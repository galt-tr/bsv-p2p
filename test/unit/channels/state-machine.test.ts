import { describe, it, expect } from 'vitest'
import { ChannelStateMachine, ChannelState, Channel } from '../../../src/channels/index.js'

describe('ChannelStateMachine', () => {
  const sm = new ChannelStateMachine()

  describe('state transitions', () => {
    it('should allow PROPOSED → ACCEPTED', () => {
      expect(sm.canTransition(ChannelState.PROPOSED, ChannelState.ACCEPTED)).toBe(true)
    })

    it('should allow PROPOSED → REJECTED', () => {
      expect(sm.canTransition(ChannelState.PROPOSED, ChannelState.REJECTED)).toBe(true)
    })

    it('should not allow PROPOSED → OPEN (skip ACCEPTED)', () => {
      expect(sm.canTransition(ChannelState.PROPOSED, ChannelState.OPEN)).toBe(false)
    })

    it('should allow OPEN → CLOSING', () => {
      expect(sm.canTransition(ChannelState.OPEN, ChannelState.CLOSING)).toBe(true)
    })

    it('should allow OPEN → FORCE_CLOSING', () => {
      expect(sm.canTransition(ChannelState.OPEN, ChannelState.FORCE_CLOSING)).toBe(true)
    })

    it('should not allow transitions from CLOSED', () => {
      expect(sm.canTransition(ChannelState.CLOSED, ChannelState.OPEN)).toBe(false)
      expect(sm.canTransition(ChannelState.CLOSED, ChannelState.PROPOSED)).toBe(false)
    })
  })

  describe('createProposed', () => {
    it('should create a channel in PROPOSED state', () => {
      const channel = sm.createProposed(
        '12D3KooWTest...',
        '02abc123...',
        10000,
        true
      )

      expect('error' in channel).toBe(false)
      if (!('error' in channel)) {
        expect(channel.state).toBe(ChannelState.PROPOSED)
        expect(channel.isInitiator).toBe(true)
        expect(channel.capacitySats).toBe(10000)
        expect(channel.localBalanceSats).toBe(10000)
        expect(channel.remoteBalanceSats).toBe(0)
      }
    })

    it('should reject capacity below minimum', () => {
      const result = sm.createProposed('peer', 'pk', 100, true)
      expect('error' in result).toBe(true)
    })

    it('should reject capacity above maximum', () => {
      const result = sm.createProposed('peer', 'pk', 200000000, true)
      expect('error' in result).toBe(true)
    })
  })

  describe('validateUpdate', () => {
    const openChannel: Channel = {
      id: 'test-channel',
      state: ChannelState.OPEN,
      isInitiator: true,
      peerId: '12D3KooWTest...',
      localPubKey: '02abc...',
      remotePubKey: '03def...',
      capacitySats: 10000,
      localBalanceSats: 5000,
      remoteBalanceSats: 5000,
      commitmentSeq: 5,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    it('should accept valid update', () => {
      const result = sm.validateUpdate(openChannel, {
        channelId: 'test-channel',
        seq: 6,
        localBalanceSats: 4000,
        remoteBalanceSats: 6000,
        signature: 'sig'
      })
      expect(result.ok).toBe(true)
    })

    it('should reject update with old sequence', () => {
      const result = sm.validateUpdate(openChannel, {
        channelId: 'test-channel',
        seq: 3, // Too low
        localBalanceSats: 4000,
        remoteBalanceSats: 6000,
        signature: 'sig'
      })
      expect(result.ok).toBe(false)
    })

    it('should reject update with invalid balances', () => {
      const result = sm.validateUpdate(openChannel, {
        channelId: 'test-channel',
        seq: 6,
        localBalanceSats: 4000,
        remoteBalanceSats: 5000, // Doesn't sum to 10000
        signature: 'sig'
      })
      expect(result.ok).toBe(false)
    })

    it('should reject update on non-OPEN channel', () => {
      const closedChannel = { ...openChannel, state: ChannelState.CLOSED }
      const result = sm.validateUpdate(closedChannel, {
        channelId: 'test-channel',
        seq: 6,
        localBalanceSats: 4000,
        remoteBalanceSats: 6000,
        signature: 'sig'
      })
      expect(result.ok).toBe(false)
    })
  })
})
