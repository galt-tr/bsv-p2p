/**
 * Channel Protocol - Wires ChannelManager to P2P MessageHandler
 *
 * Handles the P2P protocol for payment channel operations:
 * - Opening channels (CHANNEL_OPEN → CHANNEL_ACCEPT/REJECT)
 * - Updating state (CHANNEL_UPDATE for payments)
 * - Closing channels (CHANNEL_CLOSE)
 */
import { EventEmitter } from 'events';
import { MessageType, createBaseMessage } from '../protocol/messages.js';
import { PrivateKey, PublicKey } from '@bsv/sdk';
import { createCloseRequest, signCloseRequest, broadcastClose } from './close.js';
export class ChannelProtocol extends EventEmitter {
    manager;
    handler;
    peerId;
    autoAcceptMax;
    onChannelRequest;
    onChannelReady;
    onPaidRequest;
    // Track pending channel opens (waiting for accept/reject)
    pendingOpens = new Map();
    constructor(config) {
        super();
        this.manager = config.channelManager;
        this.handler = config.messageHandler;
        this.peerId = config.peerId;
        this.autoAcceptMax = config.autoAcceptMaxCapacity ?? 0;
        this.onChannelRequest = config.onChannelRequest;
        this.onChannelReady = config.onChannelReady;
        this.onPaidRequest = config.onPaidRequest;
        this.setupListeners();
    }
    setupListeners() {
        // Listen for channel messages
        this.handler.on(MessageType.CHANNEL_OPEN, this.handleChannelOpen.bind(this));
        this.handler.on(MessageType.CHANNEL_ACCEPT, this.handleChannelAccept.bind(this));
        this.handler.on(MessageType.CHANNEL_REJECT, this.handleChannelReject.bind(this));
        this.handler.on(MessageType.CHANNEL_UPDATE, this.handleChannelUpdate.bind(this));
        this.handler.on(MessageType.CHANNEL_CLOSE, this.handleChannelClose.bind(this));
        this.handler.on(MessageType.PAID_REQUEST, this.handlePaidRequest.bind(this));
        // Cooperative close protocol
        this.handler.on(MessageType.CLOSE_REQUEST, this.handleCloseRequest.bind(this));
        this.handler.on(MessageType.CLOSE_ACCEPT, this.handleCloseAccept.bind(this));
        this.handler.on(MessageType.CLOSE_COMPLETE, this.handleCloseComplete.bind(this));
    }
    // Track pending close requests
    pendingCloseRequests = new Map();
    /**
     * Open a new payment channel with a peer
     */
    async openChannel(remotePeerId, remotePubKey, capacity, timeoutMs = 30000) {
        // Create channel locally
        const channel = await this.manager.createChannel(remotePeerId, remotePubKey, capacity);
        channel.localPeerId = this.peerId;
        // TODO: Create funding transaction (for now, placeholder)
        const fundingTxHex = ''; // Will be implemented with transaction layer
        // Send CHANNEL_OPEN message
        const openMsg = {
            ...createBaseMessage(MessageType.CHANNEL_OPEN, this.peerId, remotePeerId),
            type: MessageType.CHANNEL_OPEN,
            channelId: channel.id,
            fundingTxHex,
            ourPubKey: channel.localPubKey,
            proposedCapacity: capacity,
            proposedLockTime: channel.nLockTime
        };
        // Set up promise to wait for accept/reject
        const responsePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingOpens.delete(channel.id);
                reject(new Error(`Channel open timeout after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pendingOpens.set(channel.id, { channel, resolve, reject, timeout });
        });
        await this.handler.send(remotePeerId, openMsg);
        console.log(`[Channel] Sent CHANNEL_OPEN to ${remotePeerId.substring(0, 16)}... (id: ${channel.id.substring(0, 8)}...)`);
        return responsePromise;
    }
    /**
     * Handle incoming CHANNEL_OPEN
     */
    async handleChannelOpen(msg, remotePeerId) {
        console.log(`[Channel] Received CHANNEL_OPEN from ${remotePeerId.substring(0, 16)}...`);
        console.log(`  Capacity: ${msg.proposedCapacity} sats, LockTime: ${msg.proposedLockTime}`);
        // Check auto-accept
        let shouldAccept = false;
        if (this.autoAcceptMax > 0 && msg.proposedCapacity <= this.autoAcceptMax) {
            shouldAccept = true;
            console.log(`[Channel] Auto-accepting (within limit of ${this.autoAcceptMax} sats)`);
        }
        else if (this.onChannelRequest) {
            shouldAccept = await this.onChannelRequest(msg);
        }
        if (!shouldAccept) {
            // Reject
            const rejectMsg = {
                ...createBaseMessage(MessageType.CHANNEL_REJECT, this.peerId, remotePeerId),
                type: MessageType.CHANNEL_REJECT,
                channelId: msg.channelId,
                reason: 'Channel not accepted'
            };
            await this.handler.send(remotePeerId, rejectMsg);
            console.log(`[Channel] Rejected channel ${msg.channelId.substring(0, 8)}...`);
            this.emit('channel:rejected', { channelId: msg.channelId, reason: 'not accepted' });
            return;
        }
        // Accept the channel
        const channel = await this.manager.acceptChannel(msg.channelId, this.peerId, remotePeerId, msg.ourPubKey, msg.proposedCapacity, msg.proposedLockTime);
        // TODO: Co-sign funding transaction
        const fundingTxHex = msg.fundingTxHex; // Would add our signature
        // Send CHANNEL_ACCEPT
        const acceptMsg = {
            ...createBaseMessage(MessageType.CHANNEL_ACCEPT, this.peerId, remotePeerId),
            type: MessageType.CHANNEL_ACCEPT,
            channelId: msg.channelId,
            fundingTxHex,
            theirPubKey: channel.localPubKey
        };
        await this.handler.send(remotePeerId, acceptMsg);
        console.log(`[Channel] Accepted channel ${msg.channelId.substring(0, 8)}...`);
        // Mark as open (in real implementation, wait for funding tx confirmation)
        this.manager.openChannel(channel.id);
        this.emit('channel:opened', channel);
        this.onChannelReady?.(channel);
    }
    /**
     * Handle CHANNEL_ACCEPT response
     */
    async handleChannelAccept(msg, remotePeerId) {
        console.log(`[Channel] Received CHANNEL_ACCEPT for ${msg.channelId.substring(0, 8)}...`);
        const pending = this.pendingOpens.get(msg.channelId);
        if (!pending) {
            console.warn(`[Channel] No pending open for channel ${msg.channelId}`);
            return;
        }
        clearTimeout(pending.timeout);
        this.pendingOpens.delete(msg.channelId);
        // Update channel with remote pubkey
        const channel = pending.channel;
        channel.remotePubKey = msg.theirPubKey;
        // TODO: Verify and broadcast funding transaction
        // Mark as open
        this.manager.openChannel(channel.id);
        this.emit('channel:opened', channel);
        this.onChannelReady?.(channel);
        pending.resolve(channel);
    }
    /**
     * Handle CHANNEL_REJECT response
     */
    async handleChannelReject(msg, remotePeerId) {
        console.log(`[Channel] Received CHANNEL_REJECT for ${msg.channelId.substring(0, 8)}...: ${msg.reason}`);
        const pending = this.pendingOpens.get(msg.channelId);
        if (!pending) {
            return;
        }
        clearTimeout(pending.timeout);
        this.pendingOpens.delete(msg.channelId);
        this.emit('channel:rejected', { channelId: msg.channelId, reason: msg.reason });
        pending.reject(new Error(`Channel rejected: ${msg.reason}`));
    }
    /**
     * Send a payment through a channel
     */
    async pay(channelId, amount) {
        const channel = this.manager.getChannel(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        if (channel.state !== 'open')
            throw new Error(`Channel not open`);
        // Create payment (updates local state)
        const payment = await this.manager.createPayment(channelId, amount);
        // TODO: Create commitment transaction
        const commitmentTxHex = ''; // Will be implemented
        // Send CHANNEL_UPDATE
        const updateMsg = {
            ...createBaseMessage(MessageType.CHANNEL_UPDATE, this.peerId, channel.remotePeerId),
            type: MessageType.CHANNEL_UPDATE,
            channelId,
            sequence: payment.newSequenceNumber,
            ourBalance: payment.newLocalBalance,
            theirBalance: payment.newRemoteBalance,
            commitmentTxHex,
            signature: payment.signature
        };
        await this.handler.send(channel.remotePeerId, updateMsg);
        console.log(`[Channel] Sent payment of ${amount} sats (seq: ${payment.newSequenceNumber})`);
        return payment;
    }
    /**
     * Handle incoming CHANNEL_UPDATE (payment received)
     */
    async handleChannelUpdate(msg, remotePeerId) {
        console.log(`[Channel] Received CHANNEL_UPDATE for ${msg.channelId.substring(0, 8)}...`);
        console.log(`  Seq: ${msg.sequence}, Our balance: ${msg.theirBalance}, Their balance: ${msg.ourBalance}`);
        const channel = this.manager.getChannel(msg.channelId);
        if (!channel) {
            console.warn(`[Channel] Unknown channel ${msg.channelId}`);
            return;
        }
        // Create payment object from message
        // Note: msg.ourBalance is THEIR local balance = our remote balance
        const payment = {
            channelId: msg.channelId,
            amount: msg.ourBalance - channel.remoteBalance, // Change in their balance = payment to us
            newSequenceNumber: msg.sequence,
            newLocalBalance: msg.ourBalance, // Their perspective
            newRemoteBalance: msg.theirBalance, // Their perspective
            signature: msg.signature,
            timestamp: msg.timestamp
        };
        try {
            await this.manager.processPayment(payment);
            console.log(`[Channel] Processed payment of ${payment.amount} sats`);
            this.emit('payment:received', { channel, payment });
        }
        catch (err) {
            console.error(`[Channel] Failed to process payment: ${err.message}`);
            this.emit('payment:error', { channel, error: err.message });
        }
    }
    /**
     * Close a channel cooperatively
     */
    async closeChannel(channelId) {
        const channel = this.manager.getChannel(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        const closeRequest = await this.manager.closeChannel(channelId);
        // TODO: Create close transaction
        const finalTxHex = ''; // Will be implemented
        const closeMsg = {
            ...createBaseMessage(MessageType.CHANNEL_CLOSE, this.peerId, channel.remotePeerId),
            type: MessageType.CHANNEL_CLOSE,
            channelId,
            finalTxHex,
            cooperative: true
        };
        await this.handler.send(channel.remotePeerId, closeMsg);
        console.log(`[Channel] Sent CHANNEL_CLOSE for ${channelId.substring(0, 8)}...`);
    }
    /**
     * Handle incoming CHANNEL_CLOSE
     */
    async handleChannelClose(msg, remotePeerId) {
        console.log(`[Channel] Received CHANNEL_CLOSE for ${msg.channelId.substring(0, 8)}...`);
        const channel = this.manager.getChannel(msg.channelId);
        if (!channel) {
            console.warn(`[Channel] Unknown channel ${msg.channelId}`);
            return;
        }
        if (msg.cooperative) {
            // If we initiated the close (state=closing), this is the confirmation
            if (channel.state === 'closing') {
                this.manager.finalizeClose(msg.channelId, 'cooperative-close-txid');
                console.log(`[Channel] Close confirmed by peer`);
            }
            else {
                // Peer initiated - accept and close
                this.manager.finalizeClose(msg.channelId, 'cooperative-close-txid');
                console.log(`[Channel] Cooperative close complete`);
                // Send close acknowledgment back
                const ackMsg = {
                    ...createBaseMessage(MessageType.CHANNEL_CLOSE, this.peerId, remotePeerId),
                    type: MessageType.CHANNEL_CLOSE,
                    channelId: msg.channelId,
                    finalTxHex: msg.finalTxHex,
                    cooperative: true
                };
                await this.handler.send(remotePeerId, ackMsg);
            }
        }
        else {
            // Unilateral close - need to handle timeout
            console.warn(`[Channel] Unilateral close detected - monitoring for timeout`);
        }
        this.emit('channel:closed', channel);
    }
    /**
     * Send a paid service request
     */
    async paidRequest(channelId, service, params, amount, timeoutMs = 30000) {
        const channel = this.manager.getChannel(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        // Create payment
        const payment = await this.manager.createPayment(channelId, amount);
        // Send paid request
        const msg = {
            ...createBaseMessage(MessageType.PAID_REQUEST, this.peerId, channel.remotePeerId),
            type: MessageType.PAID_REQUEST,
            channelId,
            service,
            params,
            payment: {
                amount,
                sequence: payment.newSequenceNumber,
                commitmentTxHex: '', // TODO: real commitment tx
                signature: payment.signature
            }
        };
        // Wait for response using handler's request mechanism
        // We'll set up a one-time listener for PAID_RESULT
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.handler.off(MessageType.PAID_RESULT, resultHandler);
                reject(new Error(`Paid request timeout after ${timeoutMs}ms`));
            }, timeoutMs);
            const resultHandler = (result) => {
                if (result.requestId === msg.id) {
                    clearTimeout(timeout);
                    this.handler.off(MessageType.PAID_RESULT, resultHandler);
                    resolve(result);
                }
            };
            this.handler.on(MessageType.PAID_RESULT, resultHandler);
            this.handler.send(channel.remotePeerId, msg);
        });
    }
    /**
     * Handle incoming PAID_REQUEST
     */
    async handlePaidRequest(msg, remotePeerId) {
        console.log(`[Channel] Received PAID_REQUEST: ${msg.service} for ${msg.payment.amount} sats`);
        const channel = this.manager.getChannel(msg.channelId);
        if (!channel) {
            console.warn(`[Channel] Unknown channel ${msg.channelId}`);
            return;
        }
        // Process payment
        // IMPORTANT: The payment must be constructed from the SENDER's perspective,
        // because processPayment() will swap the balances to convert to receiver's perspective.
        // The sender (remote peer) paid us, so:
        //   - newLocalBalance = sender's new balance (their local, which is our remote - amount)
        //   - newRemoteBalance = our new balance (their remote, which is our local + amount)
        const payment = {
            channelId: msg.channelId,
            amount: msg.payment.amount,
            newSequenceNumber: msg.payment.sequence,
            newLocalBalance: channel.remoteBalance - msg.payment.amount, // Sender's new balance
            newRemoteBalance: channel.localBalance + msg.payment.amount, // Our new balance
            signature: msg.payment.signature,
            timestamp: msg.timestamp
        };
        try {
            await this.manager.processPayment(payment);
        }
        catch (err) {
            console.error(`[Channel] Payment failed: ${err.message}`);
            // Send error response
            const result = {
                ...createBaseMessage(MessageType.PAID_RESULT, this.peerId, remotePeerId),
                type: MessageType.PAID_RESULT,
                requestId: msg.id,
                channelId: msg.channelId,
                success: false,
                error: `Payment failed: ${err.message}`,
                paymentAccepted: false
            };
            await this.handler.send(remotePeerId, result);
            return;
        }
        // Process service request
        let serviceResult;
        if (this.onPaidRequest) {
            serviceResult = await this.onPaidRequest(msg, channel);
        }
        else {
            serviceResult = { success: false, error: 'No service handler configured' };
        }
        // Send result
        const result = {
            ...createBaseMessage(MessageType.PAID_RESULT, this.peerId, remotePeerId),
            type: MessageType.PAID_RESULT,
            requestId: msg.id,
            channelId: msg.channelId,
            success: serviceResult.success,
            result: serviceResult.result,
            error: serviceResult.error,
            paymentAccepted: true
        };
        await this.handler.send(remotePeerId, result);
        console.log(`[Channel] Sent PAID_RESULT: success=${serviceResult.success}`);
    }
    /**
     * Get channel by peer ID (first open channel)
     */
    getChannelByPeer(peerId) {
        return this.manager.getChannelsByPeer(peerId).find(c => c.state === 'open');
    }
    /**
     * Get all channels
     */
    getChannels() {
        return this.manager.getAllChannels();
    }
    // ============================================================
    // Real BSV Transaction Methods
    // ============================================================
    /**
     * Fund a channel with a real UTXO
     *
     * @param channelId - The channel to fund
     * @param utxo - The UTXO to spend
     * @param fee - Transaction fee in satoshis
     * @returns The funding transaction ID
     */
    async fundChannel(channelId, utxo, fee = 200) {
        return await this.manager.fundChannelWithUTXO(channelId, utxo, fee);
    }
    /**
     * Verify funding transaction with SPV and open the channel
     *
     * @param channelId - The channel to verify and open
     * @returns true if verified and opened, false if not confirmed yet
     */
    async verifyAndOpenChannel(channelId) {
        const channel = this.manager.getChannel(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        if (channel.state !== 'pending') {
            throw new Error(`Channel already in state ${channel.state}`);
        }
        // Verify funding transaction
        const verified = await this.manager.verifyFundingTx(channelId);
        if (verified) {
            // Open the channel
            this.manager.openChannel(channelId);
            this.emit('channel:opened', channel);
            this.onChannelReady?.(channel);
            return true;
        }
        return false;
    }
    /**
     * Send a signed payment through a channel
     * Uses real commitment transaction signatures
     */
    async payWithSignature(channelId, amount) {
        const channel = this.manager.getChannel(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        if (channel.state !== 'open')
            throw new Error(`Channel not open`);
        // Create signed payment
        const payment = await this.manager.createSignedPayment(channelId, amount);
        // Send CHANNEL_UPDATE
        const updateMsg = {
            ...createBaseMessage(MessageType.CHANNEL_UPDATE, this.peerId, channel.remotePeerId),
            type: MessageType.CHANNEL_UPDATE,
            channelId,
            sequence: payment.newSequenceNumber,
            ourBalance: payment.newLocalBalance,
            theirBalance: payment.newRemoteBalance,
            commitmentTxHex: '', // Full tx would be here for transparency
            signature: payment.signature
        };
        await this.handler.send(channel.remotePeerId, updateMsg);
        console.log(`[Channel] Sent signed payment of ${amount} sats (seq: ${payment.newSequenceNumber})`);
        return payment;
    }
    // ============================================================
    // Cooperative Close Protocol
    // ============================================================
    /**
     * Initiate cooperative close of a channel
     * Creates close request, signs it, and sends to counterparty
     */
    async initiateCooperativeClose(channelId, privateKeyHex) {
        const channel = this.manager.getChannel(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        if (!channel.fundingTxId)
            throw new Error('Channel has no funding transaction');
        if (channel.state === 'closed')
            throw new Error('Channel already closed');
        const privateKey = PrivateKey.fromHex(privateKeyHex);
        const localPubKey = PublicKey.fromString(channel.localPubKey);
        const remotePubKey = PublicKey.fromString(channel.remotePubKey);
        console.log(`[Close] Initiating cooperative close for channel ${channelId.substring(0, 8)}...`);
        console.log(`[Close] Local balance: ${channel.localBalance}, Remote balance: ${channel.remoteBalance}`);
        // Create close request
        const closeRequest = await createCloseRequest({
            channelId,
            fundingTxId: channel.fundingTxId.trim(),
            fundingVout: channel.fundingOutputIndex ?? 0,
            capacity: channel.capacity,
            localBalance: channel.localBalance,
            remoteBalance: channel.remoteBalance,
            localPrivateKey: privateKey,
            localPubKey,
            remotePubKey
        });
        // Store for when we receive the accept
        this.pendingCloseRequests.set(channelId, closeRequest);
        // Send to counterparty
        const msg = {
            ...createBaseMessage(MessageType.CLOSE_REQUEST, this.peerId, channel.remotePeerId),
            type: MessageType.CLOSE_REQUEST,
            ...closeRequest
        };
        await this.handler.send(channel.remotePeerId, msg);
        console.log(`[Close] Sent CLOSE_REQUEST to ${channel.remotePeerId.substring(0, 16)}...`);
        // Update channel state (only if open, pending channels go straight to closing)
        if (channel.state === 'open') {
            try {
                this.manager.closeChannel(channelId);
            }
            catch (err) {
                // Ignore - might already be closing
            }
        }
        return closeRequest;
    }
    /**
     * Handle incoming CLOSE_REQUEST (responder side)
     */
    async handleCloseRequest(msg, remotePeerId) {
        console.log(`[Close] Received CLOSE_REQUEST for channel ${msg.channelId.substring(0, 8)}...`);
        console.log(`[Close] Initiator balance: ${msg.initiatorBalance}, Responder balance: ${msg.responderBalance}`);
        const channel = this.manager.getChannel(msg.channelId);
        if (!channel) {
            console.warn(`[Close] Unknown channel ${msg.channelId}`);
            return;
        }
        // Get our private key from manager config
        const privateKeyHex = this.manager.privateKey;
        if (!privateKeyHex) {
            console.error('[Close] No private key available');
            return;
        }
        const privateKey = PrivateKey.fromHex(privateKeyHex);
        try {
            // Sign the close request
            const closeRequest = {
                channelId: msg.channelId,
                fundingTxId: msg.fundingTxId,
                fundingVout: msg.fundingVout,
                capacity: msg.capacity,
                initiatorBalance: msg.initiatorBalance,
                responderBalance: msg.responderBalance,
                fee: msg.fee,
                closingTxHex: '',
                initiatorSignature: msg.initiatorSignature,
                initiatorPubKey: msg.initiatorPubKey,
                responderPubKey: msg.responderPubKey
            };
            const closeAccept = await signCloseRequest(closeRequest, privateKey);
            // Send accept back
            const acceptMsg = {
                ...createBaseMessage(MessageType.CLOSE_ACCEPT, this.peerId, remotePeerId),
                type: MessageType.CLOSE_ACCEPT,
                channelId: msg.channelId,
                responderSignature: closeAccept.responderSignature
            };
            await this.handler.send(remotePeerId, acceptMsg);
            console.log(`[Close] Sent CLOSE_ACCEPT with signature`);
            // Update channel state (if open)
            if (channel.state === 'open') {
                try {
                    this.manager.closeChannel(msg.channelId);
                }
                catch (err) {
                    // Ignore
                }
            }
        }
        catch (err) {
            console.error(`[Close] Failed to sign close request: ${err.message}`);
        }
    }
    /**
     * Handle incoming CLOSE_ACCEPT (initiator side)
     */
    async handleCloseAccept(msg, remotePeerId) {
        console.log(`[Close] Received CLOSE_ACCEPT for channel ${msg.channelId.substring(0, 8)}...`);
        const closeRequest = this.pendingCloseRequests.get(msg.channelId);
        if (!closeRequest) {
            console.warn(`[Close] No pending close request for channel ${msg.channelId}`);
            return;
        }
        try {
            // Broadcast the closing transaction
            const closingTxId = await broadcastClose(closeRequest, {
                channelId: msg.channelId,
                responderSignature: msg.responderSignature
            });
            console.log(`[Close] 🎉 BROADCAST SUCCESS! TXID: ${closingTxId}`);
            // Send completion message
            const completeMsg = {
                ...createBaseMessage(MessageType.CLOSE_COMPLETE, this.peerId, remotePeerId),
                type: MessageType.CLOSE_COMPLETE,
                channelId: msg.channelId,
                closingTxId
            };
            await this.handler.send(remotePeerId, completeMsg);
            // Finalize close
            this.manager.finalizeClose(msg.channelId, closingTxId);
            this.pendingCloseRequests.delete(msg.channelId);
            this.emit('channel:closed', { channelId: msg.channelId, closingTxId });
        }
        catch (err) {
            console.error(`[Close] Broadcast failed: ${err.message}`);
        }
    }
    /**
     * Handle incoming CLOSE_COMPLETE (responder side)
     */
    async handleCloseComplete(msg, remotePeerId) {
        console.log(`[Close] Received CLOSE_COMPLETE for channel ${msg.channelId.substring(0, 8)}...`);
        console.log(`[Close] 🎉 Closing TXID: ${msg.closingTxId}`);
        // Finalize close
        this.manager.finalizeClose(msg.channelId, msg.closingTxId);
        this.emit('channel:closed', { channelId: msg.channelId, closingTxId: msg.closingTxId });
    }
}
