/**
 * BSV P2P Message Protocol
 * 
 * Structured messages between agents with payment support.
 */

// Protocol identifier
export const MESSAGE_PROTOCOL = '/openclaw/message/1.0.0'

// Message types
export enum MessageType {
  // General communication
  TEXT = 'text',
  REQUEST = 'request',
  RESPONSE = 'response',
  ERROR = 'error',
  
  // Service discovery
  SERVICE_ANNOUNCE = 'service:announce',
  SERVICE_QUERY = 'service:query',
  SERVICE_LIST = 'service:list',
  
  // Payment channel operations
  CHANNEL_OPEN = 'channel:open',
  CHANNEL_ACCEPT = 'channel:accept',
  CHANNEL_REJECT = 'channel:reject',
  CHANNEL_UPDATE = 'channel:update',
  CHANNEL_CLOSE = 'channel:close',
  
  // Paid service requests
  PAID_REQUEST = 'paid:request',
  PAID_RESULT = 'paid:result',
  PAID_REFUND = 'paid:refund'
}

// Base message structure
export interface BaseMessage {
  id: string              // Unique message ID (for request/response correlation)
  type: MessageType
  timestamp: number       // Unix timestamp ms
  from: string           // PeerId of sender
  to?: string            // PeerId of recipient (optional for broadcasts)
}

// Text message - simple communication
export interface TextMessage extends BaseMessage {
  type: MessageType.TEXT
  content: string
  replyTo?: string       // ID of message being replied to
}

// Service request - asking another agent to do something
export interface RequestMessage extends BaseMessage {
  type: MessageType.REQUEST
  service: string        // Service identifier (e.g., 'poem', 'translate', 'summarize')
  params: Record<string, any>
  maxWaitMs?: number     // How long sender will wait
}

// Response to a request
export interface ResponseMessage extends BaseMessage {
  type: MessageType.RESPONSE
  requestId: string      // ID of the request being responded to
  success: boolean
  result?: any
  error?: string
}

// Error message
export interface ErrorMessage extends BaseMessage {
  type: MessageType.ERROR
  code: string
  message: string
  details?: any
}

// Service announcement - advertising capabilities
export interface ServiceAnnounceMessage extends BaseMessage {
  type: MessageType.SERVICE_ANNOUNCE
  services: ServiceDefinition[]
}

export interface ServiceDefinition {
  id: string
  name: string
  description: string
  pricePerRequest: number  // Satoshis per request (0 = free)
  params: ParamDefinition[]
}

export interface ParamDefinition {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object'
  required: boolean
  description?: string
}

// Payment channel messages
export interface ChannelOpenMessage extends BaseMessage {
  type: MessageType.CHANNEL_OPEN
  channelId: string
  fundingTxHex: string     // Partially signed funding tx
  ourPubKey: string        // Our pubkey for 2-of-2 multisig
  proposedCapacity: number // Satoshis
  proposedLockTime: number // Seconds
}

export interface ChannelAcceptMessage extends BaseMessage {
  type: MessageType.CHANNEL_ACCEPT
  channelId: string
  fundingTxHex: string     // Fully signed funding tx
  theirPubKey: string      // Their pubkey for 2-of-2 multisig
}

export interface ChannelRejectMessage extends BaseMessage {
  type: MessageType.CHANNEL_REJECT
  channelId: string
  reason: string
}

export interface ChannelUpdateMessage extends BaseMessage {
  type: MessageType.CHANNEL_UPDATE
  channelId: string
  sequence: number
  ourBalance: number
  theirBalance: number
  commitmentTxHex: string  // New commitment tx (signed by sender)
  signature: string        // Signature for verification
}

export interface ChannelCloseMessage extends BaseMessage {
  type: MessageType.CHANNEL_CLOSE
  channelId: string
  finalTxHex: string       // Cooperative close tx
  cooperative: boolean
}

// Paid request - request with payment attached
export interface PaidRequestMessage extends BaseMessage {
  type: MessageType.PAID_REQUEST
  channelId: string        // Payment channel to use
  service: string
  params: Record<string, any>
  payment: {
    amount: number         // Satoshis being paid
    sequence: number       // New channel sequence
    commitmentTxHex: string
    signature: string
  }
}

// Paid result - response with payment confirmation
export interface PaidResultMessage extends BaseMessage {
  type: MessageType.PAID_RESULT
  requestId: string
  channelId: string
  success: boolean
  result?: any
  error?: string
  paymentAccepted: boolean
}

// Union type for all messages
export type Message = 
  | TextMessage
  | RequestMessage
  | ResponseMessage
  | ErrorMessage
  | ServiceAnnounceMessage
  | ChannelOpenMessage
  | ChannelAcceptMessage
  | ChannelRejectMessage
  | ChannelUpdateMessage
  | ChannelCloseMessage
  | PaidRequestMessage
  | PaidResultMessage

// Helper to create message IDs
export function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`
}

// Helper to create base message
export function createBaseMessage(type: MessageType, from: string, to?: string): BaseMessage {
  return {
    id: createMessageId(),
    type,
    timestamp: Date.now(),
    from,
    to
  }
}

// Serialize message
export function serializeMessage(msg: Message): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg))
}

// Deserialize message
export function deserializeMessage(data: Uint8Array): Message {
  const json = new TextDecoder().decode(data)
  return JSON.parse(json) as Message
}
