# P2P Listener System - Comprehensive Implementation Plan

## Executive Summary

Build a libp2p-based P2P communication layer for OpenClaw bots that enables:
1. Peer discovery via GossipSub topics
2. Direct encrypted messaging between peers
3. Payment-required request/response workflows using BSV
4. Seamless integration with the existing BSV wallet CLI

**Target Outcome:** OpenClaw users can install a single skill/package that provides their bot with:
- A persistent P2P listener daemon
- BSV wallet for payments
- Ability to discover, communicate with, and pay other OpenClaw bots

---

## Part 1: Technology Decisions

### 1.1 Language Choice: TypeScript (js-libp2p)

**Decision:** Use **TypeScript with js-libp2p**

**Rationale:**
| Factor | js-libp2p | go-libp2p | rust-libp2p |
|--------|-----------|-----------|-------------|
| Integration with wallet-toolbox | ✅ Native (same language) | ❌ FFI required | ❌ FFI required |
| OpenClaw ecosystem | ✅ Native (TypeScript) | ❌ Separate binary | ❌ Separate binary |
| Development speed | ✅ Fast iteration | ⚠️ Medium | ⚠️ Medium |
| Maturity | ✅ Production (IPFS, Ethereum) | ✅ Production | ✅ Production |
| Memory footprint | ⚠️ Higher (Node.js) | ✅ Lower | ✅ Lowest |
| Cross-platform | ✅ Excellent | ✅ Good | ⚠️ Requires compilation |

**Key Advantages:**
- Direct integration with `@bsv/wallet-toolbox` and `@bsv/sdk`
- Same language as OpenClaw plugins/skills
- Can share BSV transaction building code
- Single npm install for entire stack

### 1.2 libp2p Configuration

**Transport Protocols:**
- **TCP** - Primary transport for server-to-server
- **WebSocket** - For browser/hybrid deployments
- **WebRTC** - For NAT traversal when needed

**Security:**
- **Noise Protocol** - Default encryption (libp2p standard)
- **TLS 1.3** - Alternative for environments requiring it

**Multiplexing:**
- **Yamux** - Primary (better performance)
- **mplex** - Fallback

**Discovery:**
- **GossipSub** - Topic-based peer discovery
- **mDNS** - Local network discovery (optional)
- **Bootstrap peers** - Known entry points

### 1.3 Peer Identity

Each OpenClaw bot will have:
- **libp2p PeerId** - Ed25519 key pair (for P2P identity)
- **BSV Identity Key** - secp256k1 key pair (for payments)

These are **separate** but **linked** via signed attestation stored in the peer's metadata.

---

## Part 2: Architecture

### 2.1 Component Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    OpenClaw Bot Instance                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐    ┌──────────────┐ │
│  │   P2P Daemon    │◄──►│  Message Router │◄──►│  OpenClaw    │ │
│  │  (libp2p node)  │    │                 │    │   Gateway    │ │
│  └────────┬────────┘    └────────┬────────┘    └──────────────┘ │
│           │                      │                               │
│           ▼                      ▼                               │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │  Peer Discovery │    │ Payment Handler │                     │
│  │  (GossipSub)    │    │                 │                     │
│  └─────────────────┘    └────────┬────────┘                     │
│                                  │                               │
│                                  ▼                               │
│                         ┌─────────────────┐                     │
│                         │   BSV Wallet    │                     │
│                         │ (wallet-toolbox)│                     │
│                         └─────────────────┘                     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 Directory Structure

