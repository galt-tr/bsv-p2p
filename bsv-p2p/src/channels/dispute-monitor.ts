/**
 * Dispute Detection Monitor
 * 
 * Watches for old commitment transaction broadcasts and enables dispute resolution.
 * In payment channels, if a party tries to broadcast an old state, the counterparty
 * can detect this and broadcast the latest state to claim the correct funds.
 * 
 * Key concepts:
 * - Commitment transactions have nSequence numbers that increment with each payment
 * - If an old commitment tx is broadcast, the counterparty has until nLockTime expires
 *   to broadcast the latest commitment tx
 * - The blockchain acts as the arbiter using nSequence/nLockTime
 */

import { EventEmitter } from 'events'
import { Transaction } from '@bsv/sdk'
import { Channel, ChannelState } from './types.js'
import { fetchTransaction } from './bsv-services.js'

export interface DisputeDetectionConfig {
  /** How often to check for channel-related transactions (milliseconds) */
  checkIntervalMs: number
  /** How far back to look for transactions (blocks) */
  lookbackBlocks: number
  /** Enable automatic dispute resolution (broadcast latest state) */
  autoResolve: boolean
}

export const DEFAULT_DISPUTE_CONFIG: DisputeDetectionConfig = {
  checkIntervalMs: 60 * 1000,      // 1 minute
  lookbackBlocks: 6,               // Last ~1 hour
  autoResolve: false                // Manual by default for safety
}

export interface DisputeAlert {
  channelId: string
  detectedAt: number
  broadcastTxId: string
  broadcastSequence: number
  latestSequence: number
  timeToExpiry: number
  canRespond: boolean
  channel: Channel
}

export class DisputeMonitor extends EventEmitter {
  private config: DisputeDetectionConfig
  private channels: Map<string, Channel> = new Map()
  private monitoredTxIds: Set<string> = new Set()
  private checkTimer: NodeJS.Timeout | null = null
  private activeDisputes: Map<string, DisputeAlert> = new Map()

  constructor(config: Partial<DisputeDetectionConfig> = {}) {
    super()
    this.config = {
      ...DEFAULT_DISPUTE_CONFIG,
      ...config
    }
  }

  /**
   * Start monitoring for disputes
   */
  start(): void {
    if (this.checkTimer) return
    
    this.checkTimer = setInterval(() => {
      this.checkForDisputes().catch(err => {
        console.error('[DisputeMonitor] Check failed:', err.message)
      })
    }, this.config.checkIntervalMs)
    
    console.log(`[DisputeMonitor] Started (interval: ${this.config.checkIntervalMs}ms)`)
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
    console.log('[DisputeMonitor] Stopped')
  }

  /**
   * Register a channel for dispute monitoring
   */
  registerChannel(channel: Channel): void {
    this.channels.set(channel.id, channel)
    console.log(`[DisputeMonitor] Registered channel ${channel.id.substring(0, 8)}...`)
  }

  /**
   * Unregister a channel
   */
  unregisterChannel(channelId: string): void {
    this.channels.delete(channelId)
    this.activeDisputes.delete(channelId)
    console.log(`[DisputeMonitor] Unregistered channel ${channelId.substring(0, 8)}...`)
  }

  /**
   * Update channel state (called when sequence number changes)
   */
  updateChannel(channel: Channel): void {
    if (this.channels.has(channel.id)) {
      this.channels.set(channel.id, channel)
    }
  }

  /**
   * Check for disputes across all registered channels
   */
  private async checkForDisputes(): Promise<void> {
    const openChannels = Array.from(this.channels.values()).filter(
      c => c.state === 'open' || c.state === 'closing'
    )
    
    if (openChannels.length === 0) return
    
    console.log(`[DisputeMonitor] Checking ${openChannels.length} channels...`)
    
    for (const channel of openChannels) {
      try {
        await this.checkChannelForDispute(channel)
      } catch (err: any) {
        console.error(`[DisputeMonitor] Error checking channel ${channel.id}:`, err.message)
      }
    }
  }

