/**
 * Replay protection for P2P messages
 * Tracks seen message IDs to prevent replay attacks
 */

export interface ReplayProtectionConfig {
  /** Maximum time to keep message IDs in memory (milliseconds) */
  retentionTime?: number
  /** Cleanup interval (milliseconds) */
  cleanupInterval?: number
}

const DEFAULT_CONFIG: Required<ReplayProtectionConfig> = {
  retentionTime: 10 * 60 * 1000,  // 10 minutes
  cleanupInterval: 60 * 1000       // 1 minute
}

export class ReplayProtection {
  private seenMessages: Map<string, number> = new Map()  // messageId -> timestamp
  private config: Required<ReplayProtectionConfig>
  private cleanupTimer: NodeJS.Timeout | null = null

  constructor(config: ReplayProtectionConfig = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config
    }
  }

  /**
   * Start the cleanup timer
   */
  start(): void {
    if (this.cleanupTimer) return
    
    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, this.config.cleanupInterval)
  }

  /**
   * Stop the cleanup timer
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * Check if a message has been seen before
   * If not seen, marks it as seen and returns false
   * If seen, returns true (replay detected)
   */
  checkAndMark(messageId: string): boolean {
    const now = Date.now()
    
    // Check if we've seen this message before
    if (this.seenMessages.has(messageId)) {
      return true  // Replay detected
    }
    
    // Mark as seen
    this.seenMessages.set(messageId, now)
    return false  // Not a replay
  }

  /**
   * Check if a message is a replay without marking it
   */
  isReplay(messageId: string): boolean {
    return this.seenMessages.has(messageId)
  }

  /**
   * Clean up old message IDs
   */
  private cleanup(): void {
    const now = Date.now()
    const cutoff = now - this.config.retentionTime
    
    let cleaned = 0
    for (const [messageId, timestamp] of this.seenMessages.entries()) {
      if (timestamp < cutoff) {
        this.seenMessages.delete(messageId)
        cleaned++
      }
    }
    
    if (cleaned > 0) {
      console.log(`[ReplayProtection] Cleaned up ${cleaned} old message IDs (total: ${this.seenMessages.size})`)
    }
  }

  /**
   * Get statistics
   */
  getStats(): { trackedMessages: number; memoryUsageKB: number } {
    const trackedMessages = this.seenMessages.size
    // Rough estimate: each entry is ~50 bytes (UUID string + timestamp + Map overhead)
    const memoryUsageKB = Math.round((trackedMessages * 50) / 1024)
    
    return {
      trackedMessages,
      memoryUsageKB
    }
  }

  /**
   * Clear all tracked messages
   */
  clear(): void {
    this.seenMessages.clear()
  }
}
