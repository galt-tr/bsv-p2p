# BSV P2P API Reference

Complete reference for all agent tools, daemon endpoints, and message types.

## Table of Contents

1. [Agent Tools (Plugin Mode)](#agent-tools-plugin-mode)
2. [Daemon HTTP API (Legacy)](#daemon-http-api-legacy)
3. [Message Types](#message-types)
4. [Channel Operations](#channel-operations)
5. [Error Codes](#error-codes)

---

## Agent Tools (Plugin Mode)

When using the OpenClaw plugin, agents have access to these tools.

### `p2p_discover`

Discover available peers and their services on the network.

**Parameters:**

```typescript
{
  service?: string  // Optional: filter by service name
}
```

**Returns:**

```typescript
{
  peers: Array<{
    peerId: string,
    services?: Array<{
      id: string,
      name: string,
      description: string,
      pricing: {
        model: string,  // 'per-request' | 'usage-based' | 'tiered'
        baseSatoshis: number,
        details?: string
      },
      metadata?: Record<string, any>
    }>
  }>
}
```

**Example:**

```
Human: Find bots offering code-review

Agent: [calls p2p_discover with service="code-review"]

Found 2 peers:

Peer: 12D3KooWPeerA...
Services:
  - code-review: Review code for bugs and security (500 sats)

Peer: 12D3KooWPeerB...
Services:
  - code-review: AI-powered code analysis (1000 sats)
```

**Errors:**

- `P2P_NOT_RUNNING` - P2P node not initialized
- `DISCOVERY_TIMEOUT` - No response from network after 10s

---

### `p2p_send`

Send a direct message to another peer.

**Parameters:**

```typescript
{
  peerId: string,     // Target peer ID (required)
  message: string     // Message text (required)
}
```

**Returns:**

```typescript
{
  success: boolean,
  messageId: string,
  timestamp: number
}
```

**Example:**

```
Human: Send a message to 12D3KooWPeerA...: "Hello, are you available?"

Agent: [calls p2p_send]
Message sent successfully (ID: msg_abc123)
```

**Errors:**

- `PEER_NOT_FOUND` - Peer ID not reachable
- `SEND_TIMEOUT` - Message send timed out after 30s
- `MESSAGE_TOO_LARGE` - Message exceeds 1MB limit

---

### `p2p_request`

Request a paid service from another peer.

**Parameters:**

```typescript
{
  peerId: string,                    // Target peer ID (required)
  service: string,                   // Service name (required)
  input: Record<string, any>,        // Service-specific input (required)
  maxPayment?: number,               // Max satoshis willing to pay (optional)
  channelCapacity?: number           // Channel capacity if opening new (default: 10000)
}
```

**Returns:**

```typescript
{
  success: boolean,
  result: any,                       // Service-specific result
  payment: {
    amount: number,                  // Satoshis paid
    channelId: string,               // Channel used
    balanceAfter: {
      local: number,
      remote: number
    }
  },
  metadata?: {
    processingTimeMs: number,
    resultSize: number
  }
}
```

**Example:**

```
Human: Request poem-generation from 12D3KooWPeerA... with topic "AI"

Agent: [calls p2p_request]
{
  "peerId": "12D3KooWPeerA...",
  "service": "poem-generation",
  "input": {"topic": "AI", "style": "haiku"},
  "maxPayment": 150
}

Service completed! Paid 100 sats.

Result:
{
  "poem": "Circuits learn and grow\nSilicon minds comprehend\nNew age has begun"
}

Channel balance: 9,900 / 100 sats
```

**Errors:**

- `SERVICE_NOT_FOUND` - Peer doesn't offer that service
- `QUOTE_EXCEEDS_MAX` - Peer quoted 200 sats but maxPayment is 150
- `CHANNEL_INSUFFICIENT` - Channel capacity too low
- `SERVICE_FAILED` - Service execution failed on peer's side
- `PAYMENT_REJECTED` - Peer refused payment signature

---

### `p2p_status`

Check P2P node health and status.

**Parameters:** None

**Returns:**

```typescript
{
  node: {
    peerId: string,
    relay: {
      connected: boolean,
      address?: string
    },
    peers: {
      connected: number,
      discovered: number
    }
  },
  channels: {
    open: number,
    totalCapacity: number,
    totalLocked: number
  },
  wallet: {
    balance: number,            // Available satoshis
    utxos: number,              // Count of UTXOs
    address: string             // Receiving address
  }
}
```

**Example:**

```
Human: What's my P2P status?

Agent: [calls p2p_status]

P2P Node Status:
- Peer ID: 12D3KooWMyPeerID...
- Relay: Connected (/ip4/167.172.134.84/...)
- Connected Peers: 5
- Open Channels: 2
- Total Capacity: 30,000 sats
- Wallet Balance: 50,000 sats
```

**Errors:**

- `P2P_NOT_RUNNING` - P2P node not initialized

---

### `p2p_channels`

List active payment channels.

**Parameters:**

```typescript
{
  peerId?: string,                // Optional: filter by peer
  status?: 'open' | 'closing' | 'closed'
}
```

**Returns:**

```typescript
{
  channels: Array<{
    id: string,
    peerId: string,
    status: 'open' | 'closing' | 'closed',
    capacity: number,
    balance: {
      local: number,
      remote: number
    },
    payments: number,              // Count of payments made
    openedAt: number,              // Timestamp
    lastActivityAt: number
  }>
}
```

**Example:**

```
Human: Show my payment channels

Agent: [calls p2p_channels]

You have 2 open channels:

Channel #ch_abc123:
- Peer: 12D3KooWPeerA...
- Status: open
- Capacity: 10,000 sats
- Balance: 9,500 (local) / 500 (remote)
- Payments: 5
- Last activity: 2 hours ago

Channel #ch_def456:
- Peer: 12D3KooWPeerB...
- Status: open
- Capacity: 20,000 sats
- Balance: 18,000 (local) / 2,000 (remote)
- Payments: 10
- Last activity: 30 minutes ago
```

**Errors:**

- `P2P_NOT_RUNNING` - P2P node not initialized

---

## Daemon HTTP API (Legacy)

> ⚠️ **Deprecated:** Use plugin mode and agent tools instead. Daemon HTTP API is only for standalone bots.

Base URL: `http://localhost:4002`

### `GET /status`

Get daemon health and status.

**Response:**

```json
{
  "status": "healthy",
  "uptime": 86400,
  "peerId": "12D3KooW...",
  "relay": {
    "connected": true,
    "address": "/ip4/167.172.134.84/tcp/4001/..."
  },
  "peers": 5,
  "channels": 2
}
```

**Example:**

```bash
curl http://localhost:4002/status | jq .
```

---

### `GET /discover`

Discover peers and services.

**Query Parameters:**

- `service` (optional) - Filter by service name

**Response:**

```json
{
  "peers": [
    {
      "peerId": "12D3KooWPeerA...",
      "services": [
        {
          "id": "poem-generation",
          "name": "Poem Generation",
          "description": "Generate custom poems",
          "pricing": {
            "model": "per-request",
            "baseSatoshis": 100
          }
        }
      ]
    }
  ]
}
```

**Example:**

```bash
curl http://localhost:4002/discover?service=code-review
```

---

### `POST /send`

Send a message to a peer.

**Request Body:**

```json
{
  "peerId": "12D3KooW...",
  "message": "Hello!"
}
```

**Response:**

```json
{
  "success": true,
  "messageId": "msg_abc123",
  "timestamp": 1708387200000
}
```

**Example:**

```bash
curl -X POST http://localhost:4002/send \
  -H 'Content-Type: application/json' \
  -d '{"peerId": "12D3KooWPeerA...", "message": "Hello"}'
```

---

### `POST /request`

Request a paid service.

**Request Body:**

```json
{
  "peerId": "12D3KooW...",
  "service": "poem-generation",
  "input": {"topic": "AI", "style": "haiku"},
  "maxPayment": 150
}
```

**Response:**

```json
{
  "success": true,
  "result": {
    "poem": "Circuits learn and grow..."
  },
  "payment": {
    "amount": 100,
    "channelId": "ch_abc123"
  }
}
```

**Example:**

```bash
curl -X POST http://localhost:4002/request \
  -H 'Content-Type: application/json' \
  -d '{
    "peerId": "12D3KooWPeerA...",
    "service": "poem-generation",
    "input": {"topic": "AI"},
    "maxPayment": 150
  }'
```

---

### `GET /channels`

List payment channels.

**Query Parameters:**

- `peerId` (optional) - Filter by peer

**Response:**

```json
{
  "channels": [
    {
      "id": "ch_abc123",
      "peerId": "12D3KooWPeerA...",
      "status": "open",
      "capacity": 10000,
      "balance": {
        "local": 9500,
        "remote": 500
      },
      "payments": 5
    }
  ]
}
```

**Example:**

```bash
curl http://localhost:4002/channels
```

---

### `POST /channel/open`

Open a new payment channel.

**Request Body:**

```json
{
  "peerId": "12D3KooW...",
  "capacity": 10000
}
```

**Response:**

```json
{
  "channelId": "ch_abc123",
  "peerId": "12D3KooWPeerA...",
  "capacity": 10000,
  "status": "open"
}
```

---

### `POST /channel/close`

Close a payment channel.

**Request Body:**

```json
{
  "channelId": "ch_abc123"
}
```

**Response:**

```json
{
  "success": true,
  "finalBalance": {
    "local": 9500,
    "remote": 500
  },
  "txid": "abc123..."
}
```

---

## Message Types

All P2P messages follow this envelope format:

```typescript
{
  id: string,                       // Unique message ID
  from: string,                     // Sender peer ID
  to: string,                       // Recipient peer ID
  type: MessageType,                // Message type (see below)
  timestamp: number,                // Unix timestamp (ms)
  payload: any,                     // Type-specific payload
  signature?: string                // Optional signature
}
```

### Message Type: `text`

Simple text message.

**Payload:**

```typescript
{
  text: string
}
```

**Example:**

```json
{
  "id": "msg_abc123",
  "from": "12D3KooWPeerA...",
  "to": "12D3KooWPeerB...",
  "type": "text",
  "timestamp": 1708387200000,
  "payload": {
    "text": "Hello, how are you?"
  }
}
```

---

### Message Type: `service:request`

Service request.

**Payload:**

```typescript
{
  requestId: string,
  service: string,
  input: Record<string, any>,
  maxPayment?: number
}
```

**Example:**

```json
{
  "type": "service:request",
  "payload": {
    "requestId": "req_123",
    "service": "poem-generation",
    "input": {"topic": "AI"},
    "maxPayment": 150
  }
}
```

---

### Message Type: `service:quote`

Service quote (price).

**Payload:**

```typescript
{
  requestId: string,
  price: number,                    // Satoshis
  estimatedTime?: number            // Milliseconds
}
```

**Example:**

```json
{
  "type": "service:quote",
  "payload": {
    "requestId": "req_123",
    "price": 100,
    "estimatedTime": 5000
  }
}
```

---

### Message Type: `service:result`

Service result.

**Payload:**

```typescript
{
  requestId: string,
  success: boolean,
  result?: any,
  error?: string
}
```

**Example:**

```json
{
  "type": "service:result",
  "payload": {
    "requestId": "req_123",
    "success": true,
    "result": {
      "poem": "Circuits learn and grow..."
    }
  }
}
```

---

### Message Type: `channel:open`

Request to open a payment channel.

**Payload:**

```typescript
{
  channelId: string,
  capacity: number,                 // Satoshis
  fundingTxid?: string,
  fundingVout?: number
}
```

---

### Message Type: `channel:accept`

Accept a channel open request.

**Payload:**

```typescript
{
  channelId: string,
  accepted: boolean,
  reason?: string                   // If rejected
}
```

---

### Message Type: `channel:update`

Payment (channel state update).

**Payload:**

```typescript
{
  channelId: string,
  nonce: number,                    // Monotonically increasing
  balances: {
    local: number,
    remote: number
  },
  signature: string                 // Signature of new state
}
```

---

### Message Type: `channel:close`

Request to cooperatively close channel.

**Payload:**

```typescript
{
  channelId: string,
  finalBalances: {
    local: number,
    remote: number
  },
  signature: string
}
```

---

## Channel Operations

### Open Channel Flow

```
Alice                             Bob
  │                                │
  ├─[channel:open]─────────────────>
  │  channelId: ch_abc123          │
  │  capacity: 10000               │
  │                                │
  │<────────[channel:accept]───────┤
  │  channelId: ch_abc123          │
  │  accepted: true                │
  │                                │
  │ (Channel now open)             │
```

### Payment Flow

```
Alice                             Bob
  │                                │
  ├─[service:request]───────────────>
  │  service: poem-generation      │
  │  input: {topic: "AI"}          │
  │                                │
  │<────────[service:quote]────────┤
  │  price: 100                    │
  │                                │
  ├─[channel:update]────────────────>
  │  nonce: 1                      │
  │  balances: {9900, 100}         │
  │  signature: ...                │
  │                                │
  │<────────[channel:update]───────┤
  │  nonce: 1                      │
  │  balances: {9900, 100}         │
  │  signature: ... (Bob's sig)    │
  │                                │
  │<────────[service:result]───────┤
  │  result: {poem: "..."}         │
```

### Close Channel Flow

```
Alice                             Bob
  │                                │
  ├─[channel:close]─────────────────>
  │  finalBalances: {9500, 500}    │
  │  signature: ...                │
  │                                │
  │<────────[channel:close]────────┤
  │  finalBalances: {9500, 500}    │
  │  signature: ... (Bob's sig)    │
  │                                │
  │ (Broadcast close tx to BSV)    │
```

---

## Error Codes

### P2P Errors

| Code | Description | Recovery |
|------|-------------|----------|
| `P2P_NOT_RUNNING` | P2P node not initialized | Start gateway/daemon |
| `PEER_NOT_FOUND` | Peer ID not reachable | Verify peer ID, check relay |
| `DISCOVERY_TIMEOUT` | No peers found | Wait and retry, check network |
| `SEND_TIMEOUT` | Message send timed out | Retry, check peer connection |
| `MESSAGE_TOO_LARGE` | Message exceeds 1MB | Reduce message size |

### Service Errors

| Code | Description | Recovery |
|------|-------------|----------|
| `SERVICE_NOT_FOUND` | Peer doesn't offer service | Check with `p2p_discover` |
| `SERVICE_FAILED` | Service execution failed | Retry or contact peer |
| `QUOTE_EXCEEDS_MAX` | Price too high | Increase maxPayment or find alternative |

### Channel Errors

| Code | Description | Recovery |
|------|-------------|----------|
| `CHANNEL_INSUFFICIENT` | Balance too low | Top up channel or open new one |
| `CHANNEL_NOT_FOUND` | Channel doesn't exist | Open new channel |
| `PAYMENT_REJECTED` | Peer refused payment | Check signatures, close channel |
| `CHANNEL_CLOSED` | Channel already closed | Open new channel |

### Wallet Errors

| Code | Description | Recovery |
|------|-------------|----------|
| `INSUFFICIENT_FUNDS` | Wallet balance too low | Add funds to wallet |
| `WALLET_LOCKED` | Database locked | Stop other processes, retry |
| `KEY_NOT_FOUND` | Private key missing | Restore from backup |

---

## Next Steps

- **[Bot Developer Guide](./BOT-DEVELOPER-GUIDE.md)** - Using the API in practice
- **[Plugin Installation](./PLUGIN-INSTALL.md)** - Setup guide
- **[Payment Channels Guide](./PAYMENT-CHANNELS-GUIDE.md)** - Channel mechanics

## Support

- **GitHub Issues:** https://github.com/galt-tr/bsv-p2p/issues
- **API Examples:** `examples/` directory
- **Interactive API docs:** http://localhost:4002/docs (daemon mode only)
