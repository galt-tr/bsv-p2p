/**
 * Unilateral (Force) Channel Close
 * 
 * When a peer becomes unresponsive, either party can force-close the channel
 * by broadcasting the latest commitment transaction after nLockTime expires.
 * 
 * Flow:
 * 1. Detect peer unresponsiveness (timeout)
 * 2. Wait for nLockTime to expire
 * 3. Broadcast the latest commitment transaction
 * 4. Mark channel as closed (unilateral)
 */

import { Transaction, PrivateKey, PublicKey } from '@bsv/sdk'
import { broadcastTransaction, fetchTransaction } from './bsv-services.js'
import { Channel } from './types.js'

export interface ForceCloseConfig {
  /** Timeout in milliseconds to wait for peer response before force-closing */
  peerTimeoutMs: number
  /** How often to check if nLockTime has expired (milliseconds) */
  checkIntervalMs: number
}

export const DEFAULT_FORCE_CLOSE_CONFIG: ForceCloseConfig = {
  peerTimeoutMs: 5 * 60 * 1000,   // 5 minutes
  checkIntervalMs: 60 * 1000       // 1 minute
}

export interface ForceCloseResult {
  txid: string
  broadcastedAt: number
  finalLocalBalance: number
  finalRemoteBalance: number
}

/**
 * Check if nLockTime has expired for a channel
 */
export function isNLockTimeExpired(channel: Channel): boolean {
  const now = Math.floor(Date.now() / 1000)  // Unix timestamp in seconds
  return now >= channel.nLockTime
}

/**
 * Check if peer is unresponsive based on last activity
 */
export function isPeerUnresponsive(channel: Channel, timeoutMs: number): boolean {
  const now = Date.now()
  const lastActivity = channel.updatedAt || channel.createdAt
  return now - lastActivity > timeoutMs
}

/**
 * Calculate when nLockTime will expire
 */
export function getNLockTimeExpiry(channel: Channel): Date {
  return new Date(channel.nLockTime * 1000)
}

/**
 * Get time remaining until nLockTime expires
 */
export function getTimeUntilExpiry(channel: Channel): number {
  const expiryMs = channel.nLockTime * 1000
  const now = Date.now()
  return Math.max(0, expiryMs - now)
}

/**
 * Broadcast the latest commitment transaction (force close)
 * 
 * This should only be called after:
 * 1. Peer is unresponsive (peer timeout exceeded)
 * 2. nLockTime has expired
 * 
 * @param channel The channel to force-close
 * @param commitmentTxHex The latest signed commitment transaction
 * @returns Transaction ID of the broadcasted commitment tx
 */
export async function broadcastCommitmentTx(
  channel: Channel,
  commitmentTxHex: string
): Promise<ForceCloseResult> {
  // Verify nLockTime has expired
  if (!isNLockTimeExpired(channel)) {
    const expiry = getNLockTimeExpiry(channel)
    throw new Error(`Cannot force-close: nLockTime ${channel.nLockTime} has not expired yet (expires at ${expiry.toISOString()})`)
  }

  // Parse the commitment transaction
  const tx = Transaction.fromHex(commitmentTxHex)

  // Verify nLockTime matches
  if (tx.lockTime !== channel.nLockTime) {
    throw new Error(`Commitment tx nLockTime ${tx.lockTime} does not match channel nLockTime ${channel.nLockTime}`)
  }

  // Broadcast the transaction
  const txid = await broadcastTransaction(commitmentTxHex)

  return {
    txid: txid.trim(),
    broadcastedAt: Date.now(),
    finalLocalBalance: channel.localBalance,
    finalRemoteBalance: channel.remoteBalance
  }
}

/**
 * Monitor for channels that need force-closing
 * 
 * This function should be called periodically to check:
 * 1. Which channels have unresponsive peers
 * 2. Which channels have expired nLockTime
 * 3. Trigger force-close for channels meeting both criteria
 */
export function findChannelsNeedingForceClose(
  channels: Channel[],
  config: ForceCloseConfig = DEFAULT_FORCE_CLOSE_CONFIG
): Channel[] {
  const now = Date.now()
  
  return channels.filter(channel => {
    // Only consider open channels
    if (channel.state !== 'open') return false
    
    // Check if peer is unresponsive
    if (!isPeerUnresponsive(channel, config.peerTimeoutMs)) return false
    
    // Check if nLockTime has expired
    if (!isNLockTimeExpired(channel)) return false
    
    return true
  })
}

/**
 * Calculate statistics about pending force-closes
 */
export function getForceCloseStats(channels: Channel[], config: ForceCloseConfig = DEFAULT_FORCE_CLOSE_CONFIG): {
  totalChannels: number
  unresponsivePeers: number
  expiredLockTime: number
  readyForForceClose: number
  pendingChannels: Array<{
    channelId: string
    peerUnresponsive: boolean
    lockTimeExpired: boolean
    expiresAt: Date
    timeUntilExpiry: number
  }>
} {
  const openChannels = channels.filter(c => c.state === 'open')
  
  let unresponsivePeers = 0
  let expiredLockTime = 0
  let readyForForceClose = 0
  const pendingChannels: Array<{
    channelId: string
    peerUnresponsive: boolean
    lockTimeExpired: boolean
    expiresAt: Date
    timeUntilExpiry: number
  }> = []
  
  for (const channel of openChannels) {
    const peerUnresponsive = isPeerUnresponsive(channel, config.peerTimeoutMs)
    const lockTimeExpired = isNLockTimeExpired(channel)
    
    if (peerUnresponsive) unresponsivePeers++
    if (lockTimeExpired) expiredLockTime++
    if (peerUnresponsive && lockTimeExpired) readyForForceClose++
    
    if (peerUnresponsive || lockTimeExpired) {
      pendingChannels.push({
        channelId: channel.id,
        peerUnresponsive,
        lockTimeExpired,
        expiresAt: getNLockTimeExpiry(channel),
        timeUntilExpiry: getTimeUntilExpiry(channel)
      })
    }
  }
  
  return {
    totalChannels: openChannels.length,
    unresponsivePeers,
    expiredLockTime,
    readyForForceClose,
    pendingChannels
  }
}
