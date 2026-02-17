/**
 * Channel Handler - Integrates payment channels with the P2P node
 *
 * Handles the full channel lifecycle over libp2p streams:
 * - Opening channels (negotiation + funding)
 * - Processing payments (commitment updates)
 * - Closing channels (cooperative settlement)
 */
import { EventEmitter } from 'events';
import { PrivateKey } from '@bsv/sdk';
import { P2PNode } from '../daemon/node.js';
import { Channel, ChannelPayment } from './types.js';
export interface ChannelHandlerConfig {
    /** Our BSV private key */
    privateKey: PrivateKey;
    /** Default channel lifetime in ms */
    defaultLifetimeMs?: number;
    /** Auto-accept channel requests below this amount */
    autoAcceptBelowSats?: number;
    /** Callback to broadcast transactions */
    broadcastTx?: (rawTx: string) => Promise<string>;
    /** Callback to get UTXOs for funding */
    getUtxos?: () => Promise<Array<{
        txid: string;
        vout: number;
        satoshis: number;
        scriptPubKey: string;
    }>>;
}
export interface ServiceHandler {
    (input: any, payment: {
        amount: number;
        channelId: string;
    }): Promise<any>;
}
export declare class ChannelHandler extends EventEmitter {
    private node;
    private manager;
    private config;
    private publicKey;
    private address;
    private serviceHandlers;
    private pendingOpens;
    constructor(node: P2PNode, config: ChannelHandlerConfig);
    private setupMessageHandlers;
    private handleMessage;
    /**
     * Register a service handler for paid requests
     */
    registerService(serviceId: string, handler: ServiceHandler): void;
    /**
     * Open a new payment channel with a peer
     */
    openChannel(peerId: string, remotePubKey: string, amount: number, lifetimeMs?: number): Promise<Channel>;
    /**
     * Handle incoming channel open request
     */
    private handleOpenRequest;
    /**
     * Handle channel open acceptance
     */
    private handleOpenAccept;
    /**
     * Send a payment over a channel
     */
    pay(channelId: string, amount: number, memo?: string): Promise<ChannelPayment>;
    /**
     * Handle incoming payment update
     */
    private handleUpdateRequest;
    /**
     * Handle payment acknowledgment
     */
    private handleUpdateAck;
    /**
     * Close a channel cooperatively
     */
    closeChannel(channelId: string): Promise<string>;
    /**
     * Handle close request
     */
    private handleCloseRequest;
    /**
     * Handle close acceptance
     */
    private handleCloseAccept;
    /**
     * Request a paid service from a peer
     */
    requestService(peerId: string, serviceId: string, input: any, channelId?: string): Promise<any>;
    getChannel(channelId: string): Channel | undefined;
    getAllChannels(): Channel[];
    getOpenChannels(): Channel[];
    getTotalBalance(): number;
}
