#!/usr/bin/env node

import { P2PNode } from './node.js'
import { GatewayConfig } from './gateway.js'
import { ChannelManager } from '../channels/manager.js'
import { ChannelProtocol } from '../channels/protocol.js'
import { Wallet } from '../wallet/index.js'
import { MessageType, PaymentMessage, PaymentAckMessage, createBaseMessage } from '../protocol/messages.js'
import { KeychainManager } from '../config/keychain.js'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createServer, IncomingMessage, ServerResponse } from 'http'

interface DaemonConfig {
  port: number
  bootstrapPeers: string[]
  announceAddrs: string[]
  enableMdns: boolean
  bsvIdentityKey?: string
  bsvPrivateKey?: string
  bsvPublicKey?: string
  announceIntervalMs: number
  gateway?: GatewayConfig
  healthCheckIntervalMs: number
  relayReservationTimeoutMs: number
  autoAcceptChannelsBelowSats?: number
}

const DEFAULT_DAEMON_CONFIG: DaemonConfig = {
  port: 4001,
  bootstrapPeers: [],
  announceAddrs: [],
  enableMdns: false,  // Disabled - causes version conflicts
  announceIntervalMs: 300000,  // 5 minutes
  healthCheckIntervalMs: 30000,  // 30 seconds
  relayReservationTimeoutMs: 30000  // 30 seconds to get relay reservation
}

// Debug logging with timestamps
function log(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', component: string, message: string, data?: any): void {
  const ts = new Date().toISOString()
  const prefix = `[${ts}] [${level}] [${component}]`
  if (data) {
    console.log(`${prefix} ${message}`, JSON.stringify(data, null, 2))
  } else {
    console.log(`${prefix} ${message}`)
  }
}

function loadGatewayConfigFromEnv(): GatewayConfig {
  const url = process.env.OPENCLAW_GATEWAY_URL
  const token = process.env.OPENCLAW_HOOKS_TOKEN
  
  if (token) {
    return {
      url: url ?? 'http://127.0.0.1:18789',
      token,
      enabled: true
    }
  }
  
  return { enabled: false }
}

