/**
 * Payment Channel Manager
 * 
 * Manages the lifecycle of payment channels:
 * - Opening channels (funding transactions)
 * - Processing payments (commitment updates)
 * - Closing channels (cooperative or unilateral)
 * 
 * Now with REAL BSV signatures!
 */

import { EventEmitter } from 'events'
import { v4 as uuid } from 'uuid'
import { PrivateKey, PublicKey, Script } from '@bsv/sdk'
import {
  Channel,
  ChannelState,
  ChannelConfig,
  ChannelOpenRequest,
  ChannelOpenResponse,
  ChannelPayment,
  ChannelCloseRequest,
  CommitmentTransaction,
  DEFAULT_CHANNEL_CONFIG
} from './types.js'
import {
  createMultisigLockingScript,
  createCommitmentTransaction,
  createSettlementTransaction,
  signCommitmentTransaction,
  verifyCommitmentSignature,
  CommitmentTxParams
} from './transactions.js'

export interface ChannelManagerConfig extends Partial<ChannelConfig> {
  /** Our BSV private key (hex) for signing */
  privateKey: string
  /** Our BSV public key (hex) */
  publicKey: string
  /** Our BSV address for receiving payouts */
  address: string
  /** Callback to broadcast transactions */
  broadcastTx?: (rawTx: string) => Promise<string>
}

export class ChannelManager extends EventEmitter {
  private config: ChannelConfig
  private privateKey: PrivateKey
  private publicKey: string
  private address: string
  private channels: Map<string, Channel> = new Map()
  private broadcastTx?: (rawTx: string) => Promise<string>

  constructor(managerConfig: ChannelManagerConfig) {
    super()
    this.privateKey = PrivateKey.fromString(managerConfig.privateKey, 'hex')
    this.publicKey = managerConfig.publicKey
    this.address = managerConfig.address
    this.broadcastTx = managerConfig.broadcastTx
    this.config = {
      ...DEFAULT_CHANNEL_CONFIG,
      ...managerConfig
    }
  }

  /**
   * Get the multisig funding script for a channel
   */
  private getFundingScript(channel: Channel): Script {
    if (channel.fundingScript) {
      return Script.fromHex(channel.fundingScript)
    }
    return createMultisigLockingScript(channel.localPubKey, channel.remotePubKey)
  }

  /**
   * Create a new channel (initiator side)
   */
  async createChannel(
    remotePeerId: string,
    remotePubKey: string,
    remoteAddress: string,
    amount: number,
    lifetimeMs?: number
  ): Promise<Channel> {
    // Validate amount
    if (amount < this.config.minCapacity) {
      throw new Error(`Channel capacity must be at least ${this.config.minCapacity} satoshis`)
    }
    if (amount > this.config.maxCapacity) {
      throw new Error(`Channel capacity cannot exceed ${this.config.maxCapacity} satoshis`)
    }

    const lifetime = lifetimeMs ?? this.config.defaultLifetimeMs
    const now = Date.now()
    
    // Calculate nLockTime (current time + lifetime, in Unix seconds)
    const nLockTime = Math.floor((now + lifetime) / 1000)

    // Create and cache the funding script
    const fundingScript = createMultisigLockingScript(this.publicKey, remotePubKey)

    const channel: Channel = {
      id: uuid(),
      localPeerId: '', // Will be set by P2PNode
      remotePeerId,
      localPubKey: this.publicKey,
      remotePubKey,
      localAddress: this.address,
      remoteAddress,
      state: 'pending',
      capacity: amount,
      localBalance: amount,  // Initiator funds the channel
      remoteBalance: 0,
      sequenceNumber: 0,
      fundingScript: fundingScript.toHex(),
      nLockTime,
      createdAt: now,
      updatedAt: now
    }

    this.channels.set(channel.id, channel)
    this.emit('channel:created', channel)
    
    return channel
  }

