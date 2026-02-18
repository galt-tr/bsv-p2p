/**
 * SQLite persistence layer for payment channels
 */

import Database from 'better-sqlite3'
import { Channel, ChannelState, PaymentRecord } from './types.js'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

export interface ChannelRow {
  id: string
  local_peer_id: string
  remote_peer_id: string
  local_pub_key: string
  remote_pub_key: string
  capacity: number
  local_balance: number
  remote_balance: number
  state: string
  n_lock_time: number
  sequence_number: number
  funding_tx_id: string | null
  funding_vout: number | null
  created_at: number
  updated_at: number
}

export interface PaymentRow {
  id: string
  channel_id: string
  amount: number
  direction: string
  sequence: number
  signature: string | null
  created_at: number
}

export class ChannelStorage {
  private db: Database.Database

  constructor(dbPath: string = '~/.bsv-p2p/channels.db') {
    // Expand ~ to home directory
    const expandedPath = dbPath.replace(/^~/, process.env.HOME || '')
    
    // Ensure directory exists
    const dir = dirname(expandedPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    this.db = new Database(expandedPath)
    this.db.pragma('journal_mode = WAL')
    this.init()
  }

  private init(): void {
    // Create channels table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        local_peer_id TEXT NOT NULL,
        remote_peer_id TEXT NOT NULL,
        local_pub_key TEXT NOT NULL,
        remote_pub_key TEXT NOT NULL,
        capacity INTEGER NOT NULL,
        local_balance INTEGER NOT NULL,
        remote_balance INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        n_lock_time INTEGER NOT NULL,
        sequence_number INTEGER NOT NULL DEFAULT 0,
        funding_tx_id TEXT,
        funding_vout INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // Create payments table for audit trail
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        direction TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        signature TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (channel_id) REFERENCES channels(id)
      )
    `)

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_channels_remote_peer ON channels(remote_peer_id);
      CREATE INDEX IF NOT EXISTS idx_channels_state ON channels(state);
      CREATE INDEX IF NOT EXISTS idx_payments_channel ON payments(channel_id);
    `)
  }

  /**
   * Save or update a channel
   */
  saveChannel(channel: Channel): void {
    const stmt = this.db.prepare(`
      INSERT INTO channels (
        id, local_peer_id, remote_peer_id, local_pub_key, remote_pub_key,
        capacity, local_balance, remote_balance, state, n_lock_time, sequence_number,
        funding_tx_id, funding_vout, created_at, updated_at
      ) VALUES (
        @id, @local_peer_id, @remote_peer_id, @local_pub_key, @remote_pub_key,
        @capacity, @local_balance, @remote_balance, @state, @n_lock_time, @sequence_number,
        @funding_tx_id, @funding_vout, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        local_balance = @local_balance,
        remote_balance = @remote_balance,
        state = @state,
        sequence_number = @sequence_number,
        funding_tx_id = @funding_tx_id,
        funding_vout = @funding_vout,
        updated_at = @updated_at
    `)

    stmt.run({
      id: channel.id,
      local_peer_id: channel.localPeerId || '',
      remote_peer_id: channel.remotePeerId,
      local_pub_key: channel.localPubKey,
      remote_pub_key: channel.remotePubKey,
      capacity: channel.capacity,
      local_balance: channel.localBalance,
      remote_balance: channel.remoteBalance,
      state: channel.state,
      n_lock_time: channel.nLockTime,
      sequence_number: channel.sequenceNumber,
      funding_tx_id: channel.fundingTxId || null,
      funding_vout: channel.fundingOutputIndex ?? null,
      created_at: channel.createdAt,
      updated_at: Date.now()
    })
  }

  /**
   * Load a channel by ID
   */
  getChannel(id: string): Channel | null {
    const stmt = this.db.prepare('SELECT * FROM channels WHERE id = ?')
    const row = stmt.get(id) as ChannelRow | undefined
    return row ? this.rowToChannel(row) : null
  }

  /**
   * Load all channels
   */
  getAllChannels(): Channel[] {
    const stmt = this.db.prepare('SELECT * FROM channels ORDER BY created_at DESC')
    const rows = stmt.all() as ChannelRow[]
    return rows.map(row => this.rowToChannel(row))
  }

  /**
   * Load channels by peer ID
   */
  getChannelsByPeer(peerId: string): Channel[] {
    const stmt = this.db.prepare('SELECT * FROM channels WHERE remote_peer_id = ?')
    const rows = stmt.all(peerId) as ChannelRow[]
    return rows.map(row => this.rowToChannel(row))
  }

  /**
   * Load channels by state
   */
  getChannelsByState(state: ChannelState): Channel[] {
    const stmt = this.db.prepare('SELECT * FROM channels WHERE state = ?')
    const rows = stmt.all(state) as ChannelRow[]
    return rows.map(row => this.rowToChannel(row))
  }

  /**
   * Delete a channel
   */
  deleteChannel(id: string): void {
    // Delete payments first (foreign key)
    this.db.prepare('DELETE FROM payments WHERE channel_id = ?').run(id)
    this.db.prepare('DELETE FROM channels WHERE id = ?').run(id)
  }

  /**
   * Record a payment
   */
  recordPayment(payment: PaymentRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO payments (id, channel_id, amount, direction, sequence, signature, created_at)
      VALUES (@id, @channel_id, @amount, @direction, @sequence, @signature, @created_at)
    `)

    stmt.run({
      id: payment.id,
      channel_id: payment.channelId,
      amount: payment.amount,
      direction: payment.direction,
      sequence: payment.sequence,
      signature: payment.signature || null,
      created_at: payment.timestamp
    })
  }

  /**
   * Get payments for a channel
   */
  getPayments(channelId: string): PaymentRecord[] {
    const stmt = this.db.prepare('SELECT * FROM payments WHERE channel_id = ? ORDER BY created_at')
    const rows = stmt.all(channelId) as PaymentRow[]
    return rows.map(row => ({
      id: row.id,
      channelId: row.channel_id,
      amount: row.amount,
      direction: row.direction as 'sent' | 'received',
      sequence: row.sequence,
      signature: row.signature || undefined,
      timestamp: row.created_at
    }))
  }

  /**
   * Convert database row to Channel object
   */
  private rowToChannel(row: ChannelRow): Channel {
    return {
      id: row.id,
      localPeerId: row.local_peer_id,
      remotePeerId: row.remote_peer_id,
      localPubKey: row.local_pub_key,
      remotePubKey: row.remote_pub_key,
      capacity: row.capacity,
      localBalance: row.local_balance,
      remoteBalance: row.remote_balance,
      state: row.state as ChannelState,
      nLockTime: row.n_lock_time,
      sequenceNumber: row.sequence_number,
      fundingTxId: row.funding_tx_id || undefined,
      fundingOutputIndex: row.funding_vout ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close()
  }
}
