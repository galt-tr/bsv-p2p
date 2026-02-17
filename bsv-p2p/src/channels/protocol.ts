/**
 * Channel Protocol - Wires ChannelManager to P2P MessageHandler
 * 
 * Handles the P2P protocol for payment channel operations:
 * - Opening channels (CHANNEL_OPEN → CHANNEL_ACCEPT/REJECT)
 * - Updating state (CHANNEL_UPDATE for payments)
 * - Closing channels (CHANNEL_CLOSE)
 */

import { EventEmitter } from 'events'
import { ChannelManager } from './manager.js'
import { Channel, ChannelPayment } from './types.js'
import {
  MessageHandler,
} from '../protocol/handler.js'
import {
  Message,
  MessageType,
  ChannelOpenMessage,
  ChannelAcceptMessage,
  ChannelRejectMessage,
  ChannelUpdateMessage,
  ChannelCloseMessage,
  PaidRequestMessage,
  PaidResultMessage,
  createBaseMessage,
  createMessageId
} from '../protocol/messages.js'

export interface ChannelProtocolConfig {
  channelManager: ChannelManager
  messageHandler: MessageHandler
  peerId: string
  /** Auto-accept incoming channels up to this capacity (0 = manual approval) */
  autoAcceptMaxCapacity?: number
  /** Callback for manual channel approval */
  onChannelRequest?: (request: ChannelOpenMessage) => Promise<boolean>
  /** Callback when channel is ready */
  onChannelReady?: (channel: Channel) => void
  /** Callback for incoming paid requests */
  onPaidRequest?: (request: PaidRequestMessage, channel: Channel) => Promise<{ success: boolean; result?: any; error?: string }>
}

export class ChannelProtocol extends EventEmitter {
  private manager: ChannelManager
  private handler: MessageHandler
  private peerId: string
  private autoAcceptMax: number
  private onChannelRequest?: (request: ChannelOpenMessage) => Promise<boolean>
  private onChannelReady?: (channel: Channel) => void
  private onPaidRequest?: (request: PaidRequestMessage, channel: Channel) => Promise<{ success: boolean; result?: any; error?: string }>
  
  // Track pending channel opens (waiting for accept/reject)
  private pendingOpens: Map<string, {
    channel: Channel
    resolve: (channel: Channel) => void
    reject: (err: Error) => void
    timeout: NodeJS.Timeout
  }> = new Map()
  
  constructor(config: ChannelProtocolConfig) {
    super()
    this.manager = config.channelManager
    this.handler = config.messageHandler
    this.peerId = config.peerId
    this.autoAcceptMax = config.autoAcceptMaxCapacity ?? 0
    this.onChannelRequest = config.onChannelRequest
    this.onChannelReady = config.onChannelReady
    this.onPaidRequest = config.onPaidRequest
    
    this.setupListeners()
  }
  
  private setupListeners(): void {
    // Listen for channel messages
    this.handler.on(MessageType.CHANNEL_OPEN, this.handleChannelOpen.bind(this))
    this.handler.on(MessageType.CHANNEL_ACCEPT, this.handleChannelAccept.bind(this))
    this.handler.on(MessageType.CHANNEL_REJECT, this.handleChannelReject.bind(this))
    this.handler.on(MessageType.CHANNEL_UPDATE, this.handleChannelUpdate.bind(this))
    this.handler.on(MessageType.CHANNEL_CLOSE, this.handleChannelClose.bind(this))
    this.handler.on(MessageType.PAID_REQUEST, this.handlePaidRequest.bind(this))
  }
  