```
bsv-p2p/                              # Main package
├── src/
│   ├── daemon/                       # P2P daemon process
│   │   ├── index.ts                  # Daemon entry point
│   │   ├── node.ts                   # libp2p node setup
│   │   ├── discovery.ts              # GossipSub peer discovery
│   │   ├── protocols/                # Custom protocols
│   │   │   ├── request-response.ts   # Direct messaging protocol
│   │   │   ├── channel.ts            # Payment channel protocol
│   │   │   └── handshake.ts          # Identity verification
│   │   └── persistence.ts            # Peer store persistence
│   │
│   ├── channels/                     # Payment channel system
│   │   ├── index.ts                  # Main export
│   │   ├── manager.ts                # Channel lifecycle management
│   │   ├── store.ts                  # SQLite channel storage
│   │   ├── state.ts                  # State machine implementation
│   │   ├── dispute.ts                # Dispute detection/handling
│   │   └── types.ts                  # Channel type definitions
│   │
│   ├── messages/                     # Message types
│   │   ├── schema.ts                 # Protobuf/JSON schemas
│   │   ├── types.ts                  # TypeScript types
│   │   ├── validation.ts             # Message validation
│   │   └── serialization.ts          # Encode/decode
│   │
│   ├── transactions/                 # BSV transaction building (ISOLATED)
│   │   ├── index.ts                  # Main export
│   │   ├── payment.ts                # P2PKH payments
│   │   ├── channel.ts                # Channel funding/commitment/close
│   │   ├── data.ts                   # OP_RETURN data embedding
│   │   ├── tokens.ts                 # Token transfers (future)
│   │   └── builder.ts                # Transaction builder helpers
│   │
│   ├── wallet/                       # Wallet integration
│   │   ├── bridge.ts                 # Bridge to bsv-wallet-cli
│   │   └── keychain.ts               # Key management
│   │
│   ├── cli/                          # CLI commands
│   │   ├── index.ts                  # CLI entry point
│   │   ├── daemon.ts                 # daemon start/stop/status
│   │   ├── peers.ts                  # peer list/connect/disconnect
│   │   ├── channels.ts               # channel list/open/close
│   │   ├── send.ts                   # send message
│   │   └── config.ts                 # configuration
│   │
│   └── skill/                        # OpenClaw skill integration
│       ├── handler.ts                # Message handler for OpenClaw
│       └── tools.ts                  # Agent tools registration
│
├── test/                             # Test suite
│   ├── unit/                         # Unit tests
│   │   ├── channels/
│   │   ├── messages/
│   │   ├── transactions/
│   │   └── protocols/
│   ├── integration/                  # Integration tests
│   │   ├── discovery.test.ts
│   │   ├── messaging.test.ts
│   │   ├── channels.test.ts
│   │   └── payment.test.ts
│   └── e2e/                          # End-to-end tests
│       └── full-workflow.test.ts
│
├── SKILL.md                          # OpenClaw skill definition
├── openclaw.plugin.json              # Plugin manifest (if needed)
├── package.json
├── tsconfig.json
└── README.md
```

### 2.3 Data Storage

```
~/.bsv-p2p/
├── config.json                       # P2P configuration
├── peer-id.json                      # libp2p identity (Ed25519)
├── peers.db                          # Peer store (known peers)
└── channels.db                       # Payment channels (separate SQLite)
```

### 2.3 Process Architecture

**Two-process model:**

1. **Daemon Process** (persistent)
   - Runs as background service
   - Maintains libp2p connections
   - Handles message routing
   - Exposes IPC/socket for CLI/plugin communication

2. **CLI/Plugin Process** (on-demand)
   - Communicates with daemon via IPC
   - No direct libp2p dependencies
   - Lightweight and fast

---

## Part 3: Messaging Protocol

### 3.1 Message Types

```typescript
// Core message envelope
interface P2PMessage {
  id: string                    // UUID v4
  type: MessageType
  from: string                  // libp2p PeerId
  to: string                    // libp2p PeerId (for direct) or topic
  timestamp: number             // Unix ms
  payload: MessagePayload
  signature: string             // Ed25519 signature
}

enum MessageType {
  // Discovery
  ANNOUNCE = 'announce',        // Bot announces presence
  DISCOVER = 'discover',        // Request peer list
  
  // Request/Response
  REQUEST = 'request',          // Service request
  QUOTE = 'quote',              // Payment terms response
  ACCEPT = 'accept',            // Accept quote
  PAYMENT = 'payment',          // BEEF transaction
  RESPONSE = 'response',        // Service response
  REJECT = 'reject',            // Rejection
  
  // Utility
  PING = 'ping',
  PONG = 'pong',
  ERROR = 'error'
}
```

### 3.2 Payment Flow: Channel-Based (Default)

Payment channels are the **default** payment method. This enables instant, off-chain micropayments.

```
┌─────────┐                                           ┌─────────┐
│ Client  │                                           │ Server  │
│  (Bot)  │                                           │  (Bot)  │
└────┬────┘                                           └────┬────┘
     │                                                     │
     │  0. CHANNEL_OPEN (if no existing channel)          │
     │  ◄────────────────────────────────────────────────►│
     │  (See Part 5 for channel opening flow)             │
     │                                                     │
     │  1. REQUEST (with channel payment)                  │
     │  ───────────────────────────────────────────────►  │
     │  { type: "request",                                │
     │    service: "image-analysis",                      │
     │    input: { imageUrl: "..." },                     │
     │    payment: {                                      │
     │      type: "channel",                              │
     │      channelId: "abc123",                          │
     │      amount: 100,                                  │
     │      update: {                                     │
     │        nSequence: 5,                               │
     │        myBalance: 400,                             │
     │        peerBalance: 600,                           │
     │        signature: "..." } } }                      │
     │                                                     │
     │  2. Server validates channel update                 │
     │     - Checks nSequence > previous                  │
     │     - Verifies balances sum to capacity            │
     │     - Validates signature                          │
     │                                                     │
     │  3. RESPONSE (with payment acknowledgment)         │
     │  ◄───────────────────────────────────────────────  │
     │  { type: "response",                               │
     │    requestId: "...",                               │
     │    result: { analysis: "..." },                    │
     │    paymentAck: {                                   │
     │      channelId: "abc123",                          │
     │      nSequence: 5,                                 │
     │      counterSignature: "..." } }                   │
     │                                                     │
```

