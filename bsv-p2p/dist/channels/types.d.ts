/**
 * BSV Payment Channel Types
 *
 * Payment channels enable off-chain micropayments between two parties.
 * Only the opening and closing transactions go on-chain.
 */
export type ChannelState = 'pending' | 'open' | 'closing' | 'disputed' | 'closed';
export interface ChannelConfig {
    /** Default channel lifetime in milliseconds (default: 1 hour) */
    defaultLifetimeMs: number;
    /** Minimum channel capacity in satoshis */
    minCapacity: number;
    /** Maximum channel capacity in satoshis */
    maxCapacity: number;
    /** Fee rate in satoshis per byte for on-chain txs */
    feeRate: number;
}
export declare const DEFAULT_CHANNEL_CONFIG: ChannelConfig;
export interface Channel {
    /** Unique channel identifier */
    id: string;
    /** Our peer ID */
    localPeerId: string;
    /** Remote peer ID */
    remotePeerId: string;
    /** Our BSV public key (hex) */
    localPubKey: string;
    /** Remote BSV public key (hex) */
    remotePubKey: string;
    /** Current state */
    state: ChannelState;
    /** Total capacity in satoshis */
    capacity: number;
    /** Our current balance */
    localBalance: number;
    /** Remote party's current balance */
    remoteBalance: number;
    /** Update sequence number (increments with each payment) */
    sequenceNumber: number;
    /** Funding transaction ID */
    fundingTxId?: string;
    /** Funding output index */
    fundingOutputIndex?: number;
    /** Latest commitment transaction (hex) */
    latestCommitmentTx?: string;
    /** Latest commitment signature from remote (hex) */
    latestRemoteSignature?: string;
    /** nLockTime for dispute resolution */
    nLockTime: number;
    /** Timestamp when channel was created */
    createdAt: number;
    /** Timestamp of last activity */
    updatedAt: number;
}
export interface ChannelOpenRequest {
    /** Amount to fund the channel with (satoshis) */
    amount: number;
    /** Our BSV public key */
    localPubKey: string;
    /** Channel lifetime in milliseconds */
    lifetimeMs?: number;
}
export interface ChannelOpenResponse {
    /** Whether the request was accepted */
    accepted: boolean;
    /** Remote party's BSV public key */
    remotePubKey?: string;
    /** Agreed nLockTime */
    nLockTime?: number;
    /** Reason for rejection (if rejected) */
    reason?: string;
}
export interface ChannelPayment {
    /** Channel ID */
    channelId: string;
    /** Amount to pay (satoshis) */
    amount: number;
    /** New sequence number after this payment */
    newSequenceNumber: number;
    /** New local balance after payment */
    newLocalBalance: number;
    /** New remote balance after payment */
    newRemoteBalance: number;
    /** Signature from sender */
    signature: string;
    /** Timestamp */
    timestamp: number;
}
export interface ChannelCloseRequest {
    /** Channel ID */
    channelId: string;
    /** Final sequence number */
    finalSequenceNumber: number;
    /** Final local balance */
    finalLocalBalance: number;
    /** Final remote balance */
    finalRemoteBalance: number;
    /** Close type */
    type: 'cooperative' | 'unilateral';
    /** Signature */
    signature: string;
}
export interface CommitmentTransaction {
    /** Raw transaction hex */
    rawTx: string;
    /** Transaction ID */
    txId: string;
    /** Sequence number this commitment represents */
    sequenceNumber: number;
    /** Local balance at this state */
    localBalance: number;
    /** Remote balance at this state */
    remoteBalance: number;
    /** Our signature */
    localSignature: string;
    /** Their signature */
    remoteSignature?: string;
}
export interface ChannelMessage {
    type: 'channel_open_request' | 'channel_open_response' | 'channel_funding_created' | 'channel_funding_signed' | 'channel_payment' | 'channel_payment_ack' | 'channel_close_request' | 'channel_close_ack' | 'channel_dispute';
    channelId: string;
    payload: any;
    timestamp: number;
    signature?: string;
}
