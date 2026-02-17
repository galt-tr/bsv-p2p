#!/usr/bin/env node

import { P2PNode } from './node.js'
import { GatewayConfig } from './gateway.js'
import { ChannelManager } from '../channels/manager.js'
import { ChannelProtocol } from '../channels/protocol.js'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

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

function loadConfig(): DaemonConfig {
  const configPath = join(getDataDir(), 'config.json')
  
  if (existsSync(configPath)) {
    try {
      const data = readFileSync(configPath, 'utf-8')
      return { ...DEFAULT_DAEMON_CONFIG, ...JSON.parse(data) }
    } catch {
      return DEFAULT_DAEMON_CONFIG
    }
  }
  
  return DEFAULT_DAEMON_CONFIG
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
    
    // Get multiaddrs and check for relay
    const addrs = this.node.multiaddrs
    const relayAddrs = addrs.filter(a => a.includes('p2p-circuit') && a.includes('167.172.134.84'))
    const hasRelayReservation = relayAddrs.length > 0
    
    if (!hasRelayReservation) {
      errors.push('No relay reservation')
    }
    
    // Check if relay address changed (might indicate reconnection)
    const currentRelayAddr = relayAddrs[0] || null
    if (this.lastRelayAddr && currentRelayAddr !== this.lastRelayAddr) {
      log('INFO', 'HEALTH', 'Relay address changed', { old: this.lastRelayAddr, new: currentRelayAddr })
    }
    this.lastRelayAddr = currentRelayAddr
    
    // Check relay peer connection
    const relayPeerId = '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
    const connections = this.node.getConnections()
    const relayConnected = connections.some(c => c.remotePeer.toString() === relayPeerId)
    
    if (!relayConnected) {
      errors.push('Not connected to relay server')
    }
    
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

async function main(): Promise<void> {
  const config = loadConfig()
  
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
      log('ERROR', 'STARTUP', 'FATAL: Could not acquire relay reservation')
      log('ERROR', 'STARTUP', 'Check: Is relay server running? Is network accessible?')
      process.exit(1)
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
    
    // Start reservation refresh (every 2 minutes to prevent silent expiration)
    node.startReservationRefresh(120000)
    log('INFO', 'STARTUP', 'Relay reservation refresh started (every 2m)')
    
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
    
    log('INFO', 'STARTUP', '='.repeat(60))
    log('INFO', 'STARTUP', '✅ Daemon ready and healthy')
    log('INFO', 'STARTUP', `PeerId: ${node.peerId}`)
    log('INFO', 'STARTUP', '='.repeat(60))
    
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
