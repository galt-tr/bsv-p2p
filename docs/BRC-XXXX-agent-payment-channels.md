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
