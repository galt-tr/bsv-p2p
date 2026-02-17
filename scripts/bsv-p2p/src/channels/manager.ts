/**
 * Payment Channel Manager
 * 
 * Manages the lifecycle of payment channels:
 * - Opening channels (funding transactions)
 * - Processing payments (commitment updates)
 * - Closing channels (cooperative or unilateral)
 */

import { EventEmitter } from 'events'
import { v4 as uuid } from 'uuid'
import {
  Channel,
  ChannelState,
  ChannelConfig,
  ChannelOpenRequest,
  ChannelOpenResponse,
  ChannelPayment,
  ChannelCloseRequest,
  CommitmentTransaction,
  ChannelMessage,
  DEFAULT_CHANNEL_CONFIG
} from './types.js'

export interface ChannelManagerConfig extends Partial<ChannelConfig> {
  /** Our BSV private key (hex) for signing */
  privateKey: string
  /** Our BSV public key (hex) */
  publicKey: string
  /** Callback to broadcast transactions */
  broadcastTx?: (rawTx: string) => Promise<string>
}

export class ChannelManager extends EventEmitter {
  private config: ChannelConfig
  private privateKey: string
  private publicKey: string
  private channels: Map<string, Channel> = new Map()
  private broadcastTx?: (rawTx: string) => Promise<string>

  constructor(managerConfig: ChannelManagerConfig) {
    super()
    this.privateKey = managerConfig.privateKey
    this.publicKey = managerConfig.publicKey
    this.broadcastTx = managerConfig.broadcastTx
    this.config = {
      ...DEFAULT_CHANNEL_CONFIG,
      ...managerConfig
    }
  }

  /**
   * Create a new channel (initiator side)
   */
  async createChannel(
    remotePeerId: string,
    remotePubKey: string,
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

    const channel: Channel = {
      id: uuid(),
      localPeerId: '', // Will be set by P2PNode
      remotePeerId,
      localPubKey: this.publicKey,
      remotePubKey,
      state: 'pending',
      capacity: amount,
      localBalance: amount,  // Initiator funds the channel
      remoteBalance: 0,
      sequenceNumber: 0,
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
    capacity: number,
    nLockTime: number
  ): Promise<Channel> {
    const now = Date.now()

    const channel: Channel = {
      id: channelId,
      localPeerId,
      remotePeerId,
      localPubKey: this.publicKey,
      remotePubKey,
      state: 'pending',
      capacity,
      localBalance: 0,  // Responder starts with 0
      remoteBalance: capacity,  // Initiator has all funds
      sequenceNumber: 0,
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
   * Process an incoming payment (update channel state)
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

    // TODO: Verify signature

    // Update channel state
    // Note: For incoming payments, newLocalBalance is THEIR new balance (becomes our remote)
    // We need to swap the perspective
    channel.localBalance = payment.newRemoteBalance  // Their remote is our local
    channel.remoteBalance = payment.newLocalBalance  // Their local is our remote
    channel.sequenceNumber = payment.newSequenceNumber
    channel.updatedAt = Date.now()

    this.emit('channel:payment_received', { channel, payment })
  }

  /**
   * Create an outgoing payment
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

    // TODO: Create and sign commitment transaction
    const signature = '' // Placeholder

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
    channel.updatedAt = Date.now()

    this.emit('channel:payment_sent', { channel, payment })
    
    return payment
  }

  /**
   * Initiate cooperative channel close
   */
  async closeChannel(channelId: string): Promise<ChannelCloseRequest> {
    const channel = this.channels.get(channelId)
    if (!channel) throw new Error(`Channel ${channelId} not found`)
    if (channel.state !== 'open') {
      throw new Error(`Cannot close channel in state ${channel.state}`)
    }

    channel.state = 'closing'
    channel.updatedAt = Date.now()

    // TODO: Sign close request
    const signature = '' // Placeholder

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
