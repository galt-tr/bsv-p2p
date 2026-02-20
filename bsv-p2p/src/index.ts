// Main exports for bsv-p2p package — P2P networking only

export { P2PNode, createP2PNode } from './daemon/node.js'
export type {
  P2PNodeConfig,
  PeerInfo,
  PeerAnnouncement,
  ServiceInfo,
  P2PNodeEvents
} from './daemon/types.js'
export {
  PROTOCOL_PREFIX,
  PROTOCOL_VERSION,
  TOPICS,
  PROTOCOLS,
  DEFAULT_CONFIG
} from './daemon/types.js'

// Gateway integration
export {
  GatewayClient,
  createGatewayClientFromEnv
} from './daemon/gateway.js'
export type {
  GatewayConfig,
  WakeOptions,
  AgentRunOptions,
  GatewayResponse
} from './daemon/gateway.js'