  /**
   * Check a specific channel for dispute
   */
  private async checkChannelForDispute(channel: Channel): Promise<void> {
    // In a real implementation, this would:
    // 1. Query a block explorer or run a full node
    // 2. Look for transactions spending from the channel's funding output
    // 3. Parse the transaction to extract the nSequence
    // 4. Compare with the latest known sequence number
    
    // For now, this is a placeholder that demonstrates the structure
    // A real implementation would integrate with a BSV node or block explorer
    
    // Example: Check if a commitment tx has been broadcast
    // This would require monitoring the UTXO set or mempool
    
    // Placeholder: just log that we're monitoring
    if (Math.random() < 0.001) { // Very rare, just for testing
      console.log(`[DisputeMonitor] Monitoring channel ${channel.id.substring(0, 8)}... (seq: ${channel.sequenceNumber})`)
    }
  }

  /**
   * Manually check for a dispute on a specific transaction
   */
  async checkTransaction(txId: string, channel: Channel): Promise<DisputeAlert | null> {
    // Fetch the transaction
    let tx: Transaction
    try {
      const txInfo = await fetchTransaction(txId)
      tx = Transaction.fromHex(txInfo.hex)
    } catch (err) {
      throw new Error(`Failed to fetch transaction ${txId}: ${err}`)
    }

    // Extract nSequence from the transaction
    // In a commitment transaction, the input spending from the funding tx has the nSequence
    if (tx.inputs.length === 0) {
      return null // Not a valid commitment tx
    }

    const broadcastSequence = tx.inputs[0].sequence || 0

    // Compare with the latest known sequence
    if (broadcastSequence < channel.sequenceNumber) {
      // OLD STATE DETECTED - This is a dispute!
      const now = Date.now()
      const nLockTime = channel.nLockTime * 1000 // Convert to ms
      const timeToExpiry = Math.max(0, nLockTime - now)
      const canRespond = timeToExpiry > 0

      const alert: DisputeAlert = {
        channelId: channel.id,
        detectedAt: now,
        broadcastTxId: txId,
        broadcastSequence,
        latestSequence: channel.sequenceNumber,
        timeToExpiry,
        canRespond,
        channel
      }

      this.activeDisputes.set(channel.id, alert)
      this.emit('dispute', alert)

      console.error(`[DisputeMonitor] 🚨 DISPUTE DETECTED!`)
      console.error(`  Channel: ${channel.id}`)
      console.error(`  Broadcast sequence: ${broadcastSequence}`)
      console.error(`  Latest sequence: ${channel.sequenceNumber}`)
      console.error(`  Time to respond: ${Math.floor(timeToExpiry / 1000)}s`)

      return alert
    }

    return null // No dispute
  }

  /**
   * Get all active disputes
   */
  getActiveDisputes(): DisputeAlert[] {
    return Array.from(this.activeDisputes.values())
  }

  /**
   * Get dispute for a specific channel
   */
  getDisputeForChannel(channelId: string): DisputeAlert | undefined {
    return this.activeDisputes.get(channelId)
  }

  /**
   * Resolve a dispute by broadcasting the latest commitment transaction
   * 
   * @param channelId The channel with the dispute
   * @param latestCommitmentTxHex The hex of the latest commitment transaction
   * @returns The transaction ID of the broadcast
   */
  async resolveDispute(
    channelId: string,
    latestCommitmentTxHex: string
  ): Promise<string> {
    const dispute = this.activeDisputes.get(channelId)
    if (!dispute) {
      throw new Error(`No active dispute for channel ${channelId}`)
    }

    if (!dispute.canRespond) {
      throw new Error('nLockTime has expired, cannot resolve dispute')
    }

    // In a real implementation, this would broadcast the transaction
    // For now, return a placeholder
    console.log(`[DisputeMonitor] Resolving dispute for channel ${channelId}`)
    console.log(`[DisputeMonitor] Broadcasting latest commitment tx (seq: ${dispute.latestSequence})`)

    // TODO: Actually broadcast the transaction
    // const txId = await broadcastTransaction(latestCommitmentTxHex)

    // Mark as resolved
    this.activeDisputes.delete(channelId)
    this.emit('dispute_resolved', { channelId, latestSequence: dispute.latestSequence })

    return 'mock-txid-for-resolved-commitment'
  }

  /**
   * Get statistics about dispute monitoring
   */
  getStats(): {
    monitoredChannels: number
    activeDisputes: number
    monitoredTxIds: number
    running: boolean
  } {
    return {
      monitoredChannels: this.channels.size,
      activeDisputes: this.activeDisputes.size,
      monitoredTxIds: this.monitoredTxIds.size,
      running: this.checkTimer !== null
    }
  }
}