  /**
   * Accept a channel open request (responder side)
   */
  async acceptChannel(
    channelId: string,
    localPeerId: string,
    remotePeerId: string,
    remotePubKey: string,
    remoteAddress: string,
    capacity: number,
    nLockTime: number
  ): Promise<Channel> {
    const now = Date.now()

    // Create and cache the funding script
    const fundingScript = createMultisigLockingScript(this.publicKey, remotePubKey)

    const channel: Channel = {
      id: channelId,
      localPeerId,
      remotePeerId,
      localPubKey: this.publicKey,
      remotePubKey,
      localAddress: this.address,
      remoteAddress,
      state: 'pending',
      capacity,
      localBalance: 0,  // Responder starts with 0
      remoteBalance: capacity,  // Initiator has all funds
      sequenceNumber: 0,
      fundingScript: fundingScript.toHex(),
      nLockTime,
      createdAt: now,
      updatedAt: now
    }

    this.channels.set(channel.id, channel)
    this.emit('channel:accepted', channel)
    
    return channel
  }

  /**
   * Set funding transaction details (after funding tx is created)
   */
  setFundingTx(channelId: string, txId: string, outputIndex: number): void {
    const channel = this.channels.get(channelId)
    if (!channel) throw new Error(`Channel ${channelId} not found`)
    
    channel.fundingTxId = txId
    channel.fundingOutputIndex = outputIndex
    channel.updatedAt = Date.now()
  }

  /**
   * Mark channel as open (after funding tx is confirmed)
   */
  openChannel(channelId: string): void {
    const channel = this.channels.get(channelId)
    if (!channel) throw new Error(`Channel ${channelId} not found`)
    if (channel.state !== 'pending') {
      throw new Error(`Cannot open channel in state ${channel.state}`)
    }
    
    channel.state = 'open'
    channel.updatedAt = Date.now()
    this.emit('channel:opened', channel)
  }

  /**
   * Build commitment transaction parameters for current channel state
   * Uses deterministic ordering based on pubkey sort (same as multisig)
   * to ensure both parties build identical transactions
   */
  private buildCommitmentParams(
    channel: Channel,
    newLocalBalance: number,
    newRemoteBalance: number,
    newSequenceNumber: number
  ): CommitmentTxParams {
    if (!channel.fundingTxId || channel.fundingOutputIndex === undefined) {
      throw new Error('Channel has no funding transaction')
    }
    if (!channel.remoteAddress) {
      throw new Error('Channel has no remote address')
    }

    // Sort by pubkey to match multisig ordering
    const localFirst = channel.localPubKey < channel.remotePubKey
    
    return {
      fundingTxId: channel.fundingTxId,
      fundingVout: channel.fundingOutputIndex,
      fundingAmount: channel.capacity,
      // Use sorted pubkey order for consistency
      pubKeyA: localFirst ? channel.localPubKey : channel.remotePubKey,
      pubKeyB: localFirst ? channel.remotePubKey : channel.localPubKey,
      addressA: localFirst ? channel.localAddress : channel.remoteAddress,
      addressB: localFirst ? channel.remoteAddress : channel.localAddress,
      balanceA: localFirst ? newLocalBalance : newRemoteBalance,
      balanceB: localFirst ? newRemoteBalance : newLocalBalance,
      sequenceNumber: newSequenceNumber,
      nLockTime: channel.nLockTime
    }
  }

  /**
   * Process an incoming payment (update channel state)
   * Now with REAL signature verification!
   */
  async processPayment(payment: ChannelPayment): Promise<void> {
    const channel = this.channels.get(payment.channelId)
    if (!channel) throw new Error(`Channel ${payment.channelId} not found`)
    if (channel.state !== 'open') {
      throw new Error(`Cannot process payment on channel in state ${channel.state}`)
    }

    // Verify sequence number
    if (payment.newSequenceNumber !== channel.sequenceNumber + 1) {
      throw new Error(`Invalid sequence number: expected ${channel.sequenceNumber + 1}, got ${payment.newSequenceNumber}`)
    }

    // Verify balances sum to capacity
    if (payment.newLocalBalance + payment.newRemoteBalance !== channel.capacity) {
      throw new Error('Invalid payment: balances do not sum to capacity')
    }

    // Build the commitment tx that this payment represents
    // Note: From sender's perspective, newLocalBalance is THEIR balance
    // So we swap when building from our perspective
    const commitmentParams = this.buildCommitmentParams(
      channel,
      payment.newRemoteBalance,  // Our new balance (their "remote")
      payment.newLocalBalance,   // Their new balance (their "local")
      payment.newSequenceNumber
    )
    const commitmentTx = createCommitmentTransaction(commitmentParams)
    const fundingScript = this.getFundingScript(channel)

    // Verify the sender's signature
    const signatureValid = verifyCommitmentSignature(
      commitmentTx,
      payment.signature,
      channel.remotePubKey,
      fundingScript,
      channel.capacity
    )

    if (!signatureValid) {
      throw new Error('Invalid payment signature')
    }

    // Sign our half of the commitment
    const ourSignature = signCommitmentTransaction(
      commitmentTx,
      this.privateKey,
      fundingScript,
      channel.capacity
    )

    // Update channel state
    channel.localBalance = payment.newRemoteBalance  // Their remote is our local
    channel.remoteBalance = payment.newLocalBalance  // Their local is our remote
    channel.sequenceNumber = payment.newSequenceNumber
    // Store commitment tx params instead of hex (can reconstruct when needed)
    channel.latestCommitmentTx = JSON.stringify(commitmentParams)
    channel.latestLocalSignature = ourSignature
    channel.latestRemoteSignature = payment.signature
    channel.updatedAt = Date.now()

    this.emit('channel:payment_received', { channel, payment })
  }