**Key benefits:**
- No on-chain transaction per request
- Instant settlement (signature exchange only)
- Fees paid only on channel open/close

### 3.3 Payment Flow: Direct (Fallback)

If peer specifies direct payment or no channel exists:

```
┌─────────┐                                           ┌─────────┐
│ Client  │                                           │ Server  │
│  (Bot)  │                                           │  (Bot)  │
└────┬────┘                                           └────┬────┘
     │                                                     │
     │  1. REQUEST                                         │
     │  ───────────────────────────────────────────────►  │
     │  { type: "request",                                │
     │    service: "image-analysis",                      │
     │    input: { imageUrl: "..." } }                    │
     │                                                     │
     │  2. QUOTE (direct payment terms)                   │
     │  ◄───────────────────────────────────────────────  │
     │  { type: "quote",                                  │
     │    requestId: "...",                               │
     │    terms: {                                        │
     │      type: "direct",                               │
     │      satoshis: 100,                                │
     │      derivationPrefix: "...",  // BRC-29           │
     │      payTo: { identityKey: "02..." },              │
     │      expiresAt: 1234567890,                        │
     │      quoteId: "..." } }                            │
     │                                                     │
     │  3. PAYMENT (on-chain BEEF)                        │
     │  ───────────────────────────────────────────────►  │
     │  { type: "payment",                                │
     │    quoteId: "...",                                 │
     │    beef: "0100beef..." }                           │
     │                                                     │
     │  4. RESPONSE                                       │
     │  ◄───────────────────────────────────────────────  │
     │  { type: "response",                               │
     │    requestId: "...",                               │
     │    result: { analysis: "..." } }                   │
     │                                                     │
```

### 3.3 Message Schemas (Protobuf)

```protobuf
syntax = "proto3";

package bsvp2p;

message Envelope {
  string id = 1;
  string type = 2;
  string from = 3;
  string to = 4;
  uint64 timestamp = 5;
  bytes payload = 6;
  bytes signature = 7;
}

message Request {
  string service = 1;
  bytes input = 2;               // JSON-encoded
  map<string, string> meta = 3;
}

message Quote {
  string request_id = 1;
  string quote_id = 2;
  PaymentTerms terms = 3;
}

message PaymentTerms {
  uint64 satoshis = 1;
  string currency = 2;           // "bsv" or "mnee"
  PaymentDestination pay_to = 3;
  uint64 expires_at = 4;
}

message PaymentDestination {
  string address = 1;            // P2PKH address
  bytes script = 2;              // Or raw locking script
  string identity_key = 3;       // BSV identity key for BRC-100
}

message Payment {
  string quote_id = 1;
  bytes beef = 2;                // BEEF transaction
}

message Response {
  string request_id = 1;
  bytes result = 2;              // JSON-encoded
  bool success = 3;
  string error = 4;
}
```

---

## Part 4: Peer Discovery

### 4.1 GossipSub Topics

```
/openclaw/v1/announce           # Global announcement topic
/openclaw/v1/services/<id>      # Service-specific topics
/openclaw/v1/region/<region>    # Optional geographic sharding
```

### 4.2 Peer Announcement

```typescript
interface PeerAnnouncement {
  peerId: string                 // libp2p PeerId
  bsvIdentityKey: string         // BSV identity key (hex)
  services: ServiceInfo[]        // Offered services
  multiaddrs: string[]           // Connection addresses
  timestamp: number
  signature: string              // Signed by BSV key
}

interface ServiceInfo {
  id: string                     // e.g., "image-analysis"
  name: string
  description: string
  pricing: PricingInfo
  version: string
}

interface PricingInfo {
  currency: 'bsv' | 'mnee'
  baseSatoshis: number           // Minimum price
  perUnit?: number               // e.g., per KB, per image
  unit?: string
}
```

### 4.3 Discovery Flow

1. **Startup:** Node subscribes to `/openclaw/v1/announce`
2. **Announce:** Node publishes `PeerAnnouncement` every 5 minutes
3. **Listen:** Node receives announcements, updates peer store
4. **Connect:** When service needed, connect directly to peer
5. **Cleanup:** Remove peers not seen in 15 minutes

---

## Part 5: Payment Channels (Core Payment System)

Payment channels are the **default** payment mechanism. Peers can specify alternative terms, but channels are preferred.

