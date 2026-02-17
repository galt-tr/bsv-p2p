# BSV Transaction Formats

Transaction structures for payment channels.

## Funding Transaction

Creates the 2-of-2 multisig output that locks channel funds.

```
Inputs:  [UTXOs from channel initiator]
Outputs: [0] 2-of-2 multisig (channel capacity)
         [1] Change (optional)

nSequence: 0xFFFFFFFF (final)
nLockTime: 0
```

### Multisig Script

```
OP_2 <pubkey_A> <pubkey_B> OP_2 OP_CHECKMULTISIG
```

**Important**: Pubkeys sorted lexicographically for determinism.

## Commitment Transaction

Spends funding output, distributes to both parties. Created off-chain.

```
Input:   [0] Funding output (2-of-2 multisig)
Outputs: [0] Party A balance (P2PKH)
         [1] Party B balance (P2PKH)

nSequence: SEQUENCE_MAX - logical_sequence
nLockTime: channel_expiry (Unix timestamp)
```

### nSequence Ordering

Higher logical sequence → lower nSequence → can replace older states.

```typescript
nSequence = 0xFFFFFFFE - sequenceNumber
```

Example:
- Seq 1: nSequence = 0xFFFFFFFD
- Seq 5: nSequence = 0xFFFFFFF9 (lower, wins)

### Dust Handling

Outputs below 546 sats are skipped to avoid dust limit.

## Settlement Transaction

Final cooperative close. Immediately broadcastable.

```
Input:   [0] Funding output (2-of-2 multisig)
Outputs: [0] Party A final balance
         [1] Party B final balance

nSequence: 0xFFFFFFFF (final, no replacement)
nLockTime: 0 (immediate)
```

## Unlocking Script (Multisig Spend)

```
OP_0 <sig_A> <sig_B>
```

OP_0 is dummy for CHECKMULTISIG off-by-one bug.

## Fee Calculation

Fees split proportionally by balance:

```typescript
feeA = floor(totalFee * balanceA / (balanceA + balanceB))
feeB = totalFee - feeA
```

## Sighash

All signatures use:
```
SIGHASH_ALL | SIGHASH_FORKID (0x41)
```

## Constants

```typescript
SEQUENCE_FINAL = 0xFFFFFFFF
SEQUENCE_MAX_REPLACEABLE = 0xFFFFFFFE
SEQUENCE_LOCKTIME_DISABLE = 1 << 31
```
