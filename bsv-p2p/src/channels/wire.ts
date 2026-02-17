/**
 * Channel Wire Protocol - Message types for channel negotiation
 * 
 * This defines the wire format for channel protocol messages
 * sent over libp2p streams.
 */

export const CHANNEL_PROTOCOL = '/openclaw/channel/1.0.0'

export enum ChannelMessageType {
  // Channel opening
  OPEN_REQUEST = 'open:request',
  OPEN_ACCEPT = 'open:accept',
  OPEN_REJECT = 'open:reject',
  
  // Funding flow
  FUNDING_CREATED = 'funding:created',
  FUNDING_SIGNED = 'funding:signed',
  CHANNEL_READY = 'channel:ready',
  
  // State updates (payments)
  UPDATE_REQUEST = 'update:request',
  UPDATE_ACK = 'update:ack',
  UPDATE_REJECT = 'update:reject',
  
  // Channel closing
  CLOSE_REQUEST = 'close:request',
  CLOSE_ACCEPT = 'close:accept',
  CLOSE_COMPLETE = 'close:complete',
  
  // Errors
  ERROR = 'error'
}

// Base message type
export interface BaseChannelMessage {
  type: ChannelMessageType
  channelId: string
  timestamp: number
}

// Opening messages
export interface OpenRequestMessage extends BaseChannelMessage {
  type: ChannelMessageType.OPEN_REQUEST
  proposedCapacity: number
  ourPubKey: string
  identityKey: string
  proposedLockTimeSeconds: number
  ourAddress: string
}

export interface OpenAcceptMessage extends BaseChannelMessage {
  type: ChannelMessageType.OPEN_ACCEPT
  ourPubKey: string
  identityKey: string
  agreedLockTime: number
  ourAddress: string
}

export interface OpenRejectMessage extends BaseChannelMessage {
  type: ChannelMessageType.OPEN_REJECT
  reason: string
}

// Funding messages
export interface FundingCreatedMessage extends BaseChannelMessage {
  type: ChannelMessageType.FUNDING_CREATED
  fundingTxHex: string
  fundingTxId: string
  fundingOutputIndex: number
  initialCommitmentTxHex: string
  ourCommitmentSig: string
}

export interface FundingSignedMessage extends BaseChannelMessage {
  type: ChannelMessageType.FUNDING_SIGNED
  theirCommitmentSig: string
}

export interface ChannelReadyMessage extends BaseChannelMessage {
  type: ChannelMessageType.CHANNEL_READY
}

// Update messages (payments)
export interface UpdateRequestMessage extends BaseChannelMessage {
  type: ChannelMessageType.UPDATE_REQUEST
  amount: number
  newSequence: number
  newSenderBalance: number
  newReceiverBalance: number
  newCommitmentTxHex: string
  senderSig: string
  memo?: string
}

export interface UpdateAckMessage extends BaseChannelMessage {
  type: ChannelMessageType.UPDATE_ACK
  ackSequence: number
  receiverSig: string
}

export interface UpdateRejectMessage extends BaseChannelMessage {
  type: ChannelMessageType.UPDATE_REJECT
  reason: string
  expectedSequence?: number
}

// Close messages
export interface CloseRequestMessage extends BaseChannelMessage {
  type: ChannelMessageType.CLOSE_REQUEST
  settlementTxHex: string
  ourSettlementSig: string
  finalSequence: number
}

export interface CloseAcceptMessage extends BaseChannelMessage {
  type: ChannelMessageType.CLOSE_ACCEPT
  theirSettlementSig: string
}

export interface CloseCompleteMessage extends BaseChannelMessage {
  type: ChannelMessageType.CLOSE_COMPLETE
  settlementTxId: string
}

// Error message
export interface ErrorMessage extends BaseChannelMessage {
  type: ChannelMessageType.ERROR
  errorCode: string
  errorMessage: string
}

// Union type
export type ChannelMessage =
  | OpenRequestMessage
  | OpenAcceptMessage
  | OpenRejectMessage
  | FundingCreatedMessage
  | FundingSignedMessage
  | ChannelReadyMessage
  | UpdateRequestMessage
  | UpdateAckMessage
  | UpdateRejectMessage
  | CloseRequestMessage
  | CloseAcceptMessage
  | CloseCompleteMessage
  | ErrorMessage

// Serialization
export function serializeMessage(message: ChannelMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(message))
}

export function deserializeMessage(data: Uint8Array): ChannelMessage {
  const json = new TextDecoder().decode(data)
  return JSON.parse(json) as ChannelMessage
}
