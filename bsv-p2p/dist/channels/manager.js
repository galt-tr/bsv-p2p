/**
 * Payment Channel Manager
 *
 * Manages the lifecycle of payment channels:
 * - Opening channels (funding transactions)
 * - Processing payments (commitment updates)
 * - Closing channels (cooperative or unilateral)
 */
import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { DEFAULT_CHANNEL_CONFIG } from './types.js';
import { ChannelStorage } from './storage.js';
export class ChannelManager extends EventEmitter {
    config;
    privateKey;
    publicKey;
    channels = new Map();
    storage;
    broadcastTx;
    constructor(managerConfig) {
        super();
        this.privateKey = managerConfig.privateKey;
        this.publicKey = managerConfig.publicKey;
        this.broadcastTx = managerConfig.broadcastTx;
        this.config = {
            ...DEFAULT_CHANNEL_CONFIG,
            ...managerConfig
        };
        // Initialize storage
        this.storage = new ChannelStorage(managerConfig.dbPath);
        // Load existing channels from database
        this.loadChannels();
    }
    /**
     * Load channels from persistent storage
     */
    loadChannels() {
        const channels = this.storage.getAllChannels();
        for (const channel of channels) {
            this.channels.set(channel.id, channel);
        }
        console.log(`[ChannelManager] Loaded ${channels.length} channels from database`);
    }
    /**
     * Save a channel to persistent storage
     */
    saveChannel(channel) {
        this.storage.saveChannel(channel);
    }
    /**
     * Record a payment in the database
     */
    recordPayment(channelId, amount, direction, sequence, signature) {
        const record = {
            id: uuid(),
            channelId,
            amount,
            direction,
            sequence,
            signature,
            timestamp: Date.now()
        };
        this.storage.recordPayment(record);
    }
    /**
     * Create a new channel (initiator side)
     */
    async createChannel(remotePeerId, remotePubKey, amount, lifetimeMs) {
        // Validate amount
        if (amount < this.config.minCapacity) {
            throw new Error(`Channel capacity must be at least ${this.config.minCapacity} satoshis`);
        }
        if (amount > this.config.maxCapacity) {
            throw new Error(`Channel capacity cannot exceed ${this.config.maxCapacity} satoshis`);
        }
        const lifetime = lifetimeMs ?? this.config.defaultLifetimeMs;
        const now = Date.now();
        // Calculate nLockTime (current time + lifetime, in Unix seconds)
        const nLockTime = Math.floor((now + lifetime) / 1000);
        const channel = {
            id: uuid(),
            localPeerId: '', // Will be set by P2PNode
            remotePeerId,
            localPubKey: this.publicKey,
            remotePubKey,
            state: 'pending',
            capacity: amount,
            localBalance: amount, // Initiator funds the channel
            remoteBalance: 0,
            sequenceNumber: 0,
            nLockTime,
            createdAt: now,
            updatedAt: now
        };
        this.channels.set(channel.id, channel);
        this.saveChannel(channel);
        this.emit('channel:created', channel);
        return channel;
    }
    /**
     * Accept a channel open request (responder side)
     */
    async acceptChannel(channelId, localPeerId, remotePeerId, remotePubKey, capacity, nLockTime) {
        const now = Date.now();
        const channel = {
            id: channelId,
            localPeerId,
            remotePeerId,
            localPubKey: this.publicKey,
            remotePubKey,
            state: 'pending',
            capacity,
            localBalance: 0, // Responder starts with 0
            remoteBalance: capacity, // Initiator has all funds
            sequenceNumber: 0,
            nLockTime,
            createdAt: now,
            updatedAt: now
        };
        this.channels.set(channel.id, channel);
        this.saveChannel(channel);
        this.emit('channel:accepted', channel);
        return channel;
    }
    /**
     * Set funding transaction details (after funding tx is created)
     */
    setFundingTx(channelId, txId, outputIndex) {
        const channel = this.channels.get(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        channel.fundingTxId = txId;
        channel.fundingOutputIndex = outputIndex;
        channel.updatedAt = Date.now();
        this.saveChannel(channel);
    }
    /**
     * Mark channel as open (after funding tx is confirmed)
     */
    openChannel(channelId) {
        const channel = this.channels.get(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        if (channel.state !== 'pending') {
            throw new Error(`Cannot open channel in state ${channel.state}`);
        }
        channel.state = 'open';
        channel.updatedAt = Date.now();
        this.saveChannel(channel);
        this.emit('channel:opened', channel);
    }
    /**
     * Process an incoming payment (update channel state)
     */
    async processPayment(payment) {
        const channel = this.channels.get(payment.channelId);
        if (!channel)
            throw new Error(`Channel ${payment.channelId} not found`);
        if (channel.state !== 'open') {
            throw new Error(`Cannot process payment on channel in state ${channel.state}`);
        }
        // Verify sequence number
        if (payment.newSequenceNumber !== channel.sequenceNumber + 1) {
            throw new Error(`Invalid sequence number: expected ${channel.sequenceNumber + 1}, got ${payment.newSequenceNumber}`);
        }
        // Verify balances sum to capacity
        if (payment.newLocalBalance + payment.newRemoteBalance !== channel.capacity) {
            throw new Error('Invalid payment: balances do not sum to capacity');
        }
        // TODO: Verify signature
        // Update channel state
        // Note: For incoming payments, the payment contains the SENDER's perspective:
        //   payment.newLocalBalance = sender's new local balance
        //   payment.newRemoteBalance = sender's new remote balance (which is our new local balance)
        // So we swap them to get our perspective:
        channel.remoteBalance = payment.newLocalBalance; // Sender's local is our remote
        channel.localBalance = payment.newRemoteBalance; // Sender's remote is our local
        channel.sequenceNumber = payment.newSequenceNumber;
        channel.updatedAt = Date.now();
        this.saveChannel(channel);
        this.recordPayment(channel.id, payment.amount, 'received', payment.newSequenceNumber, payment.signature);
        this.emit('channel:payment_received', { channel, payment });
    }
    /**
     * Create an outgoing payment
     */
    async createPayment(channelId, amount) {
        const channel = this.channels.get(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        if (channel.state !== 'open') {
            throw new Error(`Cannot pay on channel in state ${channel.state}`);
        }
        // Check sufficient balance
        if (amount > channel.localBalance) {
            throw new Error(`Insufficient balance: have ${channel.localBalance}, need ${amount}`);
        }
        const newSequenceNumber = channel.sequenceNumber + 1;
        const newLocalBalance = channel.localBalance - amount;
        const newRemoteBalance = channel.remoteBalance + amount;
        // TODO: Create and sign commitment transaction
        const signature = ''; // Placeholder
        const payment = {
            channelId,
            amount,
            newSequenceNumber,
            newLocalBalance,
            newRemoteBalance,
            signature,
            timestamp: Date.now()
        };
        // Update local state optimistically
        channel.localBalance = newLocalBalance;
        channel.remoteBalance = newRemoteBalance;
        channel.sequenceNumber = newSequenceNumber;
        channel.updatedAt = Date.now();
        this.saveChannel(channel);
        this.recordPayment(channelId, amount, 'sent', newSequenceNumber, signature);
        this.emit('channel:payment_sent', { channel, payment });
        return payment;
    }
    /**
     * Initiate cooperative channel close
     */
    async closeChannel(channelId) {
        const channel = this.channels.get(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        if (channel.state !== 'open') {
            throw new Error(`Cannot close channel in state ${channel.state}`);
        }
        channel.state = 'closing';
        channel.updatedAt = Date.now();
        this.saveChannel(channel);
        // TODO: Sign close request
        const signature = ''; // Placeholder
        const closeRequest = {
            channelId,
            finalSequenceNumber: channel.sequenceNumber,
            finalLocalBalance: channel.localBalance,
            finalRemoteBalance: channel.remoteBalance,
            type: 'cooperative',
            signature
        };
        this.emit('channel:closing', { channel, closeRequest });
        return closeRequest;
    }
    /**
     * Complete channel close (after close tx is confirmed)
     */
    finalizeClose(channelId, closeTxId) {
        const channel = this.channels.get(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        channel.state = 'closed';
        channel.updatedAt = Date.now();
        this.saveChannel(channel);
        this.emit('channel:closed', { channel, closeTxId });
    }
    /**
     * Get payment history for a channel
     */
    getPaymentHistory(channelId) {
        return this.storage.getPayments(channelId);
    }
    /**
     * Get a channel by ID
     */
    getChannel(channelId) {
        return this.channels.get(channelId);
    }
    /**
     * Get all channels
     */
    getAllChannels() {
        return Array.from(this.channels.values());
    }
    /**
     * Get channels by peer ID
     */
    getChannelsByPeer(peerId) {
        return this.getAllChannels().filter(c => c.remotePeerId === peerId);
    }
    /**
     * Get open channels
     */
    getOpenChannels() {
        return this.getAllChannels().filter(c => c.state === 'open');
    }
    /**
     * Get total balance across all open channels
     */
    getTotalBalance() {
        return this.getOpenChannels().reduce((sum, c) => sum + c.localBalance, 0);
    }
    // ============================================================
    // Real BSV Transaction Methods
    // ============================================================
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
    async fundChannelWithUTXO(channelId, utxo, fee = 200) {
        const channel = this.channels.get(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        if (channel.state !== 'pending') {
            throw new Error(`Cannot fund channel in state ${channel.state}`);
        }
        // Import required modules
        const { PrivateKey, PublicKey } = await import('@bsv/sdk');
        const { createFundingTransaction } = await import('./multisig.js');
        const { broadcastTransaction } = await import('./bsv-services.js');
        // Create the funding transaction
        const privateKey = PrivateKey.fromHex(this.privateKey);
        const localPubKey = PublicKey.fromString(channel.localPubKey);
        const remotePubKey = PublicKey.fromString(channel.remotePubKey);
        const fundingTx = await createFundingTransaction({
            utxo,
            privateKey,
            localPubKey,
            remotePubKey,
            capacity: channel.capacity,
            fee
        });
        // Broadcast the transaction
        const txHex = fundingTx.toHex();
        let txid;
        if (this.broadcastTx) {
            txid = await this.broadcastTx(txHex);
        }
        else {
            txid = await broadcastTransaction(txHex);
        }
        // Update channel with funding details
        this.setFundingTx(channelId, txid, 0); // Output 0 is always the multisig
        return txid;
    }
    /**
     * Verify a funding transaction using SPV
     *
     * Checks that the funding tx is confirmed and the merkle proof is valid.
     *
     * @param channelId - The channel to verify
     * @returns true if verified, false otherwise
     */
    async verifyFundingTx(channelId) {
        const channel = this.channels.get(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        if (!channel.fundingTxId) {
            throw new Error('Channel has no funding transaction');
        }
        const { verifyTransaction } = await import('./bsv-services.js');
        return await verifyTransaction(channel.fundingTxId);
    }
    /**
     * Create a signed commitment transaction for a payment
     *
     * @param channelId - The channel
     * @param amount - Payment amount in satoshis
     * @returns The payment object with a real signature
     */
    async createSignedPayment(channelId, amount) {
        const channel = this.channels.get(channelId);
        if (!channel)
            throw new Error(`Channel ${channelId} not found`);
        if (channel.state !== 'open') {
            throw new Error(`Cannot pay on channel in state ${channel.state}`);
        }
        if (!channel.fundingTxId) {
            throw new Error('Channel has no funding transaction');
        }
        // Check sufficient balance
        if (amount > channel.localBalance) {
            throw new Error(`Insufficient balance: have ${channel.localBalance}, need ${amount}`);
        }
        // Import required modules
        const { PrivateKey, PublicKey, Transaction } = await import('@bsv/sdk');
        const { createMultisigLockingScript, createCommitmentTransaction, signCommitment } = await import('./multisig.js');
        const { fetchTransaction } = await import('./bsv-services.js');
        // Fetch the funding transaction
        const fundingTxInfo = await fetchTransaction(channel.fundingTxId);
        const fundingTx = Transaction.fromHex(fundingTxInfo.hex);
        const newSequenceNumber = channel.sequenceNumber + 1;
        const newLocalBalance = channel.localBalance - amount;
        const newRemoteBalance = channel.remoteBalance + amount;
        // Create the commitment transaction
        const localPubKey = PublicKey.fromString(channel.localPubKey);
        const remotePubKey = PublicKey.fromString(channel.remotePubKey);
        const multisigScript = createMultisigLockingScript(localPubKey, remotePubKey);
        const commitmentTx = createCommitmentTransaction({
            fundingTx,
            fundingVout: channel.fundingOutputIndex ?? 0,
            multisigScript,
            capacity: channel.capacity,
            localBalance: newLocalBalance,
            remoteBalance: newRemoteBalance,
            localPubKey,
            remotePubKey,
            lockTime: channel.nLockTime,
            sequence: newSequenceNumber
        });
        // Sign our half
        const privateKey = PrivateKey.fromHex(this.privateKey);
        const { signature } = signCommitment(commitmentTx, 0, privateKey, multisigScript, channel.capacity);
        const payment = {
            channelId,
            amount,
            newSequenceNumber,
            newLocalBalance,
            newRemoteBalance,
            signature: Buffer.from(signature).toString('hex'),
            timestamp: Date.now()
        };
        // Update local state
        channel.localBalance = newLocalBalance;
        channel.remoteBalance = newRemoteBalance;
        channel.sequenceNumber = newSequenceNumber;
        channel.updatedAt = Date.now();
        this.saveChannel(channel);
        this.recordPayment(channelId, amount, 'sent', newSequenceNumber, payment.signature);
        this.emit('channel:payment_sent', { channel, payment });
        return payment;
    }
    /**
     * Verify a counterparty's payment signature
     */
    async verifyPaymentSignature(payment) {
        const channel = this.channels.get(payment.channelId);
        if (!channel)
            return false;
        if (!payment.signature)
            return false;
        try {
            const { PublicKey, Transaction } = await import('@bsv/sdk');
            const { createMultisigLockingScript, createCommitmentTransaction, verifySignature } = await import('./multisig.js');
            const { fetchTransaction } = await import('./bsv-services.js');
            // Fetch the funding transaction
            const fundingTxInfo = await fetchTransaction(channel.fundingTxId);
            const fundingTx = Transaction.fromHex(fundingTxInfo.hex);
            // Recreate the commitment transaction
            const localPubKey = PublicKey.fromString(channel.localPubKey);
            const remotePubKey = PublicKey.fromString(channel.remotePubKey);
            const multisigScript = createMultisigLockingScript(localPubKey, remotePubKey);
            // Note: From counterparty's perspective, local/remote are swapped
            const commitmentTx = createCommitmentTransaction({
                fundingTx,
                fundingVout: channel.fundingOutputIndex ?? 0,
                multisigScript,
                capacity: channel.capacity,
                localBalance: payment.newRemoteBalance, // Their local is our remote
                remoteBalance: payment.newLocalBalance, // Their remote is our local
                localPubKey: remotePubKey, // Their local pubkey
                remotePubKey: localPubKey, // Their remote is us
                lockTime: channel.nLockTime,
                sequence: payment.newSequenceNumber
            });
            const signatureBytes = Buffer.from(payment.signature, 'hex');
            return verifySignature(commitmentTx, 0, remotePubKey, Array.from(signatureBytes), multisigScript, channel.capacity);
        }
        catch (err) {
            console.error('Signature verification failed:', err);
            return false;
        }
    }
}
