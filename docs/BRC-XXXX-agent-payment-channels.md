# BRC-XXX Section 5: Message Formats & Error Codes

## 5.1 Wire Format

All channel messages are JSON-encoded UTF-8, wrapped in the existing libp2p stream protocol. JSON is chosen over binary formats for:
- Human/agent readability and debugging
- No schema compilation step
- Negligible overhead at channel message sizes (<1KB typical)

Every message MUST contain:
```json
{
  "type": "<MESSAGE_TYPE>",
  "channelId": "<hex>",
  "timestamp": <unix_ms>,
  "signature": "<base64>"
}
```

`signature` covers `sha256(type + channelId + timestamp + <type-specific fields>)` signed with sender's BSV private key.

## 5.2 Message Types

### 5.2.1 CHANNEL_PROPOSE
```json
{
  "type": "CHANNEL_PROPOSE",
  "channelId": "<32-byte random hex>",
  "timestamp": 1708476249732,
  "proposerPubKey": "<compressed secp256k1 hex>",
  "fundingAmount": 50000,
  "lockBlocks": 144,
  "attestation": {
    "peerId": "12D3KooW...",
    "pubkey": "<hex>",
    "blockHash": "<recent blockhash>",
    "blockHeight": 885432,
    "signature": "<base64>"
  },
  "challenge": "<32-byte random hex>",
  "signature": "<base64>"
}
```

### 5.2.2 CHANNEL_ACCEPT
```json
{
  "type": "CHANNEL_ACCEPT",
  "channelId": "<from PROPOSE>",
  "timestamp": 1708476250000,
  "responderPubKey": "<compressed secp256k1 hex>",
  "attestation": {
    "peerId": "12D3KooW...",
    "pubkey": "<hex>",
    "challenge": "<from PROPOSE>",
    "signature": "<base64>"
  },
  "challenge": "<32-byte random hex>",
  "fundingTxDraft": "<hex>",
  "signature": "<base64>"
}
```

### 5.2.3 CHANNEL_FUNDED
```json
{
  "type": "CHANNEL_FUNDED",
  "channelId": "<hex>",
  "timestamp": 1708476251000,
  "fundingTxId": "<txid hex>",
  "fundingOutputIndex": 0,
  "attestationProof": {
    "challenge": "<from ACCEPT>",
    "signature": "<base64>"
  },
  "signature": "<base64>"
}
```

### 5.2.4 CHANNEL_UPDATE
```json
{
  "type": "CHANNEL_UPDATE",
  "channelId": "<hex>",
  "timestamp": 1708476260000,
  "sequence": 4294967293,
  "balanceA": 45000,
  "balanceB": 5000,
  "commitmentTx": "<signed tx hex>",
  "signature": "<base64>"
}
```

`sequence` is nSequence value. Starts at 0xFFFFFFFE, decrements with each update. Lower = newer.

### 5.2.5 CHANNEL_UPDATE_ACK
```json
{
  "type": "CHANNEL_UPDATE_ACK",
  "channelId": "<hex>",
  "timestamp": 1708476260100,
  "sequence": 4294967293,
  "commitmentTx": "<counter-signed tx hex>",
  "signature": "<base64>"
}
```

### 5.2.6 CHANNEL_CLOSE
```json
{
  "type": "CHANNEL_CLOSE",
  "channelId": "<hex>",
  "timestamp": 1708476300000,
  "closingTx": "<signed tx hex, nSeq=0, nLockTime=0>",
  "finalBalanceA": 45000,
  "finalBalanceB": 5000,
  "cooperative": true,
  "signature": "<base64>"
}
```

### 5.2.7 CHANNEL_CLOSE_ACK
```json
{
  "type": "CHANNEL_CLOSE_ACK",
  "channelId": "<hex>",
  "timestamp": 1708476300100,
  "closingTx": "<counter-signed tx hex>",
  "signature": "<base64>"
}
```

## 5.3 Error Codes

| Code | Name | Description |
|------|------|-------------|
| E001 | INVALID_SIGNATURE | Message signature verification failed |
| E002 | UNKNOWN_CHANNEL | channelId not recognized |
| E003 | INVALID_STATE | Message not valid for current channel state |
| E004 | ATTESTATION_FAILED | Identity attestation verification failed |
| E005 | STALE_BLOCKHASH | Attestation blockhash older than 6 blocks |
| E006 | SEQUENCE_MISMATCH | nSequence doesn't match expected value |
| E007 | BALANCE_MISMATCH | Balances don't sum to funding amount |
| E008 | INSUFFICIENT_FUNDS | Proposed payment exceeds sender balance |
| E009 | TIMEOUT_EXPIRED | Channel locktime has expired |
| E010 | DUPLICATE_CHANNEL | channelId already exists |

Error response format:
```json
{
  "type": "ERROR",
  "channelId": "<hex>",
  "code": "E001",
  "message": "Invalid signature on CHANNEL_UPDATE",
  "timestamp": 1708476260200,
  "signature": "<base64>"
}
```

## 5.4 Message Size Limits

