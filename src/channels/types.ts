/**
 * Payment Channel Types
 * 
 * Based on BRC draft: https://github.com/galt-tr/bsv-p2p/issues/5
 */

export enum ChannelState {
  // Happy path
  PROPOSED = 'proposed',    // We sent/received CHANNEL_OPEN
  ACCEPTED = 'accepted',    // They sent CHANNEL_ACCEPT
  FUNDING = 'funding',      // Funding tx created, waiting for confirmation
  OPEN = 'open',            // Channel is live, can send/receive payments
  CLOSING = 'closing',      // Cooperative close initiated
  CLOSED = 'closed',        // Settlement tx confirmed
  
  // Edge cases
  REJECTED = 'rejected',    // They rejected our open request
  FAILED = 'failed',        // Funding failed (timeout, etc)
  FORCE_CLOSING = 'force_closing',  // Unilateral close initiated
  RESOLVED = 'resolved'     // Force close resolved (after timeout)
}

export interface ChannelConfig {
  /** Default channel capacity in satoshis */
  defaultCapacitySats: number
  /** nLockTime for force-close dispute window (in blocks) */
  disputeWindowBlocks: number
  /** Minimum channel size */
  minCapacitySats: number
  /** Maximum channel size */
  maxCapacitySats: number
}

export const DEFAULT_CHANNEL_CONFIG: ChannelConfig = {
  defaultCapacitySats: 10000,       // 10k sats default
  disputeWindowBlocks: 144,         // ~24 hours
  minCapacitySats: 1000,            // 1k sats minimum
  maxCapacitySats: 100000000        // 1 BSV maximum
}

export interface Channel {
  /** Unique channel ID (hash of funding outpoint) */
  id: string
  
  /** Current state */
  state: ChannelState
  
  /** Our role: did we initiate? */
  isInitiator: boolean
  
  /** Peer's PeerId */
  peerId: string
  
  /** Our BSV public key for this channel */
  localPubKey: string
  
  /** Peer's BSV public key for this channel */
  remotePubKey: string
  
  /** Total channel capacity in satoshis */
  capacitySats: number
  
  /** Our current balance */
  localBalanceSats: number
  
  /** Their current balance */
  remoteBalanceSats: number
  
  /** Current commitment sequence number (higher = newer) */
  commitmentSeq: number
  
  /** Funding transaction details */
  fundingTxId?: string
  fundingVout?: number
  
  /** Latest commitment transaction (hex) */
  latestCommitmentTx?: string
  
  /** Timestamps */
  createdAt: number
  updatedAt: number
}

export interface ChannelUpdate {
  channelId: string
  /** New sequence number (must be > current) */
  seq: number
  /** New local balance */
  localBalanceSats: number
  /** New remote balance */
  remoteBalanceSats: number
  /** Signature over the update */
  signature: string
}

// Message types for channel protocol
export interface ChannelOpenMessage {
  type: 'channel:open'
  channelId: string          // Proposed channel ID
  capacitySats: number       // Proposed capacity
  localPubKey: string        // Initiator's pubkey
  pushSats?: number          // Initial amount to push to remote
}

export interface ChannelAcceptMessage {
  type: 'channel:accept'
  channelId: string
  localPubKey: string        // Acceptor's pubkey
}

export interface ChannelRejectMessage {
  type: 'channel:reject'
  channelId: string
  reason: string
}

export interface ChannelUpdateMessage {
  type: 'channel:update'
  channelId: string
  seq: number
  localBalanceSats: number
  remoteBalanceSats: number
  signature: string
}

export interface ChannelCloseMessage {
  type: 'channel:close'
  channelId: string
  finalLocalBalance: number
  finalRemoteBalance: number
  signature: string
}

export type ChannelMessage = 
  | ChannelOpenMessage 
  | ChannelAcceptMessage 
  | ChannelRejectMessage
  | ChannelUpdateMessage
  | ChannelCloseMessage
