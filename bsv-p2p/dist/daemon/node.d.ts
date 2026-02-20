import { EventEmitter } from 'events';
import { P2PNodeConfig, PeerInfo, ServiceInfo } from './types.js';
import { GatewayClient, GatewayConfig } from './gateway.js';
import { ChannelMessage } from '../channels/wire.js';
import { MessageHandler } from '../protocol/index.js';
export declare class P2PNode extends EventEmitter {
    private node;
    private config;
    private gatewayConfig;
    private gateway;
    private peers;
    private services;
    private bsvIdentityKey;
    private announcementInterval;
    private messageHandler;
    private discovery;
    private eventListeners;
    constructor(config?: P2PNodeConfig);
    /**
     * Get the gateway client for external use
     */
    get gatewayClient(): GatewayClient;
    /**
     * Get the message handler for sending P2P messages
     */
    get messages(): MessageHandler | null;
    /**
     * Configure the gateway client
     */
    configureGateway(config: GatewayConfig): void;
    get peerId(): string;
    get multiaddrs(): string[];
    get isStarted(): boolean;
    /**
     * Get all current connections
     */
    getConnections(): any[];
    private relayMaintenanceInterval;
    private static readonly RELAY_PEER_ID;
    /**
     * Dial the relay server to establish connection (which enables reservation).
     *
     * IMPORTANT: Do NOT close this connection! The reservation is only valid
     * while the connection is maintained. See circuit-v2 spec.
     */
    dialRelay(relayAddr: string): Promise<void>;
    /**
     * Check if we have a valid relay reservation.
     * Note: This checks for the presence of relay addresses in our multiaddrs.
     * The actual reservation validity depends on maintaining the connection.
     */
    hasRelayReservation(): boolean;
    /**
     * Get our relay circuit address if we have one.
     */
    getRelayAddress(): string | null;
    /**
     * Check if we're connected to the relay server.
     * Connection = reservation (per circuit-v2 spec).
     */
    isConnectedToRelay(): boolean;
    /**
     * Wait for relay reservation to be established (relay address appears in multiaddrs).
     */
    private waitForReservation;
    /**
     * Maintain connection to relay server.
     *
     * This is the KEY to keeping reservations valid. Per circuit-v2 spec:
     * "The reservation remains valid until its expiration, as long as there
     * is an active connection from the peer to the relay. If the peer
     * disconnects, the reservation is no longer valid."
     *
     * We do NOT "refresh" reservations by closing/reopening connections.
     * We simply maintain the connection, and libp2p handles reservation refresh.
     */
    startRelayConnectionMaintenance(intervalMs?: number): void;
    /**
     * Stop connection maintenance
     */
    stopRelayConnectionMaintenance(): void;
    startReservationRefresh(intervalMs?: number): void;
    stopReservationRefresh(): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    private setupEventHandlers;
    private subscribeToTopics;
    private handleAnnouncement;
    private setupProtocolHandlers;
    /**
     * Handle incoming P2P message and wake agent
     */
    private handleIncomingMessage;
    /**
     * Send a text message to another peer
     */
    sendMessage(toPeerId: string, content: string): Promise<void>;
    /**
     * Send a service request to another peer
     */
    sendRequest(toPeerId: string, service: string, params: Record<string, any>, timeoutMs?: number): Promise<any>;
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
    /**
     * Get discovery service statistics
     */
    getDiscoveryStats(): {
        knownPeers: number;
        registeredServices: number;
        isRunning: boolean;
    } | null;
}
export declare function createP2PNode(config?: P2PNodeConfig): Promise<P2PNode>;
