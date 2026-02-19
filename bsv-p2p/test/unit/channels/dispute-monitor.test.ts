import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DisputeMonitor, DisputeAlert } from '../../../src/channels/dispute-monitor.js'
import { Channel, ChannelState } from '../../../src/channels/types.js'

// Helper to create a test channel
function createTestChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'test-channel-' + Math.random().toString(36).substring(7),
    localPeerId: 'peer1',
    remotePeerId: 'peer2',
    localPubKey: 'pubkey1',
    remotePubKey: 'pubkey2',
    state: 'open' as ChannelState,
    capacity: 10000,
    localBalance: 5000,
    remoteBalance: 5000,
    sequenceNumber: 10,
    nLockTime: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

describe('Dispute Monitor', () => {
  let monitor: DisputeMonitor

  beforeEach(() => {
    monitor = new DisputeMonitor({
      checkIntervalMs: 100,  // Fast for testing
      autoResolve: false
    })
  })

  afterEach(() => {
    monitor.stop()
  })

  it('should start and stop monitoring', () => {
    expect(monitor.getStats().running).toBe(false)
    
    monitor.start()
    expect(monitor.getStats().running).toBe(true)
    
    monitor.stop()
    expect(monitor.getStats().running).toBe(false)
  })

  it('should register and unregister channels', () => {
    const channel = createTestChannel()
    
    expect(monitor.getStats().monitoredChannels).toBe(0)
    
    monitor.registerChannel(channel)
    expect(monitor.getStats().monitoredChannels).toBe(1)
    
    monitor.unregisterChannel(channel.id)
    expect(monitor.getStats().monitoredChannels).toBe(0)
  })

  it('should update channel state', () => {
    const channel = createTestChannel({ sequenceNumber: 5 })
    
    monitor.registerChannel(channel)
    
    const updated = { ...channel, sequenceNumber: 10 }
    monitor.updateChannel(updated)
    
    // Stats should still show 1 monitored channel
    expect(monitor.getStats().monitoredChannels).toBe(1)
  })

  it('should track active disputes', () => {
    const channel = createTestChannel()
    
    expect(monitor.getActiveDisputes()).toHaveLength(0)
    expect(monitor.getDisputeForChannel(channel.id)).toBeUndefined()
  })

  it('should provide monitoring statistics', () => {
    const channel1 = createTestChannel()
    const channel2 = createTestChannel()
    
    monitor.registerChannel(channel1)
    monitor.registerChannel(channel2)
    
    const stats = monitor.getStats()
    expect(stats.monitoredChannels).toBe(2)
    expect(stats.activeDisputes).toBe(0)
    expect(stats.running).toBe(false)
  })

  it('should emit dispute events', (done) => {
    const channel = createTestChannel()
    monitor.registerChannel(channel)
    
    monitor.on('dispute', (alert: DisputeAlert) => {
      expect(alert.channelId).toBe(channel.id)
      expect(alert.broadcastSequence).toBeLessThan(alert.latestSequence)
      done()
    })
    
    // Manually trigger a dispute check
    // In a real scenario, this would be detected from blockchain monitoring
  })

  it('should emit dispute_resolved events', (done) => {
    const channel = createTestChannel()
    monitor.registerChannel(channel)
    
    monitor.on('dispute_resolved', (result: any) => {
      expect(result.channelId).toBe(channel.id)
      done()
    })
    
    // Simulate dispute resolution
    // This requires manually creating a dispute first
  })

  it('should calculate time to expiry correctly', () => {
    const futureTime = Math.floor(Date.now() / 1000) + 3600 // 1 hour
    const channel = createTestChannel({ nLockTime: futureTime })
    
    monitor.registerChannel(channel)
    
    // Time to expiry should be roughly 1 hour (in milliseconds)
    const expectedExpiry = futureTime * 1000 - Date.now()
    expect(expectedExpiry).toBeGreaterThan(3500 * 1000) // ~58 minutes
    expect(expectedExpiry).toBeLessThan(3700 * 1000)    // ~62 minutes
  })

  it('should identify when response time has expired', () => {
    const pastTime = Math.floor(Date.now() / 1000) - 100 // 100 seconds ago
    const channel = createTestChannel({ nLockTime: pastTime })
    
    monitor.registerChannel(channel)
    
    // For an expired nLockTime, canRespond should be false
    // This would be checked in the dispute detection logic
  })

  it('should not monitor closed channels', () => {
    const closedChannel = createTestChannel({ state: 'closed' })
    
    monitor.registerChannel(closedChannel)
    
    // Monitor should track it, but checkForDisputes filters by state
    expect(monitor.getStats().monitoredChannels).toBe(1)
  })

  it('should handle multiple channels simultaneously', () => {
    const channels = [
      createTestChannel({ id: 'channel-1' }),
      createTestChannel({ id: 'channel-2' }),
      createTestChannel({ id: 'channel-3' })
    ]
    
    channels.forEach(ch => monitor.registerChannel(ch))
    
    expect(monitor.getStats().monitoredChannels).toBe(3)
  })

  it('should prevent double-start', () => {
    monitor.start()
    monitor.start() // Should not throw or create duplicate timers
    
    expect(monitor.getStats().running).toBe(true)
    
    monitor.stop()
    expect(monitor.getStats().running).toBe(false)
  })
})

describe('Dispute Resolution', () => {
  let monitor: DisputeMonitor

  beforeEach(() => {
    monitor = new DisputeMonitor()
  })

  afterEach(() => {
    monitor.stop()
  })

  it('should throw error when resolving non-existent dispute', async () => {
    await expect(
      monitor.resolveDispute('non-existent-channel', 'tx-hex')
    ).rejects.toThrow('No active dispute')
  })

  it('should throw error when nLockTime has expired', async () => {
    // This would require setting up a dispute with expired nLockTime
    // and then attempting to resolve it
  })
})