  /**
   * Open a new payment channel with a peer
   */
  async openChannel(
    remotePeerId: string,
    remotePubKey: string,
    capacity: number,
    timeoutMs: number = 30000
  ): Promise<Channel> {
    // Create channel locally
    const channel = await this.manager.createChannel(
      remotePeerId,
      remotePubKey,
      capacity
    )
    channel.localPeerId = this.peerId
    
    // TODO: Create funding transaction (for now, placeholder)
    const fundingTxHex = '' // Will be implemented with transaction layer
    
    // Send CHANNEL_OPEN message
    const openMsg: ChannelOpenMessage = {
      ...createBaseMessage(MessageType.CHANNEL_OPEN, this.peerId, remotePeerId),
      type: MessageType.CHANNEL_OPEN,
      channelId: channel.id,
      fundingTxHex,
      ourPubKey: channel.localPubKey,
      proposedCapacity: capacity,
      proposedLockTime: channel.nLockTime
    }
    
    // Set up promise to wait for accept/reject
    const responsePromise = new Promise<Channel>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingOpens.delete(channel.id)
        reject(new Error(`Channel open timeout after ${timeoutMs}ms`))
      }, timeoutMs)
      
      this.pendingOpens.set(channel.id, { channel, resolve, reject, timeout })
    })
    
    await this.handler.send(remotePeerId, openMsg)
    console.log(`[Channel] Sent CHANNEL_OPEN to ${remotePeerId.substring(0, 16)}... (id: ${channel.id.substring(0, 8)}...)`)
    
    return responsePromise
  }
  
  /**
   * Handle incoming CHANNEL_OPEN
   */
  private async handleChannelOpen(msg: ChannelOpenMessage, remotePeerId: string): Promise<void> {
    console.log(`[Channel] Received CHANNEL_OPEN from ${remotePeerId.substring(0, 16)}...`)
    console.log(`  Capacity: ${msg.proposedCapacity} sats, LockTime: ${msg.proposedLockTime}`)
    
    // Check auto-accept
    let shouldAccept = false
    if (this.autoAcceptMax > 0 && msg.proposedCapacity <= this.autoAcceptMax) {
      shouldAccept = true
      console.log(`[Channel] Auto-accepting (within limit of ${this.autoAcceptMax} sats)`)
    } else if (this.onChannelRequest) {
      shouldAccept = await this.onChannelRequest(msg)
    }
    
    if (!shouldAccept) {
      // Reject
      const rejectMsg: ChannelRejectMessage = {
        ...createBaseMessage(MessageType.CHANNEL_REJECT, this.peerId, remotePeerId),
        type: MessageType.CHANNEL_REJECT,
        channelId: msg.channelId,
        reason: 'Channel not accepted'
      }
      await this.handler.send(remotePeerId, rejectMsg)
      console.log(`[Channel] Rejected channel ${msg.channelId.substring(0, 8)}...`)
      this.emit('channel:rejected', { channelId: msg.channelId, reason: 'not accepted' })
      return
    }
    
    // Accept the channel
    const channel = await this.manager.acceptChannel(
      msg.channelId,
      this.peerId,
      remotePeerId,
      msg.ourPubKey,
      msg.proposedCapacity,
      msg.proposedLockTime
    )
    
    // TODO: Co-sign funding transaction
    const fundingTxHex = msg.fundingTxHex // Would add our signature
    
    // Send CHANNEL_ACCEPT
    const acceptMsg: ChannelAcceptMessage = {
      ...createBaseMessage(MessageType.CHANNEL_ACCEPT, this.peerId, remotePeerId),
      type: MessageType.CHANNEL_ACCEPT,
      channelId: msg.channelId,
      fundingTxHex,
      theirPubKey: channel.localPubKey
    }
    
    await this.handler.send(remotePeerId, acceptMsg)
    console.log(`[Channel] Accepted channel ${msg.channelId.substring(0, 8)}...`)
    
    // Mark as open (in real implementation, wait for funding tx confirmation)
    this.manager.openChannel(channel.id)
    
    this.emit('channel:opened', channel)
    this.onChannelReady?.(channel)
  }
  
  /**
   * Handle CHANNEL_ACCEPT response
   */
  private async handleChannelAccept(msg: ChannelAcceptMessage, remotePeerId: string): Promise<void> {
    console.log(`[Channel] Received CHANNEL_ACCEPT for ${msg.channelId.substring(0, 8)}...`)
    
    const pending = this.pendingOpens.get(msg.channelId)
    if (!pending) {
      console.warn(`[Channel] No pending open for channel ${msg.channelId}`)
      return
    }
    
    clearTimeout(pending.timeout)
    this.pendingOpens.delete(msg.channelId)
    
    // Update channel with remote pubkey
    const channel = pending.channel
    channel.remotePubKey = msg.theirPubKey
    
    // TODO: Verify and broadcast funding transaction
    
    // Mark as open
    this.manager.openChannel(channel.id)
    
    this.emit('channel:opened', channel)
    this.onChannelReady?.(channel)
    
    pending.resolve(channel)
  }
  
  /**
   * Handle CHANNEL_REJECT response
   */
  private async handleChannelReject(msg: ChannelRejectMessage, remotePeerId: string): Promise<void> {
    console.log(`[Channel] Received CHANNEL_REJECT for ${msg.channelId.substring(0, 8)}...: ${msg.reason}`)
    
    const pending = this.pendingOpens.get(msg.channelId)
    if (!pending) {
      return
    }
    
    clearTimeout(pending.timeout)
    this.pendingOpens.delete(msg.channelId)
    
    this.emit('channel:rejected', { channelId: msg.channelId, reason: msg.reason })
    
    pending.reject(new Error(`Channel rejected: ${msg.reason}`))
  }
  
  /**
   * Send a payment through a channel
   */
  async pay(channelId: string, amount: number): Promise<ChannelPayment> {
    const channel = this.manager.getChannel(channelId)
    if (!channel) throw new Error(`Channel ${channelId} not found`)
    if (channel.state !== 'open') throw new Error(`Channel not open`)
    
    // Create payment (updates local state)
    const payment = await this.manager.createPayment(channelId, amount)
    
    // TODO: Create commitment transaction
    const commitmentTxHex = '' // Will be implemented
    
    // Send CHANNEL_UPDATE
    const updateMsg: ChannelUpdateMessage = {
      ...createBaseMessage(MessageType.CHANNEL_UPDATE, this.peerId, channel.remotePeerId),
      type: MessageType.CHANNEL_UPDATE,
      channelId,
      sequence: payment.newSequenceNumber,
      ourBalance: payment.newLocalBalance,
      theirBalance: payment.newRemoteBalance,
      commitmentTxHex,
      signature: payment.signature
    }
    
    await this.handler.send(channel.remotePeerId, updateMsg)
    console.log(`[Channel] Sent payment of ${amount} sats (seq: ${payment.newSequenceNumber})`)
    
    return payment
  }
  
  /**
   * Handle incoming CHANNEL_UPDATE (payment received)
   */
  private async handleChannelUpdate(msg: ChannelUpdateMessage, remotePeerId: string): Promise<void> {
    console.log(`[Channel] Received CHANNEL_UPDATE for ${msg.channelId.substring(0, 8)}...`)
    console.log(`  Seq: ${msg.sequence}, Our balance: ${msg.theirBalance}, Their balance: ${msg.ourBalance}`)
    
    const channel = this.manager.getChannel(msg.channelId)
    if (!channel) {
      console.warn(`[Channel] Unknown channel ${msg.channelId}`)
      return
    }
    
    // Create payment object from message
    // Note: msg.ourBalance is THEIR local balance = our remote balance
    const payment: ChannelPayment = {
      channelId: msg.channelId,
      amount: msg.ourBalance - channel.remoteBalance, // Change in their balance = payment to us
      newSequenceNumber: msg.sequence,
      newLocalBalance: msg.ourBalance,      // Their perspective
      newRemoteBalance: msg.theirBalance,   // Their perspective
      signature: msg.signature,
      timestamp: msg.timestamp
    }
    
    try {
      await this.manager.processPayment(payment)
      console.log(`[Channel] Processed payment of ${payment.amount} sats`)
      this.emit('payment:received', { channel, payment })
    } catch (err: any) {
      console.error(`[Channel] Failed to process payment: ${err.message}`)
      this.emit('payment:error', { channel, error: err.message })
    }
  }
  
  /**
   * Close a channel cooperatively
   */
  async closeChannel(channelId: string): Promise<void> {
    const channel = this.manager.getChannel(channelId)
    if (!channel) throw new Error(`Channel ${channelId} not found`)
    
    const closeRequest = await this.manager.closeChannel(channelId)
    
    // TODO: Create close transaction
    const finalTxHex = '' // Will be implemented
    
    const closeMsg: ChannelCloseMessage = {
      ...createBaseMessage(MessageType.CHANNEL_CLOSE, this.peerId, channel.remotePeerId),
      type: MessageType.CHANNEL_CLOSE,
      channelId,
      finalTxHex,
      cooperative: true
    }
    
    await this.handler.send(channel.remotePeerId, closeMsg)
    console.log(`[Channel] Sent CHANNEL_CLOSE for ${channelId.substring(0, 8)}...`)
  }
  
  /**
   * Handle incoming CHANNEL_CLOSE
   */
  private async handleChannelClose(msg: ChannelCloseMessage, remotePeerId: string): Promise<void> {
    console.log(`[Channel] Received CHANNEL_CLOSE for ${msg.channelId.substring(0, 8)}...`)
    
    const channel = this.manager.getChannel(msg.channelId)
    if (!channel) {
      console.warn(`[Channel] Unknown channel ${msg.channelId}`)
      return
    }
    
    if (msg.cooperative) {
      // If we initiated the close (state=closing), this is the confirmation
      if (channel.state === 'closing') {
        this.manager.finalizeClose(msg.channelId, 'cooperative-close-txid')
        console.log(`[Channel] Close confirmed by peer`)
      } else {
        // Peer initiated - accept and close
        this.manager.finalizeClose(msg.channelId, 'cooperative-close-txid')
        console.log(`[Channel] Cooperative close complete`)
        
        // Send close acknowledgment back
        const ackMsg: ChannelCloseMessage = {
          ...createBaseMessage(MessageType.CHANNEL_CLOSE, this.peerId, remotePeerId),
          type: MessageType.CHANNEL_CLOSE,
          channelId: msg.channelId,
          finalTxHex: msg.finalTxHex,
          cooperative: true
        }
        await this.handler.send(remotePeerId, ackMsg)
      }
    } else {
      // Unilateral close - need to handle timeout
      console.warn(`[Channel] Unilateral close detected - monitoring for timeout`)
    }
    
    this.emit('channel:closed', channel)
  }
  
  /**
   * Send a paid service request
   */
  async paidRequest(
    channelId: string,
    service: string,
    params: Record<string, any>,
    amount: number,
    timeoutMs: number = 30000
  ): Promise<PaidResultMessage> {
    const channel = this.manager.getChannel(channelId)
    if (!channel) throw new Error(`Channel ${channelId} not found`)
    
    // Create payment
    const payment = await this.manager.createPayment(channelId, amount)
    
    // Send paid request
    const msg: PaidRequestMessage = {
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
    }
    
    // Wait for response using handler's request mechanism
    // We'll set up a one-time listener for PAID_RESULT
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.handler.off(MessageType.PAID_RESULT, resultHandler)
        reject(new Error(`Paid request timeout after ${timeoutMs}ms`))
      }, timeoutMs)
      
      const resultHandler = (result: PaidResultMessage) => {
        if (result.requestId === msg.id) {
          clearTimeout(timeout)
          this.handler.off(MessageType.PAID_RESULT, resultHandler)
          resolve(result)
        }
      }
      
      this.handler.on(MessageType.PAID_RESULT, resultHandler)
      this.handler.send(channel.remotePeerId, msg)
    })
  }
  
  /**
   * Handle incoming PAID_REQUEST
   */
  private async handlePaidRequest(msg: PaidRequestMessage, remotePeerId: string): Promise<void> {
    console.log(`[Channel] Received PAID_REQUEST: ${msg.service} for ${msg.payment.amount} sats`)
    
    const channel = this.manager.getChannel(msg.channelId)
    if (!channel) {
      console.warn(`[Channel] Unknown channel ${msg.channelId}`)
      return
    }
    
    // Process payment
    const payment: ChannelPayment = {
      channelId: msg.channelId,
      amount: msg.payment.amount,
      newSequenceNumber: msg.payment.sequence,
      newLocalBalance: channel.localBalance + msg.payment.amount,
      newRemoteBalance: channel.remoteBalance - msg.payment.amount,
      signature: msg.payment.signature,
      timestamp: msg.timestamp
    }
    
    try {
      await this.manager.processPayment(payment)
    } catch (err: any) {
      console.error(`[Channel] Payment failed: ${err.message}`)
      // Send error response
      const result: PaidResultMessage = {
        ...createBaseMessage(MessageType.PAID_RESULT, this.peerId, remotePeerId),
        type: MessageType.PAID_RESULT,
        requestId: msg.id,
        channelId: msg.channelId,
        success: false,
        error: `Payment failed: ${err.message}`,
        paymentAccepted: false
      }
      await this.handler.send(remotePeerId, result)
      return
    }
    
    // Process service request
    let serviceResult: { success: boolean; result?: any; error?: string }
    
    if (this.onPaidRequest) {
      serviceResult = await this.onPaidRequest(msg, channel)
    } else {
      serviceResult = { success: false, error: 'No service handler configured' }
    }
    
    // Send result
    const result: PaidResultMessage = {
      ...createBaseMessage(MessageType.PAID_RESULT, this.peerId, remotePeerId),
      type: MessageType.PAID_RESULT,
      requestId: msg.id,
      channelId: msg.channelId,
      success: serviceResult.success,
      result: serviceResult.result,
      error: serviceResult.error,
      paymentAccepted: true
    }
    
    await this.handler.send(remotePeerId, result)
    console.log(`[Channel] Sent PAID_RESULT: success=${serviceResult.success}`)
  }
  
  /**
   * Get channel by peer ID (first open channel)
   */
  getChannelByPeer(peerId: string): Channel | undefined {
    return this.manager.getChannelsByPeer(peerId).find(c => c.state === 'open')
  }
}
