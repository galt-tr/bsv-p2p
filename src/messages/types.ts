/**
 * Message types for P2P communication
 * Based on architecture plan Part 3
 */

export enum MessageType {
  // Discovery
  ANNOUNCE = 'announce',
  DISCOVER = 'discover',
  
  // Request/Response
  REQUEST = 'request',
  QUOTE = 'quote',
  ACCEPT = 'accept',
  PAYMENT = 'payment',
  RESPONSE = 'response',
  REJECT = 'reject',
  
  // Utility
  PING = 'ping',
  PONG = 'pong',
  ERROR = 'error',
  
  // Channel management
  CHANNEL_PROPOSE = 'channel_propose',
  CHANNEL_ACCEPT = 'channel_accept',
  CHANNEL_REJECT = 'channel_reject',
  CHANNEL_CLOSE = 'channel_close',
}

/**
 * Core message envelope that wraps all message types
 */
export interface P2PMessage<T = MessagePayload> {
  id: string                      // UUID v4
  type: MessageType
  from: string                    // libp2p PeerId
  to: string                      // libp2p PeerId (for direct) or topic
  timestamp: number               // Unix ms
  payload: T
  signature?: string              // Ed25519 signature (optional for some types)
}

/**
 * Union type of all possible message payloads
 */
export type MessagePayload =
  | AnnouncePayload
  | DiscoverPayload
  | RequestPayload
  | QuotePayload
  | AcceptPayload
  | PaymentPayload
  | ResponsePayload
  | RejectPayload
  | PingPayload
  | PongPayload
  | ErrorPayload
  | ChannelProposePayload
  | ChannelAcceptPayload
  | ChannelRejectPayload
  | ChannelClosePayload

/**
 * Announce presence and services
 */
export interface AnnouncePayload {
  peerId: string
  bsvIdentityKey: string
  services: ServiceInfo[]
  multiaddrs: string[]
  timestamp: number
}

/**
 * Request peer list / service discovery
 */
export interface DiscoverPayload {
  service?: string                // Optional filter by service
}

/**
 * Service request
 */
export interface RequestPayload {
  service: string
  input: any                      // Service-specific input (JSON)
  meta?: Record<string, string>   // Optional metadata
  payment?: ChannelPayment        // Payment via channel (if available)
}

/**
 * Payment quote in response to request
 */
export interface QuotePayload {
  requestId: string
  quoteId: string
  terms: PaymentTerms
}

/**
 * Accept a quote and proceed with payment
 */
export interface AcceptPayload {
  quoteId: string
}

/**
 * Direct payment (BEEF transaction)
 */
export interface PaymentPayload {
  quoteId: string
  beef: string                    // BEEF-encoded transaction
}

/**
 * Service response
 */
export interface ResponsePayload {
  requestId: string
  result: any                     // Service-specific result (JSON)
  success: boolean
  error?: string
  paymentAck?: ChannelPaymentAck  // Acknowledgment of channel payment
}

/**
 * Rejection message
 */
export interface RejectPayload {
  requestId: string
  reason: string
}

/**
 * Ping message
 */
export interface PingPayload {
  timestamp: number
}

/**
 * Pong response
 */
export interface PongPayload {
  requestTimestamp: number
  responseTimestamp: number
}

/**
 * Error message
 */
export interface ErrorPayload {
  code: string
  message: string
  details?: any
}

/**
 * Channel opening proposal
 */
export interface ChannelProposePayload {
  proposalId: string
  capacity: number                // Total sats
  lockTimeHours: number           // Channel lifetime
  myPubKey: string                // Proposer's BSV public key
  fundingTxid?: string            // If already funded
  fundingVout?: number
}

/**
 * Accept channel proposal
 */
export interface ChannelAcceptPayload {
  proposalId: string
  myPubKey: string                // Acceptor's BSV public key
  signature: string               // Signature of channel params
}

/**
 * Reject channel proposal
 */
export interface ChannelRejectPayload {
  proposalId: string
  reason: string
}

/**
 * Channel close request
 */
export interface ChannelClosePayload {
  channelId: string
  type: 'cooperative' | 'force'
  finalTx?: string                // Final settlement tx (if cooperative)
  mySignature?: string
}

/**
 * Service information
 */
export interface ServiceInfo {
  id: string
  name: string
  description: string
  pricing: PricingInfo
  version: string
}

/**
 * Pricing information
 */
export interface PricingInfo {
  currency: 'bsv' | 'mnee'
  baseSatoshis: number
  perUnit?: number
  unit?: string
}

/**
 * Payment terms
 */
export interface PaymentTerms {
  type: 'direct' | 'channel'
  satoshis: number
  currency?: 'bsv' | 'mnee'
  payTo?: PaymentDestination
  expiresAt: number
  channelId?: string              // If channel payment expected
}

/**
 * Payment destination (for direct payments)
 */
export interface PaymentDestination {
  address?: string                // P2PKH address
  script?: string                 // Raw locking script (hex)
  identityKey?: string            // BSV identity key for BRC-100
  derivationPrefix?: string       // BRC-29 derivation prefix
}

/**
 * Channel payment update (included in request)
 */
export interface ChannelPayment {
  type: 'channel'
  channelId: string
  amount: number
  update: ChannelUpdate
}

/**
 * Channel state update
 */
export interface ChannelUpdate {
  nSequence: number
  myBalance: number
  peerBalance: number
  signature: string               // Signature of commitment tx
}

/**
 * Channel payment acknowledgment (included in response)
 */
export interface ChannelPaymentAck {
  channelId: string
  nSequence: number
  counterSignature: string        // Peer's signature
}
