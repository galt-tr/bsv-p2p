# Cooperative Close Protocol - Lessons Learned

## The Problem

Two parties need to sign the **exact same transaction**. If either party builds a slightly different tx (different outputs, amounts, or addresses), the signatures won't combine.

## What Went Wrong Initially

1. **Different output configurations**: I sent "split 5000/5000", then later "10000/0" - Moneo signed the first version
2. **Address derivation mismatch**: Different ways of deriving output addresses from pubkeys
3. **Protocol messages as text**: Moneo's daemon sent JSON text instead of typed protocol messages

## The Solution: Sighash Coordination

The key insight: **share the exact sighash, not tx parameters**.

### Correct Flow

```
1. Initiator creates closing tx locally
2. Initiator computes sighash preimage and hashes it
3. Initiator signs the sighash
4. Initiator sends SIGHASH (32 bytes hex) to responder
5. Responder signs the SAME sighash with their key
6. Responder sends signature back
7. Initiator combines signatures and broadcasts
```

### Critical Details

**Sighash computation:**
```typescript
const preimage = createSighashPreimage(tx, inputIndex, multisigScript, sourceSatoshis)
const sighash = sha256(preimage)
// sighash is what both parties sign
```

**Signature format:**
- Sign the 32-byte sighash with ECDSA
- Append sighash type byte (0x41 = SIGHASH_ALL | SIGHASH_FORKID)
- Result is DER-encoded signature + 1 byte

**Multisig unlocking script order:**
- Signatures must be in same order as pubkeys in the locking script
- OP_0 <sig1> <sig2> where sig1 corresponds to first pubkey

## Improved Protocol Messages

### CLOSE_REQUEST should include:
```json
{
  "type": "close:request",
  "channelId": "...",
  "fundingTxId": "...",
  "fundingVout": 0,
  "capacity": 10000,
  "initiatorFinalBalance": 9900,
  "responderFinalBalance": 0,
  "fee": 100,
  "sighash": "e1d157145023af0f05677af175d69ca1318de217bcf5cfcf4a710322331ee6ba",
  "initiatorSignature": "3044...41",
  "outputScriptHex": "76a914...88ac"
}
```

### CLOSE_ACCEPT should include:
```json
{
  "type": "close:accept", 
  "channelId": "...",
  "sighash": "e1d157145023af0f05677af175d69ca1318de217bcf5cfcf4a710322331ee6ba",
  "responderSignature": "3044...41"
}
```

**Key**: Responder should verify the sighash matches expected tx before signing!

## Verification Steps (Responder)

Before signing, responder should:
1. Rebuild the tx from parameters
2. Compute sighash locally
3. Verify it matches the sighash in the request
4. Only then sign

## Quick Reference

```bash
# Generate sighash for closing tx
npx tsx coordinate-close.ts

# Broadcast with Moneo's signature
npx tsx coordinate-close.ts <moneo-signature-hex>
```

## Summary

| Step | Initiator | Responder |
|------|-----------|-----------|
| 1 | Create tx, compute sighash | - |
| 2 | Sign sighash | - |
| 3 | Send sighash + sig | Receive |
| 4 | - | Verify sighash matches expected tx |
| 5 | - | Sign same sighash |
| 6 | Receive sig | Send sig |
| 7 | Combine sigs, broadcast | - |
| 8 | Send CLOSE_COMPLETE | Receive confirmation |

## Files

- `src/channels/close.ts` - Close protocol implementation
- `src/channels/multisig.ts` - Sighash preimage creation
- `coordinate-close.ts` - Manual close coordination script