function getDataDir(): string {
  const dir = join(homedir(), '.bsv-p2p')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

async function loadConfig(): Promise<DaemonConfig> {
  const configPath = join(getDataDir(), 'config.json')
  
  let config: DaemonConfig = DEFAULT_DAEMON_CONFIG
  
  // Load from file if exists
  if (existsSync(configPath)) {
    try {
      const data = readFileSync(configPath, 'utf-8')
      config = { ...DEFAULT_DAEMON_CONFIG, ...JSON.parse(data) }
    } catch {
      config = DEFAULT_DAEMON_CONFIG
    }
  }
  
  // Priority 1: Check OS keychain for keys
  const keychain = new KeychainManager()
  const keychainPrivateKey = await keychain.getPrivateKey()
  const keychainPublicKey = await keychain.getPublicKey()
  const keychainIdentityKey = await keychain.getIdentityKey()
  
  if (keychainPrivateKey || keychainPublicKey || keychainIdentityKey) {
    console.log('[Config] Loading keys from OS keychain')
    
    if (keychainPrivateKey) {
      config.bsvPrivateKey = keychainPrivateKey
    }
    if (keychainPublicKey) {
      config.bsvPublicKey = keychainPublicKey
    }
    if (keychainIdentityKey) {
      config.bsvIdentityKey = keychainIdentityKey
    }
  } else {
    // Migration: If keys exist in plaintext config, offer to migrate
    if (config.bsvPrivateKey || config.bsvPublicKey || config.bsvIdentityKey) {
      const keychainAvailable = await keychain.isAvailable()
      
      if (keychainAvailable) {
        console.log('[Config] ⚠️  WARNING: Keys found in plaintext config file')
        console.log('[Config] Migrating keys to OS keychain for better security...')
        
        try {
          if (config.bsvPrivateKey) {
            await keychain.setPrivateKey(config.bsvPrivateKey)
          }
          if (config.bsvPublicKey) {
            await keychain.setPublicKey(config.bsvPublicKey)
          }
          if (config.bsvIdentityKey) {
            await keychain.setIdentityKey(config.bsvIdentityKey)
          }
          
          console.log('[Config] ✅ Keys migrated to OS keychain')
          console.log('[Config] TIP: You can now remove keys from config.json for better security')
        } catch (error: any) {
          console.log('[Config] ⚠️  Failed to migrate to keychain:', error.message)
          console.log('[Config] Continuing with plaintext config keys')
        }
      }
    }
  }
  
  // Priority 2: Override with environment variables if present
  if (process.env.BSV_PRIVATE_KEY) {
    config.bsvPrivateKey = process.env.BSV_PRIVATE_KEY
    console.log('[Config] Using BSV_PRIVATE_KEY from environment')
  }
  
  if (process.env.BSV_PUBLIC_KEY) {
    config.bsvPublicKey = process.env.BSV_PUBLIC_KEY
    console.log('[Config] Using BSV_PUBLIC_KEY from environment')
  }
  
  if (process.env.BSV_IDENTITY_KEY) {
    config.bsvIdentityKey = process.env.BSV_IDENTITY_KEY
    console.log('[Config] Using BSV_IDENTITY_KEY from environment')
  }
  
  return config
}

function savePidFile(pid: number): void {
  const pidPath = join(getDataDir(), 'daemon.pid')
  writeFileSync(pidPath, pid.toString())
}

function removePidFile(): void {
  const pidPath = join(getDataDir(), 'daemon.pid')
  if (existsSync(pidPath)) {
    const { unlinkSync } = require('fs')
    unlinkSync(pidPath)
  }
}

interface HealthStatus {
  isHealthy: boolean
  peerId: string
  relayConnected: boolean
  relayReservationActive: boolean
  relayAddress: string | null
  connectedPeers: number
  uptime: number
  lastCheck: string
  errors: string[]
}

class DaemonHealthMonitor {
  private node: P2PNode
  private config: DaemonConfig
  private startTime: number = Date.now()
  private healthInterval: NodeJS.Timeout | null = null
  private lastRelayAddr: string | null = null
  private consecutiveFailures: number = 0
  private isRestarting: boolean = false
  
  constructor(node: P2PNode, config: DaemonConfig) {
    this.node = node
    this.config = config
  }
  
  async start(): Promise<void> {
    log('INFO', 'HEALTH', 'Starting health monitor')
    
    // Initial health check
    const initialStatus = await this.checkHealth()
    this.logHealthStatus(initialStatus)
    
    // Start periodic health checks
    this.healthInterval = setInterval(async () => {
      const status = await this.checkHealth()
      
      if (!status.isHealthy) {
        this.consecutiveFailures++
        log('WARN', 'HEALTH', `Health check failed (${this.consecutiveFailures} consecutive)`, status.errors)
        
        // Try to recover after 3 consecutive failures
        if (this.consecutiveFailures >= 3 && !this.isRestarting) {
          await this.attemptRecovery()
        }
      } else {
        if (this.consecutiveFailures > 0) {
          log('INFO', 'HEALTH', 'Health recovered')
        }
        this.consecutiveFailures = 0
      }
      
      // Log status periodically (every 5 checks = 2.5 minutes)
      if (Math.random() < 0.2) {
        this.logHealthStatus(status)
      }
    }, this.config.healthCheckIntervalMs)
  }
  
  stop(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval)
      this.healthInterval = null
    }
  }
  
  async checkHealth(): Promise<HealthStatus> {
    const errors: string[] = []
    
    // Check node is started
    if (!this.node.isStarted) {
      errors.push('Node not started')
    }
    
    // PRIMARY CHECK: Are we connected to the relay server?
    // Per circuit-v2 spec, reservation is only valid while connection is maintained.
    const relayPeerId = '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
    const connections = this.node.getConnections()
    const relayConnection = connections.find(c => c.remotePeer.toString() === relayPeerId)
    const relayConnected = !!relayConnection
    
    if (!relayConnected) {
      errors.push('Not connected to relay server (reservation INVALID)')
    }
    
    // SECONDARY CHECK: Do we have relay addresses in our multiaddrs?
    // This can lag behind the actual connection state.
    const addrs = this.node.multiaddrs
    const relayAddrs = addrs.filter(a => a.includes('p2p-circuit') && a.includes('167.172.134.84'))
    const hasRelayReservation = relayAddrs.length > 0
    
    if (!hasRelayReservation && relayConnected) {
      // Connected but no address yet - may still be establishing reservation
      log('DEBUG', 'HEALTH', 'Connected to relay but reservation not yet visible')
    }
    
    // Check if relay address changed (might indicate reconnection)
    const currentRelayAddr = relayAddrs[0] || null
    if (this.lastRelayAddr && currentRelayAddr !== this.lastRelayAddr) {
      log('INFO', 'HEALTH', 'Relay address changed', { old: this.lastRelayAddr, new: currentRelayAddr })
    }
    this.lastRelayAddr = currentRelayAddr
    
    return {
      isHealthy: errors.length === 0,
      peerId: this.node.peerId,
      relayConnected,
      relayReservationActive: hasRelayReservation,
      relayAddress: currentRelayAddr,
      connectedPeers: connections.length,
      uptime: Date.now() - this.startTime,
      lastCheck: new Date().toISOString(),
      errors
    }
  }
  
  private logHealthStatus(status: HealthStatus): void {
    const uptimeMin = Math.floor(status.uptime / 60000)
    log(status.isHealthy ? 'INFO' : 'WARN', 'HEALTH', 
      `Status: ${status.isHealthy ? '✅ HEALTHY' : '❌ UNHEALTHY'} | ` +
      `Relay: ${status.relayReservationActive ? '✅' : '❌'} | ` +
      `Peers: ${status.connectedPeers} | ` +
      `Uptime: ${uptimeMin}m`,
      status.isHealthy ? undefined : { errors: status.errors }
    )
  }
  
  private async attemptRecovery(): Promise<void> {
    log('WARN', 'HEALTH', 'Attempting recovery - will reconnect to relay')
    this.isRestarting = true
    
    try {
      // Force reconnect to relay by dialing it
      const relayMultiaddr = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
      await this.node.dialRelay(relayMultiaddr)
      
      // Wait for new reservation
      log('INFO', 'HEALTH', 'Waiting for new relay reservation...')
      await new Promise(r => setTimeout(r, 5000))
      
      const status = await this.checkHealth()
      if (status.isHealthy) {
        log('INFO', 'HEALTH', '✅ Recovery successful!')
        this.consecutiveFailures = 0
      } else {
        log('ERROR', 'HEALTH', 'Recovery failed', status.errors)
      }
    } catch (err: any) {
      log('ERROR', 'HEALTH', 'Recovery error', { error: err.message })
    } finally {
      this.isRestarting = false
    }
  }
}

