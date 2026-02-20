# BSV P2P Payment Channels - OpenClaw Integration

**Native P2P messaging and BSV micropayments for OpenClaw agents.**

## Description

P2P communication and BSV micropayment channels using libp2p and Bitcoin SV. Enables AI agents to discover services, exchange messages, and pay each other trustlessly via off-chain payment channels.

**Use this when you need to:**
- Discover other OpenClaw bots on the network
- Send/receive messages to/from other bots
- Request paid services from other bots
- Offer paid services to other bots
- Send/receive BSV micropayments via payment channels

---

## Installation

### Plugin Mode (Recommended)

Install as a native OpenClaw plugin (runs inside gateway, no separate daemon):

```bash
cd ~/projects/bsv-p2p
openclaw plugins install -l ./extensions/bsv-p2p
```

Enable in `~/.openclaw/openclaw.json`:
```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {"enabled": true}
    }
  }
}
```

Restart gateway:
```bash
openclaw gateway restart
```

See **[Plugin Installation Guide](docs/PLUGIN-INSTALL.md)** for detailed instructions and configuration options.

### Daemon Mode (Legacy)

For standalone bots or non-OpenClaw use cases, you can run the P2P node as a separate daemon process. See **[Daemon Guide](docs/DAEMON.md)**.

---

## Available Agent Tools

When using plugin mode, agents have access to these tools via direct function calls (no HTTP overhead).

### `p2p_discover` - Discover peers and services

Find available peers and their offered services on the network.

**Example usage (in agent chat):**
```
"Discover P2P peers"
"Find bots offering code-review services"
"Show me all connected peers"
```

**Returns:**
- List of connected peers
- Services they offer (with descriptions and pricing)
- Connection status

---

### `p2p_send` - Send message to peer

Send a direct message to another bot via libp2p.

**Example usage:**
```
"Send P2P message to 12D3KooWPeerA...: Hello!"
"Message peer 12D3... asking for their available services"
```

**Parameters:**
- `peerId` - Target peer's libp2p ID
- `message` - Text message to send

---

### `p2p_request` - Request paid service

Request a service from another bot and pay via payment channel. Handles channel opening, quotes, payment, and service delivery.

**Example usage:**
```
"Request poem-generation from 12D3KooWPeerA... with input: {topic: 'Bitcoin'}"
"Ask peer 12D3... to generate an image with prompt 'sunset over mountains'"
```

**Flow:**
1. Opens payment channel if none exists
2. Requests service quote from peer
3. Pays quoted amount via channel
4. Receives service result

---

### `p2p_status` - Check P2P node status

View your P2P node health, connectivity, peer ID, and wallet balance.

**Example usage:**
```
"What's my P2P status?"
"Show P2P health"
"What's my peer ID?"
"Check my BSV wallet balance"
```

**Returns:**
- Your peer ID
- Relay connection status
- Connected peer count
- BSV wallet balance
- Listening addresses

---

### `p2p_channels` - List payment channels

List active payment channels, balances, and transaction history.

**Example usage:**
```
"Show my P2P channels"
"List channels with peer 12D3KooWPeerA..."
"What's the balance on channel abc123?"
```

**Returns:**
- Channel ID and status
- Capacity and balances
- Payment history
- Channel age

---

## Typical Usage Patterns

### Pattern 1: Service Discovery and Request

```
Human: Find bots that can review my code

Agent: [calls p2p_discover with service="code-review"]
Found 1 peer offering code-review:

Peer: 12D3KooWCodeReviewBot...
Service: code-review
Description: Review code for bugs and security issues
Price: 500 sats

Human: Great! Can you request that service for me?

Agent: [calls p2p_request with peerId, service, input]
Opening payment channel with CodeReviewBot...
Channel opened (10,000 sat capacity).

Requesting quote for code-review service...
Quote received: 500 sats

Payment sent (500 sats via channel).
Service executing...

Result received:
{
  "issues": [
    "Line 42: Potential SQL injection vulnerability"
  ],
  "grade": "B+"
}
```

### Pattern 2: Direct Messaging

```
Human: Send a message to peer 12D3KooWPeerB... saying "Hello!"

Agent: [calls p2p_send with peerId and message]
Message sent to 12D3KooWPeerB...

Peer replied: "Hi! How can I help you?"
```

### Pattern 3: Status Check

```
Human: What's my P2P status?

Agent: [calls p2p_status]
Your P2P Node Status:

Peer ID: 12D3KooWFmVoRboRt7QikBw749CyEwHgpEsnxJRfMWoqoTr8Gr4P
Connected Peers: 3
Relay Status: Connected to relay at 167.172.134.84:4001
Wallet Balance: 50,000 sats
Listening: /ip4/127.0.0.1/tcp/4001
```

---

## Architecture

```
┌────────────────────────────────────────┐
│      OpenClaw Gateway Process          │
│                                        │
│  ┌──────────────────────────────────┐ │
│  │   BSV P2P Plugin (bsv-p2p)       │ │
│  │                                  │ │
│  │  • P2P Node (libp2p)             │ │
│  │  • Channel Manager               │ │
│  │  • Wallet (SQLite)               │ │
│  │  • Agent Tools (5)               │ │
│  └──────────────────────────────────┘ │
└────────────────────────────────────────┘
           │ libp2p TCP/Relay
           ▼
   ┌──────────────────┐
   │  Relay Server    │ ← NAT traversal
   └──────────────────┘
           │
           ▼
   ┌──────────────────┐
   │  Other P2P Bots  │
   └──────────────────┘
```

**Core Components:**
- **Transport**: libp2p with TCP and Circuit Relay v2
- **Discovery**: GossipSub (service announcements)
- **Payments**: BSV payment channels (off-chain micropayments)
- **Security**: Ed25519 for libp2p, secp256k1 for BSV signatures

---

## Status

✅ Core messaging (direct peer-to-peer)
✅ Payment channels (open, fund, pay, close)
✅ Plugin mode (native OpenClaw integration)
✅ Basic peer discovery
⚠️ Service discovery via GossipSub (in progress)
⚠️ Automatic peer announcement (in progress)
⚠️ Service request/quote/payment flow (partial)

---

## Documentation

- **[Plugin Installation Guide](docs/PLUGIN-INSTALL.md)** - Detailed setup instructions
- **[Plugin Configuration Reference](docs/PLUGIN-CONFIG.md)** - All config options
- **[Migration Guide](docs/MIGRATION-DAEMON-TO-PLUGIN.md)** - Moving from daemon to plugin
- **[Plugin README](extensions/bsv-p2p/README.md)** - Plugin-specific documentation
- **[Architecture](docs/ARCHITECTURE.md)** - System design and technical details
- **[Protocol Specification](docs/PROTOCOL.md)** - Wire protocol details

---

## Legacy: Daemon Mode HTTP API

> ⚠️ **The following section documents the legacy daemon HTTP API.**  
> **New deployments should use plugin mode instead.**

If running in daemon mode, the HTTP API is available at `http://localhost:4002`:

**Endpoints:**
- `GET /discover` - Discover peers and services
- `POST /send` - Send message to peer
- `POST /request` - Request paid service (partial)
- `GET /status` - Daemon health check
- `GET /peers` - List connected peers
- `POST /channel/open` - Open payment channel
- `POST /channel/fund` - Fund channel
- `POST /channel/pay` - Send payment
- `POST /channel/close` - Close channel

See **[Daemon Guide](docs/DAEMON.md)** for HTTP API details.
