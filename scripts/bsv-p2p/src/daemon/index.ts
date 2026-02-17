#!/usr/bin/env node

import { P2PNode } from './node.js'
import { GatewayConfig } from './gateway.js'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

interface DaemonConfig {
  port: number
  bootstrapPeers: string[]
  announceAddrs: string[]
  enableMdns: boolean
  bsvIdentityKey?: string
  announceIntervalMs: number
  gateway?: GatewayConfig
}

const DEFAULT_DAEMON_CONFIG: DaemonConfig = {
  port: 4001,
  bootstrapPeers: [],  // Use libp2p defaults
  announceAddrs: [],
  enableMdns: true,
  announceIntervalMs: 300000  // 5 minutes
}

/**
 * Load gateway config from environment variables (takes precedence)
 */
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

async function main(): Promise<void> {
  const config = loadConfig()
  
  // Load gateway config: env vars take precedence, then config file
  const envGateway = loadGatewayConfigFromEnv()
  const gatewayConfig: GatewayConfig = envGateway.enabled 
    ? envGateway 
    : (config.gateway ?? { enabled: false })
  
  console.log('Starting BSV P2P daemon...')
  console.log(`Data directory: ${getDataDir()}`)
  console.log(`Port: ${config.port}`)
  console.log(`Gateway integration: ${gatewayConfig.enabled ? 'ENABLED' : 'disabled'}`)
  if (gatewayConfig.enabled) {
    console.log(`Gateway URL: ${gatewayConfig.url ?? 'http://127.0.0.1:18789'}`)
  }
  
  const node = new P2PNode({
    port: config.port,
    // Only pass bootstrapPeers if explicitly set and non-empty, otherwise let P2PNode use defaults
    ...(config.bootstrapPeers && config.bootstrapPeers.length > 0 ? { bootstrapPeers: config.bootstrapPeers } : {}),
    announceAddrs: config.announceAddrs,
    enableMdns: config.enableMdns,
    dataDir: getDataDir(),
    gateway: gatewayConfig
  })

  // Handle shutdown gracefully
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`)
    await node.stop()
    removePidFile()
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  try {
    await node.start()
    
    // Set BSV identity key if configured
    if (config.bsvIdentityKey) {
      node.setBsvIdentityKey(config.bsvIdentityKey)
    }
    
    // Start announcing presence
    node.startAnnouncing(config.announceIntervalMs)
    
    // Save PID file
    savePidFile(process.pid)
    
    console.log('\nDaemon is running. Press Ctrl+C to stop.')
    console.log(`PeerId: ${node.peerId}`)
    console.log(`Multiaddrs: ${node.multiaddrs.join(', ')}`)
    
    // Set up event logging
    node.on('peer:connected', (peerId) => {
      console.log(`[EVENT] Peer connected: ${peerId}`)
    })
    
    node.on('peer:disconnected', (peerId) => {
      console.log(`[EVENT] Peer disconnected: ${peerId}`)
    })
    
    node.on('announcement:received', (announcement) => {
      console.log(`[EVENT] Announcement from ${announcement.peerId}: ${announcement.services.length} services`)
    })
    
    node.on('channel:message', ({ peerId, message }) => {
      console.log(`[EVENT] Channel message from ${peerId}: ${message.type}`)
    })
    
    // Gateway events
    node.gatewayClient.on('wake', ({ text }) => {
      console.log(`[GATEWAY] Woke agent with: ${text.substring(0, 80)}...`)
    })
    
    node.gatewayClient.on('error', ({ type, error }) => {
      console.error(`[GATEWAY] Error (${type}): ${error}`)
    })
    
    // Keep the process alive
    await new Promise(() => {})
    
  } catch (err) {
    console.error('Failed to start daemon:', err)
    process.exit(1)
  }
}

main().catch(console.error)