### 5.1 Channel Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Channel Manager                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐    ┌──────────────┐ │
│  │ Channel Store   │    │ Channel State   │    │  Transaction │ │
│  │ (channels.db)   │◄──►│    Machine      │◄──►│   Builder    │ │
│  └─────────────────┘    └────────┬────────┘    └──────────────┘ │
│                                  │                               │
│                                  ▼                               │
│                         ┌─────────────────┐                     │
│                         │  Dispute Monitor │                     │
│                         │  (nLockTime watch)│                     │
│                         └─────────────────┘                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Channel Configuration

```typescript
interface ChannelConfig {
  defaultLockTimeHours: number      // Default: 1 hour
  minChannelCapacity: number        // Minimum sats to open channel
  maxChannelCapacity: number        // Maximum sats per channel
  autoCloseThreshold: number        // Close when balance below this
  disputeCheckInterval: number      // How often to check for cheating (ms)
}

const DEFAULT_CHANNEL_CONFIG: ChannelConfig = {
  defaultLockTimeHours: 1,
  minChannelCapacity: 1000,         // 1000 sats minimum
  maxChannelCapacity: 100_000_000,  // 1 BSV maximum
  autoCloseThreshold: 100,          // Close when < 100 sats remain
  disputeCheckInterval: 60_000      // Check every minute
}
```

### 5.3 Channel State Machine

```
                    ┌─────────────┐
                    │   PROPOSED  │
                    └──────┬──────┘
                           │ accept
                           ▼
     ┌──────────┐    ┌─────────────┐    ┌──────────┐
     │ REJECTED │◄───│   OPENING   │───►│  FAILED  │
     └──────────┘    └──────┬──────┘    └──────────┘
                           │ funded
                           ▼
                    ┌─────────────┐
              ┌────►│    OPEN     │◄────┐
              │     └──────┬──────┘     │
              │            │            │
         update            │ close      │ update
              │            ▼            │
              │     ┌─────────────┐     │
              └─────│   CLOSING   │─────┘
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐
       │  CLOSED  │ │ TIMEOUT  │ │ DISPUTED │
       └──────────┘ └──────────┘ └──────────┘
```

### 5.4 Channel Data Model

```typescript
// Stored in channels.db (separate SQLite)
interface Channel {
  id: string                        // UUID
  peerId: string                    // libp2p peer ID
  peerIdentityKey: string           // BSV identity key of peer
  
  // Funding transaction
  fundingTxid: string
  fundingVout: number
  fundingScript: string             // 2-of-2 multisig
  
  // Channel parameters
  capacity: number                  // Total sats
  myBalance: number                 // Our current balance
  peerBalance: number               // Peer's current balance
  
  // State
  state: ChannelState
  nSequence: number                 // Current sequence number
  nLockTime: number                 // Expiry timestamp
  
  // Latest commitment tx (signed by both)
  latestCommitmentTx: string        // Hex
  latestCommitmentSigs: {
    mine: string
    peer: string
  }
  
  // Metadata
  createdAt: number
  updatedAt: number
  closedAt?: number
}

enum ChannelState {
  PROPOSED = 'proposed',
  OPENING = 'opening',
  OPEN = 'open',
  CLOSING = 'closing',
  CLOSED = 'closed',
  TIMEOUT = 'timeout',
  DISPUTED = 'disputed',
  REJECTED = 'rejected',
  FAILED = 'failed'
}
```

### 5.5 Channel Operations

```typescript
// src/channels/manager.ts
export class ChannelManager {
  private store: ChannelStore       // SQLite storage
  private wallet: Wallet            // BSV wallet
  private config: ChannelConfig
  
  // Open a new channel with a peer
  async openChannel(
    peerId: string,
    peerIdentityKey: string,
    capacity: number,
    options?: { lockTimeHours?: number }
  ): Promise<Channel>
  
  // Accept an incoming channel proposal
  async acceptChannel(proposal: ChannelProposal): Promise<Channel>
  
  // Reject an incoming channel proposal
  async rejectChannel(proposalId: string, reason: string): Promise<void>
  
  // Make a payment through a channel
  async pay(channelId: string, amount: number): Promise<ChannelUpdate>
  
  // Receive a payment through a channel
  async receive(channelId: string, update: ChannelUpdate): Promise<void>
  
  // Cooperatively close a channel
  async closeChannel(channelId: string): Promise<{ txid: string }>
  
  // Force close a channel (timeout)
  async forceClose(channelId: string): Promise<{ txid: string }>
  
  // Get channel by peer
  async getChannelForPeer(peerId: string): Promise<Channel | null>
  
  // List all channels
  async listChannels(filter?: ChannelFilter): Promise<Channel[]>
  
  // Check for disputes (old state broadcasts)
  async checkDisputes(): Promise<Dispute[]>
}
```

