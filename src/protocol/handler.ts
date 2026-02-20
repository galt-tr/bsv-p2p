/**
 * P2P Message Handler
 * 
 * Handles sending/receiving structured messages between agents.
 */

import { Libp2p } from 'libp2p'
import { multiaddr } from '@multiformats/multiaddr'
import * as lp from 'it-length-prefixed'
import { EventEmitter } from 'events'
import { RateLimiter } from '../daemon/rate-limiter.js'
import {
  MESSAGE_PROTOCOL,
  Message,
  MessageType,
  TextMessage,
  RequestMessage,
  ResponseMessage,
  PaidRequestMessage,
  createBaseMessage,
  serializeMessage,
  deserializeMessage
} from './messages.js'

export interface MessageHandlerConfig {
  node: Libp2p
  peerId: string
  onMessage?: (msg: Message, peerId: string) => void | Promise<void>
  relayAddr?: string
}

export class MessageHandler extends EventEmitter {
  private node: Libp2p
  private peerId: string
  private relayAddr?: string
  private rateLimiter: RateLimiter
  private pendingRequests: Map<string, {
    resolve: (msg: Message) => void
    reject: (err: Error) => void
    timeout: NodeJS.Timeout
  }> = new Map()
  
  constructor(config: MessageHandlerConfig) {
    super()
    this.node = config.node
    this.peerId = config.peerId
    this.relayAddr = config.relayAddr
    
    // Initialize rate limiter with message handling config
    this.rateLimiter = new RateLimiter({
      maxMessagesPerWindow: 100,     // 100 messages per minute per peer
      windowMs: 60 * 1000,            // 1 minute window
      maxMessageSize: 1024 * 1024,    // 1MB max message size
      rejectOnLimit: true             // Drop messages exceeding limit
    })
    
    // Log rate limit violations
    this.rateLimiter.on('rate_limit_violation', (violation) => {
      console.warn(`[MessageHandler] Rate limit violation from ${violation.peerId.substring(0, 16)}... - ${violation.type}: ${violation.details}`)
    })
    
    if (config.onMessage) {
      this.on('message', config.onMessage)
    }
  }
  
  /**
   * Register the message protocol handler
   */
  register(): void {
    this.node.handle(MESSAGE_PROTOCOL, async (data: any) => {
      const stream = data.stream || data
      const connection = data.connection
      const connectionPeer = connection?.remotePeer?.toString()
      
      console.log(`[Message] Incoming stream...`)
      
      try {
        // Read message with length-prefix
        let messageData: Uint8Array | null = null
        
        for await (const chunk of lp.decode(stream)) {
          const data = chunk instanceof Uint8Array ? chunk : chunk.subarray()
          messageData = data
          break // Only expect one message per stream
        }
        
        if (!messageData) {
          console.log('[Message] No data received')
          return
        }
        
        const message = deserializeMessage(messageData)
        // Use message.from as the authoritative peer ID (works over relay)
        // Fall back to connection.remotePeer if message.from is missing
        const senderPeerId = message.from || connectionPeer || 'unknown'
        console.log(`[Message] Received ${message.type} from ${senderPeerId.substring(0, 16)}...`)
        
        // Rate limiting check
        const messageSize = messageData.byteLength
        const allowed = this.rateLimiter.checkMessage(senderPeerId, messageSize)
        
        if (!allowed) {
          console.warn(`[Message] Dropped message from ${senderPeerId.substring(0, 16)}... due to rate limit`)
          return // Drop the message
        }
        
        // Check if this is a response to a pending request
        if (message.type === MessageType.RESPONSE || message.type === MessageType.PAID_RESULT) {
          const requestId = (message as any).requestId
          const pending = this.pendingRequests.get(requestId)
          if (pending) {
            clearTimeout(pending.timeout)
            this.pendingRequests.delete(requestId)
            pending.resolve(message)
            return
          }
        }
        
        // Emit for external handling - use senderPeerId from message
        this.emit('message', message, senderPeerId)
        
        // Also emit specific event for message type
        this.emit(message.type, message, senderPeerId)
        
      } catch (err: any) {
        console.error('[Message] Error handling message:', err.message)
        this.emit('error', err)
      }
    }, { runOnLimitedConnection: true })
    
    console.log(`[Protocol] Registered handler for ${MESSAGE_PROTOCOL}`)
  }
  
  /**
   * Send a message to a peer
   */
  async send(toPeerId: string, message: Message): Promise<void> {
    console.log(`[Message] Sending ${message.type} to ${toPeerId.substring(0, 16)}...`)
    
    // Try to dial the peer (via relay if needed)
    const conn = await this.dialPeer(toPeerId)
    
    // Open stream
    const stream = await conn.newStream(MESSAGE_PROTOCOL, {
      runOnLimitedConnection: true
    })
    
    // Encode and send
    const encoded = serializeMessage(message)
    const lpEncoded: Uint8Array[] = []
    for await (const chunk of lp.encode([encoded])) {
      lpEncoded.push(chunk)
    }
    
    for (const chunk of lpEncoded) {
      stream.send(chunk)
    }
    
    await stream.sendCloseWrite?.()
    console.log(`[Message] Sent ${message.type}`)
  }
  
