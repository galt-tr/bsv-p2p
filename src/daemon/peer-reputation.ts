/**
 * Peer Reputation Manager
 * 
 * Tracks peer behavior and manages scoring/blacklisting for GossipSub v1.1
 * 
 * Scoring criteria:
 * - Successful message delivery
 * - Failed connections
 * - Protocol violations
 * - Spam/flooding
 * - Payment failures
 * 
 * Peers with low scores can be rate-limited or blacklisted.
 */

import { EventEmitter } from 'events'

export interface PeerReputationConfig {
  /** Initial score for new peers */
  initialScore: number
  /** Minimum score before rate limiting */
  rateLimitThreshold: number
  /** Minimum score before blacklisting */
  blacklistThreshold: number
  /** Score decay rate (points per hour) */
  decayRate: number
  /** Maximum score a peer can have */
  maxScore: number
  /** Minimum score a peer can have */
  minScore: number
  /** Time to keep blacklisted peers (milliseconds) */
  blacklistDuration: number
  /** Maximum connections per peer */
  maxConnectionsPerPeer: number
}

export const DEFAULT_REPUTATION_CONFIG: PeerReputationConfig = {
  initialScore: 50,
  rateLimitThreshold: 20,
  blacklistThreshold: -10,
  decayRate: 5, // Scores decay by 5 points per hour toward neutral (50)
  maxScore: 100,
  minScore: -100,
  blacklistDuration: 24 * 60 * 60 * 1000, // 24 hours
  maxConnectionsPerPeer: 3
}

export interface PeerScore {
  peerId: string
  score: number
  lastUpdated: number
  violations: number
  successfulMessages: number
  failedMessages: number
  blacklistedUntil?: number
  blacklistReason?: string
  connectionCount: number
}

export enum ScoreEvent {
  MESSAGE_SENT = 'message_sent',
  MESSAGE_RECEIVED = 'message_received',
  MESSAGE_FAILED = 'message_failed',
  CONNECTION_SUCCESS = 'connection_success',
  CONNECTION_FAILED = 'connection_failed',
  PROTOCOL_VIOLATION = 'protocol_violation',
  PAYMENT_SUCCESS = 'payment_success',
  PAYMENT_FAILED = 'payment_failed',
  SPAM_DETECTED = 'spam_detected',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded'
}

const SCORE_DELTAS: Record<ScoreEvent, number> = {
  [ScoreEvent.MESSAGE_SENT]: 1,
  [ScoreEvent.MESSAGE_RECEIVED]: 1,
  [ScoreEvent.MESSAGE_FAILED]: -2,
  [ScoreEvent.CONNECTION_SUCCESS]: 2,
  [ScoreEvent.CONNECTION_FAILED]: -3,
  [ScoreEvent.PROTOCOL_VIOLATION]: -10,
  [ScoreEvent.PAYMENT_SUCCESS]: 5,
  [ScoreEvent.PAYMENT_FAILED]: -5,
  [ScoreEvent.SPAM_DETECTED]: -15,
  [ScoreEvent.RATE_LIMIT_EXCEEDED]: -5
}

export class PeerReputationManager extends EventEmitter {
  private config: PeerReputationConfig
  private peers: Map<string, PeerScore> = new Map()
  private decayTimer: NodeJS.Timeout | null = null

  constructor(config: Partial<PeerReputationConfig> = {}) {
    super()
    this.config = {
      ...DEFAULT_REPUTATION_CONFIG,
      ...config
    }

    // Start score decay timer (every hour)
    this.startDecayTimer()
  }

  /**
   * Record a peer event and update their score
   */
  recordEvent(peerId: string, event: ScoreEvent, customDelta?: number): void {
    const peer = this.getOrCreatePeer(peerId)
    
    const delta = customDelta ?? SCORE_DELTAS[event]
    const oldScore = peer.score
    peer.score = Math.max(
      this.config.minScore,
      Math.min(this.config.maxScore, peer.score + delta)
    )
    peer.lastUpdated = Date.now()

    // Track specific events
    switch (event) {
      case ScoreEvent.MESSAGE_SENT:
      case ScoreEvent.MESSAGE_RECEIVED:
        peer.successfulMessages++
        break
      case ScoreEvent.MESSAGE_FAILED:
        peer.failedMessages++
        break
      case ScoreEvent.PROTOCOL_VIOLATION:
      case ScoreEvent.SPAM_DETECTED:
      case ScoreEvent.RATE_LIMIT_EXCEEDED:
        peer.violations++
        break
    }

    // Check if peer should be blacklisted
    if (peer.score <= this.config.blacklistThreshold && !peer.blacklistedUntil) {
      this.blacklistPeer(peerId, `Score dropped to ${peer.score}`)
    }

    this.emit('score_updated', { peerId, oldScore, newScore: peer.score, event })
  }

  /**
   * Blacklist a peer
   */
  blacklistPeer(peerId: string, reason: string): void {
    const peer = this.getOrCreatePeer(peerId)
    peer.blacklistedUntil = Date.now() + this.config.blacklistDuration
    peer.blacklistReason = reason

    console.log(`[PeerReputation] Blacklisted peer ${peerId.substring(0, 16)}... Reason: ${reason}`)
    this.emit('peer_blacklisted', { peerId, reason, until: peer.blacklistedUntil })
  }