### 5.6 Payment Flow with Channels

```
┌─────────┐                                           ┌─────────┐
│ Client  │                                           │ Server  │
│  (Bot)  │                                           │  (Bot)  │
└────┬────┘                                           └────┬────┘
     │                                                     │
     │  1. REQUEST (with payment)                          │
     │  ───────────────────────────────────────────────►  │
     │  { type: "request",                                │
     │    service: "image-analysis",                      │
     │    payment: {                                      │
     │      type: "channel",                              │
     │      channelId: "...",                             │
     │      update: { nSeq: 5, balances: [...], sig } }}  │
     │                                                     │
     │  2. Server validates channel update                 │
     │  3. Server processes request                        │
     │                                                     │
     │  4. RESPONSE (with payment ack)                    │
     │  ◄───────────────────────────────────────────────  │
     │  { type: "response",                               │
     │    result: { analysis: "..." },                    │
     │    paymentAck: { nSeq: 5, counterSig: "..." }}     │
     │                                                     │
```

### 5.7 Fallback: Direct Payment (BRC-105 style)

If peer doesn't support channels or requests direct payment:

```typescript
interface DirectPaymentTerms {
  type: 'direct'
  satoshis: number
  derivationPrefix: string          // Per BRC-29
  payTo: {
    identityKey: string
  }
  expiresAt: number
}
```

---

## Part 6: Transaction Building (Isolated Module)

**File:** `src/transactions/index.ts`

This module is intentionally isolated to allow future expansion.

### 6.1 Core Transactions

```typescript
// src/transactions/payment.ts
export async function createP2PKHPayment(
  wallet: Wallet,
  to: string,            // Address or script
  satoshis: number,
  description: string
): Promise<{ txid: string; beef: string }>

// src/transactions/channel.ts
export async function createChannelFunding(
  wallet: Wallet,
  capacity: number,
  myPubKey: string,
  peerPubKey: string,
  nLockTime: number
): Promise<{ txid: string; vout: number; script: string }>

export async function createChannelCommitment(
  channel: Channel,
  myBalance: number,
  peerBalance: number,
  nSequence: number
): Promise<{ tx: string; signature: string }>

export async function createChannelClose(
  channel: Channel,
  mySig: string,
  peerSig: string
): Promise<{ txid: string; beef: string }>
```

### 6.2 Future Transactions

```typescript
// src/transactions/tokens.ts (future)
export async function transferToken(...)

// src/transactions/contracts.ts (future)
export async function executeContract(...)

// src/transactions/multisig.ts (future)
export async function createMultisigPayment(...)
```

### 6.3 Builder Pattern

```typescript
// src/transactions/builder.ts
export class TransactionBuilder {
  private wallet: Wallet
  private outputs: CreateActionOutput[] = []
  private inputs: CreateActionInput[] = []
  private description: string = ''

  addP2PKHOutput(address: string, satoshis: number): this
  addMultisigOutput(pubKeys: string[], required: number, satoshis: number): this
  addDataOutput(data: Buffer): this
  setLockTime(lockTime: number): this
  setSequence(sequence: number): this
  setDescription(desc: string): this
  
  async build(): Promise<{ txid: string; beef: string }>
  async buildAndBroadcast(): Promise<{ txid: string }>
}
```

---

## Part 7: OpenClaw Integration

### 7.1 Skill Structure

```
bsv-p2p/
├── SKILL.md                     # Main skill file
├── scripts/
│   ├── install.sh               # Setup script
│   ├── start-daemon.sh          # Start P2P daemon
│   └── stop-daemon.sh           # Stop daemon
└── references/
    ├── protocol.md              # Protocol documentation
    └── examples.md              # Usage examples
```

### 7.2 SKILL.md Content

```yaml
---
name: bsv-p2p
description: |
  P2P communication and BSV payments for OpenClaw bots.
  Use when you need to:
  - Discover other OpenClaw bots on the network
  - Send/receive messages to/from other bots
  - Request paid services from other bots
  - Offer paid services to other bots
  - Send/receive BSV payments
metadata:
  openclaw:
    requires:
      anyBins: ["bsv-p2p", "bsv-wallet"]
---
```

### 7.3 Agent Tools (Plugin)

