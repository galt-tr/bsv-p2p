import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ReplayProtection } from '../../../src/messages/replay-protection.js'
import { v4 as uuidv4 } from 'uuid'

describe('Replay Protection', () => {
  let protection: ReplayProtection

  beforeEach(() => {
    protection = new ReplayProtection()
  })

  afterEach(() => {
    protection.stop()
  })

  it('should detect new messages as not replays', () => {
    const messageId = uuidv4()
    
    const isReplay = protection.checkAndMark(messageId)
    expect(isReplay).toBe(false)
  })

  it('should detect duplicate messages as replays', () => {
    const messageId = uuidv4()
    
    // First time: not a replay
    expect(protection.checkAndMark(messageId)).toBe(false)
    
    // Second time: replay detected
    expect(protection.checkAndMark(messageId)).toBe(true)
    
    // Third time: still a replay
    expect(protection.checkAndMark(messageId)).toBe(true)
  })

  it('should track multiple different messages', () => {
    const id1 = uuidv4()
    const id2 = uuidv4()
    const id3 = uuidv4()
    
    expect(protection.checkAndMark(id1)).toBe(false)
    expect(protection.checkAndMark(id2)).toBe(false)
    expect(protection.checkAndMark(id3)).toBe(false)
    
    // All should now be marked as seen
    expect(protection.checkAndMark(id1)).toBe(true)
    expect(protection.checkAndMark(id2)).toBe(true)
    expect(protection.checkAndMark(id3)).toBe(true)
  })

  it('should check without marking with isReplay', () => {
    const messageId = uuidv4()
    
    // Check without marking
    expect(protection.isReplay(messageId)).toBe(false)
    
    // Still not marked
    expect(protection.isReplay(messageId)).toBe(false)
    
    // Now mark it
    expect(protection.checkAndMark(messageId)).toBe(false)
    
    // Now it's marked
    expect(protection.isReplay(messageId)).toBe(true)
  })

  it('should clean up old messages', async () => {
    const oldProtection = new ReplayProtection({
      retentionTime: 100,  // 100ms
      cleanupInterval: 50  // 50ms
    })
    oldProtection.start()
    
    try {
      const messageId = uuidv4()
      
      // Mark the message
      expect(oldProtection.checkAndMark(messageId)).toBe(false)
      
      // Initially marked
      expect(oldProtection.isReplay(messageId)).toBe(true)
      
      // Wait for cleanup (150ms should be enough for retention + cleanup interval)
      await new Promise(r => setTimeout(r, 200))
      
      // Should be cleaned up now
      expect(oldProtection.isReplay(messageId)).toBe(false)
    } finally {
      oldProtection.stop()
    }
  })

  it('should provide stats', () => {
    const id1 = uuidv4()
    const id2 = uuidv4()
    
    protection.checkAndMark(id1)
    protection.checkAndMark(id2)
    
    const stats = protection.getStats()
    expect(stats.trackedMessages).toBe(2)
    expect(stats.memoryUsageKB).toBeGreaterThanOrEqual(0)
  })

  it('should clear all tracked messages', () => {
    const id1 = uuidv4()
    const id2 = uuidv4()
    
    protection.checkAndMark(id1)
    protection.checkAndMark(id2)
    
    expect(protection.getStats().trackedMessages).toBe(2)
    
    protection.clear()
    
    expect(protection.getStats().trackedMessages).toBe(0)
    
    // Messages should no longer be marked
    expect(protection.isReplay(id1)).toBe(false)
    expect(protection.isReplay(id2)).toBe(false)
  })

  it('should handle high volume of messages', () => {
    const messageIds: string[] = []
    
    // Generate and mark 1000 messages
    for (let i = 0; i < 1000; i++) {
      const id = uuidv4()
      messageIds.push(id)
      expect(protection.checkAndMark(id)).toBe(false)
    }
    
    // All should be marked as replays
    for (const id of messageIds) {
      expect(protection.isReplay(id)).toBe(true)
    }
    
    const stats = protection.getStats()
    expect(stats.trackedMessages).toBe(1000)
  })
})
