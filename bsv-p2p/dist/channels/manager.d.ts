/**
 * Payment Channel Manager
 *
 * Manages the lifecycle of payment channels:
 * - Opening channels (funding transactions)
 * - Processing payments (commitment updates)
 * - Closing channels (cooperative or unilateral)
 */
import { EventEmitter } from 'events';
import { Channel, ChannelConfig, ChannelPayment, ChannelCloseRequest, PaymentRecord } from './types.js';
export interface ChannelManagerConfig extends Partial<ChannelConfig> {
    /** Our BSV private key (hex) for signing */
    privateKey: string;
    /** Our BSV public key (hex) */
    publicKey: string;
    /** Callback to broadcast transactions */
    broadcastTx?: (rawTx: string) => Promise<string>;
    /** Database path for persistence (default: ~/.bsv-p2p/channels.db) */
    dbPath?: string;
}
export declare class ChannelManager extends EventEmitter {
    private config;
    private privateKey;
    private publicKey;
    private channels;
    private storage;
    private broadcastTx?;
    constructor(managerConfig: ChannelManagerConfig);
    /**
     * Load channels from persistent storage
     */
    private loadChannels;
    /**
     * Save a channel to persistent storage
     */
    private saveChannel;
    /**
     * Record a payment in the database
     */
    private recordPayment;
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
     * Get payment history for a channel
     */
    getPaymentHistory(channelId: string): PaymentRecord[];
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
    /**
     * Fund a channel with a real UTXO
     *
     * Creates and broadcasts a funding transaction that locks funds in a 2-of-2 multisig.
     *
     * @param channelId - The channel to fund
     * @param utxo - The UTXO to spend
     * @param fee - Transaction fee in satoshis (default: 200)
     * @returns The funding transaction ID
     */
    fundChannelWithUTXO(channelId: string, utxo: {
        txid: string;
        vout: number;
        satoshis: number;
        scriptPubKey: string;
    }, fee?: number): Promise<string>;
    /**
     * Verify a funding transaction using SPV
     *
     * Checks that the funding tx is confirmed and the merkle proof is valid.
     *
     * @param channelId - The channel to verify
     * @returns true if verified, false otherwise
     */
    verifyFundingTx(channelId: string): Promise<boolean>;
    /**
     * Create a signed commitment transaction for a payment
     *
     * @param channelId - The channel
     * @param amount - Payment amount in satoshis
     * @returns The payment object with a real signature
     */
    createSignedPayment(channelId: string, amount: number): Promise<ChannelPayment>;
    /**
     * Verify a counterparty's payment signature
     */
    verifyPaymentSignature(payment: ChannelPayment): Promise<boolean>;
}
