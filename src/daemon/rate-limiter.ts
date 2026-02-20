/**
 * Rate Limiter and DoS Protection
 * 
 * Provides rate limiting for:
 * - Message frequency per peer
 * - Payment request frequency
 * - Message size limits
 * 
 * Works in conjunction with PeerReputationManager for comprehensive DoS protection.
 */

import { EventEmitter } from 'events'

export interface RateLimitConfig {
  /** Maximum messages per peer per window */
  maxMessagesPerWindow: number
  /** Window duration in milliseconds */
  windowMs: number
  /** Maximum payment requests per peer per window */
  maxPaymentRequestsPerWindow: number
  /** Payment request window duration in milliseconds */
  paymentWindowMs: number
  /** Maximum message size in bytes */
  maxMessageSize: number
  /** Whether to reject or just warn on rate limit */
  rejectOnLimit: boolean
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxMessagesPerWindow: 100,
  windowMs: 60 * 1000, // 1 minute
  maxPaymentRequestsPerWindow: 10,
  paymentWindowMs: 60 * 1000, // 1 minute
  maxMessageSize: 1024 * 1024, // 1MB
  rejectOnLimit: true
}

interface MessageWindow {
  count: number
  firstMessageAt: number
}

interface PaymentWindow {
  count: number
  firstRequestAt: number
}

export enum RateLimitType {
  MESSAGE = 'message',
  PAYMENT = 'payment',
  SIZE = 'size'
}

export interface RateLimitViolation {
  peerId: string
  type: RateLimitType
  timestamp: number
  details: string
}

export class RateLimiter extends EventEmitter {
  private config: RateLimitConfig
  private messageWindows: Map<string, MessageWindow> = new Map()
  private paymentWindows: Map<string, PaymentWindow> = new Map()
  private violations: RateLimitViolation[] = []
  private cleanupTimer: NodeJS.Timeout | null = null

  constructor(config: Partial<RateLimitConfig> = {}) {
    super()
    this.config = {
      ...DEFAULT_RATE_LIMIT_CONFIG,
      ...config
    }

    // Start cleanup timer
    this.startCleanupTimer()
  }

  /**
   * Check if a message should be rate limited
   * 
   * @returns true if allowed, false if rate limited
   */
  checkMessage(peerId: string, messageSize?: number): boolean {
    // Check message size
    if (messageSize && messageSize > this.config.maxMessageSize) {
      this.recordViolation(peerId, RateLimitType.SIZE, 
        `Message size ${messageSize} exceeds limit ${this.config.maxMessageSize}`)
      return !this.config.rejectOnLimit
    }

    const now = Date.now()
    const window = this.messageWindows.get(peerId)

    if (!window) {
      // First message from this peer
      this.messageWindows.set(peerId, {
        count: 1,
        firstMessageAt: now
      })
      return true
    }

    // Check if window has expired
    if (now - window.firstMessageAt > this.config.windowMs) {
      // Reset window
      window.count = 1
      window.firstMessageAt = now
      return true
    }

    // Check if limit exceeded
    if (window.count >= this.config.maxMessagesPerWindow) {
      this.recordViolation(peerId, RateLimitType.MESSAGE,
        `Exceeded ${this.config.maxMessagesPerWindow} messages per ${this.config.windowMs}ms`)
      return !this.config.rejectOnLimit
    }

    // Increment count
    window.count++
    return true
  }

  /**
   * Check if a payment request should be rate limited
   * 
   * @returns true if allowed, false if rate limited
   */
  checkPaymentRequest(peerId: string): boolean {
    const now = Date.now()
    const window = this.paymentWindows.get(peerId)

    if (!window) {
      // First payment request from this peer
      this.paymentWindows.set(peerId, {
        count: 1,
        firstRequestAt: now
      })
      return true
    }

    // Check if window has expired
    if (now - window.firstRequestAt > this.config.paymentWindowMs) {
      // Reset window
      window.count = 1
      window.firstRequestAt = now
      return true
    }

    // Check if limit exceeded
    if (window.count >= this.config.maxPaymentRequestsPerWindow) {
      this.recordViolation(peerId, RateLimitType.PAYMENT,
        `Exceeded ${this.config.maxPaymentRequestsPerWindow} payment requests per ${this.config.paymentWindowMs}ms`)
      return !this.config.rejectOnLimit
    }

    // Increment count
    window.count++
    return true
  }