async function waitForRelayReservation(node: P2PNode, timeoutMs: number): Promise<boolean> {
  const startTime = Date.now()
  const checkInterval = 1000
  
  log('INFO', 'STARTUP', `Waiting for relay reservation (timeout: ${timeoutMs}ms)...`)
  
  while (Date.now() - startTime < timeoutMs) {
    const addrs = node.multiaddrs
    const relayAddrs = addrs.filter(a => a.includes('p2p-circuit') && a.includes('167.172.134.84'))
    
    if (relayAddrs.length > 0) {
      log('INFO', 'STARTUP', '✅ Relay reservation acquired!', { relayAddr: relayAddrs[0] })
      return true
    }
    
    const elapsed = Math.floor((Date.now() - startTime) / 1000)
    if (elapsed % 5 === 0 && elapsed > 0) {
      log('DEBUG', 'STARTUP', `Still waiting for reservation... (${elapsed}s)`)
    }
    
    await new Promise(r => setTimeout(r, checkInterval))
  }
  
  log('ERROR', 'STARTUP', '❌ Timeout waiting for relay reservation')
  return false
}

/**
 * Background task to retry relay reservation with exponential backoff
 */
function startRelayRetryBackgroundTask(node: P2PNode, initialTimeoutMs: number): void {
  let retryAttempt = 0
  const maxBackoffMs = 5 * 60 * 1000  // Cap at 5 minutes
  
  async function retryRelay() {
    // Exponential backoff: 30s, 60s, 120s, 240s, 300s (capped at 5min)
    const backoffMs = Math.min(30000 * Math.pow(2, retryAttempt), maxBackoffMs)
    retryAttempt++
    
    log('INFO', 'RELAY_RETRY', `Retrying relay reservation in ${Math.floor(backoffMs / 1000)}s (attempt #${retryAttempt})`)
    
    await new Promise(r => setTimeout(r, backoffMs))
    
    // Check if we now have relay reservation
    const addrs = node.multiaddrs
    const relayAddrs = addrs.filter(a => a.includes('p2p-circuit'))
    
    if (relayAddrs.length > 0) {
      log('INFO', 'RELAY_RETRY', '✅ Relay reservation acquired on retry!', { relayAddr: relayAddrs[0] })
      // Success - stop retrying
      return
    }
    
    log('WARN', 'RELAY_RETRY', `Still no relay reservation (attempt #${retryAttempt})`)
    
    // Continue retrying indefinitely with exponential backoff
    retryRelay()
  }
  
  // Start the retry loop (non-blocking)
  retryRelay().catch(err => {
    log('ERROR', 'RELAY_RETRY', 'Relay retry error:', err)
  })
}

