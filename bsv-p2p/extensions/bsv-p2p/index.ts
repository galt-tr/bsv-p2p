/**
 * BSV P2P Native OpenClaw Plugin
 * 
 * Runs P2PNode inside the gateway process as a background service.
 * Provides 5 agent tools for peer-to-peer messaging and payment channels.
 */

import { P2PNode } from '../../src/daemon/node.js'
import { ChannelManager } from '../../src/channels/manager.js'
import { Wallet } from '../../src/wallet/index.js'
import { homedir } from 'os'
import { join } from 'path'

interface BSVConfig {
  port?: number
  relayAddress?: string
  bootstrapPeers?: string[]
  walletPath?: string
  bsvIdentityKey?: string
  enableRelay?: boolean
  enableMdns?: boolean
  maxConnections?: number
}

export default function register(api: any) {
  let p2pNode: P2PNode | null = null
  let channelManager: ChannelManager | null = null
  let wallet: Wallet | null = null

  // Helper to expand ~ in paths
  function expandPath(path: string): string {
    if (path.startsWith('~/')) {
      return join(homedir(), path.slice(2))
    }
    return path
  }

  // Background service: P2P node lifecycle
  api.registerService({
    id: 'bsv-p2p-node',
    
    async start() {
      try {
        const cfg: BSVConfig = api.config.plugins?.entries?.['bsv-p2p']?.config || {}
        
        api.logger.info('[BSV P2P] Starting P2P node...')
        
        // Initialize wallet
        const walletPath = expandPath(cfg.walletPath || '~/.bsv-p2p/wallet.db')
        wallet = new Wallet(walletPath)
        api.logger.debug(`[BSV P2P] Wallet initialized at ${walletPath}`)
        
        // Initialize channel manager
        channelManager = new ChannelManager(wallet)
        api.logger.debug('[BSV P2P] Channel manager initialized')
        
        // Initialize P2P node
        p2pNode = new P2PNode({
          port: cfg.port || 4001,
          bootstrapPeers: cfg.bootstrapPeers || [],
          wallet,
          relayAddress: cfg.relayAddress,
          enableRelay: cfg.enableRelay ?? true,
          enableMdns: cfg.enableMdns ?? false,
          maxConnections: cfg.maxConnections || 50
        } as any) // Type assertion to avoid config mismatch
        
        // Register channel manager with P2P node
        if (p2pNode.registerChannelManager) {
          p2pNode.registerChannelManager(channelManager)
        }
        
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
          // TODO: Route to appropriate handler based on message type
        })
        
        // Handle peer connections
        p2pNode.on('peer:connected', (peerId: string) => {
          api.logger.info(`[BSV P2P] Peer connected: ${peerId.substring(0, 16)}...`)
        })
        
        p2pNode.on('peer:disconnected', (peerId: string) => {
          api.logger.info(`[BSV P2P] Peer disconnected: ${peerId.substring(0, 16)}...`)
        })
        
      } catch (err: any) {
        api.logger.error('[BSV P2P] Failed to start P2P node:', err.message)
        // Don't throw - let gateway continue running
        await this.stop()
      }
    },
    
    async stop() {
      try {
        api.logger.info('[BSV P2P] Stopping P2P node...')
        
        if (p2pNode) {
          await p2pNode.stop()
          p2pNode = null
          api.logger.debug('[BSV P2P] P2P node stopped')
        }
        
        if (channelManager) {
          // await channelManager.shutdown() // If this method exists
          channelManager = null
          api.logger.debug('[BSV P2P] Channel manager stopped')
        }
        
        if (wallet) {
          wallet.close()
          wallet = null
          api.logger.debug('[BSV P2P] Wallet closed')
        }
        
        api.logger.info('[BSV P2P] Stopped successfully')
      } catch (err: any) {
        api.logger.error('[BSV P2P] Error during shutdown:', err.message)
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

        // Call discoverPeers on P2PNode (if method exists)
        // For now, return connected peers
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

  // Tool 3: p2p_request - Request paid service from peer
  api.registerTool({
    name: 'p2p_request',
    description: 'Request a paid service from another peer. The peer will provide a quote, and payment will be handled automatically via payment channel or on-chain.',
    parameters: {
      type: 'object',
      properties: {
        peerId: {
          type: 'string',
          description: 'The peer ID of the service provider'
        },
        service: {
          type: 'string',
          description: 'The service name (e.g. "translate", "image-analysis", "poem")'
        },
        input: {
          type: 'object',
          description: 'Service-specific input parameters (JSON object)',
          additionalProperties: true
        },
        maxPayment: {
          type: 'number',
          description: 'Maximum payment willing to make in satoshis (default: 1000)',
          default: 1000
        }
      },
      required: ['peerId', 'service', 'input']
    },
    async execute(_context: any, params: {
      peerId: string
      service: string
      input: any
      maxPayment?: number
    }): Promise<any> {
      try {
        const check = ensureRunning()
        if (!check.ok) {
          return {
            content: [{ type: 'text', text: check.error! }],
            isError: true
          }
        }

        // TODO: Implement full request flow when service handler is ready
        return {
          content: [{
            type: 'text',
            text: `Service request functionality not yet fully implemented.\n\nRequested:\n- Peer: ${params.peerId.substring(0, 16)}...\n- Service: ${params.service}\n- Input: ${JSON.stringify(params.input, null, 2)}\n- Max payment: ${params.maxPayment || 1000} sats\n\nThis requires integration with the channel payment protocol.`
          }]
        }
      } catch (err: any) {
        api.logger.error('[BSV P2P] p2p_request error:', err)
        return {
          content: [{ type: 'text', text: `Error requesting service: ${err.message}` }],
          isError: true
        }
      }
    }
  })

  // Tool 4: p2p_status - Get P2P daemon status
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

  // Tool 5: p2p_channels - List payment channels
  api.registerTool({
    name: 'p2p_channels',
    description: 'List all payment channels and their balances. Use to check available channels before requesting paid services.',
    parameters: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          description: 'Filter by state: "pending", "open", "closing", or "closed"',
          enum: ['pending', 'open', 'closing', 'closed']
        }
      }
    },
    async execute(_context: any, params: { state?: string }): Promise<any> {
      try {
        const check = ensureRunning()
        if (!check.ok) {
          return {
            content: [{ type: 'text', text: check.error! }],
            isError: true
          }
        }

        if (!channelManager) {
          return {
            content: [{ type: 'text', text: 'Channel manager not initialized' }],
            isError: true
          }
        }

        const allChannels = channelManager.listChannels()
        let channels = allChannels
        
        if (params.state) {
          channels = channels.filter(c => c.state === params.state)
        }
        
        if (channels.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'No payment channels found. Open a channel with: bsv-p2p channels open <peerId> <satoshis> --pubkey <remotePubKey>'
            }]
          }
        }
        
        const channelInfo = channels.map(ch => {
          return [
            `Channel: ${ch.id.substring(0, 16)}...`,
            `  State: ${ch.state}`,
            `  Peer: ${ch.remotePeerId.substring(0, 32)}...`,
            `  Capacity: ${ch.capacity} sats`,
            `  Your balance: ${ch.localBalance} sats`,
            `  Their balance: ${ch.remoteBalance} sats`
          ].join('\n')
        }).join('\n\n')
        
        return {
          content: [{
            type: 'text',
            text: `Found ${channels.length} channel(s):\n\n${channelInfo}`
          }]
        }
      } catch (err: any) {
        api.logger.error('[BSV P2P] p2p_channels error:', err)
        return {
          content: [{ type: 'text', text: `Error listing channels: ${err.message}` }],
          isError: true
        }
      }
    }
  })

  api.logger.info('[BSV P2P] Plugin registered successfully')
}
