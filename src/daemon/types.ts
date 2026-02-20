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

export interface P2PNodeEvents {
  'peer:discovered': (peer: PeerInfo) => void
  'peer:connected': (peerId: string) => void
  'peer:disconnected': (peerId: string) => void
  'message:received': (from: string, message: any) => void
  'announcement:received': (announcement: PeerAnnouncement) => void
}

export const PROTOCOL_PREFIX = '/openclaw'
export const PROTOCOL_VERSION = '1.0.0'

export const TOPICS = {
  ANNOUNCE: `${PROTOCOL_PREFIX}/announce/1.0.0`,
  SERVICES: `${PROTOCOL_PREFIX}/services/1.0.0`
} as const

export const PROTOCOLS = {
  REQUEST_RESPONSE: `${PROTOCOL_PREFIX}/request/1.0.0`,
  CHANNEL: `${PROTOCOL_PREFIX}/channel/1.0.0`,
  HANDSHAKE: `${PROTOCOL_PREFIX}/handshake/1.0.0`
} as const

export const DEFAULT_CONFIG: Required<Omit<P2PNodeConfig, 'gateway'>> = {
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
  ephemeralKey: false
}
