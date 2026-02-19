export const PROTOCOL_PREFIX = '/openclaw';
export const PROTOCOL_VERSION = '1.0.0';
export const TOPICS = {
    ANNOUNCE: `${PROTOCOL_PREFIX}/announce/1.0.0`,
    SERVICES: `${PROTOCOL_PREFIX}/services/1.0.0`
};
export const PROTOCOLS = {
    REQUEST_RESPONSE: `${PROTOCOL_PREFIX}/request/1.0.0`,
    CHANNEL: `${PROTOCOL_PREFIX}/channel/1.0.0`,
    HANDSHAKE: `${PROTOCOL_PREFIX}/handshake/1.0.0`
};
export const DEFAULT_CONFIG = {
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
};
