import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RateLimiter, RateLimitType } from '../../../src/daemon/rate-limiter.js'

describe('Rate Limiter', () => {
  let limiter: RateLimiter

  beforeEach(() => {
    limiter = new RateLimiter({
      maxMessagesPerWindow: 10,
      windowMs: 1000, // 1 second for testing
      maxPaymentRequestsPerWindow: 3,
      paymentWindowMs: 1000,
      maxMessageSize: 1024 // 1KB for testing
    })
  })

  afterEach(() => {
    limiter.stop()
  })

  describe('Message Rate Limiting', () => {
    it('should allow messages under the limit', () => {
      for (let i = 0; i < 10; i++) {
        expect(limiter.checkMessage('peer1')).toBe(true)
      }
    })

    it('should block messages over the limit', () => {
      // Send max messages
      for (let i = 0; i < 10; i++) {
        limiter.checkMessage('peer1')
      }

      // 11th message should be blocked
      expect(limiter.checkMessage('peer1')).toBe(false)
    })

    it('should reset after window expires', async () => {
      // Send max messages
      for (let i = 0; i < 10; i++) {
        limiter.checkMessage('peer1')
      }

      // Should be blocked
      expect(limiter.checkMessage('peer1')).toBe(false)

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 1100))

      // Should be allowed again
      expect(limiter.checkMessage('peer1')).toBe(true)
    })

    it('should track different peers separately', () => {
      // Peer1 sends max messages
      for (let i = 0; i < 10; i++) {
        limiter.checkMessage('peer1')
      }

      // Peer1 should be blocked
      expect(limiter.checkMessage('peer1')).toBe(false)

      // Peer2 should still be allowed
      expect(limiter.checkMessage('peer2')).toBe(true)
    })

    it('should calculate message rate correctly', () => {
      limiter.checkMessage('peer1')
      limiter.checkMessage('peer1')
      limiter.checkMessage('peer1')

      const rate = limiter.getMessageRate('peer1')
      expect(rate).toBeGreaterThan(0)
    })
  })

  describe('Message Size Limiting', () => {
    it('should allow messages under size limit', () => {
      expect(limiter.checkMessage('peer1', 512)).toBe(true)
    })

    it('should block messages over size limit', () => {
      expect(limiter.checkMessage('peer1', 2048)).toBe(false)
    })

    it('should check size independently', () => {
      expect(limiter.checkMessageSize(512)).toBe(true)
      expect(limiter.checkMessageSize(2048)).toBe(false)
    })

    it('should record size violations', () => {
      limiter.checkMessage('peer1', 2048)

      const violations = limiter.getPeerViolations('peer1')
      expect(violations.length).toBe(1)
      expect(violations[0].type).toBe(RateLimitType.SIZE)
    })
  })

  describe('Payment Request Rate Limiting', () => {
    it('should allow payment requests under the limit', () => {
      for (let i = 0; i < 3; i++) {
        expect(limiter.checkPaymentRequest('peer1')).toBe(true)
      }
    })

    it('should block payment requests over the limit', () => {
      // Send max requests
      for (let i = 0; i < 3; i++) {
        limiter.checkPaymentRequest('peer1')
      }

      // 4th request should be blocked
      expect(limiter.checkPaymentRequest('peer1')).toBe(false)
    })

    it('should reset payment window after expiry', async () => {
      // Send max requests
      for (let i = 0; i < 3; i++) {
        limiter.checkPaymentRequest('peer1')
      }

      // Should be blocked
      expect(limiter.checkPaymentRequest('peer1')).toBe(false)

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 1100))

      // Should be allowed again
      expect(limiter.checkPaymentRequest('peer1')).toBe(true)
    })

    it('should track payment rate correctly', () => {
      limiter.checkPaymentRequest('peer1')
      limiter.checkPaymentRequest('peer1')

      const rate = limiter.getPaymentRequestRate('peer1')
      expect(rate).toBeGreaterThan(0)
    })
  })

  describe('Violation Tracking', () => {
    it('should record violations', () => {
      // Trigger a violation
      for (let i = 0; i < 11; i++) {
        limiter.checkMessage('peer1')
      }

      const violations = limiter.getViolations()
      expect(violations.length).toBeGreaterThan(0)
    })

    it('should get violations for specific peer', () => {
      // Peer1 violates
      for (let i = 0; i < 11; i++) {
        limiter.checkMessage('peer1')
      }

      // Peer2 violates
      for (let i = 0; i < 11; i++) {
        limiter.checkMessage('peer2')
      }

      const peer1Violations = limiter.getPeerViolations('peer1')
      expect(peer1Violations.length).toBeGreaterThan(0)
      expect(peer1Violations.every(v => v.peerId === 'peer1')).toBe(true)
    })

    it('should emit violation events', () => {
      let emittedViolation: any = null
      limiter.on('rate_limit_violation', (violation) => {
        emittedViolation = violation
      })

      // Trigger violation
      for (let i = 0; i < 11; i++) {
        limiter.checkMessage('peer1')
      }

      expect(emittedViolation).not.toBeNull()
      expect(emittedViolation.peerId).toBe('peer1')
      expect(emittedViolation.type).toBe(RateLimitType.MESSAGE)
    })

    it('should limit stored violations to 1000', () => {
      // Trigger many violations
      for (let i = 0; i < 1500; i++) {
        limiter.checkMessage(`peer${i}`, 2048) // Size violation
      }

      const violations = limiter.getViolations()
      expect(violations.length).toBeLessThanOrEqual(1000)
    })
  })

  describe('Statistics', () => {
    it('should provide stats', () => {
      limiter.checkMessage('peer1')
      limiter.checkMessage('peer2')
      limiter.checkPaymentRequest('peer1')

      const stats = limiter.getStats()
      expect(stats.trackedPeers).toBe(2)
      expect(stats.paymentTrackedPeers).toBe(1)
      expect(stats.totalViolations).toBe(0)
    })

    it('should track violation types', () => {
      // Message violation
      for (let i = 0; i < 11; i++) {
        limiter.checkMessage('peer1')
      }

      // Size violation
      limiter.checkMessage('peer2', 2048)

      // Payment violation
      for (let i = 0; i < 4; i++) {
        limiter.checkPaymentRequest('peer3')
      }

      const stats = limiter.getStats()
      expect(stats.messageViolations).toBeGreaterThan(0)
      expect(stats.sizeViolations).toBeGreaterThan(0)
      expect(stats.paymentViolations).toBeGreaterThan(0)
    })
  })

  describe('Configuration', () => {
    it('should accept custom config', () => {
      const custom = new RateLimiter({
        maxMessagesPerWindow: 5,
        maxMessageSize: 512
      })

      // Should allow up to 5
      for (let i = 0; i < 5; i++) {
        expect(custom.checkMessage('peer1')).toBe(true)
      }

      // 6th should be blocked
      expect(custom.checkMessage('peer1')).toBe(false)

      custom.stop()
    })

    it('should support warn-only mode', () => {
      const warnOnly = new RateLimiter({
        maxMessagesPerWindow: 2,
        rejectOnLimit: false
      })

      // Send more than limit
      for (let i = 0; i < 5; i++) {
        expect(warnOnly.checkMessage('peer1')).toBe(true) // All allowed in warn mode
      }

      // But violations should still be recorded
      const violations = warnOnly.getViolations()
      expect(violations.length).toBeGreaterThan(0)

      warnOnly.stop()
    })
  })

  describe('Cleanup', () => {
    it('should clear all data', () => {
      limiter.checkMessage('peer1')
      limiter.checkPaymentRequest('peer1')
      
      // Trigger violation for data
      for (let i = 0; i < 11; i++) {
        limiter.checkMessage('peer2')
      }

      expect(limiter.getStats().trackedPeers).toBeGreaterThan(0)

      limiter.clear()

      const stats = limiter.getStats()
      expect(stats.trackedPeers).toBe(0)
      expect(stats.paymentTrackedPeers).toBe(0)
      expect(stats.totalViolations).toBe(0)
    })

    it('should stop cleanup timer', () => {
      limiter.stop()
      // No easy way to test timer stopped, but should not throw
      expect(true).toBe(true)
    })
  })

  describe('Rate Calculations', () => {
    it('should return zero rate for unknown peer', () => {
      expect(limiter.getMessageRate('unknown')).toBe(0)
      expect(limiter.getPaymentRequestRate('unknown')).toBe(0)
    })

    it('should return zero rate after window expires', async () => {
      limiter.checkMessage('peer1')
      
      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 1100))
      
      expect(limiter.getMessageRate('peer1')).toBe(0)
    })
  })
})
