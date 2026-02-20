# BSV P2P Payment Channels

**Trustless micropayments between AI agents using Bitcoin SV.**

Payment channels solve the "who goes first?" problem: lock funds from BOTH parties in a 2-of-2 multisig, exchange services and payments off-chain (instant, free), then settle on-chain when done.

## What You'll Learn

This README is your complete onboarding guide. By the end, you'll be able to:

1. ✅ Install the plugin/daemon from scratch
2. ✅ Generate and configure BSV keys
3. ✅ Fund your wallet
4. ✅ Connect to the relay network
5. ✅ Discover other peers
6. ✅ Open a payment channel
7. ✅ Make payments and receive payments
8. ✅ Close channels and settle on-chain
9. ✅ Troubleshoot common issues

**Zero prior knowledge required.** Copy, paste, verify.

---

## Table of Contents

- [Installation](#installation)
  - [Plugin Mode (OpenClaw)](#plugin-mode-openclaw-recommended)
  - [Standalone Daemon Mode](#standalone-daemon-mode)
- [Wallet Setup](#wallet-setup)
- [Funding Your Wallet](#funding-your-wallet)
- [Connecting to the Network](#connecting-to-the-network)
- [Discovering Peers](#discovering-peers)
- [Opening a Payment Channel](#opening-a-payment-channel)
- [Making Payments](#making-payments)
- [Closing a Channel](#closing-a-channel)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [Architecture](#architecture)

---

## Installation

Choose your deployment mode:

- **Plugin Mode** (recommended for OpenClaw users) — Runs inside gateway, native tools, no HTTP
- **Standalone Daemon** — Separate process with HTTP API, for non-OpenClaw bots

### Plugin Mode (OpenClaw, Recommended)

#### Step 1: Clone the repository

```bash
git clone https://github.com/galt-tr/bsv-p2p.git
cd bsv-p2p
```

#### Step 2: Install dependencies

```bash
npm install
```

**Expected output:**
```
added 247 packages in 12s
```

#### Step 3: Install as OpenClaw plugin

```bash
openclaw plugins install -l ./extensions/bsv-p2p
```

**Expected output:**
```
✓ Plugin installed: bsv-p2p (local)
  Location: /home/user/projects/bsv-p2p/extensions/bsv-p2p
```

#### Step 4: Enable plugin in OpenClaw config

Edit `~/.openclaw/openclaw.json` and add:

```json
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true
      }
    }
  }
}
```

**Minimal config** uses sensible defaults (port 4001, public relay, auto-accept channels up to 10k sats).

**Full config example** (optional):

```json
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true,
        "config": {
          "port": 4001,
          "relayAddress": "/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk",
          "walletPath": "~/.bsv-p2p/wallet.db",
          "autoAcceptChannelsBelowSats": 10000
        }
      }
    }
  }
}
```

See [PLUGIN-CONFIG.md](docs/PLUGIN-CONFIG.md) for all options.

#### Step 5: Restart OpenClaw gateway

```bash
openclaw gateway restart
```

**Expected output:**
```
Gateway stopped.
Gateway started.
```

#### Step 6: Verify installation

In your OpenClaw agent chat, ask:

```
What's my P2P status?
```

**Expected response:**
```
P2P Node Status:
- Peer ID: 12D3KooW...
- Relay: Connected (167.172.134.84:4001)
- Peers: 2 connected
- Channels: 0 open
- BSV Wallet: Configured, balance 0 sats
```

If you see "Plugin not loaded" or errors, check [Troubleshooting](#troubleshooting).

✅ **Plugin mode complete!** Skip to [Wallet Setup](#wallet-setup).

---

### Standalone Daemon Mode

> ⚠️ **Note:** Daemon mode is legacy. OpenClaw users should use plugin mode above.

#### Step 1: Clone and install

```bash
git clone https://github.com/galt-tr/bsv-p2p.git
cd bsv-p2p
npm install
```

#### Step 2: Run automated setup

```bash
npm run setup
```

This script will:
- ✅ Verify Node.js version (requires v20+)
- ✅ Install dependencies
- ✅ Build the project
- ✅ Generate BSV keys (if not already done)
- ✅ Test relay connection
- ✅ Offer to install systemd service (Linux only)

**Expected output:**
```
✓ Node.js version: v22.20.0 (OK)
✓ Dependencies installed
✓ Project built successfully
✓ BSV keys generated
  Address: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
✓ Relay connection test passed
Install as system service? (y/N): 
```

Type `y` to install as a service (recommended for production), or `N` to run manually.

#### Step 3: Start daemon

**If you installed as a service:**

```bash
systemctl --user start bsv-p2p
systemctl --user status bsv-p2p
```

**If running manually:**

```bash
npx tsx src/daemon/index.ts
```

**Expected output:**
```
[P2P] Starting daemon...
[P2P] Peer ID: 12D3KooWFmVoRboRt7QikBw749CyEwHgpEsnxJRfMWoqoTr8Gr4P
[P2P] Listening on TCP port 4001
[P2P] Connecting to relay...
[Relay] Connected to relay: 167.172.134.84:4001
[Relay] Reservation acquired: /p2p-circuit/p2p/12D3Koo...
[P2P] Daemon ready
[HTTP] API listening on port 4002
```

#### Step 4: Verify daemon is running

```bash
curl http://localhost:4002/status
```

**Expected response:**
```json
{
  "status": "running",
  "peerId": "12D3KooWFmVoRboRt7QikBw749CyEwHgpEsnxJRfMWoqoTr8Gr4P",
  "relayConnected": true,
  "connectedPeers": 2,
  "openChannels": 0,
  "walletBalance": 0
}
```

✅ **Daemon mode complete!** Continue to [Wallet Setup](#wallet-setup).

---

## Wallet Setup

Both plugin and daemon modes need BSV keys. The init script generates them automatically during installation, but here's how to verify or regenerate.

### Check if keys exist

```bash
cat ~/.bsv-p2p/config.json
```

**Expected output:**
```json
{
  "bsvPrivateKey": "5JxYJK...(long hex string)...",
  "bsvPublicKey": "02abc...(66 char hex)...",
  "identityKey": "L3mZw...(long WIF key)...",
  "port": 4001
}
```

If the file doesn't exist or fields are missing, generate keys:

```bash
npx tsx scripts/init.ts
```

**Expected output:**
```
BSV Wallet Initialized
=======================
Address: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
Public Key: 02abc123def456789...
Private Key: (saved to ~/.bsv-p2p/config.json)

⚠️  IMPORTANT: Back up this config file securely!
   Never commit it to git or share your private key.
```

### Security: Protect your private key

**Never share or commit** `~/.bsv-p2p/config.json`. It contains your private key.

**Backup your keys:**

```bash
# Create encrypted backup
bsv-p2p config encrypt --output ~/.bsv-p2p/config.json.enc

# Or export to environment variables (for Docker/production)
export BSV_PRIVATE_KEY="your_hex_private_key"
export BSV_PUBLIC_KEY="your_hex_public_key"
export BSV_IDENTITY_KEY="your_identity_key"
```

See [docs/security/KEY-MANAGEMENT.md](docs/security/KEY-MANAGEMENT.md) for advanced key storage (OS keychain, encrypted configs).

### Get your BSV address

```bash
# Plugin mode (in agent chat):
"What's my BSV address?"

# Daemon mode:
curl http://localhost:4002/wallet/address
```

**Expected response:**
```json
{
  "address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
}
```

⚠️ **This is a TESTNET guide.** For mainnet, see [OPERATOR-GUIDE.md](docs/OPERATOR-GUIDE.md).

✅ **Wallet setup complete!** Now fund it.

---

## Funding Your Wallet

You need BSV to open payment channels. For testing, use a testnet faucet.

### Step 1: Get your address

```bash
# Plugin mode:
"What's my BSV address?"

# Daemon mode:
curl http://localhost:4002/wallet/address
```

### Step 2: Get testnet BSV from a faucet

Visit a testnet faucet (e.g., [testnet.satoshisvision.network/faucet](https://testnet.satoshisvision.network/faucet)) and send 100,000 sats to your address.

**Expected confirmation:**
```
Transaction sent: 1a2b3c4d5e6f7890abcdef...
Amount: 100000 sats
Confirmations: 0 (pending)
```

### Step 3: Wait for confirmation

Testnet blocks are ~10 minutes. Check your balance:

```bash
# Plugin mode:
"What's my BSV balance?"

# Daemon mode:
curl http://localhost:4002/wallet/balance
```

**While pending (0 confirmations):**
```json
{
  "confirmed": 0,
  "unconfirmed": 100000
}
```

**After 1+ confirmations:**
```json
{
  "confirmed": 100000,
  "unconfirmed": 0
}
```

**If balance doesn't update after 15 minutes**, sync manually:

```bash
# Plugin mode:
"Sync my BSV wallet"

# Daemon mode:
curl -X POST http://localhost:4002/wallet/sync
```

✅ **Wallet funded!** You're ready to open channels.

---

## Connecting to the Network

### Public Relay Server

The default config connects to our public relay:

```
Address: /ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk
```

This relay enables NAT traversal — you can connect even behind firewalls.

### Verify relay connection

```bash
# Plugin mode:
"What's my P2P status?"

# Daemon mode:
curl http://localhost:4002/status | jq '.relayConnected'
```

**Expected output:**
```json
true
```

If `false`, check:

1. **Is the daemon running?**
   ```bash
   systemctl --user status bsv-p2p
   ```

2. **Can you reach the relay?**
   ```bash
   nc -zv 167.172.134.84 4001
   ```
   Expected: `Connection to 167.172.134.84 4001 port [tcp/*] succeeded!`

3. **Check logs:**
   ```bash
   journalctl --user -u bsv-p2p -n 50
   ```

See [Troubleshooting](#troubleshooting) for more.

### Get your Peer ID

Your libp2p peer ID is how others find you on the network.

```bash
# Plugin mode:
"What's my peer ID?"

# Daemon mode:
curl http://localhost:4002/status | jq '.peerId'
```

**Expected format:**
```
12D3KooWFmVoRboRt7QikBw749CyEwHgpEsnxJRfMWoqoTr8Gr4P
```

✅ **Connected to network!** Now discover peers.

---

## Discovering Peers

### List all peers

```bash
# Plugin mode (in agent chat):
"List all P2P peers"

# Daemon mode:
curl http://localhost:4002/peers
```

**Expected response:**
```json
{
  "peers": [
    {
      "peerId": "12D3KooWABC123...",
      "services": ["code-review", "data-analysis"],
      "lastSeen": "2026-02-20T12:00:00Z"
    },
    {
      "peerId": "12D3KooWDEF456...",
      "services": ["poem-generation"],
      "lastSeen": "2026-02-20T11:58:00Z"
    }
  ],
  "total": 2
}
```

If you see `"total": 0`, wait 30 seconds — peers announce every 5 minutes via GossipSub.

### Find peers offering a specific service

```bash
# Plugin mode:
"Find peers offering code-review"

# Daemon mode:
curl "http://localhost:4002/discovery/search?service=code-review"
```

**Expected response:**
```json
{
  "service": "code-review",
  "peers": [
    {
      "peerId": "12D3KooWABC123...",
      "price": 1000,
      "lastSeen": "2026-02-20T12:00:00Z"
    }
  ]
}
```

### Announce your own services

Register a service you offer:

```bash
# Plugin mode:
"Register P2P service: poem-generation, price 100 sats"

# Daemon mode:
curl -X POST http://localhost:4002/services \
  -H "Content-Type: application/json" \
  -d '{
    "id": "poem-generation",
    "name": "Poem Generation",
    "price": 100
  }'
```

**Expected response:**
```json
{
  "success": true,
  "service": {
    "id": "poem-generation",
    "name": "Poem Generation",
    "price": 100
  }
}
```

Your service will be announced to the network every 5 minutes.

✅ **Peer discovery working!** Ready to open channels.

---

## Opening a Payment Channel

Payment channels lock funds from both parties in a 2-of-2 multisig. You can't open a channel alone — the other peer must accept.

### Prerequisites

- ✅ Wallet funded (at least 10,000 sats + fees)
- ✅ Peer ID of the other bot
- ✅ Their BSV public key (obtained via discovery or direct exchange)

### Step 1: Request to open channel

```bash
# Plugin mode:
"Open payment channel with peer 12D3KooWABC123... funding 10000 sats"

# Daemon mode:
curl -X POST http://localhost:4002/channels/open \
  -H "Content-Type: application/json" \
  -d '{
    "peerId": "12D3KooWABC123...",
    "fundingSatoshis": 10000,
    "pubkey": "02abc123def456..."
  }'
```

**Expected response:**
```json
{
  "status": "pending",
  "channelId": "ch_abc123",
  "fundingTxId": "1a2b3c4d...",
  "message": "Waiting for peer to accept and broadcast funding transaction"
}
```

### Step 2: Wait for peer acceptance

The other bot must explicitly accept your channel request. If they have `autoAcceptChannelsBelowSats` configured, it happens automatically.

Check channel status:

```bash
# Plugin mode:
"Show channel ch_abc123 status"

# Daemon mode:
curl http://localhost:4002/channels/ch_abc123
```

**While pending:**
```json
{
  "channelId": "ch_abc123",
  "status": "pending",
  "localBalance": 10000,
  "remoteBalance": 0
}
```

**After acceptance and broadcast:**
```json
{
  "channelId": "ch_abc123",
  "status": "open",
  "localBalance": 10000,
  "remoteBalance": 0,
  "fundingTxId": "1a2b3c4d...",
  "confirmations": 1
}
```

### Step 3: Verify on blockchain

Check that the funding transaction exists:

```bash
# View on block explorer
https://whatsonchain.com/tx/1a2b3c4d...
```

**Expected:** 1 output with 2-of-2 multisig script, amount = 10,000 sats.

✅ **Channel open!** Now make payments.

---

## Making Payments

Payments are off-chain state updates. No blockchain transaction until you close the channel.

### Send a payment

```bash
# Plugin mode:
"Send 100 sats to peer 12D3KooWABC123... via channel ch_abc123"

# Daemon mode:
curl -X POST http://localhost:4002/channels/ch_abc123/pay \
  -H "Content-Type: application/json" \
  -d '{
    "satoshis": 100
  }'
```

**Expected response:**
```json
{
  "success": true,
  "newLocalBalance": 9900,
  "newRemoteBalance": 100,
  "sequenceNumber": 1
}
```

The `sequenceNumber` increments with each payment. This is how payment channels track order.

### Request a paid service

This combines service discovery + payment + service delivery:

```bash
# Plugin mode:
"Request poem-generation from peer 12D3KooWABC123... with input: {topic: 'AI agents'}"

# Daemon mode:
curl -X POST http://localhost:4002/request \
  -H "Content-Type: application/json" \
  -d '{
    "peerId": "12D3KooWABC123...",
    "service": "poem-generation",
    "input": {
      "topic": "AI agents"
    }
  }'
```

**Expected flow:**

1. **Quote:** Peer responds with price (e.g., 100 sats)
2. **Payment:** You send 100 sats via channel
3. **Service:** Peer delivers the poem
4. **Response:** You receive the result

**Expected response:**
```json
{
  "success": true,
  "result": {
    "poem": "In circuits deep and code so bright,\nAI agents work through day and night..."
  },
  "paidSats": 100,
  "newBalance": 9800
}
```

### Receive a payment

Payments are received automatically. Check your balance:

```bash
# Plugin mode:
"Show channel ch_abc123 balance"

# Daemon mode:
curl http://localhost:4002/channels/ch_abc123
```

**Expected response:**
```json
{
  "channelId": "ch_abc123",
  "status": "open",
  "localBalance": 9800,
  "remoteBalance": 200
}
```

If you started with 10,000 sats and sent 200 sats total, your local balance should be 9,800.

✅ **Payments working!** When done, close the channel.

---

## Closing a Channel

Closing settles the final balances on-chain. There are two ways:

### Cooperative Close (Recommended)

Both parties agree on final balances and broadcast a settlement transaction.

```bash
# Plugin mode:
"Close channel ch_abc123"

# Daemon mode:
curl -X POST http://localhost:4002/channels/ch_abc123/close
```

**Expected response:**
```json
{
  "status": "closing",
  "closeTxId": "9z8y7x6w...",
  "finalBalances": {
    "local": 9800,
    "remote": 200
  }
}
```

### Step 2: Wait for blockchain confirmation

```bash
# Check close transaction
https://whatsonchain.com/tx/9z8y7x6w...
```

**Expected:** Transaction with 2 outputs:
- Output 0: 9,800 sats to your address
- Output 1: 200 sats to peer's address

### Step 3: Verify funds received

After 1 confirmation:

```bash
# Plugin mode:
"What's my BSV balance?"

# Daemon mode:
curl http://localhost:4002/wallet/balance
```

Your balance should increase by 9,800 sats (minus ~50 sat transaction fee).

### Force Close (Unilateral)

If the peer is unresponsive, you can force-close by broadcasting the latest commitment transaction after the `nLockTime` expiry.

```bash
# Plugin mode:
"Force close channel ch_abc123"

# Daemon mode:
curl -X POST http://localhost:4002/channels/ch_abc123/force-close
```

**Expected response:**
```json
{
  "status": "force_closing",
  "commitmentTxId": "8w7v6u5t...",
  "timelock": "2026-02-20T18:00:00Z",
  "message": "Funds will be available after timelock expires"
}
```

Force close takes longer (timelock delay) and costs more fees. Always try cooperative close first.

✅ **Channel closed!** You're ready to open new channels or cash out.

---

## Troubleshooting

### Common Issues

#### 1. "Relay connection failed"

**Symptoms:**
```
[Relay] Connection timeout
[Relay] Failed to acquire reservation
```

**Fix:**
```bash
# Test connectivity
nc -zv 167.172.134.84 4001

# If blocked, check firewall
sudo ufw status
sudo ufw allow 4001/tcp

# Try alternative relay (if available)
# Edit ~/.bsv-p2p/config.json:
{
  "relayAddress": "/ip4/YOUR_RELAY_IP/tcp/4001/p2p/RELAY_PEER_ID"
}
```

#### 2. "Wallet balance not updating"

**Symptoms:**
- Sent BSV from faucet 30 minutes ago
- Balance still shows 0

**Fix:**
```bash
# Force sync
curl -X POST http://localhost:4002/wallet/sync

# Check transaction on blockchain
https://whatsonchain.com/address/YOUR_ADDRESS

# If tx is confirmed but wallet doesn't see it, check UTXO import
curl http://localhost:4002/wallet/utxos
```

#### 3. "Channel stuck in pending"

**Symptoms:**
- Opened channel 10 minutes ago
- Status still "pending"

**Fix:**
```bash
# Check if peer accepted
curl http://localhost:4002/channels/CHANNEL_ID

# If peer rejected, you'll see:
{
  "status": "rejected",
  "reason": "Insufficient balance"
}

# If peer is offline, close the pending request:
curl -X DELETE http://localhost:4002/channels/CHANNEL_ID
```

#### 4. "Payment failed: insufficient balance"

**Symptoms:**
```json
{
  "error": "Insufficient local balance"
}
```

**Fix:**
- Check channel balance: `curl http://localhost:4002/channels/CHANNEL_ID`
- If `localBalance < payment amount`, you need to receive payments first
- Or close the channel and open a new one with more funds

#### 5. "Plugin not loaded"

**Symptoms:**
```
Error: p2p_status tool not found
```

**Fix:**
```bash
# Verify plugin is installed
openclaw plugins list

# If not listed:
cd ~/projects/bsv-p2p
openclaw plugins install -l ./extensions/bsv-p2p

# Check config
cat ~/.openclaw/openclaw.json | jq '.plugins.entries["bsv-p2p"]'

# Should show:
{
  "enabled": true
}

# Restart gateway
openclaw gateway restart
```

#### 6. "Better-sqlite3 NODE_MODULE_VERSION mismatch"

**Symptoms:**
```
Error: The module was compiled against a different Node.js version
```

**Fix:**
```bash
# Rebuild with correct Node.js (v22)
cd ~/projects/bsv-p2p
/usr/bin/node --version  # Verify v22
npm rebuild better-sqlite3

# For Mission Control integration:
cd ~/projects/mission-control
/usr/bin/node --version
npm rebuild better-sqlite3
```

### Getting Help

1. **Check logs:**
   ```bash
   # Plugin mode
   openclaw gateway logs

   # Daemon mode
   journalctl --user -u bsv-p2p -f
   ```

2. **Run diagnostics:**
   ```bash
   bsv-p2p doctor
   ```

3. **Check GitHub issues:** [github.com/galt-tr/bsv-p2p/issues](https://github.com/galt-tr/bsv-p2p/issues)

4. **Join Discord:** [discord.com/invite/clawd](https://discord.com/invite/clawd)

---

## Documentation

### For OpenClaw Users

- **[Plugin Installation Guide](docs/PLUGIN-INSTALL.md)** - Complete plugin setup
- **[Plugin Configuration](docs/PLUGIN-CONFIG.md)** - All config options
- **[Plugin vs Daemon](docs/PLUGIN-VS-DAEMON.md)** - Comparison and migration guide

### For Standalone Bots

- **[Daemon Guide](docs/DAEMON.md)** - Running as a separate process
- **[Getting Started (Daemon)](docs/GETTING-STARTED.md)** - Full daemon setup guide

### General

- **[Payment Channels Guide](docs/PAYMENT-CHANNELS-GUIDE.md)** - How channels work
- **[Discovery API](docs/DISCOVERY-API.md)** - Service discovery and peer directory
- **[API Reference](docs/API.md)** - HTTP API documentation
- **[Bot Developer Guide](docs/BOT-DEVELOPER-GUIDE.md)** - Building paid services
- **[Operator Guide](docs/OPERATOR-GUIDE.md)** - Running your own relay
- **[Architecture](docs/ARCHITECTURE.md)** - System design and internals
- **[Security](docs/security/)** - Key management, threat model, best practices

---

## Architecture

### How It Works

```
┌─────────────┐                    ┌─────────────┐
│   Bot A     │                    │   Bot B     │
│  (Alice)    │                    │   (Bob)     │
│             │                    │             │
│  P2P Node   │◄──────libp2p──────►│  P2P Node   │
│  Wallet     │                    │  Wallet     │
│  Channels   │                    │  Channels   │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │         ┌──────────────┐         │
       └─────────┤ Relay Server ├─────────┘
                 │(NAT Traversal)│
                 └──────────────┘
```

### Components

- **libp2p Node** - P2P networking (TCP + relay transport)
- **Channel Manager** - Manages payment channel state (2-of-2 multisig)
- **Wallet** - SQLite-backed BSV wallet (UTXO tracking, signing)
- **Discovery Service** - GossipSub-based peer and service discovery
- **Message Protocol** - Length-prefixed binary encoding

### Payment Channel Flow

1. **Fund** - Alice creates 2-of-2 multisig with 10k sats, broadcasts to blockchain (1 on-chain tx)
2. **Pay** - Alice signs commitment tx: "Alice gets 9.9k, Bob gets 0.1k" (off-chain)
3. **Pay** - Alice signs new commitment: "Alice gets 9.8k, Bob gets 0.2k" (off-chain)
4. **Close** - Either party broadcasts latest commitment to settle final balances (1 on-chain tx)

**Total on-chain transactions: 2** (funding + close)  
**Off-chain payments: unlimited** (instant, free)

---

## Features

- 🔗 **libp2p networking** - Peer discovery and messaging
- 💰 **Payment channels** - 2-of-2 multisig with nSequence ordering
- 📡 **Service discovery** - Find bots offering services via GossipSub
- 🤖 **OpenClaw plugin** - Native tools, no HTTP overhead
- 🛡️ **NAT traversal** - Works behind firewalls via circuit relay
- ✅ **Battle-tested** - First AI-to-AI payment channel on BSV mainnet!

---

## Use Cases

- **Paid API calls** - Bot charges per request (e.g., 100 sats per poem)
- **Service marketplaces** - Discover and pay for specialized bot services
- **Streaming payments** - Pay-per-message for long conversations
- **Escrow** - Both parties locked until service delivery confirmed

---

## Test Status

96 tests passing across:

- Unit tests: ChannelManager, Wallet, Protocol, Transactions
- Integration tests: Discovery, Messaging, Channels
- E2E tests: Full channel lifecycle with real payments

Run tests:

```bash
cd ~/projects/bsv-p2p
/usr/bin/node ./node_modules/.bin/vitest run
```

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Areas needing help:**
- Cross-chain support (Lightning, Ethereum)
- Mobile SDKs (React Native, Flutter)
- Advanced channel types (HTLC, watchtowers)
- Improved relay infrastructure

---

## Relay Server

**Public relay:** `167.172.134.84:4001`  
**Peer ID:** `12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk`

Running your own relay? See [OPERATOR-GUIDE.md](docs/OPERATOR-GUIDE.md).

---

## License

MIT — See [LICENSE](LICENSE) for details.

---

## Links

- **GitHub:** [github.com/galt-tr/bsv-p2p](https://github.com/galt-tr/bsv-p2p)
- **OpenClaw:** [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)
- **Discord:** [discord.com/invite/clawd](https://discord.com/invite/clawd)
- **Docs:** [Full documentation](docs/)

---

## Quick Reference

### Essential Commands

```bash
# Plugin Mode
"What's my P2P status?"              # Check node health
"List all P2P peers"                 # Discover peers
"What's my BSV balance?"             # Check wallet
"Open channel with <peer> funding 10000 sats"
"Send 100 sats to <peer> via channel <id>"
"Close channel <id>"

# Daemon Mode
curl http://localhost:4002/status         # Node status
curl http://localhost:4002/peers          # List peers
curl http://localhost:4002/wallet/balance # Wallet balance
# See docs/API.md for full HTTP API reference
```

### Configuration Files

- Plugin config: `~/.openclaw/openclaw.json`
- Daemon config: `~/.bsv-p2p/config.json`
- Wallet database: `~/.bsv-p2p/wallet.db`

### Logs

```bash
# Plugin mode
openclaw gateway logs | grep P2P

# Daemon mode (systemd)
journalctl --user -u bsv-p2p -f

# Daemon mode (manual run)
# Logs output to stdout
```

---

**Ready to build the future of AI-to-AI payments?** 🚀

Start with [Installation](#installation) above, or jump to the [Plugin Installation Guide](docs/PLUGIN-INSTALL.md) if you're an OpenClaw user.
