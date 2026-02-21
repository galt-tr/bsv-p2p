import type { Libp2p } from 'libp2p'
import type { PeerId } from '@libp2p/interface'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { GatewayConfig } from './gateway.js'

export interface P2PNodeConfig {
  port?: number
  bootstrapPeers?: string[]
  announceAddrs?: string[]
  dataDir?: string
  enableMdns?: boolean
  /** Gateway webhook configuration for agent wake */
  gateway?: GatewayConfig
  /** Use ephemeral key instead of loading from disk (useful for tests) */
  ephemeralKey?: boolean
  /** Human-readable name for this node */
  name?: string
  /** How often to broadcast node status (default: 60000ms = 1 minute) */
  statusBroadcastIntervalMs?: number
}

export interface PeerInfo {
  peerId: string
  multiaddrs: string[]
  protocols: string[]
  bsvIdentityKey?: string
  services?: ServiceInfo[]
  lastSeen: number
}

export interface ServiceInfo {
  id: string
  name: string
  description?: string
  price: number
  currency: 'bsv' | 'mnee'
}

export interface PeerAnnouncement {
  peerId: string
  bsvIdentityKey: string
  services: ServiceInfo[]
  multiaddrs: string[]
  timestamp: number
  signature: string
}

export interface NodeStatusMessage {
  peerId: string
  name: string              // Human-readable name (e.g., "Ghanima", "Moneo")
  multiaddrs: string[]      // Full multiaddrs including relay addrs
  services: string[]        // Service IDs offered
  version: string           // bsv-p2p version
  uptime: number            // Seconds since daemon start
  connectedPeers: number    // Number of currently connected peers
  timestamp: number         // Unix ms
}

export interface P2PNodeEvents {
  'peer:discovered': (peer: PeerInfo) => void
  'peer:connected': (peerId: string) => void
  'peer:disconnected': (peerId: string) => void
  'message:received': (from: string, message: any) => void
  'announcement:received': (announcement: PeerAnnouncement) => void
  'node-status': (status: NodeStatusMessage) => void
}

export const PROTOCOL_PREFIX = '/openclaw'
export const PROTOCOL_VERSION = '1.0.0'

export const TOPICS = {
  ANNOUNCE: `${PROTOCOL_PREFIX}/announce/1.0.0`,
  SERVICES: `${PROTOCOL_PREFIX}/services/1.0.0`,
  NODE_STATUS: `${PROTOCOL_PREFIX}/node-status/1.0.0`
} as const

export const PROTOCOLS = {
  REQUEST_RESPONSE: `${PROTOCOL_PREFIX}/request/1.0.0`,
  CHANNEL: `${PROTOCOL_PREFIX}/channel/1.0.0`,
  HANDSHAKE: `${PROTOCOL_PREFIX}/handshake/1.0.0`
} as const

export const DEFAULT_CONFIG: Required<Omit<P2PNodeConfig, 'gateway' | 'name'>> & { name?: string } = {
  port: 4001,
  bootstrapPeers: [
    // Default libp2p bootstrap peers (IPFS)
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt'
  ],
  announceAddrs: [],
  dataDir: '~/.bsv-p2p',
  enableMdns: true,
  ephemeralKey: false,
  name: undefined,
  statusBroadcastIntervalMs: 60000
}
