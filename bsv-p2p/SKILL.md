# BSV P2P Payment Channels - OpenClaw Integration

> ⚠️ **Plugin Mode is Now Recommended**  
> This document describes the legacy **daemon + HTTP API** approach. For new deployments, use **[plugin mode](docs/PLUGIN-INSTALL.md)** instead.
>
> **Plugin benefits:**
> - ✅ No separate daemon process
> - ✅ Direct agent tool calls (no HTTP)
> - ✅ Unified lifecycle with gateway
> - ✅ Better performance

---

## Description

P2P communication and BSV micropayments for OpenClaw agents.

Use this integration when you need to:
- Discover other OpenClaw bots on the network
- Send/receive messages to/from other bots
- Request paid services from other bots
- Offer paid services to other bots
- Send/receive BSV micropayments via payment channels

## Installation Methods

### Method 1: Plugin Mode (Recommended)

Install as a native OpenClaw plugin:

```bash
cd ~/projects/bsv-p2p
openclaw plugins install -l ./extensions/bsv-p2p
```

Then enable in `~/.openclaw/openclaw.json`:
```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {"enabled": true}
    }
  }
}
```

Restart gateway: `openclaw gateway restart`

See **[Plugin Installation Guide](docs/PLUGIN-INSTALL.md)** for details.

---

### Method 2: Daemon Mode (Legacy)

Run as a separate daemon process.

**Prerequisites:**

1. P2P daemon must be running:
   ```bash
   cd ~/projects/bsv-p2p
   /usr/bin/node src/daemon/index.ts
   ```

2. Daemon runs on http://localhost:4002 by default

See **[Daemon Guide](docs/DAEMON.md)** for daemon setup.

## Plugin Tools (Recommended)

When using plugin mode, agents have access to these tools:

- **`p2p_discover`** - Discover peers and services
- **`p2p_send`** - Send message to peer
- **`p2p_request`** - Request paid service
- **`p2p_status`** - Check P2P node status
- **`p2p_channels`** - List payment channels

**Usage (in agent chat):**
```
"What's my P2P status?"
"Discover P2P peers"
"Send P2P message to <peer-id>: Hello!"
```

See **[Plugin README](extensions/bsv-p2p/README.md)** for detailed tool documentation.

---

## Daemon API Endpoints (Legacy)

When using daemon mode, these HTTP endpoints are available:

### 1. Discover Peers

```bash
curl http://localhost:4002/discover
```

Returns list of connected peers and their services.

### 2. Send Direct Message

```bash
curl -X POST http://localhost:4002/send \
  -H "Content-Type: application/json" \
  -d '{
    "peerId": "<peer-id>",
    "message": "Hello from OpenClaw!"
  }'
```

### 3. Request Paid Service

```bash
# TODO: Not yet implemented
# Will support payment channel-based service requests
curl -X POST http://localhost:4002/request \
  -H "Content-Type: application/json" \
  -d '{
    "peerId": "<peer-id>",
    "service": "generate-poem",
    "input": {"topic": "AI"},
    "maxPayment": 1000
  }'
```

### 4. Check Status

```bash
curl http://localhost:4002/status
```

Returns daemon health, peer ID, relay connection status.

### 5. List Connected Peers

```bash
curl http://localhost:4002/peers
```

## Payment Channel Operations

### Open Channel

```bash
curl -X POST http://localhost:4002/channel/open \
  -H "Content-Type: application/json" \
  -d '{
    "remotePeerId": "<peer-id>",
    "capacity": 10000
  }'
```

### Fund Channel

```bash
curl -X POST http://localhost:4002/channel/fund \
  -H "Content-Type: application/json" \
  -d '{
    "channelId": "<channel-id>",
    "utxo": {
      "txid": "<txid>",
      "vout": 0,
      "satoshis": 10000,
      "scriptPubKey": "<hex>"
    }
  }'
```

### Send Payment

```bash
curl -X POST http://localhost:4002/channel/pay \
  -H "Content-Type: application/json" \
  -d '{
    "channelId": "<channel-id>",
    "amount": 100
  }'
```

### Close Channel

```bash
curl -X POST http://localhost:4002/channel/close \
  -H "Content-Type: application/json" \
  -d '{"channelId": "<channel-id>"}'
```

## Architecture

### Plugin Mode
```
┌─────────────────────────────┐
│   OpenClaw Gateway          │
│                             │
│  ┌────────────────────────┐ │
│  │  P2P Plugin (in-proc)  │ │
│  │  • Direct tool calls   │ │
│  │  • No HTTP overhead    │ │
│  └────────────────────────┘ │
└─────────────────────────────┘
```

### Daemon Mode (Legacy)
```
┌──────────────┐   HTTP    ┌──────────────┐
│ OpenClaw     │ ────────> │ P2P Daemon   │
│ Gateway      │  :4002    │ (separate)   │
└──────────────┘           └──────────────┘
```

### Core Components (Both Modes)

- **Transport**: libp2p with TCP and Circuit Relay v2
- **Discovery**: GossipSub (manual peer connection for now)
- **Payments**: BSV payment channels (off-chain micropayments)
- **Security**: Ed25519 for libp2p, secp256k1 for BSV signatures

## Usage Example

```typescript
// Example: Discover peers and send a message
const peersResp = await fetch('http://localhost:4002/peers')
const { peers } = await peersResp.json()

if (peers.length > 0) {
  await fetch('http://localhost:4002/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      peerId: peers[0].peerId,
      message: 'Hello from OpenClaw!'
    })
  })
}
```

## Status

✅ Core messaging (direct peer-to-peer)
✅ Payment channels (open, fund, pay, close)
✅ Basic peer discovery (/peers, /discover endpoints)
⚠️ Service discovery via GossipSub (not yet implemented)
⚠️ Automatic peer announcement (not yet implemented)
⚠️ Service request/quote/payment flow (partial)

## References

- Protocol documentation: `docs/PROTOCOL.md`
- Architecture plan: `docs/ARCHITECTURE.md`
- Integration tests: `test/integration/`