  /**
   * Create an outgoing payment
   * Now with REAL signatures!
   */
  async createPayment(channelId: string, amount: number): Promise<ChannelPayment> {
    const channel = this.channels.get(channelId)
    if (!channel) throw new Error(`Channel ${channelId} not found`)
    if (channel.state !== 'open') {
      throw new Error(`Cannot pay on channel in state ${channel.state}`)
    }

    // Check sufficient balance
    if (amount > channel.localBalance) {
      throw new Error(`Insufficient balance: have ${channel.localBalance}, need ${amount}`)
    }

    const newSequenceNumber = channel.sequenceNumber + 1
    const newLocalBalance = channel.localBalance - amount
    const newRemoteBalance = channel.remoteBalance + amount

    // Build and sign commitment transaction
    const commitmentParams = this.buildCommitmentParams(
      channel,
      newLocalBalance,
      newRemoteBalance,
      newSequenceNumber
    )
    const commitmentTx = createCommitmentTransaction(commitmentParams)
    const fundingScript = this.getFundingScript(channel)

    // Sign the commitment
    const signature = signCommitmentTransaction(
      commitmentTx,
      this.privateKey,
      fundingScript,
      channel.capacity
    )

    const payment: ChannelPayment = {
      channelId,
      amount,
      newSequenceNumber,
      newLocalBalance,
      newRemoteBalance,
      signature,
      timestamp: Date.now()
    }

    // Update local state optimistically
    channel.localBalance = newLocalBalance
    channel.remoteBalance = newRemoteBalance
    channel.sequenceNumber = newSequenceNumber
    // Store commitment tx params instead of hex (can reconstruct when needed)
    channel.latestCommitmentTx = JSON.stringify(commitmentParams)
    channel.latestLocalSignature = signature
    channel.updatedAt = Date.now()

    this.emit('channel:payment_sent', { channel, payment })
    
    return payment
  }

  /**
   * Initiate cooperative channel close
   * Now with REAL signatures!
   */
  async closeChannel(channelId: string): Promise<ChannelCloseRequest> {
    const channel = this.channels.get(channelId)
    if (!channel) throw new Error(`Channel ${channelId} not found`)
    if (channel.state !== 'open') {
      throw new Error(`Cannot close channel in state ${channel.state}`)
    }
    if (!channel.fundingTxId || channel.fundingOutputIndex === undefined) {
      throw new Error('Channel has no funding transaction')
    }
    if (!channel.remoteAddress) {
      throw new Error('Channel has no remote address')
    }

    channel.state = 'closing'
    channel.updatedAt = Date.now()

    // Build settlement transaction (cooperative close)
    const settlementTx = createSettlementTransaction({
      fundingTxId: channel.fundingTxId,
      fundingVout: channel.fundingOutputIndex,
      fundingAmount: channel.capacity,
      pubKeyA: channel.localPubKey,
      pubKeyB: channel.remotePubKey,
      addressA: channel.localAddress,
      addressB: channel.remoteAddress,
      balanceA: channel.localBalance,
      balanceB: channel.remoteBalance,
      nLockTime: 0  // Settlement can be broadcast immediately
    })

    const fundingScript = this.getFundingScript(channel)
    const signature = signCommitmentTransaction(
      settlementTx,
      this.privateKey,
      fundingScript,
      channel.capacity
    )

    const closeRequest: ChannelCloseRequest = {
      channelId,
      finalSequenceNumber: channel.sequenceNumber,
      finalLocalBalance: channel.localBalance,
      finalRemoteBalance: channel.remoteBalance,
      type: 'cooperative',
      signature
    }

    this.emit('channel:closing', { channel, closeRequest })
    
    return closeRequest
  }