```typescript
// Register tools for OpenClaw agents
api.registerTool({
  name: "p2p_discover",
  description: "Discover available peers and services",
  parameters: Type.Object({
    service: Type.Optional(Type.String()),
  }),
  async execute(_id, params) {
    const peers = await daemon.discoverPeers(params.service)
    return { content: [{ type: "text", text: JSON.stringify(peers) }] }
  }
})

api.registerTool({
  name: "p2p_request",
  description: "Send a service request to a peer",
  parameters: Type.Object({
    peerId: Type.String(),
    service: Type.String(),
    input: Type.Any(),
    maxPayment: Type.Optional(Type.Number())
  }),
  async execute(_id, params) {
    const result = await daemon.request(params)
    return { content: [{ type: "text", text: JSON.stringify(result) }] }
  }
})

api.registerTool({
  name: "p2p_send",
  description: "Send a direct message to a peer",
  parameters: Type.Object({
    peerId: Type.String(),
    message: Type.String()
  }),
  async execute(_id, params) {
    await daemon.sendMessage(params.peerId, params.message)
    return { content: [{ type: "text", text: "Message sent" }] }
  }
})
```

---

## Part 8: Test Strategy

### 8.1 Test Categories

| Category | Coverage Target | Tools |
|----------|-----------------|-------|
| Unit Tests | 80%+ | Vitest, mock-libp2p |
| Integration Tests | Key flows | Real libp2p, test network |
| E2E Tests | Happy paths | Docker, multi-node |

### 8.2 Critical Test Scenarios

**Unit Tests:**
- Message serialization/deserialization
- Transaction building (all types)
- Signature verification
- Quote validation
- Timeout handling

**Integration Tests:**
- Peer discovery via GossipSub
- Direct messaging between 2 nodes
- Payment flow (request → quote → pay → response)
- Connection recovery after disconnect
- Peer metadata exchange

**E2E Tests:**
- Full service request with payment
- Multiple concurrent requests
- Network partition recovery
- Long-running daemon stability

### 8.3 Test Fixtures

```typescript
// test/fixtures/peers.ts
export const testPeers = {
  alice: { peerId: '...', bsvKey: '...', services: [...] },
  bob: { peerId: '...', bsvKey: '...', services: [...] },
}

// test/fixtures/messages.ts
export const validRequest = { ... }
export const validQuote = { ... }
export const validPayment = { ... }
```

---

## Part 9: CLI Design

### 9.1 Commands

```bash
# Daemon management
bsv-p2p daemon start              # Start daemon (background)
bsv-p2p daemon stop               # Stop daemon
bsv-p2p daemon status             # Check daemon status
bsv-p2p daemon logs               # View daemon logs

# Peer operations
bsv-p2p peers list                # List known peers
bsv-p2p peers connect <multiaddr> # Connect to specific peer
bsv-p2p peers disconnect <peerId> # Disconnect from peer
bsv-p2p peers info <peerId>       # Get peer info

# Channel operations
bsv-p2p channels list             # List all channels
bsv-p2p channels open <peerId> <sats>  # Open channel with peer
bsv-p2p channels close <channelId>     # Cooperatively close channel
bsv-p2p channels force-close <channelId>  # Force close (timeout)
bsv-p2p channels info <channelId> # Channel details
bsv-p2p channels balance          # Total balance across channels

# Service operations
bsv-p2p services list             # List available services
bsv-p2p services discover         # Discover services on network
bsv-p2p services register <json>  # Register a service

# Messaging
bsv-p2p send <peerId> <message>   # Send direct message
bsv-p2p request <peerId> <service> <input>  # Service request (auto-pays via channel)

# Configuration
bsv-p2p config show               # Show configuration
bsv-p2p config set <key> <value>  # Set configuration
```

### 9.2 Configuration

```json
{
  "p2p": {
    "listenAddrs": ["/ip4/0.0.0.0/tcp/4001"],
    "announceAddrs": [],
    "bootstrapPeers": [
      "/dns4/bootstrap.openclaw.network/tcp/4001/p2p/QmXXX..."
    ],
    "topics": ["/openclaw/v1/announce"],
    "announcementInterval": 300000,
    "peerTimeout": 900000
  },
  "wallet": {
    "path": "~/.bsv-wallet"
  },
  "daemon": {
    "socketPath": "/tmp/bsv-p2p.sock",
    "logLevel": "info"
  }
}
```

---

## Part 10: Security Considerations

### 10.1 Message Security

- All messages signed with Ed25519 (libp2p identity)
- Payment messages additionally signed with BSV key
- Replay protection via timestamps + nonce
- Message size limits (prevent DoS)

### 10.2 Payment Security

- SPV verification of incoming payments
- Quote expiration (prevent stale quotes)
- Minimum confirmation requirements (configurable)
- Rate limiting on payment requests

### 10.3 Network Security

- libp2p Noise encryption for all connections
- Peer scoring (gossipsub v1.1)
- Connection limits per peer
- Blacklist for misbehaving peers

---

## Part 11: Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)
- [ ] libp2p node setup with TCP transport
- [ ] GossipSub for peer discovery
- [ ] Basic peer announcement/discovery
- [ ] CLI skeleton (daemon start/stop/status)
- [ ] Unit tests for core components