- Maximum message size: 64KB
- Maximum commitment tx size: 32KB
- Implementations SHOULD reject messages exceeding these limits with E003
# BRC-XXX Section 7: Reference Implementation Notes

## 7.1 Overview

The reference implementation is [bsv-p2p](https://github.com/galt-tr/bsv-p2p), a TypeScript library and daemon for P2P agent communication and payment channels over BSV.

**Status:** Messaging and identity layers are implemented and tested. Payment channel state machine is specified but not yet fully integrated into the daemon.

| Component | Status | Location |
|-----------|--------|----------|
| libp2p networking | ✅ Implemented | `src/daemon/node.ts` |
| Peer discovery | ✅ Implemented | `src/daemon/discovery.ts` |
| Message serialization | ✅ Implemented | `src/messages/serialization.ts` |
| Message validation | ✅ Implemented | `src/messages/validation.ts` |
| Replay protection | ✅ Implemented | `src/messages/replay-protection.ts` |
| Identity attestation | ✅ Implemented | `src/identity/attestation.ts` |
| Peer reputation | ✅ Implemented | `src/daemon/peer-reputation.ts` |
| Rate limiting | ✅ Implemented | `src/daemon/rate-limiter.ts` |
| Gateway integration | ✅ Implemented | `src/daemon/gateway.ts` |
| Channel state machine | 🔲 Specified | This BRC |
| Channel message types | 🔲 Specified | Section 5 |
| On-chain tx construction | 🔲 Specified | Section 4 |

## 7.2 Architecture

### Transport Layer
- **libp2p** with noise encryption and yamux multiplexing
- Circuit relay for NAT traversal (`/ip4/167.172.134.84/tcp/4001/...`)
- GossipSub for broadcast messaging (service announcements, peer discovery)
- Direct streams for channel messages (point-to-point, ordered delivery)

### Message Layer
- Length-prefixed (LP) encoding over libp2p streams (`src/protocol/handler.ts`)
- JSON serialization with schema validation (`src/messages/validation.ts`)
- Per-peer replay protection with nonce tracking (`src/messages/replay-protection.ts`)

### Identity Layer
- secp256k1 key pairs for BSV-native identity (`src/identity/attestation.ts`)
- `createAttestation(peerId, bsvPrivateKey)` — generates signed identity binding
- `verifyAttestation(attestation)` — validates signature against claimed pubkey
- Compact string serialization for peer announcement messages

### Agent Integration
- OpenClaw skill plugin (`src/skill/index.ts`) for agent-native P2P operations
- Gateway webhook integration — incoming P2P messages trigger agent wake via `/hooks/wake`
- systemd service for persistent daemon operation

## 7.3 Key Implementation Decisions

### JSON over Binary
Channel messages use JSON encoding (Section 5.1). At typical message sizes (<1KB), JSON parsing overhead is negligible compared to network latency. The debuggability benefit during early protocol development is significant.

### secp256k1 Only
The implementation uses secp256k1 exclusively — the same curve as BSV transaction signing. Earlier versions used Ed25519 for identity keys; this was removed to eliminate curve-mixing complexity and reduce the cryptographic surface area. One curve, one key type, one verification path.

### nSequence for State Ordering
Payment channel state ordering uses Bitcoin's native nSequence field (Section 4). This is a deliberate choice over application-layer sequence numbers because:
1. Miners enforce nSequence ordering natively — lower values take priority
2. No additional consensus mechanism needed
3. Aligns with original Bitcoin design intent for payment channels

### Cooperative Close as Default
The protocol assumes cooperative close (nSequence=0, nLockTime=0) as the normal path. Force close (timeout-based) is the fallback. This incentive structure encourages honest behavior — cooperative close is cheaper and faster for both parties.

## 7.4 Testing

The reference implementation includes:
- **71 unit tests** covering message handling, serialization, replay protection, and attestation
- **E2E tests** with 2 peers, 6 payments, 2 on-chain transactions
- Test harness for simulating multi-peer scenarios

Run tests: `npm test`

## 7.5 Deployment

### Requirements
- Node.js 22+ (Node 25 has compatibility issues with native modules)
- BSV wallet with funded UTXO for on-chain operations (funding tx, anchor tx)
- Network access for libp2p (TCP, or relay for NAT-restricted environments)

### Quick Start
```bash
git clone https://github.com/galt-tr/bsv-p2p.git
cd bsv-p2p
npm install
npm run build
npx tsx src/cli/index.ts init    # generates identity keys
npx tsx src/cli/index.ts start   # starts P2P daemon
```

### Production (systemd)
```bash
npx tsx src/cli/service-manager.ts install
sudo systemctl enable --now bsv-p2p
```

## 7.6 Known Limitations

1. **No watchtower implementation** — agents must monitor their own channels. A watchtower service spec is planned for a follow-up BRC.
2. **Single relay dependency** — current deployment uses one circuit relay. Multi-relay support is implemented but untested at scale.
3. **No fee estimation** — transaction fees are currently hardcoded. Dynamic fee estimation based on mempool state is needed for production.
4. **Channel capacity** — maximum channel funding is limited by single UTXO size. Channel splicing (add/remove funds from live channel) is not yet specified.
