/**
 * Transaction types and interfaces
 */

/**
 * Transaction output result
 */
export interface TxOutput {
  txid: string
  vout: number
  satoshis: number
  script: string
}

/**
 * Transaction result with BEEF
 */
export interface TxResult {
  txid: string
  beef: string
  tx: string  // Raw hex
}

/**
 * Simple transaction result
 */
export interface SimpleTxResult {
  txid: string
  tx: string
}

/**
 * Channel funding result
 */
export interface ChannelFundingResult extends TxOutput {
  script: string  // 2-of-2 multisig script
  redeemScript: string
}

/**
 * Commitment transaction result
 */
export interface CommitmentTxResult {
  tx: string
  signature: string
  txid: string
}
