import { describe, it, expect } from 'vitest'
import {
  isNLockTimeExpired,
  isPeerUnresponsive,
  getNLockTimeExpiry,
  getTimeUntilExpiry,
  findChannelsNeedingForceClose,
  getForceCloseStats
} from '../../../src/channels/force-close.js'
import { Channel, ChannelState } from '../../../src/channels/types.js'

// Helper to create a test channel
function createTestChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'test-channel',
    localPeerId: 'peer1',
    remotePeerId: 'peer2',
    localPubKey: 'pubkey1',
    remotePubKey: 'pubkey2',
    state: 'open' as ChannelState,
    capacity: 10000,
    localBalance: 5000,
    remoteBalance: 5000,
    sequenceNumber: 0,
    nLockTime: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

describe('Force Close - Time Checks', () => {
  it('should detect expired nLockTime', () => {
    const expiredChannel = createTestChannel({
      nLockTime: Math.floor(Date.now() / 1000) - 100 // 100 seconds ago
    })
    
    expect(isNLockTimeExpired(expiredChannel)).toBe(true)
  })

  it('should detect non-expired nLockTime', () => {
    const futureChannel = createTestChannel({
      nLockTime: Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
    })
    
    expect(isNLockTimeExpired(futureChannel)).toBe(false)
  })

  it('should get correct nLockTime expiry date', () => {
    const nLockTime = Math.floor(Date.now() / 1000) + 3600
    const channel = createTestChannel({ nLockTime })
    
    const expiry = getNLockTimeExpiry(channel)
    expect(expiry.getTime()).toBe(nLockTime * 1000)
  })

  it('should calculate time until expiry', () => {
    const nLockTime = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
    const channel = createTestChannel({ nLockTime })
    
    const timeUntil = getTimeUntilExpiry(channel)
    expect(timeUntil).toBeGreaterThan(3500 * 1000) // ~1 hour in ms
    expect(timeUntil).toBeLessThan(3700 * 1000)
  })

  it('should return 0 for expired channels', () => {
    const expiredChannel = createTestChannel({
      nLockTime: Math.floor(Date.now() / 1000) - 100
    })
    
    const timeUntil = getTimeUntilExpiry(expiredChannel)
    expect(timeUntil).toBe(0)
  })
})

describe('Force Close - Peer Responsiveness', () => {
  it('should detect unresponsive peer', () => {
    const staleChannel = createTestChannel({
      updatedAt: Date.now() - 10 * 60 * 1000 // 10 minutes ago
    })
    
    const timeoutMs = 5 * 60 * 1000 // 5 minutes
    expect(isPeerUnresponsive(staleChannel, timeoutMs)).toBe(true)
  })

  it('should detect responsive peer', () => {
    const activeChannel = createTestChannel({
      updatedAt: Date.now() - 1 * 60 * 1000 // 1 minute ago
    })
    
    const timeoutMs = 5 * 60 * 1000 // 5 minutes
    expect(isPeerUnresponsive(activeChannel, timeoutMs)).toBe(false)
  })
})

describe('Force Close - Channel Selection', () => {
  it('should find channels needing force close', () => {
    const channels: Channel[] = [
      // Channel 1: unresponsive + expired = needs force close
      createTestChannel({
        id: 'channel1',
        nLockTime: Math.floor(Date.now() / 1000) - 100,
        updatedAt: Date.now() - 10 * 60 * 1000
      }),
      // Channel 2: responsive + expired = no force close
      createTestChannel({
        id: 'channel2',
        nLockTime: Math.floor(Date.now() / 1000) - 100,
        updatedAt: Date.now()
      }),
      // Channel 3: unresponsive + not expired = no force close
      createTestChannel({
        id: 'channel3',
        nLockTime: Math.floor(Date.now() / 1000) + 3600,
        updatedAt: Date.now() - 10 * 60 * 1000
      }),
      // Channel 4: closed state = ignore
      createTestChannel({
        id: 'channel4',
        state: 'closed',
        nLockTime: Math.floor(Date.now() / 1000) - 100,
        updatedAt: Date.now() - 10 * 60 * 1000
      })
    ]
    
    const needingClose = findChannelsNeedingForceClose(channels, {
      peerTimeoutMs: 5 * 60 * 1000,
      checkIntervalMs: 60 * 1000
    })
    
    expect(needingClose).toHaveLength(1)
    expect(needingClose[0].id).toBe('channel1')
  })
})

describe('Force Close - Statistics', () => {
  it('should calculate force close statistics', () => {
    const channels: Channel[] = [
      createTestChannel({
        id: 'channel1',
        nLockTime: Math.floor(Date.now() / 1000) - 100,
        updatedAt: Date.now() - 10 * 60 * 1000
      }),
      createTestChannel({
        id: 'channel2',
        nLockTime: Math.floor(Date.now() / 1000) - 100,
        updatedAt: Date.now()
      }),
      createTestChannel({
        id: 'channel3',
        nLockTime: Math.floor(Date.now() / 1000) + 3600,
        updatedAt: Date.now() - 10 * 60 * 1000
      }),
      createTestChannel({
        id: 'channel4',
        nLockTime: Math.floor(Date.now() / 1000) + 3600,
        updatedAt: Date.now()
      })
    ]
    
    const stats = getForceCloseStats(channels, {
      peerTimeoutMs: 5 * 60 * 1000,
      checkIntervalMs: 60 * 1000
    })
    
    expect(stats.totalChannels).toBe(4)
    expect(stats.unresponsivePeers).toBe(2)
    expect(stats.expiredLockTime).toBe(2)
    expect(stats.readyForForceClose).toBe(1)
    expect(stats.pendingChannels).toHaveLength(3) // 3 channels with issues
  })

  it('should provide detailed pending channel info', () => {
    const channels: Channel[] = [
      createTestChannel({
        id: 'problem-channel',
        nLockTime: Math.floor(Date.now() / 1000) - 100,
        updatedAt: Date.now() - 10 * 60 * 1000
      })
    ]
    
    const stats = getForceCloseStats(channels, {
      peerTimeoutMs: 5 * 60 * 1000,
      checkIntervalMs: 60 * 1000
    })
    
    expect(stats.pendingChannels).toHaveLength(1)
    
    const pending = stats.pendingChannels[0]
    expect(pending.channelId).toBe('problem-channel')
    expect(pending.peerUnresponsive).toBe(true)
    expect(pending.lockTimeExpired).toBe(true)
    expect(pending.timeUntilExpiry).toBe(0)
  })
})
