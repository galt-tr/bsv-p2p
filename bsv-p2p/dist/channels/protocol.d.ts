/**
 * Channel Protocol - Wires ChannelManager to P2P MessageHandler
 *
 * Handles the P2P protocol for payment channel operations:
 * - Opening channels (CHANNEL_OPEN → CHANNEL_ACCEPT/REJECT)
 * - Updating state (CHANNEL_UPDATE for payments)
 * - Closing channels (CHANNEL_CLOSE)
 */
import { EventEmitter } from 'events';
import { ChannelManager } from './manager.js';
import { Channel, ChannelPayment } from './types.js';
import { MessageHandler } from '../protocol/handler.js';
import { ChannelOpenMessage, PaidRequestMessage, PaidResultMessage } from '../protocol/messages.js';
import { CloseRequest } from './close.js';
export interface ChannelProtocolConfig {
    channelManager: ChannelManager;
    messageHandler: MessageHandler;
    peerId: string;
    /** Auto-accept incoming channels up to this capacity (0 = manual approval) */
    autoAcceptMaxCapacity?: number;
    /** Callback for manual channel approval */
    onChannelRequest?: (request: ChannelOpenMessage) => Promise<boolean>;
    /** Callback when channel is ready */
    onChannelReady?: (channel: Channel) => void;
    /** Callback for incoming paid requests */
    onPaidRequest?: (request: PaidRequestMessage, channel: Channel) => Promise<{
        success: boolean;
        result?: any;
        error?: string;
    }>;
}
export declare class ChannelProtocol extends EventEmitter {
    private manager;
    private handler;
    private peerId;
    private autoAcceptMax;
    private onChannelRequest?;
    private onChannelReady?;
    private onPaidRequest?;
    private pendingOpens;
    constructor(config: ChannelProtocolConfig);
    private setupListeners;
    private pendingCloseRequests;
    /**
     * Open a new payment channel with a peer
     */
    openChannel(remotePeerId: string, remotePubKey: string, capacity: number, timeoutMs?: number): Promise<Channel>;
    /**
     * Handle incoming CHANNEL_OPEN
     */
    private handleChannelOpen;
    /**
     * Handle CHANNEL_ACCEPT response
     */
    private handleChannelAccept;
    /**
     * Handle CHANNEL_REJECT response
     */
    private handleChannelReject;
    /**
     * Send a payment through a channel
     */
    pay(channelId: string, amount: number): Promise<ChannelPayment>;
    /**
     * Handle incoming CHANNEL_UPDATE (payment received)
     */
    private handleChannelUpdate;
    /**
     * Close a channel cooperatively
     */
    closeChannel(channelId: string): Promise<void>;
    /**
     * Handle incoming CHANNEL_CLOSE
     */
    private handleChannelClose;
    /**
     * Send a paid service request
     */
    paidRequest(channelId: string, service: string, params: Record<string, any>, amount: number, timeoutMs?: number): Promise<PaidResultMessage>;
    /**
     * Handle incoming PAID_REQUEST
     */
    private handlePaidRequest;
    /**
     * Get channel by peer ID (first open channel)
     */
    getChannelByPeer(peerId: string): Channel | undefined;
    /**
     * Get all channels
     */
    getChannels(): Channel[];
    /**
     * Fund a channel with a real UTXO
     *
     * @param channelId - The channel to fund
     * @param utxo - The UTXO to spend
     * @param fee - Transaction fee in satoshis
     * @returns The funding transaction ID
     */
    fundChannel(channelId: string, utxo: {
        txid: string;
        vout: number;
        satoshis: number;
        scriptPubKey: string;
    }, fee?: number): Promise<string>;
    /**
     * Verify funding transaction with SPV and open the channel
     *
     * @param channelId - The channel to verify and open
     * @returns true if verified and opened, false if not confirmed yet
     */
    verifyAndOpenChannel(channelId: string): Promise<boolean>;
    /**
     * Send a signed payment through a channel
     * Uses real commitment transaction signatures
     */
    payWithSignature(channelId: string, amount: number): Promise<ChannelPayment>;
    /**
     * Initiate cooperative close of a channel
     * Creates close request, signs it, and sends to counterparty
     */
    initiateCooperativeClose(channelId: string, privateKeyHex: string): Promise<CloseRequest>;
    /**
     * Handle incoming CLOSE_REQUEST (responder side)
     */
    private handleCloseRequest;
    /**
     * Handle incoming CLOSE_ACCEPT (initiator side)
     */
    private handleCloseAccept;
    /**
     * Handle incoming CLOSE_COMPLETE (responder side)
     */
    private handleCloseComplete;
}
