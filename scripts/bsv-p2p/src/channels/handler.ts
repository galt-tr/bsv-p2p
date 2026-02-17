/**
 * Channel Handler - Integrates payment channels with the P2P node
 * 
 * Handles the full channel lifecycle over libp2p streams:
 * - Opening channels (negotiation + funding)
 * - Processing payments (commitment updates)
 * - Closing channels (cooperative settlement)
 */

import { EventEmitter } from 'events'
import { PrivateKey, PublicKey, Transaction } from '@bsv/sdk'
import { P2PNode } from '../daemon/node.js'
import { ChannelManager } from './manager.js'
import { Channel, ChannelPayment } from './types.js'
import {
  ChannelMessage,
  ChannelMessageType,
  OpenRequestMessage,
  OpenAcceptMessage,
  UpdateRequestMessage,
  UpdateAckMessage,
  CloseRequestMessage,
  CloseAcceptMessage,
  CHANNEL_PROTOCOL,
  serializeMessage,
  deserializeMessage
} from './protocol.js'
import {
  createMultisigLockingScript,
  createCommitmentTransaction,
  createSettlementTransaction,
  CommitmentTxParams
} from './transactions.js'
import { v4 as uuid } from 'uuid'

export interface ChannelHandlerConfig {
  /** Our BSV private key */
  privateKey: PrivateKey
  /** Default channel lifetime in ms */
  defaultLifetimeMs?: number
  /** Auto-accept channel requests below this amount */
  autoAcceptBelowSats?: number
  /** Callback to broadcast transactions */
  broadcastTx?: (rawTx: string) => Promise<string>
  /** Callback to get UTXOs for funding */
  getUtxos?: () => Promise<Array<{
    txid: string
    vout: number
    satoshis: number
    scriptPubKey: string
  }>>
}

export interface ServiceHandler {
  (input: any, payment: { amount: number; channelId: string }): Promise<any>
}

export class ChannelHandler extends EventEmitter {
  private node: P2PNode
  private manager: ChannelManager
  private config: ChannelHandlerConfig
  private publicKey: string
  private address: string
  private serviceHandlers: Map<string, ServiceHandler> = new Map()
  
  // Track pending channel negotiations
  private pendingOpens: Map<string, {
    resolve: (channel: Channel) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }> = new Map()

  constructor(node: P2PNode, config: ChannelHandlerConfig) {
    super()
    this.node = node
    this.config = config
    this.publicKey = config.privateKey.toPublicKey().toString()
    this.address = config.privateKey.toPublicKey().toAddress()
    
    this.manager = new ChannelManager({
      privateKey: config.privateKey.toString(),
      publicKey: this.publicKey,
      address: this.address,
      defaultLifetimeMs: config.defaultLifetimeMs,
      broadcastTx: config.broadcastTx
    })

    // Set up message handlers
    this.setupMessageHandlers()
  }

  private setupMessageHandlers(): void {
    // Listen for channel-related announcements
    this.node.on('message:received', (from: string, data: any) => {
      try {
        const message = deserializeMessage(data)
        this.handleMessage(from, message)
      } catch (err) {
        // Not a channel message, ignore
      }
    })
  }

  private async handleMessage(from: string, message: ChannelMessage): Promise<void> {
    switch (message.type) {
      case ChannelMessageType.OPEN_REQUEST:
        await this.handleOpenRequest(from, message as OpenRequestMessage)
        break
      case ChannelMessageType.OPEN_ACCEPT:
        await this.handleOpenAccept(from, message as OpenAcceptMessage)
        break
      case ChannelMessageType.UPDATE_REQUEST:
        await this.handleUpdateRequest(from, message as UpdateRequestMessage)
        break
      case ChannelMessageType.UPDATE_ACK:
        await this.handleUpdateAck(from, message as UpdateAckMessage)
        break
      case ChannelMessageType.CLOSE_REQUEST:
        await this.handleCloseRequest(from, message as CloseRequestMessage)
        break
      case ChannelMessageType.CLOSE_ACCEPT:
        await this.handleCloseAccept(from, message as CloseAcceptMessage)
        break
    }
  }

  /**
   * Register a service handler for paid requests
   */
  registerService(serviceId: string, handler: ServiceHandler): void {
    this.serviceHandlers.set(serviceId, handler)
  }