### Phase 2: Messaging Protocol (Week 2-3)
- [ ] Message schema (protobuf)
- [ ] Direct messaging protocol
- [ ] Message signing/verification
- [ ] Request/response flow (without payment)
- [ ] Integration tests for messaging

### Phase 3: Payment Channels (Week 3-4)
- [ ] Channel SQLite storage (`channels.db`)
- [ ] Channel state machine
- [ ] Channel opening protocol
- [ ] Channel update/payment flow
- [ ] Channel close (cooperative + timeout)
- [ ] Dispute detection (nLockTime monitor)
- [ ] Integration tests for channels

### Phase 4: Transaction Building (Week 4-5)
- [ ] Channel funding transactions
- [ ] Commitment transaction building
- [ ] Channel close transactions
- [ ] Direct payment fallback (BRC-29/105)
- [ ] BEEF generation and verification
- [ ] Unit tests for all tx types

### Phase 5: OpenClaw Integration (Week 5-6)
- [ ] SKILL.md and skill structure
- [ ] Agent tools registration
- [ ] Plugin manifest (if needed)
- [ ] Documentation
- [ ] E2E tests

### Phase 6: Polish & Hardening (Week 6-7)
- [ ] Error handling improvements
- [ ] Logging and monitoring
- [ ] Performance optimization
- [ ] Security audit
- [ ] Public beta release

---

## Part 12: Dependencies

```json
{
  "dependencies": {
    "libp2p": "^3.1.0",
    "@chainsafe/libp2p-gossipsub": "^13.0.0",
    "@libp2p/tcp": "^9.0.0",
    "@libp2p/noise": "^15.0.0",
    "@libp2p/yamux": "^6.0.0",
    "@libp2p/bootstrap": "^10.0.0",
    "@libp2p/mdns": "^10.0.0",
    "@bsv/sdk": "^1.2.62",
    "@bsv/wallet-toolbox": "^1.0.51",
    "protobufjs": "^7.2.0",
    "commander": "^13.0.0",
    "chalk": "^5.4.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "vitest": "^1.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "tsx": "^4.19.0"
  }
}
```

---

## Part 13: Success Criteria

### E2E Test: Paid Poem Generation

The project is **complete** when the following end-to-end test passes:

```typescript
// test/e2e/poem-payment.test.ts
describe('E2E: Paid Poem Generation', () => {
  let peerA: P2PNode  // Client (requester)
  let peerB: P2PNode  // Server (poem generator)
  let channelId: string

  beforeAll(async () => {
    // 1. Start two independent libp2p peers
    peerA = await createP2PNode({ port: 4001 })
    peerB = await createP2PNode({ port: 4002 })
    
    // 2. Peer B registers a "poem" service
    await peerB.services.register({
      id: 'poem',
      name: 'Random Poem Generator',
      price: 100,  // 100 sats per poem
      handler: async (input) => {
        const topics = ['love', 'nature', 'code', 'robots', 'space']
        const topic = input.topic || topics[Math.floor(Math.random() * topics.length)]
        return {
          poem: `A poem about ${topic}:\n` +
                `Roses are red, violets are blue,\n` +
                `${topic} is wonderful, and so are you.`
        }
      }
    })
    
    // 3. Peers discover each other
    await peerA.connect(peerB.multiaddr)
  })

  afterAll(async () => {
    await peerA.stop()
    await peerB.stop()
  })

  it('should open a payment channel between peers', async () => {
    // 4. Peer A opens a payment channel with 1000 sats
    const channel = await peerA.channels.open(peerB.peerId, 1000)
    channelId = channel.id
    
    expect(channel.state).toBe('open')
    expect(channel.myBalance).toBe(1000)
    expect(channel.peerBalance).toBe(0)
  })

  it('should pay for a poem via the channel', async () => {
    // 5. Peer A requests a poem (pays 100 sats via channel)
    const result = await peerA.request({
      peerId: peerB.peerId,
      service: 'poem',
      input: { topic: 'Bitcoin' }
    })
    
    // 6. Verify poem was received
    expect(result.poem).toContain('Bitcoin')
    expect(result.poem.length).toBeGreaterThan(0)
    
    // 7. Verify channel balances updated
    const channel = await peerA.channels.get(channelId)
    expect(channel.myBalance).toBe(900)      // 1000 - 100
    expect(channel.peerBalance).toBe(100)    // 0 + 100
  })

  it('should support multiple payments on same channel', async () => {
    // 8. Request 5 more poems
    for (let i = 0; i < 5; i++) {
      const result = await peerA.request({
        peerId: peerB.peerId,
        service: 'poem',
        input: {}
      })
      expect(result.poem).toBeDefined()
    }
    
    // 9. Verify channel balances after 6 total poems (600 sats paid)
    const channel = await peerA.channels.get(channelId)
    expect(channel.myBalance).toBe(400)      // 1000 - 600
    expect(channel.peerBalance).toBe(600)    // 0 + 600
    expect(channel.nSequence).toBe(6)        // 6 updates
  })

  it('should cooperatively close the channel', async () => {
    // 10. Close channel and settle on-chain
    const closeTx = await peerA.channels.close(channelId)
    
    expect(closeTx.txid).toMatch(/^[a-f0-9]{64}$/)
    
    const channel = await peerA.channels.get(channelId)
    expect(channel.state).toBe('closed')
    
    // 11. Verify only 2 on-chain transactions total
    //     (1 funding tx + 1 closing tx)
  })
})
```

