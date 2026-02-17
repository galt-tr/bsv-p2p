# Payment Channel Protocol

Wire protocol for BSV payment channels over libp2p.

## Protocol Identifier

```
/openclaw/channel/1.0.0
```

## Message Types

### Channel Lifecycle

| Type | Direction | Purpose |
|------|-----------|---------|
| `OPEN_REQUEST` | Initiator → Responder | Propose new channel |
| `OPEN_ACCEPT` | Responder → Initiator | Accept channel |
| `OPEN_REJECT` | Responder → Initiator | Reject with reason |
| `FUNDING_CREATED` | Initiator → Responder | Funding tx ready |
| `FUNDING_SIGNED` | Responder → Initiator | Commitment signed |
| `CHANNEL_READY` | Both | Channel operational |

### Payments

| Type | Direction | Purpose |
|------|-----------|---------|
| `UPDATE_REQUEST` | Sender → Receiver | New payment state |
| `UPDATE_ACK` | Receiver → Sender | Accept update |
| `UPDATE_REJECT` | Receiver → Sender | Reject with reason |

### Close

| Type | Direction | Purpose |
|------|-----------|---------|
| `CLOSE_REQUEST` | Either → Other | Initiate close |
| `CLOSE_ACCEPT` | Other → Requester | Sign settlement |
| `CLOSE_COMPLETE` | Either | Settlement broadcast |

## Message Formats

### OpenRequestMessage

```typescript
{
  type: 'open_request',
  channelId: string,           // UUID
  timestamp: number,           // Unix ms
  proposedCapacity: number,    // Satoshis
  ourPubKey: string,          // Hex pubkey for channel
  identityKey: string,        // BSV identity key
  proposedLockTimeSeconds: number,
  ourAddress: string          // P2PKH for receiving
}
```

### UpdateRequestMessage

```typescript
{
  type: 'update_request',
  channelId: string,
  timestamp: number,
  amount: number,              // Payment amount
  newSequence: number,         // Incremented
  newSenderBalance: number,
  newReceiverBalance: number,
  newCommitmentTxHex: string,  // Unsigned commitment
  senderSig: string,           // Signature
  memo?: string                // Optional reference
}
```

### CloseRequestMessage

```typescript
{
  type: 'close_request',
  channelId: string,
  timestamp: number,
  settlementTxHex: string,     // Final settlement tx
  ourSettlementSig: string,
  finalSequence: number
}
```

## State Machine

```
PENDING → OPEN → CLOSING → CLOSED
           ↓
       DISPUTED (unilateral)
```

## Security

- All messages should be signed with channel-specific keys
- Verify signatures before processing
- Validate balances sum to capacity
- Check sequence numbers are monotonic