async function main(): Promise<void> {
  const config = await loadConfig()
  
  const envGateway = loadGatewayConfigFromEnv()
  const gatewayConfig: GatewayConfig = envGateway.enabled 
    ? envGateway 
    : (config.gateway ?? { enabled: false })
  
  log('INFO', 'STARTUP', '='.repeat(60))
  log('INFO', 'STARTUP', 'BSV P2P Daemon Starting')
  log('INFO', 'STARTUP', '='.repeat(60))
  log('INFO', 'STARTUP', 'Configuration', {
    dataDir: getDataDir(),
    port: config.port,
    gateway: gatewayConfig.enabled ? gatewayConfig.url : 'disabled',
    healthCheckInterval: `${config.healthCheckIntervalMs}ms`,
    mDNS: config.enableMdns
  })
  
  const node = new P2PNode({
    port: config.port,
    ...(config.bootstrapPeers && config.bootstrapPeers.length > 0 ? { bootstrapPeers: config.bootstrapPeers } : {}),
    announceAddrs: config.announceAddrs,
    enableMdns: config.enableMdns,
    dataDir: getDataDir(),
    gateway: gatewayConfig
  })

  const shutdown = async (signal: string) => {
    log('INFO', 'SHUTDOWN', `Received ${signal}, shutting down...`)
    healthMonitor?.stop()
    await node.stop()
    removePidFile()
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  
  let healthMonitor: DaemonHealthMonitor | null = null

  try {
    // Start the node
    log('INFO', 'STARTUP', 'Starting P2P node...')
    await node.start()
    log('INFO', 'STARTUP', `PeerId: ${node.peerId}`)
    
    // Set BSV identity key if configured
    if (config.bsvIdentityKey) {
      node.setBsvIdentityKey(config.bsvIdentityKey)
      log('INFO', 'STARTUP', 'BSV identity key configured')
    }
    
    // Wait for relay reservation with timeout
    const hasReservation = await waitForRelayReservation(node, config.relayReservationTimeoutMs)
    
    if (!hasReservation) {
      log('WARN', 'STARTUP', '⚠️  Could not acquire relay reservation within timeout')
      log('WARN', 'STARTUP', 'Continuing without relay (graceful degradation)')
      log('WARN', 'STARTUP', 'Relay retry will run in background with exponential backoff')
      log('INFO', 'STARTUP', 'Check: Is relay server running? Is network accessible?')
      
      // Start background retry with exponential backoff (don't block startup)
      startRelayRetryBackgroundTask(node, config.relayReservationTimeoutMs)
    }
    
    // Log all addresses
    const addrs = node.multiaddrs
    log('INFO', 'STARTUP', 'Listening addresses', { 
      total: addrs.length,
      relay: addrs.filter(a => a.includes('p2p-circuit')).length,
      direct: addrs.filter(a => !a.includes('p2p-circuit')).length
    })
    
    // Start announcing presence
    node.startAnnouncing(config.announceIntervalMs)
    
    // Save PID file
    savePidFile(process.pid)
    
    // Start health monitor
    healthMonitor = new DaemonHealthMonitor(node, config)
    await healthMonitor.start()
    
    // Start relay connection maintenance (every 10 seconds to detect disconnections quickly)
    // NOTE: We no longer "refresh" reservations by closing connections - that was the bug!
    // Instead, we maintain the connection, and libp2p handles reservation refresh internally.
    node.startRelayConnectionMaintenance(10_000)
    log('INFO', 'STARTUP', 'Relay connection maintenance started (check every 10s)')
    
    // Set up event logging
    node.on('peer:connected', (peerId) => {
      log('DEBUG', 'EVENT', `Peer connected: ${peerId}`)
    })
    
    node.on('peer:disconnected', (peerId) => {
      log('DEBUG', 'EVENT', `Peer disconnected: ${peerId}`)
    })
    
    node.on('announcement:received', (announcement) => {
      log('DEBUG', 'EVENT', `Announcement from ${announcement.peerId}: ${announcement.services.length} services`)
    })
    
    node.on('channel:message', ({ peerId, message }) => {
      log('INFO', 'EVENT', `Channel message from ${peerId}: ${message.type}`)
    })
    
    node.gatewayClient.on('wake', ({ text }) => {
      log('INFO', 'GATEWAY', `Woke agent: ${text.substring(0, 80)}...`)
    })
    
    node.gatewayClient.on('error', ({ type, error }) => {
      log('ERROR', 'GATEWAY', `Error (${type}): ${error}`)
    })
    
    // Initialize payment channels if BSV keys are configured
    let channelProtocol: ChannelProtocol | null = null
    if (config.bsvPrivateKey && config.bsvPublicKey) {
      const channelManager = new ChannelManager({
        privateKey: config.bsvPrivateKey,
        publicKey: config.bsvPublicKey
      })
      
      if (node.messages) {
        channelProtocol = new ChannelProtocol({
          channelManager,
          messageHandler: node.messages,
          peerId: node.peerId,
          autoAcceptMaxCapacity: config.autoAcceptChannelsBelowSats ?? 0,
          onChannelReady: (channel) => {
            log('INFO', 'CHANNEL', `Channel ready: ${channel.id.substring(0, 8)}... with ${channel.remotePeerId.substring(0, 16)}...`)
          },
          onPaidRequest: async (req, channel) => {
            // Wake agent for paid requests
            log('INFO', 'CHANNEL', `Paid request: ${req.service} for ${req.payment.amount} sats`)
            
            // Format message for agent
            const text = `[P2P Paid Request]
Service: ${req.service}
Payment: ${req.payment.amount} sats
Channel: ${channel.id.substring(0, 16)}
From: ${req.from.substring(0, 16)}
Params: ${JSON.stringify(req.params)}
Request ID: ${req.id}

Respond to complete the service.`
            
            await node.gatewayClient.wake(text, { mode: 'now' })
            
            // Return pending - agent will respond via CLI
            return { success: false, error: 'Pending agent response' }
          }
        })
        
        channelProtocol.on('channel:opened', (channel) => {
          log('INFO', 'CHANNEL', `Channel opened: ${channel.id.substring(0, 8)}...`)
        })
        
        channelProtocol.on('payment:received', ({ channel, payment }) => {
          log('INFO', 'CHANNEL', `Payment received: ${payment.amount} sats on channel ${channel.id.substring(0, 8)}...`)
        })
        
        log('INFO', 'STARTUP', 'Payment channels enabled', {
          autoAccept: config.autoAcceptChannelsBelowSats ?? 0
        })
      } else {
        log('WARN', 'STARTUP', 'Message handler not available, payment channels disabled')
      }
    } else {
      log('INFO', 'STARTUP', 'Payment channels disabled (no BSV keys configured)')
    }
    
    // Initialize wallet if BSV keys are configured
    let wallet: Wallet | null = null
    if (config.bsvPrivateKey) {
      wallet = new Wallet({
        privateKey: config.bsvPrivateKey
      })
      
      log('INFO', 'STARTUP', `Wallet initialized: ${wallet.getAddress()}`)
      log('INFO', 'STARTUP', `Balance: ${wallet.getBalance()} sats`)
      
      // Set up payment message handler
      if (node.messages) {
        node.messages.on(MessageType.PAYMENT, async (msg: PaymentMessage, fromPeerId: string) => {
          log('INFO', 'PAYMENT', `Received payment notification from ${fromPeerId.substring(0, 16)}...`)
          log('INFO', 'PAYMENT', `  TXID: ${msg.txid}, Amount: ${msg.amount} sats`)
          
          // Record the payment
          wallet!.recordPayment(
            msg.txid,
            msg.vout,
            msg.amount,
            '', // Script will be fetched on sync
            fromPeerId,
            msg.memo
          )
          
          // Wake agent to notify of payment
          const text = `[P2P Payment Received]
From: ${fromPeerId.substring(0, 16)}...
Amount: ${msg.amount} sats
TXID: ${msg.txid}
${msg.memo ? `Memo: ${msg.memo}` : ''}`
          
          await node.gatewayClient.wake(text, { mode: 'now' })
          
          // Send acknowledgment
          const ackMsg: PaymentAckMessage = {
            ...createBaseMessage(MessageType.PAYMENT_ACK, node.peerId, fromPeerId),
            type: MessageType.PAYMENT_ACK,
            paymentId: msg.id,
            txid: msg.txid,
            received: true,
            balance: wallet!.getBalance()
          }
          
          await node.messages!.send(fromPeerId, ackMsg)
        })
        
        node.messages.on(MessageType.PAYMENT_ACK, async (msg: PaymentAckMessage, fromPeerId: string) => {
          log('INFO', 'PAYMENT', `Payment acknowledged by ${fromPeerId.substring(0, 16)}...`)
          log('INFO', 'PAYMENT', `  TXID: ${msg.txid}, Their balance: ${msg.balance ?? 'unknown'}`)
        })
      }
    }
    
    log('INFO', 'STARTUP', '='.repeat(60))
    log('INFO', 'STARTUP', '✅ Daemon ready and healthy')
    log('INFO', 'STARTUP', `PeerId: ${node.peerId}`)
    if (wallet) {
      log('INFO', 'STARTUP', `Wallet: ${wallet.getAddress()}`)
    }
    log('INFO', 'STARTUP', '='.repeat(60))
    
    // Start HTTP API server for sending messages
    const API_PORT = 4003
    const apiServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Content-Type', 'application/json')
      
      if (req.method === 'GET' && req.url === '/status') {
        res.writeHead(200)
        res.end(JSON.stringify({
          peerId: node.peerId,
          relayAddress: node.getRelayAddress(),
          isHealthy: node.isConnectedToRelay(),
          connectedPeers: node.getConnectedPeers().length
        }))
        return
      }
      
      // Get list of connected peers
      if (req.method === 'GET' && req.url === '/peers') {
        res.writeHead(200)
        res.end(JSON.stringify({
          peers: node.getConnectedPeers().map(peerId => ({ peerId }))
        }))
        return
      }
      
      // Discover peers (with optional service filter)
      if (req.method === 'GET' && (req.url === '/discover' || req.url?.startsWith('/discover?'))) {
        const url = new URL(req.url!, `http://${req.headers.host}`)
        const serviceFilter = url.searchParams.get('service')
        
        try {
          const peers = await node.discoverPeers({ service: serviceFilter ?? undefined })
          
          res.writeHead(200)
          res.end(JSON.stringify({
            peers: peers.map(peer => ({
              peerId: peer.peerId,
              multiaddrs: peer.multiaddrs,
              services: peer.services ?? [],
              bsvIdentityKey: peer.bsvIdentityKey,
              lastSeen: peer.lastSeen
            })),
            query: serviceFilter ? { service: serviceFilter } : {}
          }))
        } catch (err: any) {
          log('ERROR', 'API', `Discovery failed: ${err.message}`)
          res.writeHead(500)
          res.end(JSON.stringify({ error: err.message }))
        }
        return
      }
      
      // Register a service
      if (req.method === 'POST' && req.url === '/services') {
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', async () => {
          try {
            const service = JSON.parse(body)
            
            if (!service.id || !service.name || service.price === undefined || !service.currency) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'Service must have id, name, price, and currency' }))
              return
            }
            
            log('INFO', 'API', `Registering service: ${service.id} (${service.name})`)
            node.registerService(service)
            
            res.writeHead(200)
            res.end(JSON.stringify({ 
              success: true,
              service,
              message: 'Service registered and will be announced via GossipSub'
            }))
          } catch (err: any) {
            log('ERROR', 'API', `Service registration failed: ${err.message}`)
            res.writeHead(500)
            res.end(JSON.stringify({ error: err.message }))
          }
        })
        return
      }
      
      // Unregister a service
      if (req.method === 'DELETE' && req.url?.startsWith('/services/')) {
        const serviceId = req.url.substring('/services/'.length)
        
        try {
          log('INFO', 'API', `Unregistering service: ${serviceId}`)
          node.unregisterService(serviceId)
          
          res.writeHead(200)
          res.end(JSON.stringify({ 
            success: true,
            serviceId,
            message: 'Service unregistered'
          }))
        } catch (err: any) {
          log('ERROR', 'API', `Service unregistration failed: ${err.message}`)
          res.writeHead(500)
          res.end(JSON.stringify({ error: err.message }))
        }
        return
      }
      
      // Get our registered services
      if (req.method === 'GET' && req.url === '/services') {
        try {
          const services = node.getServices()
          
          res.writeHead(200)
          res.end(JSON.stringify({
            services,
            count: services.length
          }))
        } catch (err: any) {
          log('ERROR', 'API', `Failed to get services: ${err.message}`)
          res.writeHead(500)
          res.end(JSON.stringify({ error: err.message }))
        }
        return
      }
      
      // Get discovery service stats
      if (req.method === 'GET' && req.url === '/discovery/stats') {
        try {
          const stats = node.getDiscoveryStats()
          
          res.writeHead(200)
          res.end(JSON.stringify(stats))
        } catch (err: any) {
          log('ERROR', 'API', `Failed to get discovery stats: ${err.message}`)
          res.writeHead(500)
          res.end(JSON.stringify({ error: err.message }))
        }
        return
      }
      
      if (req.method === 'POST' && req.url === '/send') {
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', async () => {
          try {
            const { peerId, message } = JSON.parse(body)
            if (!peerId || !message) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'Missing peerId or message' }))
              return
            }
            
            log('INFO', 'API', `Sending message to ${peerId.substring(0, 16)}...`)
            await node.sendMessage(peerId, message)
            
            res.writeHead(200)
            res.end(JSON.stringify({ success: true, from: node.peerId }))
          } catch (err: any) {
            log('ERROR', 'API', `Send failed: ${err.message}`)
            res.writeHead(500)
            res.end(JSON.stringify({ error: err.message }))
          }
        })
        return
      }
      
      // Channel operations
      if (req.method === 'POST' && req.url === '/channel/open') {
        if (!channelProtocol) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Payment channels not enabled (no BSV keys configured)' }))
          return
        }
        
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', async () => {
          try {
            const { peerId, remotePubKey, capacity } = JSON.parse(body)
            if (!peerId || !remotePubKey) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'Missing peerId or remotePubKey' }))
              return
            }
            
            log('INFO', 'API', `Opening channel with ${peerId.substring(0, 16)}... capacity: ${capacity ?? 10000} sats`)
            const channel = await channelProtocol.openChannel(peerId, remotePubKey, capacity ?? 10000)
            
            res.writeHead(200)
            res.end(JSON.stringify({ 
              success: true, 
              channelId: channel.id,
              state: channel.state,
              capacity: channel.capacity
            }))
          } catch (err: any) {
            log('ERROR', 'API', `Channel open failed: ${err.message}`)
            res.writeHead(500)
            res.end(JSON.stringify({ error: err.message }))
          }
        })
        return
      }
      
      // Fund a channel with a real UTXO
      if (req.method === 'POST' && req.url === '/channel/fund') {
        if (!channelProtocol) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Payment channels not enabled (no BSV keys configured)' }))
          return
        }
        
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', async () => {
          try {
            const { channelId, utxo, fee } = JSON.parse(body)
            if (!channelId || !utxo) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'Missing channelId or utxo' }))
              return
            }
            
            if (!utxo.txid || utxo.vout === undefined || !utxo.satoshis || !utxo.scriptPubKey) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'UTXO must have txid, vout, satoshis, and scriptPubKey' }))
              return
            }
            
            log('INFO', 'API', `Funding channel ${channelId.substring(0, 8)}... with UTXO ${utxo.txid.substring(0, 8)}:${utxo.vout}`)
            const fundingTxId = await channelProtocol.fundChannel(channelId, utxo, fee ?? 200)
            
            res.writeHead(200)
            res.end(JSON.stringify({ 
              success: true, 
              channelId,
              fundingTxId,
              message: 'Channel funded. Wait for confirmation before opening.'
            }))
          } catch (err: any) {
            log('ERROR', 'API', `Channel funding failed: ${err.message}`)
            res.writeHead(500)
            res.end(JSON.stringify({ error: err.message }))
          }
        })
        return
      }
      
      // Verify and open a funded channel
      if (req.method === 'POST' && req.url === '/channel/verify-open') {
        if (!channelProtocol) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Payment channels not enabled' }))
          return
        }
        
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', async () => {
          try {
            const { channelId } = JSON.parse(body)
            if (!channelId) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'Missing channelId' }))
              return
            }
            
            log('INFO', 'API', `Verifying and opening channel ${channelId.substring(0, 8)}...`)
            const verified = await channelProtocol.verifyAndOpenChannel(channelId)
            
            if (verified) {
              res.writeHead(200)
              res.end(JSON.stringify({ 
                success: true, 
                channelId,
                state: 'open',
                message: 'Channel verified with SPV and opened.'
              }))
            } else {
              res.writeHead(400)
              res.end(JSON.stringify({ 
                success: false,
                channelId,
                message: 'Funding transaction not confirmed yet. Try again later.'
              }))
            }
          } catch (err: any) {
            log('ERROR', 'API', `Channel verify/open failed: ${err.message}`)
            res.writeHead(500)
            res.end(JSON.stringify({ error: err.message }))
          }
        })
        return
      }
      
      if (req.method === 'GET' && req.url === '/channels') {
        if (!channelProtocol) {
          res.writeHead(200)
          res.end(JSON.stringify({ channels: [], enabled: false }))
          return
        }
        
        const channels = channelProtocol.getChannels()
        res.writeHead(200)
        res.end(JSON.stringify({ 
          channels: channels.map(c => ({
            id: c.id,
            remotePeerId: c.remotePeerId,
            state: c.state,
            capacity: c.capacity,
            localBalance: c.localBalance,
            remoteBalance: c.remoteBalance,
            fundingTxId: c.fundingTxId
          })),
          enabled: true
        }))
        return
      }
      
      // Send payment through a channel
      if (req.method === 'POST' && req.url === '/channel/pay') {
        if (!channelProtocol) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Payment channels not enabled' }))
          return
        }
        
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', async () => {
          try {
            const { channelId, amount } = JSON.parse(body)
            if (!channelId || !amount) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'Missing channelId or amount' }))
              return
            }
            
            log('INFO', 'API', `Sending payment of ${amount} sats on channel ${channelId.substring(0, 8)}...`)
            const payment = await channelProtocol.pay(channelId, amount)
            
            res.writeHead(200)
            res.end(JSON.stringify({ 
              success: true,
              channelId,
              amount,
              newLocalBalance: payment.newLocalBalance,
              newRemoteBalance: payment.newRemoteBalance,
              sequence: payment.newSequenceNumber
            }))
          } catch (err: any) {
            log('ERROR', 'API', `Payment failed: ${err.message}`)
            res.writeHead(500)
            res.end(JSON.stringify({ error: err.message }))
          }
        })
        return
      }
      
      // Cooperative close a channel
      if (req.method === 'POST' && req.url === '/channel/close') {
        if (!channelProtocol) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Payment channels not enabled' }))
          return
        }
        
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', async () => {
          try {
            const { channelId } = JSON.parse(body)
            if (!channelId) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'Missing channelId' }))
              return
            }
            
            log('INFO', 'API', `Initiating cooperative close for channel ${channelId.substring(0, 8)}...`)
            const closeRequest = await channelProtocol.initiateCooperativeClose(channelId, config.bsvPrivateKey!)
            
            res.writeHead(200)
            res.end(JSON.stringify({ 
              success: true,
              channelId,
              message: 'Close request sent to counterparty. Waiting for signature...',
              initiatorBalance: closeRequest.initiatorBalance,
              responderBalance: closeRequest.responderBalance,
              fee: closeRequest.fee
            }))
          } catch (err: any) {
            log('ERROR', 'API', `Close failed: ${err.message}`)
            res.writeHead(500)
            res.end(JSON.stringify({ error: err.message }))
          }
        })
        return
      }
      
      // ============================================================
      // Wallet Endpoints
      // ============================================================
      
      // Get wallet address
      if (req.method === 'GET' && req.url === '/wallet/address') {
        if (!wallet) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Wallet not enabled (no BSV keys configured)' }))
          return
        }
        
        res.writeHead(200)
        res.end(JSON.stringify({
          address: wallet.getAddress(),
          publicKey: wallet.getPublicKey()
        }))
        return
      }
      
      // Get wallet balance
      if (req.method === 'GET' && req.url === '/wallet/balance') {
        if (!wallet) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Wallet not enabled' }))
          return
        }
        
        res.writeHead(200)
        res.end(JSON.stringify({
          balance: wallet.getBalance(),
          utxos: wallet.getUTXOs().length
        }))
        return
      }
      
      // Get wallet UTXOs
      if (req.method === 'GET' && req.url === '/wallet/utxos') {
        if (!wallet) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Wallet not enabled' }))
          return
        }
        
        res.writeHead(200)
        res.end(JSON.stringify({
          utxos: wallet.getUTXOs()
        }))
        return
      }
      
      // Sync wallet from blockchain
      if (req.method === 'POST' && req.url === '/wallet/sync') {
        if (!wallet) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Wallet not enabled' }))
          return
        }
        
        try {
          const newUtxos = await wallet.sync()
          res.writeHead(200)
          res.end(JSON.stringify({
            success: true,
            newUtxos,
            balance: wallet.getBalance()
          }))
        } catch (err: any) {
          log('ERROR', 'API', `Wallet sync failed: ${err.message}`)
          res.writeHead(500)
          res.end(JSON.stringify({ error: err.message }))
        }
        return
      }
      
      // Send payment to an address
      if (req.method === 'POST' && req.url === '/wallet/send') {
        if (!wallet) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Wallet not enabled' }))
          return
        }
        
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', async () => {
          try {
            const { toAddress, amount, fee } = JSON.parse(body)
            if (!toAddress || !amount) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'Missing toAddress or amount' }))
              return
            }
            
            log('INFO', 'API', `Sending ${amount} sats to ${toAddress}`)
            const result = await wallet!.send(toAddress, amount, fee ?? 200)
            
            res.writeHead(200)
            res.end(JSON.stringify({
              success: true,
              txid: result.txid,
              vout: result.vout,
              change: result.change,
              newBalance: wallet!.getBalance()
            }))
          } catch (err: any) {
            log('ERROR', 'API', `Send failed: ${err.message}`)
            res.writeHead(500)
            res.end(JSON.stringify({ error: err.message }))
          }
        })
        return
      }
      
      // Send payment to a peer (on-chain + P2P notification)
      if (req.method === 'POST' && req.url === '/payment/send') {
        if (!wallet) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Wallet not enabled' }))
          return
        }
        
        if (!node.messages) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'P2P messaging not available' }))
          return
        }
        
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', async () => {
          try {
            const { peerId, amount, memo, fee } = JSON.parse(body)
            if (!peerId || !amount) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'Missing peerId or amount' }))
              return
            }
            
            // First, get peer's address by sending a request (or use known address)
            // For now, we'll require the caller to provide the address
            // In a full implementation, we'd query the peer first
            const { toAddress } = JSON.parse(body)
            if (!toAddress) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'Missing toAddress (peer BSV address)' }))
              return
            }
            
            log('INFO', 'API', `Sending ${amount} sats to peer ${peerId.substring(0, 16)}... at ${toAddress}`)
            
            // Send the payment on-chain
            const result = await wallet!.send(toAddress, amount, fee ?? 200)
            
            // Notify the peer via P2P
            const paymentMsg: PaymentMessage = {
              ...createBaseMessage(MessageType.PAYMENT, node.peerId, peerId),
              type: MessageType.PAYMENT,
              txid: result.txid,
              vout: result.vout,
              amount,
              toAddress,
              memo
            }
            
            await node.messages!.send(peerId, paymentMsg)
            log('INFO', 'API', `Payment notification sent to peer`)
            
            res.writeHead(200)
            res.end(JSON.stringify({
              success: true,
              txid: result.txid,
              vout: result.vout,
              amount,
              change: result.change,
              newBalance: wallet!.getBalance(),
              notificationSent: true
            }))
          } catch (err: any) {
            log('ERROR', 'API', `Payment to peer failed: ${err.message}`)
            res.writeHead(500)
            res.end(JSON.stringify({ error: err.message }))
          }
        })
        return
      }
      
      res.writeHead(404)
      res.end(JSON.stringify({ error: 'Not found' }))
    })
    
    apiServer.listen(API_PORT, '127.0.0.1', () => {
      log('INFO', 'STARTUP', `API server listening on http://127.0.0.1:${API_PORT}`)
      log('INFO', 'STARTUP', `Send messages: curl -X POST http://127.0.0.1:${API_PORT}/send -d '{"peerId":"...","message":"..."}'`)
    })
    
    // Keep the process alive
    await new Promise(() => {})
    
  } catch (err: any) {
    log('ERROR', 'STARTUP', 'Failed to start daemon', { error: err.message, stack: err.stack })
    process.exit(1)
  }
}

main().catch((err) => {
  log('ERROR', 'FATAL', 'Unhandled error', { error: err.message, stack: err.stack })
  process.exit(1)
})
