/**
 * BSV P2P Native OpenClaw Plugin
 *
 * Runs P2PNode inside the gateway process as a background service.
 * Provides 3 agent tools for peer-to-peer messaging and discovery.
 */

import { P2PNode } from '../../src/daemon/node.js'
import { homedir } from 'os'
import { join } from 'path'

interface BSVConfig {
  port?: number
  relayAddress?: string
  bootstrapPeers?: string[]
  enableRelay?: boolean
  enableMdns?: boolean
  maxConnections?: number
}

export default function register(api: any) {
  let p2pNode: P2PNode | null = null
  let restartCount = 0
  let healthCheckInterval: NodeJS.Timeout | null = null
  let isShuttingDown = false

  const MAX_RESTART_ATTEMPTS = 3
  const HEALTH_CHECK_INTERVAL_MS = 60000 // 1 minute
  const MAX_MEMORY_MB = 512 // Disable plugin if memory exceeds this

  // Health check function
  function performHealthCheck() {
    try {
      if (!p2pNode || isShuttingDown) {
        return
      }

      // Check if node is responsive
      const peerId = p2pNode.getPeerId()
      if (!peerId) {
        api.logger.warn('[BSV P2P] Health check failed: No peer ID')
        return
      }

      // Check memory usage
      const memUsage = process.memoryUsage()
      const memMB = memUsage.heapUsed / 1024 / 1024

      if (memMB > MAX_MEMORY_MB) {
        api.logger.error(`[BSV P2P] Memory usage too high: ${memMB.toFixed(2)} MB (max ${MAX_MEMORY_MB} MB)`)
        api.logger.error('[BSV P2P] Disabling plugin to prevent gateway crash')
        stopService()
        return
      }

      // Log healthy status (debug level to avoid spam)
      api.logger.debug(`[BSV P2P] Health check passed (Memory: ${memMB.toFixed(2)} MB)`)

    } catch (err: any) {
      api.logger.error('[BSV P2P] Health check error:', err.message)
      // Attempt restart if health check fails repeatedly
      if (restartCount < MAX_RESTART_ATTEMPTS) {
        api.logger.warn(`[BSV P2P] Attempting restart (${restartCount + 1}/${MAX_RESTART_ATTEMPTS})`)
        restartService()
      }
    }
  }

  // Start service with restart logic
  async function startService() {
    try {
      const cfg: BSVConfig = api.config.plugins?.entries?.['bsv-p2p']?.config || {}

      api.logger.info('[BSV P2P] Starting P2P node...')

      // Initialize P2P node
      p2pNode = new P2PNode({
        port: cfg.port || 4001,
        bootstrapPeers: cfg.bootstrapPeers || [],
        relayAddress: cfg.relayAddress,
        enableRelay: cfg.enableRelay ?? true,
        enableMdns: cfg.enableMdns ?? false,
        maxConnections: cfg.maxConnections || 50
      } as any) // Type assertion to avoid config mismatch

      // Start listening
      await p2pNode.start()

      const peerId = p2pNode.getPeerId()
      api.logger.info(`[BSV P2P] Node started successfully`)
      api.logger.info(`[BSV P2P] Peer ID: ${peerId}`)

      // Handle incoming messages
      p2pNode.on('message', (msg: any) => {
        api.logger.debug('[BSV P2P] Received message:', {
          from: msg.from?.substring(0, 16) + '...',
          type: msg.type
        })
      })

      // Handle peer connections
      p2pNode.on('peer:connected', (peerId: string) => {
        api.logger.info(`[BSV P2P] Peer connected: ${peerId.substring(0, 16)}...`)
      })

      p2pNode.on('peer:disconnected', (peerId: string) => {
        api.logger.info(`[BSV P2P] Peer disconnected: ${peerId.substring(0, 16)}...`)
      })

      // Start health check interval
      if (healthCheckInterval) {
        clearInterval(healthCheckInterval)
      }
      healthCheckInterval = setInterval(performHealthCheck, HEALTH_CHECK_INTERVAL_MS)
      api.logger.debug(`[BSV P2P] Health checks enabled (every ${HEALTH_CHECK_INTERVAL_MS / 1000}s)`)

      // Reset restart count on successful start
      restartCount = 0

    } catch (err: any) {
      api.logger.error('[BSV P2P] Failed to start P2P node:', err.message)
      api.logger.error('[BSV P2P] Stack:', err.stack)

      // Attempt restart if under limit
      if (restartCount < MAX_RESTART_ATTEMPTS && !isShuttingDown) {
        restartCount++
        api.logger.warn(`[BSV P2P] Attempting automatic restart (${restartCount}/${MAX_RESTART_ATTEMPTS})`)
        await stopService()

        // Wait before restart (exponential backoff)
        const delayMs = Math.min(5000 * Math.pow(2, restartCount - 1), 30000)
        api.logger.info(`[BSV P2P] Waiting ${delayMs}ms before restart...`)
        await new Promise(resolve => setTimeout(resolve, delayMs))

        if (!isShuttingDown) {
          await startService()
        }
      } else {
        api.logger.error('[BSV P2P] Max restart attempts reached. Plugin disabled.')
        api.logger.error('[BSV P2P] Check configuration and logs. Restart gateway to retry.')
      }
    }
  }

  // Stop service
  async function stopService() {
    try {
      isShuttingDown = true
      api.logger.info('[BSV P2P] Stopping P2P node...')

      // Stop health checks
      if (healthCheckInterval) {
        clearInterval(healthCheckInterval)
        healthCheckInterval = null
      }

      if (p2pNode) {
        await p2pNode.stop()
        p2pNode = null
        api.logger.debug('[BSV P2P] P2P node stopped')
      }

      api.logger.info('[BSV P2P] Stopped successfully')
    } catch (err: any) {
      api.logger.error('[BSV P2P] Error during shutdown:', err.message)
    } finally {
      isShuttingDown = false
    }
  }

  // Restart service
  async function restartService() {
    api.logger.warn('[BSV P2P] Restarting service...')
    await stopService()
    await startService()
  }

  // Background service: P2P node lifecycle
  api.registerService({
    id: 'bsv-p2p-node',

    async start() {
      await startService()
    },

    async stop() {
      await stopService()
    },

    // Health status for monitoring
    async status() {
      try {
        if (!p2pNode) {
          return {
            status: 'stopped',
            restartCount,
            error: 'P2P node not running'
          }
        }

        const memUsage = process.memoryUsage()
        const memMB = memUsage.heapUsed / 1024 / 1024

        return {
          status: 'running',
          peerId: p2pNode.getPeerId(),
          connectedPeers: p2pNode.getConnectedPeers?.()?.length || 0,
          memoryMB: Math.round(memMB * 100) / 100,
          restartCount,
          healthCheckEnabled: healthCheckInterval !== null
        }
      } catch (err: any) {
        return {
          status: 'error',
          error: err.message,
          restartCount
        }
      }
    }
  })

  // Helper to check if P2P node is running
  function ensureRunning(): { ok: boolean; error?: string } {
    if (!p2pNode) {
      return { ok: false, error: 'P2P node not running. Check gateway logs for startup errors.' }
    }
    return { ok: true }
  }

  // Tool 1: p2p_discover - Discover peers and services
  api.registerTool({
    name: 'p2p_discover',
    description: 'Discover available peers and services on the P2P network. Use when you need to find other bots or specific services.',
    parameters: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'Optional: filter by service name (e.g. "image-analysis", "translate")'
        }
      }
    },
    async execute(_context: any, params: { service?: string }): Promise<any> {
      try {
        const check = ensureRunning()
        if (!check.ok) {
          return {
            content: [{ type: 'text', text: check.error! }],
            isError: true
          }
        }

        const connectedPeers = p2pNode!.getConnectedPeers ? p2pNode!.getConnectedPeers() : []

        if (connectedPeers.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'No peers connected yet. Make sure the P2P node has relay/bootstrap peers configured.'
            }]
          }
        }

        const peerList = connectedPeers.map((p: any, i: number) => {
          return `${i + 1}. ${p.toString()}`
        }).join('\n')

        return {
          content: [{
            type: 'text',
            text: `Found ${connectedPeers.length} connected peer(s):\n\n${peerList}`
          }]
        }
      } catch (err: any) {
        api.logger.error('[BSV P2P] p2p_discover error:', err)
        return {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true
        }
      }
    }
  })

  // Tool 2: p2p_send - Send direct message to peer
  api.registerTool({
    name: 'p2p_send',
    description: 'Send a direct message to another peer on the P2P network. Use for simple peer-to-peer communication.',
    parameters: {
      type: 'object',
      properties: {
        peerId: {
          type: 'string',
          description: 'The peer ID of the recipient (starts with 12D3KooW...)'
        },
        message: {
          type: 'string',
          description: 'The message to send'
        }
      },
      required: ['peerId', 'message']
    },
    async execute(_context: any, params: { peerId: string; message: string }): Promise<any> {
      try {
        const check = ensureRunning()
        if (!check.ok) {
          return {
            content: [{ type: 'text', text: check.error! }],
            isError: true
          }
        }

        await p2pNode!.sendMessage(params.peerId, params.message)

        return {
          content: [{
            type: 'text',
            text: `Message sent successfully to ${params.peerId.substring(0, 16)}...`
          }]
        }
      } catch (err: any) {
        api.logger.error('[BSV P2P] p2p_send error:', err)
        return {
          content: [{ type: 'text', text: `Error sending message: ${err.message}` }],
          isError: true
        }
      }
    }
  })

  // Tool 3: p2p_status - Get P2P daemon status
  api.registerTool({
    name: 'p2p_status',
    description: 'Check the status of the P2P node (peer ID, relay connection, connected peers).',
    parameters: {
      type: 'object',
      properties: {}
    },
    async execute(_context: any, _params: {}): Promise<any> {
      try {
        const check = ensureRunning()
        if (!check.ok) {
          return {
            content: [{
              type: 'text',
              text: `P2P Node Status: OFFLINE\n\n${check.error}`
            }]
          }
        }

        const peerId = p2pNode!.getPeerId()
        const connectedPeers = p2pNode!.getConnectedPeers ? p2pNode!.getConnectedPeers() : []

        const info = [
          'P2P Node Status: RUNNING',
          `  Peer ID: ${peerId}`,
          `  Connected peers: ${connectedPeers.length}`,
          `  Relay: ${p2pNode!.isRelayConnected ? p2pNode!.isRelayConnected() : 'unknown'}`
        ].join('\n')

        return {
          content: [{ type: 'text', text: info }]
        }
      } catch (err: any) {
        api.logger.error('[BSV P2P] p2p_status error:', err)
        return {
          content: [{ type: 'text', text: `Error getting status: ${err.message}` }],
          isError: true
        }
      }
    }
  })

  api.logger.info('[BSV P2P] Plugin registered successfully (P2P-only: discover, send, status)')
}
