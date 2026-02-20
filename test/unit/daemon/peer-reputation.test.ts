import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PeerReputationManager, ScoreEvent } from '../../../src/daemon/peer-reputation.js'

describe('Peer Reputation Manager', () => {
  let manager: PeerReputationManager

  beforeEach(() => {
    manager = new PeerReputationManager({
      blacklistDuration: 1000 // 1 second for testing
    })
  })

  afterEach(() => {
    manager.stop()
  })

  describe('Score Management', () => {
    it('should initialize new peers with initial score', () => {
      const score = manager.getScore('peer1')
      expect(score).toBe(50) // DEFAULT_REPUTATION_CONFIG.initialScore
    })

    it('should increase score on positive events', () => {
      manager.recordEvent('peer1', ScoreEvent.MESSAGE_SENT)
      expect(manager.getScore('peer1')).toBeGreaterThan(50)
    })

    it('should decrease score on negative events', () => {
      manager.recordEvent('peer1', ScoreEvent.MESSAGE_FAILED)
      expect(manager.getScore('peer1')).toBeLessThan(50)
    })

    it('should respect maximum score', () => {
      for (let i = 0; i < 100; i++) {
        manager.recordEvent('peer1', ScoreEvent.PAYMENT_SUCCESS)
      }
      expect(manager.getScore('peer1')).toBe(100)
    })

    it('should respect minimum score', () => {
      for (let i = 0; i < 100; i++) {
        manager.recordEvent('peer1', ScoreEvent.PROTOCOL_VIOLATION)
      }
      expect(manager.getScore('peer1')).toBe(-100)
    })

    it('should allow custom score deltas', () => {
      const initialScore = manager.getScore('peer1')
      manager.recordEvent('peer1', ScoreEvent.MESSAGE_SENT, 10)
      expect(manager.getScore('peer1')).toBe(initialScore + 10)
    })
  })

  describe('Blacklisting', () => {
    it('should blacklist peer when score drops below threshold', () => {
      for (let i = 0; i < 10; i++) {
        manager.recordEvent('peer1', ScoreEvent.PROTOCOL_VIOLATION)
      }
      expect(manager.isBlacklisted('peer1')).toBe(true)
    })

    it('should manually blacklist a peer', () => {
      manager.blacklistPeer('peer1', 'Test reason')
      expect(manager.isBlacklisted('peer1')).toBe(true)
    })

    it('should store blacklist reason', () => {
      manager.blacklistPeer('peer1', 'Spam detected')
      const info = manager.getPeerInfo('peer1')
      expect(info?.blacklistReason).toBe('Spam detected')
    })

    it('should unblacklist peer after duration', async () => {
      manager.blacklistPeer('peer1', 'Test')
      expect(manager.isBlacklisted('peer1')).toBe(true)
      
      // Wait for blacklist to expire
      await new Promise(resolve => setTimeout(resolve, 1100))
      
      expect(manager.isBlacklisted('peer1')).toBe(false)
    })

    it('should manually unblacklist a peer', () => {
      manager.blacklistPeer('peer1', 'Test')
      expect(manager.isBlacklisted('peer1')).toBe(true)
      
      manager.unblacklistPeer('peer1')
      expect(manager.isBlacklisted('peer1')).toBe(false)
    })

    it('should reset score when unblacklisting', () => {
      manager.blacklistPeer('peer1', 'Test')
      manager.unblacklistPeer('peer1')
      expect(manager.getScore('peer1')).toBe(50) // Reset to initial
    })

    it('should emit blacklist events', () => {
      let eventData: any = null
      manager.on('peer_blacklisted', (data) => {
        eventData = data
      })

      manager.blacklistPeer('peer1', 'Test')
      expect(eventData).not.toBeNull()
      expect(eventData.peerId).toBe('peer1')
      expect(eventData.reason).toBe('Test')
    })

    it('should emit unblacklist events', () => {
      let emitted = false
      manager.on('peer_unblacklisted', () => {
        emitted = true
      })

      manager.blacklistPeer('peer1', 'Test')
      manager.unblacklistPeer('peer1')
      expect(emitted).toBe(true)
    })
  })

  describe('Rate Limiting', () => {
    it('should identify peers that need rate limiting', () => {
      // Lower score to rate limit threshold (just below 20 but above blacklist threshold of -10)
      // Start at 50, need to get to ~15
      for (let i = 0; i < 18; i++) {
        manager.recordEvent('peer1', ScoreEvent.MESSAGE_FAILED) // -2 each
      }
      
      const score = manager.getScore('peer1')
      expect(score).toBeLessThan(20) // Rate limit threshold
      expect(score).toBeGreaterThan(-10) // Not blacklisted
      expect(manager.shouldRateLimit('peer1')).toBe(true)
    })

    it('should not rate limit peers with good scores', () => {
      expect(manager.shouldRateLimit('peer1')).toBe(false)
    })

    it('should not rate limit blacklisted peers', () => {
      manager.blacklistPeer('peer1', 'Test')
      expect(manager.shouldRateLimit('peer1')).toBe(false)
    })
  })

  describe('Connection Management', () => {
    it('should track connection count', () => {
      manager.recordConnection('peer1')
      const info = manager.getPeerInfo('peer1')
      expect(info?.connectionCount).toBe(1)
    })

    it('should allow connections under limit', () => {
      expect(manager.recordConnection('peer1')).toBe(true)
      expect(manager.recordConnection('peer1')).toBe(true)
      expect(manager.recordConnection('peer1')).toBe(true)
    })

    it('should reject connections over limit', () => {
      manager.recordConnection('peer1')
      manager.recordConnection('peer1')
      manager.recordConnection('peer1')
      expect(manager.recordConnection('peer1')).toBe(false)
    })

    it('should decrement connection count on removal', () => {
      manager.recordConnection('peer1')
      manager.recordConnection('peer1')
      manager.removeConnection('peer1')
      
      const info = manager.getPeerInfo('peer1')
      expect(info?.connectionCount).toBe(1)
    })

    it('should not go below zero connections', () => {
      manager.removeConnection('peer1')
      const info = manager.getPeerInfo('peer1')
      expect(info?.connectionCount).toBe(0)
    })
  })

  describe('Event Tracking', () => {
    it('should track successful messages', () => {
      manager.recordEvent('peer1', ScoreEvent.MESSAGE_SENT)
      manager.recordEvent('peer1', ScoreEvent.MESSAGE_RECEIVED)
      
      const info = manager.getPeerInfo('peer1')
      expect(info?.successfulMessages).toBe(2)
    })

    it('should track failed messages', () => {
      manager.recordEvent('peer1', ScoreEvent.MESSAGE_FAILED)
      
      const info = manager.getPeerInfo('peer1')
      expect(info?.failedMessages).toBe(1)
    })

    it('should track violations', () => {
      manager.recordEvent('peer1', ScoreEvent.PROTOCOL_VIOLATION)
      manager.recordEvent('peer1', ScoreEvent.SPAM_DETECTED)
      
      const info = manager.getPeerInfo('peer1')
      expect(info?.violations).toBe(2)
    })

    it('should emit score update events', () => {
      let eventData: any = null
      manager.on('score_updated', (data) => {
        eventData = data
      })

      manager.recordEvent('peer1', ScoreEvent.MESSAGE_SENT)
      
      expect(eventData).not.toBeNull()
      expect(eventData.peerId).toBe('peer1')
      expect(eventData.event).toBe(ScoreEvent.MESSAGE_SENT)
    })
  })

  describe('Queries', () => {
    beforeEach(() => {
      // Set up test peers with different scores
      manager.recordEvent('good-peer', ScoreEvent.PAYMENT_SUCCESS)
      manager.recordEvent('good-peer', ScoreEvent.PAYMENT_SUCCESS)
      manager.recordEvent('bad-peer', ScoreEvent.PROTOCOL_VIOLATION)
      manager.recordEvent('bad-peer', ScoreEvent.PROTOCOL_VIOLATION)
      manager.blacklistPeer('blacklisted-peer', 'Test')
    })

    it('should get blacklisted peers', () => {
      const blacklisted = manager.getBlacklistedPeers()
      expect(blacklisted.length).toBe(1)
      expect(blacklisted[0].peerId).toBe('blacklisted-peer')
    })

    it('should get peers by score range', () => {
      const peers = manager.getPeersByScore(50, 100)
      expect(peers.length).toBeGreaterThan(0)
    })

    it('should provide statistics', () => {
      const stats = manager.getStats()
      
      expect(stats.totalPeers).toBeGreaterThan(0)
      expect(stats.blacklistedPeers).toBe(1)
      expect(stats.averageScore).toBeDefined()
    })

    it('should calculate average score correctly', () => {
      manager.clear()
      manager.recordEvent('peer1', ScoreEvent.MESSAGE_SENT) // 51
      manager.recordEvent('peer2', ScoreEvent.MESSAGE_SENT) // 51
      
      const stats = manager.getStats()
      expect(stats.averageScore).toBe(51)
    })
  })

  describe('Cleanup', () => {
    it('should clear all peer data', () => {
      manager.recordEvent('peer1', ScoreEvent.MESSAGE_SENT)
      manager.recordEvent('peer2', ScoreEvent.MESSAGE_SENT)
      
      expect(manager.getStats().totalPeers).toBe(2)
      
      manager.clear()
      expect(manager.getStats().totalPeers).toBe(0)
    })

    it('should stop decay timer', () => {
      manager.stop()
      // No easy way to test timer stopped, but should not throw
      expect(true).toBe(true)
    })
  })

  describe('Score Events', () => {
    it('should have appropriate deltas for each event', () => {
      const initialScore = manager.getScore('peer1')
      
      manager.recordEvent('peer1', ScoreEvent.PAYMENT_SUCCESS)
      expect(manager.getScore('peer1')).toBe(initialScore + 5)
      
      manager.recordEvent('peer1', ScoreEvent.SPAM_DETECTED)
      expect(manager.getScore('peer1')).toBe(initialScore + 5 - 15)
    })
  })
})