  /**
   * Open a new payment channel with a peer
   */
  async openChannel(
    peerId: string,
    remotePubKey: string,
    remoteAddress: string,
    amount: number,
    lifetimeMs?: number
  ): Promise<Channel> {
    const channelId = uuid()
    const lifetime = lifetimeMs ?? this.config.defaultLifetimeMs ?? 3600000
    
    // Create the channel locally
    const channel = await this.manager.createChannel(
      peerId,
      remotePubKey,
      remoteAddress,
      amount,
      lifetime
    )

    // Send open request
    const request: OpenRequestMessage = {
      type: ChannelMessageType.OPEN_REQUEST,
      channelId: channel.id,
      timestamp: Date.now(),
      proposedCapacity: amount,
      ourPubKey: this.publicKey,
      identityKey: this.publicKey,
      proposedLockTimeSeconds: Math.floor(lifetime / 1000),
      ourAddress: this.address
    }

    // Wait for response with timeout
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingOpens.delete(channel.id)
        reject(new Error('Channel open request timed out'))
      }, 30000)

      this.pendingOpens.set(channel.id, { resolve, reject, timeout })
      
      // Send via pubsub or direct stream (simplified for now)
      this.emit('channel:send', peerId, request)
    })
  }

  /**
   * Handle incoming channel open request
   */
  private async handleOpenRequest(from: string, request: OpenRequestMessage): Promise<void> {
    // Auto-accept if below threshold
    const autoAccept = this.config.autoAcceptBelowSats ?? 0
    
    if (request.proposedCapacity <= autoAccept || autoAccept === Infinity) {
      // Accept the channel
      const nLockTime = Math.floor(Date.now() / 1000) + request.proposedLockTimeSeconds
      
      const channel = await this.manager.acceptChannel(
        request.channelId,
        this.node.peerId,
        from,
        request.ourPubKey,
        request.ourAddress,
        request.proposedCapacity,
        nLockTime
      )

      const response: OpenAcceptMessage = {
        type: ChannelMessageType.OPEN_ACCEPT,
        channelId: request.channelId,
        timestamp: Date.now(),
        ourPubKey: this.publicKey,
        identityKey: this.publicKey,
        agreedLockTime: nLockTime,
        ourAddress: this.address
      }

      this.emit('channel:send', from, response)
      this.emit('channel:opened', channel)
    } else {
      // Reject (or could emit event for manual approval)
      this.emit('channel:request', from, request)
    }
  }

  /**
   * Handle channel open acceptance
   */
  private async handleOpenAccept(from: string, accept: OpenAcceptMessage): Promise<void> {
    const pending = this.pendingOpens.get(accept.channelId)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pendingOpens.delete(accept.channelId)

    const channel = this.manager.getChannel(accept.channelId)
    if (!channel) {
      pending.reject(new Error('Channel not found'))
      return
    }

    // Update channel with remote info
    // In full impl, would create funding tx here
    this.manager.openChannel(accept.channelId)
    
    pending.resolve(channel)
    this.emit('channel:opened', channel)
  }

  /**
   * Send a payment over a channel
   */
  async pay(channelId: string, amount: number, memo?: string): Promise<ChannelPayment> {
    const channel = this.manager.getChannel(channelId)
    if (!channel) throw new Error(`Channel ${channelId} not found`)
    if (channel.state !== 'open') throw new Error('Channel not open')

    // Create payment
    const payment = await this.manager.createPayment(channelId, amount)

    // Create new commitment tx
    const commitmentTx = createCommitmentTransaction({
      fundingTxId: channel.fundingTxId || 'mock-funding-txid',
      fundingVout: channel.fundingOutputIndex || 0,
      fundingAmount: channel.capacity,
      pubKeyA: channel.localPubKey,
      pubKeyB: channel.remotePubKey,
      addressA: this.address,
      addressB: this.address,  // Would be remote's address
      balanceA: payment.newLocalBalance,
      balanceB: payment.newRemoteBalance,
      sequenceNumber: payment.newSequenceNumber,
      nLockTime: channel.nLockTime
    })

    // Send update request
    const updateRequest: UpdateRequestMessage = {
      type: ChannelMessageType.UPDATE_REQUEST,
      channelId,
      timestamp: Date.now(),
      amount,
      newSequence: payment.newSequenceNumber,
      newSenderBalance: payment.newLocalBalance,
      newReceiverBalance: payment.newRemoteBalance,
      newCommitmentTxHex: commitmentTx.toHex(),
      senderSig: '',  // Would sign in full impl
      memo
    }

    this.emit('channel:send', channel.remotePeerId, updateRequest)
    
    return payment
  }

  /**
   * Handle incoming payment update
   */
  private async handleUpdateRequest(from: string, update: UpdateRequestMessage): Promise<void> {
    try {
      const payment: ChannelPayment = {
        channelId: update.channelId,
        amount: update.amount,
        newSequenceNumber: update.newSequence,
        newLocalBalance: update.newSenderBalance,
        newRemoteBalance: update.newReceiverBalance,
        signature: update.senderSig,
        timestamp: update.timestamp
      }

      await this.manager.processPayment(payment)

      // Send ack
      const ack: UpdateAckMessage = {
        type: ChannelMessageType.UPDATE_ACK,
        channelId: update.channelId,
        timestamp: Date.now(),
        ackSequence: update.newSequence,
        receiverSig: ''  // Would sign in full impl
      }

      this.emit('channel:send', from, ack)
      this.emit('channel:payment_received', { channelId: update.channelId, amount: update.amount })
    } catch (err) {
      this.emit('channel:error', { channelId: update.channelId, error: err })
    }
  }

  /**
   * Handle payment acknowledgment
   */
  private async handleUpdateAck(from: string, ack: UpdateAckMessage): Promise<void> {
    this.emit('channel:payment_acked', { channelId: ack.channelId, sequence: ack.ackSequence })
  }

  /**
   * Close a channel cooperatively
   */
  async closeChannel(channelId: string): Promise<string> {
    const channel = this.manager.getChannel(channelId)
    if (!channel) throw new Error(`Channel ${channelId} not found`)

    const closeRequest = await this.manager.closeChannel(channelId)

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
    })

    const closeMsg: CloseRequestMessage = {
      type: ChannelMessageType.CLOSE_REQUEST,
      channelId,
      timestamp: Date.now(),
      settlementTxHex: settlementTx.toHex(),
      ourSettlementSig: '',
      finalSequence: closeRequest.finalSequenceNumber
    }

    this.emit('channel:send', channel.remotePeerId, closeMsg)
    
    return settlementTx.id('hex')
  }

  /**
   * Handle close request
   */
  private async handleCloseRequest(from: string, close: CloseRequestMessage): Promise<void> {
    const channel = this.manager.getChannel(close.channelId)
    if (!channel) return

    // Accept close
    const ack: CloseAcceptMessage = {
      type: ChannelMessageType.CLOSE_ACCEPT,
      channelId: close.channelId,
      timestamp: Date.now(),
      theirSettlementSig: ''
    }

    this.manager.finalizeClose(close.channelId, 'settlement-txid')
    this.emit('channel:send', from, ack)
    this.emit('channel:closed', { channelId: close.channelId })
  }

  /**
   * Handle close acceptance
   */
  private async handleCloseAccept(from: string, ack: CloseAcceptMessage): Promise<void> {
    this.manager.finalizeClose(ack.channelId, 'settlement-txid')
    this.emit('channel:closed', { channelId: ack.channelId })
  }

  /**
   * Request a paid service from a peer
   */
  async requestService(
    peerId: string,
    serviceId: string,
    input: any,
    channelId?: string
  ): Promise<any> {
    // Find or create a channel
    let channel: Channel | undefined
    
    if (channelId) {
      channel = this.manager.getChannel(channelId)
    } else {
      // Find existing open channel with this peer
      const channels = this.manager.getChannelsByPeer(peerId)
      channel = channels.find(c => c.state === 'open')
    }

    if (!channel) {
      throw new Error('No open channel with peer. Open a channel first.')
    }

    // Get service price from peer (simplified - would query peer)
    const price = 100  // Default price

    // Make payment
    await this.pay(channel.id, price, `service:${serviceId}`)

    // Return result (in full impl, would wait for service response)
    return { status: 'paid', channelId: channel.id, amount: price }
  }

  // Accessors
  getChannel(channelId: string): Channel | undefined {
    return this.manager.getChannel(channelId)
  }

  getAllChannels(): Channel[] {
    return this.manager.getAllChannels()
  }

  getOpenChannels(): Channel[] {
    return this.manager.getOpenChannels()
  }

  getTotalBalance(): number {
    return this.manager.getTotalBalance()
  }
}
