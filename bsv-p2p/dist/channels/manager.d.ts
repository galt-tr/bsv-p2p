/**
 * Payment Channel Manager
 *
 * Manages the lifecycle of payment channels:
 * - Opening channels (funding transactions)
 * - Processing payments (commitment updates)
 * - Closing channels (cooperative or unilateral)
 */
import { EventEmitter } from 'events';
import { Channel, ChannelConfig, ChannelPayment, ChannelCloseRequest } from './types.js';
export interface ChannelManagerConfig extends Partial<ChannelConfig> {
    /** Our BSV private key (hex) for signing */
    privateKey: string;
    /** Our BSV public key (hex) */
    publicKey: string;
    /** Callback to broadcast transactions */
    broadcastTx?: (rawTx: string) => Promise<string>;
}
export declare class ChannelManager extends EventEmitter {
    private config;
    private privateKey;
    private publicKey;
    private channels;
    private broadcastTx?;
    constructor(managerConfig: ChannelManagerConfig);
    /**
     * Create a new channel (initiator side)
     */
    createChannel(remotePeerId: string, remotePubKey: string, amount: number, lifetimeMs?: number): Promise<Channel>;
    /**
     * Accept a channel open request (responder side)
     */
    acceptChannel(channelId: string, localPeerId: string, remotePeerId: string, remotePubKey: string, capacity: number, nLockTime: number): Promise<Channel>;
    /**
     * Set funding transaction details (after funding tx is created)
     */
    setFundingTx(channelId: string, txId: string, outputIndex: number): void;
    /**
     * Mark channel as open (after funding tx is confirmed)
     */
    openChannel(channelId: string): void;
    /**
     * Process an incoming payment (update channel state)
     */
    processPayment(payment: ChannelPayment): Promise<void>;
    /**
     * Create an outgoing payment
     */
    createPayment(channelId: string, amount: number): Promise<ChannelPayment>;
    /**
     * Initiate cooperative channel close
     */
    closeChannel(channelId: string): Promise<ChannelCloseRequest>;
    /**
     * Complete channel close (after close tx is confirmed)
     */
    finalizeClose(channelId: string, closeTxId: string): void;
    /**
     * Get a channel by ID
     */
    getChannel(channelId: string): Channel | undefined;
    /**
     * Get all channels
     */
    getAllChannels(): Channel[];
    /**
     * Get channels by peer ID
     */
    getChannelsByPeer(peerId: string): Channel[];
    /**
     * Get open channels
     */
    getOpenChannels(): Channel[];
    /**
     * Get total balance across all open channels
     */
    getTotalBalance(): number;
}