  /**
   * Send a text message
   */
  async sendText(toPeerId: string, content: string, replyTo?: string): Promise<TextMessage> {
    const msg: TextMessage = {
      ...createBaseMessage(MessageType.TEXT, this.peerId, toPeerId),
      type: MessageType.TEXT,
      content,
      replyTo
    }
    
    await this.send(toPeerId, msg)
    return msg
  }
  
  /**
   * Send a request and wait for response
   */
  async request(
    toPeerId: string, 
    service: string, 
    params: Record<string, any>,
    timeoutMs: number = 30000
  ): Promise<ResponseMessage> {
    const msg: RequestMessage = {
      ...createBaseMessage(MessageType.REQUEST, this.peerId, toPeerId),
      type: MessageType.REQUEST,
      service,
      params,
      maxWaitMs: timeoutMs
    }
    
    // Set up response listener
    const responsePromise = new Promise<Message>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(msg.id)
        reject(new Error(`Request timeout after ${timeoutMs}ms`))
      }, timeoutMs)
      
      this.pendingRequests.set(msg.id, { resolve, reject, timeout })
    })
    
    // Send request
    await this.send(toPeerId, msg)
    
    // Wait for response
    const response = await responsePromise
    return response as ResponseMessage
  }
  
  /**
   * Send a response to a request
   */
  async respond(
    toPeerId: string, 
    requestId: string, 
    success: boolean, 
    result?: any, 
    error?: string
  ): Promise<ResponseMessage> {
    const msg: ResponseMessage = {
      ...createBaseMessage(MessageType.RESPONSE, this.peerId, toPeerId),
      type: MessageType.RESPONSE,
      requestId,
      success,
      result,
      error
    }
    
    await this.send(toPeerId, msg)
    return msg
  }
  
  /**
   * Dial a peer, using relay if needed
   */
  private async dialPeer(peerId: string): Promise<any> {
    // First check if we have an existing connection
    const connections = this.node.getConnections()
    const existing = connections.find(c => c.remotePeer.toString() === peerId)
    if (existing) {
      return existing
    }
    
    // Try dialing via relay
    if (this.relayAddr) {
      const relayCircuitAddr = multiaddr(`${this.relayAddr}/p2p-circuit/p2p/${peerId}`)
      console.log(`[Message] Dialing via relay: ${peerId.substring(0, 16)}...`)
      return await this.node.dial(relayCircuitAddr)
    }
    
    // Try direct dial
    return await this.node.dial(multiaddr(`/p2p/${peerId}`))
  }

  /**
   * Cleanup and stop the message handler
   */
  stop(): void {
    // Stop rate limiter
    this.rateLimiter.stop()
    
    // Clear pending requests
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('MessageHandler stopped'))
    }
    this.pendingRequests.clear()
    
    console.log('[MessageHandler] Stopped')
  }
}

/**
 * Format a message for display to agent
 */
export function formatMessageForAgent(msg: Message, senderPeerId: string): string {
  const timestamp = new Date(msg.timestamp).toISOString()
  
  switch (msg.type) {
    case MessageType.TEXT:
      return `⚡ ACTION REQUIRED: You received a P2P direct message. Read it and reply NOW.

[P2P Message]
From: ${senderPeerId}
Time: ${timestamp}
Content: ${(msg as TextMessage).content}

REPLY IMMEDIATELY using:
curl -s -X POST http://127.0.0.1:4003/send -H 'Content-Type: application/json' -d '{"peerId":"${senderPeerId}","message":"YOUR REPLY HERE"}'

Do NOT ignore this. Another bot is waiting for your response. Treat this like a direct message from a friend.`
    
    case MessageType.REQUEST:
      const req = msg as RequestMessage
      return `⚡ ACTION REQUIRED: You received a P2P service request. Fulfill it and reply NOW.

[P2P Service Request]
From: ${senderPeerId}
Time: ${timestamp}
Service: ${req.service}
Params: ${JSON.stringify(req.params, null, 2)}
Request ID: ${req.id}

REPLY IMMEDIATELY using:
curl -s -X POST http://127.0.0.1:4003/send -H 'Content-Type: application/json' -d '{"peerId":"${senderPeerId}","message":"YOUR REPLY HERE"}'`
    
    case MessageType.PAID_REQUEST:
      const paidReq = msg as PaidRequestMessage
      return `⚡ ACTION REQUIRED: You received a PAID service request. Someone PAID you to do this. Fulfill and reply NOW.

[P2P Paid Request] 💰 PAYMENT ATTACHED
From: ${senderPeerId}
Time: ${timestamp}
Service: ${paidReq.service}
Payment: ${paidReq.payment.amount} sats
Channel: ${paidReq.channelId}
Params: ${JSON.stringify(paidReq.params, null, 2)}
Request ID: ${paidReq.id}

REPLY IMMEDIATELY using:
curl -s -X POST http://127.0.0.1:4003/send -H 'Content-Type: application/json' -d '{"peerId":"${senderPeerId}","message":"YOUR REPLY HERE"}'`
    
    default:
      return `[P2P ${msg.type}]
From: ${senderPeerId}
Time: ${timestamp}
Data: ${JSON.stringify(msg, null, 2)}`
  }
}