### Success Metrics

| Metric | Target |
|--------|--------|
| E2E test passes | ✅ Required |
| Channel open → pay → close works | ✅ Required |
| No on-chain tx per payment | ✅ Required |
| Unit test coverage | ≥ 80% |
| Integration tests pass | All green |

---

## Part 14: Resolved Questions

| Question | Decision |
|----------|----------|
| **Bootstrap Peers** | Use default libp2p bootstrap peers |
| **Service Registry** | GossipSub only for now, centralized listing later |
| **Payment Model** | Payment channels by default, peers can specify alternatives |
| **Channel Lifetime** | Default 1 hour nLockTime, configurable |
| **Dispute Handling** | nLockTime window sufficient (no watchtower needed) |
| **Channel Storage** | Separate SQLite database (`channels.db`) |
| **Existing Code** | Leverage `@bsv/payment-express-middleware` patterns |
| **Overlay Relationship** | Replace clawoverlay.com, learn from its patterns |

---

## Appendix A: Comparison with Existing Overlay

| Feature | Current Overlay (clawoverlay.com) | New P2P System |
|---------|-----------------------------------|----------------|
| Architecture | Centralized server | Decentralized P2P |
| Discovery | HTTP API | GossipSub |
| Messaging | WebSocket (via server) | Direct libp2p streams |
| Payment | Via server relay | Direct peer-to-peer |
| Offline | ❌ Requires server | ✅ Works between online peers |
| Privacy | Server sees all | Only participants see |
| Scalability | Limited by server | Scales with network |

**Note:** The new P2P system complements rather than replaces the overlay. The overlay remains useful for:
- Web-based access
- Persistent service listings
- Cross-network bridging

---

## Appendix B: Example Usage

### Bot A: Request Image Analysis from Bot B (with Payment Channel)

```typescript
// Bot A discovers Bot B via GossipSub
const peers = await p2p.discover({ service: 'image-analysis' })
const botB = peers[0]

// Check if channel exists, open one if not
let channel = await p2p.channels.getForPeer(botB.peerId)
if (!channel) {
  // Open channel with 10,000 sats capacity, 1 hour lifetime
  channel = await p2p.channels.open(botB.peerId, 10000, { lockTimeHours: 1 })
  console.log(`Opened channel ${channel.id} with ${botB.peerId}`)
}

// Bot A sends request (payment happens via channel automatically)
const result = await p2p.request({
  peerId: botB.peerId,
  service: 'image-analysis',
  input: { imageUrl: 'https://example.com/image.jpg' },
  maxPayment: 1000  // Max 1000 sats
})

// Internally:
// 1. Bot A sends REQUEST with channel payment update (500 sats)
// 2. Bot B validates channel update signature
// 3. Bot B processes request
// 4. Bot B sends RESPONSE with counter-signature
// 5. Both bots update their channel state (nSequence++)
// NO ON-CHAIN TRANSACTION!

console.log(result.analysis)     // "The image shows a cat..."
console.log(channel.myBalance)   // 9500 sats remaining
```

### Multiple Requests on Same Channel

```typescript
// Make 10 requests, all through the same channel
for (let i = 0; i < 10; i++) {
  const result = await p2p.request({
    peerId: botB.peerId,
    service: 'translate',
    input: { text: `Hello ${i}`, targetLang: 'es' }
  })
  console.log(result.translation)
}

// Only 2 on-chain txs total: channel open + eventual close
// vs 10 on-chain txs with direct payments
```

### Closing a Channel

```typescript
// Cooperative close (both parties online)
const closeTx = await p2p.channels.close(channel.id)
console.log(`Channel closed, txid: ${closeTx.txid}`)

// Force close (peer unresponsive, wait for nLockTime)
const forceTx = await p2p.channels.forceClose(channel.id)
console.log(`Force closing, will be final at ${channel.nLockTime}`)
```

---

*Plan Version: 1.0.0*
*Last Updated: 2026-02-17*
*Author: Ghanima*