  /**
   * Manually unblacklist a peer
   */
  unblacklistPeer(peerId: string): void {
    const peer = this.peers.get(peerId)
    if (peer && peer.blacklistedUntil) {
      peer.blacklistedUntil = undefined
      peer.blacklistReason = undefined
      // Reset score to initial
      peer.score = this.config.initialScore
      console.log(`[PeerReputation] Unblacklisted peer ${peerId.substring(0, 16)}...`)
      this.emit('peer_unblacklisted', { peerId })
    }
  }

  /**
   * Check if a peer is blacklisted
   */
  isBlacklisted(peerId: string): boolean {
    const peer = this.peers.get(peerId)
    if (!peer || !peer.blacklistedUntil) return false

    // Check if blacklist has expired
    if (Date.now() > peer.blacklistedUntil) {
      this.unblacklistPeer(peerId)
      return false
    }

    return true
  }

  /**
   * Check if a peer should be rate limited
   */
  shouldRateLimit(peerId: string): boolean {
    const peer = this.peers.get(peerId)
    if (!peer) return false

    return peer.score < this.config.rateLimitThreshold && peer.score > this.config.blacklistThreshold
  }

  /**
   * Record a connection from a peer
   */
  recordConnection(peerId: string): boolean {
    const peer = this.getOrCreatePeer(peerId)
    peer.connectionCount++

    if (peer.connectionCount > this.config.maxConnectionsPerPeer) {
      this.recordEvent(peerId, ScoreEvent.RATE_LIMIT_EXCEEDED)
      return false // Reject connection
    }

    this.recordEvent(peerId, ScoreEvent.CONNECTION_SUCCESS, 0) // Don't add points just for connecting
    return true // Allow connection
  }

  /**
   * Remove a connection from a peer
   */
  removeConnection(peerId: string): void {
    const peer = this.getOrCreatePeer(peerId)
    peer.connectionCount = Math.max(0, peer.connectionCount - 1)
  }

  /**
   * Get peer score
   */
  getScore(peerId: string): number {
    const peer = this.peers.get(peerId)
    return peer?.score ?? this.config.initialScore
  }

  /**
   * Get full peer reputation info
   */
  getPeerInfo(peerId: string): PeerScore | undefined {
    return this.peers.get(peerId)
  }

  /**
   * Get all blacklisted peers
   */
  getBlacklistedPeers(): PeerScore[] {
    const now = Date.now()
    return Array.from(this.peers.values()).filter(
      p => p.blacklistedUntil && p.blacklistedUntil > now
    )
  }

  /**
   * Get peers by score threshold
   */
  getPeersByScore(minScore: number, maxScore: number): PeerScore[] {
    return Array.from(this.peers.values()).filter(
      p => p.score >= minScore && p.score <= maxScore
    )
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalPeers: number
    blacklistedPeers: number
    rateLimitedPeers: number
    goodPeers: number
    averageScore: number
  } {
    const allPeers = Array.from(this.peers.values())
    const blacklisted = this.getBlacklistedPeers()
    const rateLimited = allPeers.filter(p => this.shouldRateLimit(p.peerId))
    const good = allPeers.filter(p => p.score >= this.config.rateLimitThreshold)

    const avgScore = allPeers.length > 0
      ? allPeers.reduce((sum, p) => sum + p.score, 0) / allPeers.length
      : this.config.initialScore

    return {
      totalPeers: allPeers.length,
      blacklistedPeers: blacklisted.length,
      rateLimitedPeers: rateLimited.length,
      goodPeers: good.length,
      averageScore: Math.round(avgScore)
    }
  }

  /**
   * Clear all peer data (for testing)
   */
  clear(): void {
    this.peers.clear()
  }

  /**
   * Stop the decay timer
   */
  stop(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer)
      this.decayTimer = null
    }
  }

  private getOrCreatePeer(peerId: string): PeerScore {
    if (!this.peers.has(peerId)) {
      this.peers.set(peerId, {
        peerId,
        score: this.config.initialScore,
        lastUpdated: Date.now(),
        violations: 0,
        successfulMessages: 0,
        failedMessages: 0,
        connectionCount: 0
      })
    }
    return this.peers.get(peerId)!
  }

  private startDecayTimer(): void {
    // Decay scores every hour
    this.decayTimer = setInterval(() => {
      this.applyScoreDecay()
    }, 60 * 60 * 1000)
  }

  private applyScoreDecay(): void {
    const now = Date.now()
    const hourMs = 60 * 60 * 1000
    const neutral = 50

    for (const peer of this.peers.values()) {
      const hoursSinceUpdate = (now - peer.lastUpdated) / hourMs
      
      if (hoursSinceUpdate >= 1) {
        // Decay toward neutral score
        if (peer.score > neutral) {
          peer.score = Math.max(neutral, peer.score - this.config.decayRate)
        } else if (peer.score < neutral) {
          peer.score = Math.min(neutral, peer.score + this.config.decayRate)
        }
        peer.lastUpdated = now
      }
    }

    console.log(`[PeerReputation] Applied score decay to ${this.peers.size} peers`)
  }
}
