import Database from 'better-sqlite3'
import { join } from 'path'

interface MessageRecord {
  id: number
  peerId: string
  peerName: string | null
  direction: 'inbound' | 'outbound'
  content: string
  messageType: string
  timestamp: number
  sessionId: string | null
  metadata: string | null
}

interface MessageQuery {
  peerId?: string
  direction?: 'inbound' | 'outbound'
  since?: number
  until?: number
  limit?: number
  offset?: number
  search?: string
  messageType?: string
}

interface ConversationSummary {
  peerId: string
  peerName: string | null
  lastMessage: string
  lastTimestamp: number
  messageCount: number
  unreadCount: number
}

interface MessageStats {
  totalMessages: number
  totalInbound: number
  totalOutbound: number
  uniquePeers: number
  messagesByPeer: Array<{ peerId: string, peerName: string | null, count: number }>
  messagesByDay: Array<{ date: string, count: number }>
}

export class MessageLogger {
  private db: Database.Database
  private insertStmt: Database.Statement
  private getMessagesStmt: Database.Statement
  private searchStmt: Database.Statement
  private conversationStmt: Database.Statement
  private conversationsStmt: Database.Statement
  private statsStmt: Database.Statement

  constructor(dbPath: string) {
    this.db = new Database(dbPath)

    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')

    this.createTables()
    this.prepareStatements()
  }

