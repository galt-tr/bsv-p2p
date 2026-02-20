/**
 * Channel State Machine
 * 
 * Handles state transitions for payment channels.
 * All state changes go through this to ensure validity.
 */

import { Channel, ChannelState, ChannelUpdate, ChannelConfig, DEFAULT_CHANNEL_CONFIG } from './types.js'

export type StateTransitionResult = 
  | { ok: true; newState: ChannelState }
  | { ok: false; error: string }

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS: Record<ChannelState, ChannelState[]> = {
  [ChannelState.PROPOSED]: [
    ChannelState.ACCEPTED,
    ChannelState.REJECTED,
    ChannelState.FAILED
  ],
  [ChannelState.ACCEPTED]: [
    ChannelState.FUNDING,
    ChannelState.FAILED
  ],
  [ChannelState.FUNDING]: [
    ChannelState.OPEN,
    ChannelState.FAILED
  ],
  [ChannelState.OPEN]: [
    ChannelState.CLOSING,
    ChannelState.FORCE_CLOSING
  ],
  [ChannelState.CLOSING]: [
    ChannelState.CLOSED,
    ChannelState.FORCE_CLOSING  // If coop close fails
  ],
  [ChannelState.CLOSED]: [],  // Terminal state
  [ChannelState.REJECTED]: [], // Terminal state
  [ChannelState.FAILED]: [],   // Terminal state
  [ChannelState.FORCE_CLOSING]: [
    ChannelState.RESOLVED
  ],
  [ChannelState.RESOLVED]: []  // Terminal state
}

export class ChannelStateMachine {
  private config: ChannelConfig

  constructor(config: Partial<ChannelConfig> = {}) {
    this.config = { ...DEFAULT_CHANNEL_CONFIG, ...config }
  }

  /**
   * Check if a state transition is valid
   */
  canTransition(from: ChannelState, to: ChannelState): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false
  }

  /**
   * Attempt a state transition
   */
  transition(channel: Channel, newState: ChannelState): StateTransitionResult {
    if (!this.canTransition(channel.state, newState)) {
      return {
        ok: false,
        error: `Invalid transition: ${channel.state} -> ${newState}`
      }
    }
    return { ok: true, newState }
  }

  /**
   * Validate a channel update (payment)
   */
  validateUpdate(channel: Channel, update: ChannelUpdate): StateTransitionResult {
    // Must be in OPEN state
    if (channel.state !== ChannelState.OPEN) {
      return { ok: false, error: `Channel not open (state: ${channel.state})` }
    }

    // Sequence must be higher
    if (update.seq <= channel.commitmentSeq) {
      return { ok: false, error: `Sequence too low: ${update.seq} <= ${channel.commitmentSeq}` }
    }

    // Balances must sum to capacity
    const total = update.localBalanceSats + update.remoteBalanceSats
    if (total !== channel.capacitySats) {
      return { ok: false, error: `Invalid balances: ${total} != ${channel.capacitySats}` }
    }

    // Balances must be non-negative
    if (update.localBalanceSats < 0 || update.remoteBalanceSats < 0) {
      return { ok: false, error: 'Balances cannot be negative' }
    }

    // TODO: Verify signature

    return { ok: true, newState: ChannelState.OPEN }
  }

  /**
   * Create a new channel in PROPOSED state
   */
  createProposed(
    peerId: string,
    localPubKey: string,
    capacitySats: number,
    isInitiator: boolean
  ): Channel | { error: string } {
    if (capacitySats < this.config.minCapacitySats) {
      return { error: `Capacity below minimum: ${capacitySats} < ${this.config.minCapacitySats}` }
    }
    if (capacitySats > this.config.maxCapacitySats) {
      return { error: `Capacity above maximum: ${capacitySats} > ${this.config.maxCapacitySats}` }
    }

    const now = Date.now()
    const channelId = this.generateChannelId(localPubKey, peerId, now)

    return {
      id: channelId,
      state: ChannelState.PROPOSED,
      isInitiator,
      peerId,
      localPubKey,
      remotePubKey: '',  // Set when accepted
      capacitySats,
      localBalanceSats: isInitiator ? capacitySats : 0,
      remoteBalanceSats: isInitiator ? 0 : capacitySats,
      commitmentSeq: 0,
      createdAt: now,
      updatedAt: now
    }
  }

  private generateChannelId(localPubKey: string, peerId: string, timestamp: number): string {
    // Simple ID generation - in production, this would be hash of funding outpoint
    const data = `${localPubKey}:${peerId}:${timestamp}`
    return Buffer.from(data).toString('base64').slice(0, 16)
  }
}
