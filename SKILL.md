---
name: bsv-p2p
description: P2P communication and BSV payment channels for bot-to-bot payments. Use when building peer-to-peer bot networks, implementing micropayment channels, creating paid services between agents, or enabling off-chain BSV transactions. Supports libp2p networking, 2-of-2 multisig channels, nSequence replacement, and cooperative/unilateral close.
---

# BSV P2P Payment Channels

Enable bots to discover, communicate with, and pay each other via libp2p with BSV payment channels.

## Quick Start

```bash
cd ~/.openclaw/skills/bsv-p2p/scripts/bsv-p2p
npm install
npm run build
```

## Core Components

### P2P Node

```typescript
import { P2PNode, createP2PNode } from './src/index.js'

const node = await createP2PNode({ port: 4001 })
console.log(`PeerId: ${node.peerId}`)

// Connect to peer
await node.connect('/ip4/127.0.0.1/tcp/4002/p2p/12D3KooW...')

// Register a paid service
node.registerService({
  id: 'poem',
  name: 'Poem Generator', 
  price: 100,
  currency: 'bsv'
})
```

### Payment Channels

```typescript
import { ChannelManager } from './src/channels/index.js'

const manager = new ChannelManager({
  privateKey: myPrivKey.toString(),
  publicKey: myPubKey
})

// Open channel (1000 sats, 1 hour lifetime)
const channel = await manager.createChannel(peerId, remotePubKey, 1000, 3600000)
manager.openChannel(channel.id)

// Make off-chain payment
const payment = await manager.createPayment(channel.id, 100)

// Close cooperatively
await manager.closeChannel(channel.id)
```

## Architecture

### Channel Lifecycle

1. **Open**: Create 2-of-2 multisig funding tx
2. **Update**: Exchange commitment txs off-chain (nSequence for ordering)
3. **Close**: Cooperative settlement or unilateral via nLockTime

### Transaction Types

| Type | nSequence | nLockTime | Purpose |
|------|-----------|-----------|---------|
| Funding | FINAL | 0 | Lock funds in multisig |
| Commitment | Decrements | Future | Off-chain state update |
| Settlement | FINAL | 0 | Cooperative close |

### Protocol Messages

- `OPEN_REQUEST` / `OPEN_ACCEPT` - Channel negotiation
- `UPDATE_REQUEST` / `UPDATE_ACK` - Payment updates
- `CLOSE_REQUEST` / `CLOSE_ACCEPT` - Cooperative close

## CLI Commands

```bash
# Start daemon
npm run daemon

# Or use CLI
npm run cli -- daemon start
npm run cli -- daemon status
npm run cli -- peers list
npm run cli -- channels list
npm run cli -- channels open <peerId> <sats>
```

## Configuration

Default config at `~/.bsv-p2p/config.json`:

```json
{
  "port": 4001,
  "enableMdns": true,
  "announceIntervalMs": 300000,
  "defaultChannelLifetimeMs": 3600000,
  "gateway": {
    "url": "http://127.0.0.1:18789",
    "token": "your-hook-token",
    "enabled": true
  }
}
```

## Gateway Integration

The P2P daemon can wake your OpenClaw agent when messages arrive from other bots.

### How It Works

1. Daemon receives libp2p message from remote peer
2. Daemon calls `POST /hooks/wake` on OpenClaw gateway
3. Agent wakes with system event containing the P2P message
4. Agent uses skill tools to respond

### Environment Variables

```bash
# Set these to enable gateway integration
export OPENCLAW_HOOKS_TOKEN="your-hook-token"
export OPENCLAW_GATEWAY_URL="http://127.0.0.1:18789"  # optional, this is default
```

### Gateway Config in OpenClaw

Enable hooks in your OpenClaw config:

```json5
{
  hooks: {
    enabled: true,
    token: "your-hook-token",
    path: "/hooks"
  }
}
```

### Message Flow

When a peer sends a payment channel message:

```
Peer → libp2p → Daemon → POST /hooks/wake → Gateway → Agent
                                                ↓
        "P2P Payment: Peer abc... sent 100 sats"
```

The agent receives a formatted system event like:

```
[P2P Payment] Peer 12D3KooWGUN2ti... sent payment.
Channel ID: ch_abc123
Amount: 100 sats
Memo: For poem service
New balance: you=500 them=400

Acknowledge to accept payment.
```

## Key Technical Details

- **nSequence**: Higher logical seq = lower nSequence (newer replaces older)
- **nLockTime**: Dispute window - tx valid after this time
- **Multisig**: Lexicographically sorted pubkeys for determinism
- **Fee handling**: Split proportionally between parties

## Dependencies

- `libp2p@^3.1.0` - P2P networking
- `@bsv/sdk@^1.2.62` - BSV transactions
- `@chainsafe/libp2p-gossipsub` - Pub/sub messaging

## References

- [Protocol Details](references/protocol.md) - Wire protocol specification
- [Transaction Formats](references/transactions.md) - BSV tx structures
