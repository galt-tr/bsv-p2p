/**
 * Channel Handler - Integrates payment channels with the P2P node
 *
 * Handles the full channel lifecycle over libp2p streams:
 * - Opening channels (negotiation + funding)
 * - Processing payments (commitment updates)
 * - Closing channels (cooperative settlement)
 */
import { EventEmitter } from 'events';
import { ChannelManager } from './manager.js';
import { ChannelMessageType, deserializeMessage } from './protocol.js';
import { createCommitmentTransaction, createSettlementTransaction } from './transactions.js';
import { v4 as uuid } from 'uuid';
export class ChannelHandler extends EventEmitter {
    node;
    manager;
    config;
    publicKey;
    address;
    serviceHandlers = new Map();
    // Track pending channel negotiations
    pendingOpens = new Map();
    constructor(node, config) {
        super();
        this.node = node;
        this.config = config;
        this.publicKey = config.privateKey.toPublicKey().toString();
        this.address = config.privateKey.toPublicKey().toAddress();
        this.manager = new ChannelManager({
            privateKey: config.privateKey.toString(),
            publicKey: this.publicKey,
            defaultLifetimeMs: config.defaultLifetimeMs,
            broadcastTx: config.broadcastTx
        });
        // Set up message handlers
        this.setupMessageHandlers();
    }
    setupMessageHandlers() {
        // Listen for channel-related announcements
        this.node.on('message:received', (from, data) => {
            try {
                const message = deserializeMessage(data);
                this.handleMessage(from, message);
            }
            catch (err) {
                // Not a channel message, ignore
            }
        });
    }
    async handleMessage(from, message) {
        switch (message.type) {
            case ChannelMessageType.OPEN_REQUEST:
                await this.handleOpenRequest(from, message);
                break;
            case ChannelMessageType.OPEN_ACCEPT:
                await this.handleOpenAccept(from, message);
                break;
            case ChannelMessageType.UPDATE_REQUEST:
                await this.handleUpdateRequest(from, message);
                break;
            case ChannelMessageType.UPDATE_ACK:
                await this.handleUpdateAck(from, message);
                break;
            case ChannelMessageType.CLOSE_REQUEST:
                await this.handleCloseRequest(from, message);
                break;
            case ChannelMessageType.CLOSE_ACCEPT:
                await this.handleCloseAccept(from, message);
                break;
        }
    }
    /**
     * Register a service handler for paid requests
     */
    registerService(serviceId, handler) {
        this.serviceHandlers.set(serviceId, handler);
    }
    /**
     * Open a new payment channel with a peer
     */
    async openChannel(peerId, remotePubKey, amount, lifetimeMs) {
        const channelId = uuid();
        const lifetime = lifetimeMs ?? this.config.defaultLifetimeMs ?? 3600000;
        // Create the channel locally
        const channel = await this.manager.createChannel(peerId, remotePubKey, amount, lifetime);
        // Send open request
        const request = {
            type: ChannelMessageType.OPEN_REQUEST,
            channelId: channel.id,
            timestamp: Date.now(),
            proposedCapacity: amount,
            ourPubKey: this.publicKey,
            identityKey: this.publicKey,
            proposedLockTimeSeconds: Math.floor(lifetime / 1000),
            ourAddress: this.address
        };
        // Wait for response with timeout
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingOpens.delete(channel.id);
                reject(new Error('Channel open request timed out'));
            }, 30000);
            this.pendingOpens.set(channel.id, { resolve, reject, timeout });
            // Send via pubsub or direct stream (simplified for now)
            this.emit('channel:send', peerId, request);
        });
    }
    /**
     * Handle incoming channel open request
     */
    async handleOpenRequest(from, request) {
        // Auto-accept if below threshold
        const autoAccept = this.config.autoAcceptBelowSats ?? 0;
        if (request.proposedCapacity <= autoAccept || autoAccept === Infinity) {
            // Accept the channel
            const nLockTime = Math.floor(Date.now() / 1000) + request.proposedLockTimeSeconds;
            const channel = await this.manager.acceptChannel(request.channelId, this.node.peerId, from, request.ourPubKey, request.proposedCapacity, nLockTime);
            const response = {
                type: ChannelMessageType.OPEN_ACCEPT,
                channelId: request.channelId,
                timestamp: Date.now(),
                ourPubKey: this.publicKey,
                identityKey: this.publicKey,
                agreedLockTime: nLockTime,
                ourAddress: this.address
            };
            this.emit('channel:send', from, response);
            this.emit('channel:opened', channel);
        }
        else {
            // Reject (or could emit event for manual approval)
            this.emit('channel:request', from, request);
        }
    }
    /**
     * Handle channel open acceptance
     */
    async handleOpenAccept(from, accept) {
        const pending = this.pendingOpens.get(accept.channelId);
        if (!pending)
            return;
        clearTimeout(pending.timeout);
        this.pendingOpens.delete(accept.channelId);
        const channel = this.manager.getChannel(accept.channelId);
        if (!channel) {
            pending.reject(new Error('Channel not found'));
            return;
        }
        // Update channel with remote info
        // In full impl, would create funding tx here
        this.manager.openChannel(accept.channelId);
        pending.resolve(channel);
        this.emit('channel:opened', channel);
    }
    /**
     * Send a payment over a channel
     */
    async pay(channelId, amount, memo) {
        const channel = this.manager.getChannel(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        if (channel.state !== 'open')
            throw new Error('Channel not open');
        // Create payment
        const payment = await this.manager.createPayment(channelId, amount);
        // Create new commitment tx
        const commitmentTx = createCommitmentTransaction({
            fundingTxId: channel.fundingTxId || 'mock-funding-txid',
            fundingVout: channel.fundingOutputIndex || 0,
            fundingAmount: channel.capacity,
            pubKeyA: channel.localPubKey,
            pubKeyB: channel.remotePubKey,
            addressA: this.address,
            addressB: this.address, // Would be remote's address
            balanceA: payment.newLocalBalance,
            balanceB: payment.newRemoteBalance,
            sequenceNumber: payment.newSequenceNumber,
            nLockTime: channel.nLockTime
        });
        // Send update request
        const updateRequest = {
            type: ChannelMessageType.UPDATE_REQUEST,
            channelId,
            timestamp: Date.now(),
            amount,
            newSequence: payment.newSequenceNumber,
            newSenderBalance: payment.newLocalBalance,
            newReceiverBalance: payment.newRemoteBalance,
            newCommitmentTxHex: commitmentTx.toHex(),
            senderSig: '', // Would sign in full impl
            memo
        };
        this.emit('channel:send', channel.remotePeerId, updateRequest);
        return payment;
    }
    /**
     * Handle incoming payment update
     */
    async handleUpdateRequest(from, update) {
        try {
            const payment = {
                channelId: update.channelId,
                amount: update.amount,
                newSequenceNumber: update.newSequence,
                newLocalBalance: update.newSenderBalance,
                newRemoteBalance: update.newReceiverBalance,
                signature: update.senderSig,
                timestamp: update.timestamp
            };
            await this.manager.processPayment(payment);
            // Send ack
            const ack = {
                type: ChannelMessageType.UPDATE_ACK,
                channelId: update.channelId,
                timestamp: Date.now(),
                ackSequence: update.newSequence,
                receiverSig: '' // Would sign in full impl
            };
            this.emit('channel:send', from, ack);
            this.emit('channel:payment_received', { channelId: update.channelId, amount: update.amount });
        }
        catch (err) {
            this.emit('channel:error', { channelId: update.channelId, error: err });
        }
    }
    /**
     * Handle payment acknowledgment
     */
    async handleUpdateAck(from, ack) {
        this.emit('channel:payment_acked', { channelId: ack.channelId, sequence: ack.ackSequence });
    }
    /**
     * Close a channel cooperatively
     */
    async closeChannel(channelId) {
        const channel = this.manager.getChannel(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        const closeRequest = await this.manager.closeChannel(channelId);
        // Create settlement tx
        const settlementTx = createSettlementTransaction({
            fundingTxId: channel.fundingTxId || 'mock-funding-txid',
            fundingVout: channel.fundingOutputIndex || 0,
            fundingAmount: channel.capacity,
            pubKeyA: channel.localPubKey,
            pubKeyB: channel.remotePubKey,
            addressA: this.address,
            addressB: this.address,
            balanceA: closeRequest.finalLocalBalance,
            balanceB: closeRequest.finalRemoteBalance,
            nLockTime: channel.nLockTime
        });
        const closeMsg = {
            type: ChannelMessageType.CLOSE_REQUEST,
            channelId,
            timestamp: Date.now(),
            settlementTxHex: settlementTx.toHex(),
            ourSettlementSig: '',
            finalSequence: closeRequest.finalSequenceNumber
        };
        this.emit('channel:send', channel.remotePeerId, closeMsg);
        return settlementTx.id('hex');
    }
    /**
     * Handle close request
     */
    async handleCloseRequest(from, close) {
        const channel = this.manager.getChannel(close.channelId);
        if (!channel)
            return;
        // Accept close
        const ack = {
            type: ChannelMessageType.CLOSE_ACCEPT,
            channelId: close.channelId,
            timestamp: Date.now(),
            theirSettlementSig: ''
        };
        this.manager.finalizeClose(close.channelId, 'settlement-txid');
        this.emit('channel:send', from, ack);
        this.emit('channel:closed', { channelId: close.channelId });
    }
    /**
     * Handle close acceptance
     */
    async handleCloseAccept(from, ack) {
        this.manager.finalizeClose(ack.channelId, 'settlement-txid');
        this.emit('channel:closed', { channelId: ack.channelId });
    }
    /**
     * Request a paid service from a peer
     */
    async requestService(peerId, serviceId, input, channelId) {
        // Find or create a channel
        let channel;
        if (channelId) {
            channel = this.manager.getChannel(channelId);
        }
        else {
            // Find existing open channel with this peer
            const channels = this.manager.getChannelsByPeer(peerId);
            channel = channels.find(c => c.state === 'open');
        }
        if (!channel) {
            throw new Error('No open channel with peer. Open a channel first.');
        }
        // Get service price from peer (simplified - would query peer)
        const price = 100; // Default price
        // Make payment
        await this.pay(channel.id, price, `service:${serviceId}`);
        // Return result (in full impl, would wait for service response)
        return { status: 'paid', channelId: channel.id, amount: price };
    }
    // Accessors
    getChannel(channelId) {
        return this.manager.getChannel(channelId);
    }
    getAllChannels() {
        return this.manager.getAllChannels();
    }
    getOpenChannels() {
        return this.manager.getOpenChannels();
    }
    getTotalBalance() {
        return this.manager.getTotalBalance();
    }
}