  /**
   * Accept a cooperative close request
   */
  async acceptClose(channelId: string, closeRequest: ChannelCloseRequest): Promise<string> {
    const channel = this.channels.get(channelId)
    if (!channel) throw new Error(`Channel ${channelId} not found`)
    if (!channel.fundingTxId || channel.fundingOutputIndex === undefined) {
      throw new Error('Channel has no funding transaction')
    }
    if (!channel.remoteAddress) {
      throw new Error('Channel has no remote address')
    }

    // Build the settlement tx
    const settlementTx = createSettlementTransaction({
      fundingTxId: channel.fundingTxId,
      fundingVout: channel.fundingOutputIndex,
      fundingAmount: channel.capacity,
      pubKeyA: channel.localPubKey,
      pubKeyB: channel.remotePubKey,
      addressA: channel.localAddress,
      addressB: channel.remoteAddress,
      // Use requester's final balances (swapped perspective)
      balanceA: closeRequest.finalRemoteBalance,
      balanceB: closeRequest.finalLocalBalance,
      nLockTime: 0
    })

    const fundingScript = this.getFundingScript(channel)

    // Verify their signature
    const theirSigValid = verifyCommitmentSignature(
      settlementTx,
      closeRequest.signature,
      channel.remotePubKey,
      fundingScript,
      channel.capacity
    )

    if (!theirSigValid) {
      throw new Error('Invalid close request signature')
    }

    // Sign our half
    const ourSignature = signCommitmentTransaction(
      settlementTx,
      this.privateKey,
      fundingScript,
      channel.capacity
    )

    channel.state = 'closing'
    channel.updatedAt = Date.now()

    // Return our signature (caller combines and broadcasts)
    return ourSignature
  }

  /**
   * Complete channel close (after close tx is confirmed)
   */
  finalizeClose(channelId: string, closeTxId: string): void {
    const channel = this.channels.get(channelId)
    if (!channel) throw new Error(`Channel ${channelId} not found`)
    
    channel.state = 'closed'
    channel.updatedAt = Date.now()
    
    this.emit('channel:closed', { channel, closeTxId })
  }

  /**
   * Get the latest fully-signed commitment tx (for dispute/unilateral close)
   */
  getLatestCommitment(channelId: string): CommitmentTransaction | null {
    const channel = this.channels.get(channelId)
    if (!channel) return null
    if (!channel.latestCommitmentTx || !channel.latestLocalSignature || !channel.latestRemoteSignature) {
      return null
    }

    return {
      rawTx: channel.latestCommitmentTx,
      txId: '', // Would need to compute
      sequenceNumber: channel.sequenceNumber,
      localBalance: channel.localBalance,
      remoteBalance: channel.remoteBalance,
      localSignature: channel.latestLocalSignature,
      remoteSignature: channel.latestRemoteSignature
    }
  }

  /**
   * Get a channel by ID
   */
  getChannel(channelId: string): Channel | undefined {
    return this.channels.get(channelId)
  }

  /**
   * Get all channels
   */
  getAllChannels(): Channel[] {
    return Array.from(this.channels.values())
  }

  /**
   * Get channels by peer ID
   */
  getChannelsByPeer(peerId: string): Channel[] {
    return this.getAllChannels().filter(c => c.remotePeerId === peerId)
  }

  /**
   * Get open channels
   */
  getOpenChannels(): Channel[] {
    return this.getAllChannels().filter(c => c.state === 'open')
  }

  /**
   * Get total balance across all open channels
   */
  getTotalBalance(): number {
    return this.getOpenChannels().reduce((sum, c) => sum + c.localBalance, 0)
  }
}
