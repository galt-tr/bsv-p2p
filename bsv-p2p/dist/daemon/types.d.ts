import type { GatewayConfig } from './gateway.js';
export interface P2PNodeConfig {
    port?: number;
    bootstrapPeers?: string[];
    announceAddrs?: string[];
    dataDir?: string;
    enableMdns?: boolean;
    /** Gateway webhook configuration for agent wake */
    gateway?: GatewayConfig;
}
export interface PeerInfo {
    peerId: string;
    multiaddrs: string[];
    protocols: string[];
    bsvIdentityKey?: string;
    services?: ServiceInfo[];
    lastSeen: number;
}
export interface ServiceInfo {
    id: string;
    name: string;
    description?: string;
    price: number;
    currency: 'bsv' | 'mnee';
}
export interface PeerAnnouncement {
    peerId: string;
    bsvIdentityKey: string;
    services: ServiceInfo[];
    multiaddrs: string[];
    timestamp: number;
    signature: string;
}
export interface P2PNodeEvents {
    'peer:discovered': (peer: PeerInfo) => void;
    'peer:connected': (peerId: string) => void;
    'peer:disconnected': (peerId: string) => void;
    'message:received': (from: string, message: any) => void;
    'announcement:received': (announcement: PeerAnnouncement) => void;
}
export declare const PROTOCOL_PREFIX = "/openclaw";
export declare const PROTOCOL_VERSION = "1.0.0";
export declare const TOPICS: {
    readonly ANNOUNCE: "/openclaw/announce/1.0.0";
    readonly SERVICES: "/openclaw/services/1.0.0";
};
export declare const PROTOCOLS: {
    readonly REQUEST_RESPONSE: "/openclaw/request/1.0.0";
    readonly CHANNEL: "/openclaw/channel/1.0.0";
    readonly HANDSHAKE: "/openclaw/handshake/1.0.0";
};
export declare const DEFAULT_CONFIG: Required<P2PNodeConfig>;
