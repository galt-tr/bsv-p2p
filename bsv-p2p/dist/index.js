// Main exports for bsv-p2p package
export { P2PNode, createP2PNode } from './daemon/node.js';
export { PROTOCOL_PREFIX, PROTOCOL_VERSION, TOPICS, PROTOCOLS, DEFAULT_CONFIG } from './daemon/types.js';
// Gateway integration
export { GatewayClient, createGatewayClientFromEnv } from './daemon/gateway.js';
// Wallet
export { Wallet } from './wallet/index.js';
