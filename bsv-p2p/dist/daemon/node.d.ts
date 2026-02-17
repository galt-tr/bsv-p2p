import { EventEmitter } from 'events';
import { P2PNodeConfig, PeerInfo, ServiceInfo } from './types.js';
import { GatewayClient, GatewayConfig } from './gateway.js';
import { ChannelMessage } from '../channels/protocol.js';
export declare class P2PNode extends EventEmitter {
    private node;
    private config;
    private gatewayConfig;
    private gateway;
    private peers;
    private services;
    private bsvIdentityKey;
    private announcementInterval;
    constructor(config?: P2PNodeConfig);
    /**
     * Get the gateway client for external use
     */
    get gatewayClient(): GatewayClient;
    /**
     * Configure the gateway client
     */
    configureGateway(config: GatewayConfig): void;
    get peerId(): string;
    get multiaddrs(): string[];
    get isStarted(): boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
    private setupEventHandlers;
    private subscribeToTopics;
    private handleAnnouncement;
    private setupProtocolHandlers;
    /**
     * Wake the agent to handle an incoming channel message
     */
    private wakeAgentForChannelMessage;
    /**
     * Format a channel message for the agent to understand
     */
    private formatChannelMessageForAgent;
    /**
     * Send a channel message to a peer
     */
    sendChannelMessage(peerId: string, message: ChannelMessage): Promise<void>;
    announce(): Promise<void>;
    startAnnouncing(intervalMs?: number): void;
    setBsvIdentityKey(key: string): void;
    registerService(service: ServiceInfo): void;
    unregisterService(serviceId: string): void;
    getServices(): ServiceInfo[];
    getPeers(): PeerInfo[];
    getPeer(peerId: string): PeerInfo | undefined;
    connect(addr: string): Promise<void>;
    disconnect(peerId: string): Promise<void>;
    getConnectedPeers(): string[];
    ping(peerId: string): Promise<number>;
    discoverPeers(options?: {
        service?: string;
    }): Promise<PeerInfo[]>;
}
export declare function createP2PNode(config?: P2PNodeConfig): Promise<P2PNode>;