  private createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        peer_id TEXT NOT NULL,
        peer_name TEXT,
        direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
        content TEXT NOT NULL,
        message_type TEXT DEFAULT 'chat',
        timestamp INTEGER NOT NULL,
        session_id TEXT,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_messages_peer ON messages(peer_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);
      CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);
      CREATE INDEX IF NOT EXISTS idx_messages_peer_time ON messages(peer_id, timestamp DESC);
    `)

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        peer_name,
        peer_id,
        content='messages',
        content_rowid='id'
      );
    `)

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content, peer_name, peer_id)
        VALUES (new.id, new.content, new.peer_name, new.peer_id);
      END;
    `)

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content, peer_name, peer_id)
        VALUES('delete', old.id, old.content, old.peer_name, old.peer_id);
      END;
    `)
  }

  private prepareStatements() {
    this.insertStmt = this.db.prepare(`
      INSERT INTO messages (peer_id, peer_name, direction, content, message_type, timestamp, session_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    this.getMessagesStmt = this.db.prepare(`
      SELECT id, peer_id as peerId, peer_name as peerName, direction, content,
             message_type as messageType, timestamp, session_id as sessionId, metadata
      FROM messages
      WHERE 1=1
        AND (? IS NULL OR peer_id = ?)
        AND (? IS NULL OR direction = ?)
        AND (? IS NULL OR timestamp >= ?)
        AND (? IS NULL OR timestamp <= ?)
        AND (? IS NULL OR message_type = ?)
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `)

    this.searchStmt = this.db.prepare(`
      SELECT m.id, m.peer_id as peerId, m.peer_name as peerName, m.direction, m.content,
             m.message_type as messageType, m.timestamp, m.session_id as sessionId, m.metadata
      FROM messages m
      JOIN messages_fts f ON m.id = f.rowid
      WHERE messages_fts MATCH ?
        AND (? IS NULL OR m.peer_id = ?)
        AND (? IS NULL OR m.direction = ?)
        AND (? IS NULL OR m.timestamp >= ?)
        AND (? IS NULL OR m.timestamp <= ?)
        AND (? IS NULL OR m.message_type = ?)
      ORDER BY m.timestamp DESC
      LIMIT ? OFFSET ?
    `)

    this.conversationStmt = this.db.prepare(`
      SELECT id, peer_id as peerId, peer_name as peerName, direction, content,
             message_type as messageType, timestamp, session_id as sessionId, metadata
      FROM messages
      WHERE peer_id = ?
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `)

    this.conversationsStmt = this.db.prepare(`
      WITH latest_messages AS (
        SELECT peer_id, MAX(id) as max_id
        FROM messages
        GROUP BY peer_id
      ),
      peer_counts AS (
        SELECT peer_id, COUNT(*) as message_count
        FROM messages
        GROUP BY peer_id
      )
      SELECT m.peer_id as peerId, m.peer_name as peerName,
             m.content as lastMessage, m.timestamp as lastTimestamp,
             pc.message_count as messageCount, 0 as unreadCount
      FROM messages m
      JOIN latest_messages lm ON m.id = lm.max_id
      JOIN peer_counts pc ON m.peer_id = pc.peer_id
      ORDER BY m.timestamp DESC
    `)

    this.statsStmt = this.db.prepare(`
      SELECT COUNT(*) as totalMessages
      FROM messages
    `)
  }

  logMessage(
    peerId: string,
    peerName: string | null,
    direction: 'inbound' | 'outbound',
    content: string,
    messageType: string = 'chat',
    sessionId: string | null = null,
    metadata: string | null = null
  ): void {
    const timestamp = Date.now()
    this.insertStmt.run(peerId, peerName, direction, content, messageType, timestamp, sessionId, metadata)
  }

  getMessages(query: MessageQuery = {}): { messages: MessageRecord[], total: number } {
    const limit = query.limit || 50
    const offset = query.offset || 0

    let messages: MessageRecord[]
    let countStmt: Database.Statement

    if (query.search) {
      messages = this.searchStmt.all(
        query.search,
        query.peerId, query.peerId,
        query.direction, query.direction,
        query.since, query.since,
        query.until, query.until,
        query.messageType, query.messageType,
        limit, offset
      ) as MessageRecord[]

      countStmt = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM messages m
        JOIN messages_fts f ON m.id = f.rowid
        WHERE messages_fts MATCH ?
          AND (? IS NULL OR m.peer_id = ?)
          AND (? IS NULL OR m.direction = ?)
          AND (? IS NULL OR m.timestamp >= ?)
          AND (? IS NULL OR m.timestamp <= ?)
          AND (? IS NULL OR m.message_type = ?)
      `)
      const totalResult = countStmt.get(
        query.search,
        query.peerId, query.peerId,
        query.direction, query.direction,
        query.since, query.since,
        query.until, query.until,
        query.messageType, query.messageType
      ) as { count: number }

      return { messages, total: totalResult.count }
    } else {
      messages = this.getMessagesStmt.all(
        query.peerId, query.peerId,
        query.direction, query.direction,
        query.since, query.since,
        query.until, query.until,
        query.messageType, query.messageType,
        limit, offset
      ) as MessageRecord[]

      countStmt = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM messages
        WHERE 1=1
          AND (? IS NULL OR peer_id = ?)
          AND (? IS NULL OR direction = ?)
          AND (? IS NULL OR timestamp >= ?)
          AND (? IS NULL OR timestamp <= ?)
          AND (? IS NULL OR message_type = ?)
      `)
      const totalResult = countStmt.get(
        query.peerId, query.peerId,
        query.direction, query.direction,
        query.since, query.since,
        query.until, query.until,
        query.messageType, query.messageType
      ) as { count: number }

      return { messages, total: totalResult.count }
    }
  }

  getConversation(
    peerId: string,
    limit: number = 50,
    offset: number = 0
  ): { messages: MessageRecord[], total: number } {
    const messages = this.conversationStmt.all(peerId, limit, offset) as MessageRecord[]

    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE peer_id = ?')
    const totalResult = countStmt.get(peerId) as { count: number }

    return { messages, total: totalResult.count }
  }

  searchMessages(query: string, opts: MessageQuery = {}): { messages: MessageRecord[], total: number } {
    return this.getMessages({ ...opts, search: query })
  }

  getConversations(): ConversationSummary[] {
    return this.conversationsStmt.all() as ConversationSummary[]
  }

  getStats(): MessageStats {
    const totalResult = this.statsStmt.get() as { totalMessages: number }

    const inboundResult = this.db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE direction = 'inbound'"
    ).get() as { count: number }

    const outboundResult = this.db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE direction = 'outbound'"
    ).get() as { count: number }

    const uniquePeersResult = this.db.prepare(
      'SELECT COUNT(DISTINCT peer_id) as count FROM messages'
    ).get() as { count: number }

    const messagesByPeer = this.db.prepare(`
      SELECT peer_id as peerId, peer_name as peerName, COUNT(*) as count
      FROM messages
      GROUP BY peer_id
      ORDER BY count DESC
      LIMIT 10
    `).all() as Array<{ peerId: string, peerName: string | null, count: number }>

    const messagesByDay = this.db.prepare(`
      SELECT date(timestamp / 1000, 'unixepoch') as date, COUNT(*) as count
      FROM messages
      GROUP BY date
      ORDER BY date DESC
      LIMIT 30
    `).all() as Array<{ date: string, count: number }>

    return {
      totalMessages: totalResult.totalMessages,
      totalInbound: inboundResult.count,
      totalOutbound: outboundResult.count,
      uniquePeers: uniquePeersResult.count,
      messagesByPeer,
      messagesByDay
    }
  }

  close() {
    this.db.close()
  }
}