  /**
   * Check message size only
   */
  checkMessageSize(size: number): boolean {
    return size <= this.config.maxMessageSize
  }

  /**
   * Get current message rate for a peer (messages per minute)
   */
  getMessageRate(peerId: string): number {
    const window = this.messageWindows.get(peerId)
    if (!window) return 0

    const now = Date.now()
    const elapsed = now - window.firstMessageAt

    if (elapsed > this.config.windowMs) {
      return 0
    }

    // Calculate rate per minute
    return (window.count / elapsed) * 60 * 1000
  }

  /**
   * Get current payment request rate for a peer (requests per minute)
   */
  getPaymentRequestRate(peerId: string): number {
    const window = this.paymentWindows.get(peerId)
    if (!window) return 0

    const now = Date.now()
    const elapsed = now - window.firstRequestAt

    if (elapsed > this.config.paymentWindowMs) {
      return 0
    }

    // Calculate rate per minute
    return (window.count / elapsed) * 60 * 1000
  }

  /**
   * Get recent violations
   */
  getViolations(limit = 100): RateLimitViolation[] {
    return this.violations.slice(-limit)
  }

  /**
   * Get violations for a specific peer
   */
  getPeerViolations(peerId: string): RateLimitViolation[] {
    return this.violations.filter(v => v.peerId === peerId)
  }

  /**
   * Get statistics
   */
  getStats(): {
    trackedPeers: number
    paymentTrackedPeers: number
    totalViolations: number
    messageViolations: number
    paymentViolations: number
    sizeViolations: number
  } {
    return {
      trackedPeers: this.messageWindows.size,
      paymentTrackedPeers: this.paymentWindows.size,
      totalViolations: this.violations.length,
      messageViolations: this.violations.filter(v => v.type === RateLimitType.MESSAGE).length,
      paymentViolations: this.violations.filter(v => v.type === RateLimitType.PAYMENT).length,
      sizeViolations: this.violations.filter(v => v.type === RateLimitType.SIZE).length
    }
  }

  /**
   * Clear all rate limit data
   */
  clear(): void {
    this.messageWindows.clear()
    this.paymentWindows.clear()
    this.violations = []
  }

  /**
   * Stop the rate limiter
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  private recordViolation(peerId: string, type: RateLimitType, details: string): void {
    const violation: RateLimitViolation = {
      peerId,
      type,
      timestamp: Date.now(),
      details
    }

    this.violations.push(violation)
    
    // Keep only last 1000 violations
    if (this.violations.length > 1000) {
      this.violations = this.violations.slice(-1000)
    }

    this.emit('rate_limit_violation', violation)
    console.log(`[RateLimiter] Violation: ${peerId.substring(0, 16)}... - ${type} - ${details}`)
  }

  private startCleanupTimer(): void {
    // Clean up expired windows every minute
    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, 60 * 1000)
  }

  private cleanup(): void {
    const now = Date.now()
    let cleaned = 0

    // Clean up message windows
    for (const [peerId, window] of this.messageWindows.entries()) {
      if (now - window.firstMessageAt > this.config.windowMs * 2) {
        this.messageWindows.delete(peerId)
        cleaned++
      }
    }

    // Clean up payment windows
    for (const [peerId, window] of this.paymentWindows.entries()) {
      if (now - window.firstRequestAt > this.config.paymentWindowMs * 2) {
        this.paymentWindows.delete(peerId)
        cleaned++
      }
    }

    if (cleaned > 0) {
      console.log(`[RateLimiter] Cleaned up ${cleaned} expired windows`)
    }
  }
}
