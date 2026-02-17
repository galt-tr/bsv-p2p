/**
 * Payment Channel Protocol Messages
 * 
 * Defines the wire protocol for payment channel operations over libp2p.
 */

import { PrivateKey, PublicKey, Hash } from '@bsv/sdk'

/**
 * Protocol identifier for payment channel streams
 */
export const CHANNEL_PROTOCOL = '/openclaw/channel/1.0.0'

/**
 * Message types for the payment channel protocol
 */
export enum ChannelMessageType {
  // Channel lifecycle
  OPEN_REQUEST = 'open_request',
  OPEN_ACCEPT = 'open_accept',
  OPEN_REJECT = 'open_reject',
  FUNDING_CREATED = 'funding_created',
  FUNDING_SIGNED = 'funding_signed',
  CHANNEL_READY = 'channel_ready',
  
  // Payments
  UPDATE_REQUEST = 'update_request',
  UPDATE_ACK = 'update_ack',
  UPDATE_REJECT = 'update_reject',
  
  // Close
  CLOSE_REQUEST = 'close_request',
  CLOSE_ACCEPT = 'close_accept',
  CLOSE_COMPLETE = 'close_complete',
  
  // Errors
  ERROR = 'error'
}

/**
 * Base message structure
 */
export interface ChannelMessageBase {
  type: ChannelMessageType
  channelId: string
  timestamp: number
  signature?: string
}

/**
 * Request to open a new payment channel
 */
export interface OpenRequestMessage extends ChannelMessageBase {
  type: ChannelMessageType.OPEN_REQUEST
  /** Proposed channel capacity in satoshis */
  proposedCapacity: number
  /** Our public key for this channel */
  ourPubKey: string
  /** Our BSV identity key */
  identityKey: string
  /** Proposed nLockTime (seconds from now) */
  proposedLockTimeSeconds: number
  /** Our P2PKH address for receiving funds */
  ourAddress: string
}

/**
 * Accept channel open request
 */
export interface OpenAcceptMessage extends ChannelMessageBase {
  type: ChannelMessageType.OPEN_ACCEPT
  /** Our public key for this channel */
  ourPubKey: string
  /** Our BSV identity key */
  identityKey: string
  /** Agreed nLockTime (Unix timestamp) */
  agreedLockTime: number
  /** Our P2PKH address for receiving funds */
  ourAddress: string
}

/**
 * Reject channel open request
 */
export interface OpenRejectMessage extends ChannelMessageBase {
  type: ChannelMessageType.OPEN_REJECT
  reason: string
}

/**
 * Funding transaction has been created
 */
export interface FundingCreatedMessage extends ChannelMessageBase {
  type: ChannelMessageType.FUNDING_CREATED
  /** Funding transaction (hex) */
  fundingTxHex: string
  /** Funding transaction ID */
  fundingTxId: string
  /** Output index for the channel */
  fundingVout: number
  /** Initial commitment transaction (hex) */
  initialCommitmentTxHex: string
  /** Our signature on the initial commitment */
  ourCommitmentSig: string
}

/**
 * Funding transaction has been signed
 */
export interface FundingSignedMessage extends ChannelMessageBase {
  type: ChannelMessageType.FUNDING_SIGNED
  /** Their signature on the initial commitment */
  theirCommitmentSig: string
}

/**
 * Channel is ready for use
 */
export interface ChannelReadyMessage extends ChannelMessageBase {
  type: ChannelMessageType.CHANNEL_READY
}

/**
 * Request to update channel state (make a payment)
 */
export interface UpdateRequestMessage extends ChannelMessageBase {
  type: ChannelMessageType.UPDATE_REQUEST
  /** Amount being transferred (in satoshis) */
  amount: number
  /** New sequence number */
  newSequence: number
  /** New balance for the sender */
  newSenderBalance: number
  /** New balance for the receiver */
  newReceiverBalance: number
  /** New commitment transaction (hex) */
  newCommitmentTxHex: string
  /** Sender's signature on new commitment */
  senderSig: string
  /** Optional payment reference/memo */
  memo?: string
}

/**
 * Acknowledge update (payment received)
 */
export interface UpdateAckMessage extends ChannelMessageBase {
  type: ChannelMessageType.UPDATE_ACK
  /** Sequence number being acknowledged */
  ackSequence: number
  /** Receiver's signature on the commitment */
  receiverSig: string
}

/**
 * Reject update request
 */
export interface UpdateRejectMessage extends ChannelMessageBase {
  type: ChannelMessageType.UPDATE_REJECT
  /** Sequence number being rejected */
  rejectSequence: number
  reason: string
}

/**
 * Request to close the channel cooperatively
 */
export interface CloseRequestMessage extends ChannelMessageBase {
  type: ChannelMessageType.CLOSE_REQUEST
  /** Final settlement transaction (hex) */
  settlementTxHex: string
  /** Our signature on settlement */
  ourSettlementSig: string
  /** Final sequence number */
  finalSequence: number
}

/**
 * Accept close request
 */
export interface CloseAcceptMessage extends ChannelMessageBase {
  type: ChannelMessageType.CLOSE_ACCEPT
  /** Their signature on settlement */
  theirSettlementSig: string
}

/**
 * Close is complete (settlement broadcast)
 */
export interface CloseCompleteMessage extends ChannelMessageBase {
  type: ChannelMessageType.CLOSE_COMPLETE
  /** Settlement transaction ID */
  settlementTxId: string
}

/**
 * Error message
 */
export interface ErrorMessage extends ChannelMessageBase {
  type: ChannelMessageType.ERROR
  errorCode: string
  errorMessage: string
}

/**
 * Union type of all channel messages
 */
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

/**
 * Serialize a message to JSON bytes
 */
export function serializeMessage(message: ChannelMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(message))
}

/**
 * Deserialize a message from JSON bytes
 */
export function deserializeMessage(data: Uint8Array): ChannelMessage {
  const json = new TextDecoder().decode(data)
  return JSON.parse(json) as ChannelMessage
}

/**
 * Sign a message with a private key
 */
export function signMessage(message: ChannelMessage, privateKey: PrivateKey): string {
  // Create a copy without the signature field
  const { signature: _, ...messageWithoutSig } = message
  const messageBytes = new TextEncoder().encode(JSON.stringify(messageWithoutSig))
  const hash = Hash.sha256(messageBytes)
  const sig = privateKey.sign(hash)
  return sig.toDER().toString('hex')
}

/**
 * Verify a message signature
 */
export function verifyMessageSignature(message: ChannelMessage, publicKey: string): boolean {
  if (!message.signature) return false
  
  try {
    const { signature, ...messageWithoutSig } = message
    const messageBytes = new TextEncoder().encode(JSON.stringify(messageWithoutSig))
    const hash = Hash.sha256(messageBytes)
    const pubKey = PublicKey.fromString(publicKey)
    const sig = Buffer.from(signature, 'hex')
    
    // Import signature from DER
    const { Signature } = require('@bsv/sdk')
    const sigObj = Signature.fromDER(sig)
    
    return pubKey.verify(hash, sigObj)
  } catch {
    return false
  }
}
