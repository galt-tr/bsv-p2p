/**
 * OpenClaw Skill Integration for BSV P2P
 *
 * Registers tools that agents can use to:
 * - Discover peers and services on the P2P network
 * - Send messages to other bots
 * - Check P2P daemon status
 */

const API_PORT = 4002 // Daemon API port

interface ToolContext {
  sessionKey?: string
  agentId?: string
}

async function apiCall(method: string, path: string, body?: any): Promise<any> {
  const url = `http://127.0.0.1:${API_PORT}${path}`

  try {
    const response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return await response.json()
  } catch (err: any) {
    if (err.code === 'ECONNREFUSED') {
      throw new Error('P2P daemon not running. Start with: bsv-p2p daemon start')
    }
    throw err
  }
}

/**
 * Register P2P tools with OpenClaw
 */
export function registerP2PTools(api: any): void {
  // p2p_discover - Discover peers and services
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
    async execute(_context: ToolContext, params: { service?: string }): Promise<any> {
      try {
        const query = params.service ? `?service=${encodeURIComponent(params.service)}` : ''
        const result = await apiCall('GET', `/discover${query}`)

        if (!result.peers || result.peers.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'No peers found on the network. Make sure the P2P daemon is running and connected.'
            }]
          }
        }

        // Format the peer list
        const peerList = result.peers.map((peer: any) => {
          let info = `Peer: ${peer.peerId}`
          if (peer.services && peer.services.length > 0) {
            info += '\nServices:'
            peer.services.forEach((svc: any) => {
              info += `\n  - ${svc.name}: ${svc.description} (${svc.pricing?.baseSatoshis || 0} sats)`
            })
          }
          return info
        }).join('\n\n')

        return {
          content: [{
            type: 'text',
            text: `Found ${result.peers.length} peer(s):\n\n${peerList}`
          }]
        }
      } catch (err: any) {
        return {
          content: [{
            type: 'text',
            text: `Error discovering peers: ${err.message}`
          }],
          isError: true
        }
      }
    }
  })

  // p2p_send - Send a direct message to a peer
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
    async execute(_context: ToolContext, params: { peerId: string; message: string }): Promise<any> {
      try {
        const result = await apiCall('POST', '/send', {
          peerId: params.peerId,
          message: params.message
        })

        return {
          content: [{
            type: 'text',
            text: `Message sent successfully to ${params.peerId.substring(0, 16)}...`
          }]
        }
      } catch (err: any) {
        return {
          content: [{
            type: 'text',
            text: `Error sending message: ${err.message}`
          }],
          isError: true
        }
      }
    }
  })

  // p2p_status - Get P2P daemon status
  api.registerTool({
    name: 'p2p_status',
    description: 'Check the status of the P2P daemon (peer ID, relay connection, connected peers).',
    parameters: {
      type: 'object',
      properties: {}
    },
    async execute(_context: ToolContext, _params: {}): Promise<any> {
      try {
        const status = await apiCall('GET', '/status')

        const info = [
          `P2P Daemon Status:`,
          `  Peer ID: ${status.peerId}`,
          `  Relay: ${status.relayAddress || 'not connected'}`,
          `  Connected peers: ${status.connectedPeers}`,
          `  Healthy: ${status.isHealthy ? 'yes' : 'no'}`
        ].join('\n')

        return {
          content: [{
            type: 'text',
            text: info
          }]
        }
      } catch (err: any) {
        return {
          content: [{
            type: 'text',
            text: `Error getting status: ${err.message}`
          }],
          isError: true
        }
      }
    }
  })
}

// Export for use in OpenClaw skill loader
export default registerP2PTools
