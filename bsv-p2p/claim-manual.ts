#!/usr/bin/env npx tsx
/**
 * Manual HTLC claim - no SDK for transaction building
 */

import * as crypto from 'crypto'

const HTLC_TXID = 'eb6cd86bc9323edd281eb2d5ab74ed853d50fbccdf12df1980413c0795d62ec8'
const HTLC_VOUT = 0
const HTLC_AMOUNT = 1000
const HTLC_SCRIPT = 'a82012e90b8e74f20fc0a7274cff9fcbae14592db12292757f1ea0d7503d30799fd2882102b034bdb4bb942dec3bc192b9b6989690c7239e7a5da1a3470b3666e885136f27ac'
const PREIMAGE = 'poop'
const MONEO_PRIVKEY = '6acf2d2e086189b82480dfdb96214e6fb974f3b9cf6f8c2aae4df034ee4787af'

// Output details
const FEE = 200
const OUTPUT_AMOUNT = HTLC_AMOUNT - FEE
// Moneo's P2PKH address hash
const OUTPUT_SCRIPT = '76a914e9e3b07441b4774037aeffd4a795e395c3f50ea688ac'

function sha256(data: Buffer): Buffer {
  return crypto.createHash('sha256').update(data).digest()
}

function hash256(data: Buffer): Buffer {
  return sha256(sha256(data))
}

function reverse(hex: string): string {
  return hex.match(/.{2}/g)!.reverse().join('')
}

function writeUInt32LE(n: number): string {
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(n)
  return buf.toString('hex')
}

function writeUInt64LE(n: number): string {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(BigInt(n))
  return buf.toString('hex')
}

function writeVarInt(n: number): string {
  if (n < 0xfd) return n.toString(16).padStart(2, '0')
  throw new Error('VarInt too large')
}

function derEncode(r: Buffer, s: Buffer): Buffer {
  // Ensure positive (add leading 00 if high bit set)
  if (r[0] >= 0x80) r = Buffer.concat([Buffer.from([0]), r])
  if (s[0] >= 0x80) s = Buffer.concat([Buffer.from([0]), s])
  
  // Remove unnecessary leading zeros
  while (r.length > 1 && r[0] === 0 && r[1] < 0x80) r = r.slice(1)
  while (s.length > 1 && s[0] === 0 && s[1] < 0x80) s = s.slice(1)
  
  const rLen = r.length
  const sLen = s.length
  const totalLen = 4 + rLen + sLen
  
  return Buffer.concat([
    Buffer.from([0x30, totalLen, 0x02, rLen]),
    r,
    Buffer.from([0x02, sLen]),
    s
  ])
}

async function main() {
  console.log('=== Manual HTLC Claim ===\n')
  
  // Compute BIP143 sighash preimage
  const SIGHASH_ALL_FORKID = 0x41
  
  // 1. nVersion
  const nVersion = writeUInt32LE(1)
  
  // 2. hashPrevouts
  const prevout = reverse(HTLC_TXID) + writeUInt32LE(HTLC_VOUT)
  const hashPrevouts = hash256(Buffer.from(prevout, 'hex')).toString('hex')
  
  // 3. hashSequence  
  const hashSequence = hash256(Buffer.from(writeUInt32LE(0xffffffff), 'hex')).toString('hex')
  
  // 4. outpoint (same as prevout for single input)
  const outpoint = prevout
  
  // 5. scriptCode (HTLC script with varint length prefix)
  const scriptCode = writeVarInt(HTLC_SCRIPT.length / 2) + HTLC_SCRIPT
  
  // 6. amount
  const amount = writeUInt64LE(HTLC_AMOUNT)
  
  // 7. nSequence
  const nSequence = writeUInt32LE(0xffffffff)
  
  // 8. hashOutputs
  const output = writeUInt64LE(OUTPUT_AMOUNT) + writeVarInt(OUTPUT_SCRIPT.length / 2) + OUTPUT_SCRIPT
  const hashOutputs = hash256(Buffer.from(output, 'hex')).toString('hex')
  
  // 9. nLockTime
  const nLockTime = writeUInt32LE(0)
  
  // 10. sighash type
  const sighashType = writeUInt32LE(SIGHASH_ALL_FORKID)
  
  const preimage = nVersion + hashPrevouts + hashSequence + outpoint + scriptCode + amount + nSequence + hashOutputs + nLockTime + sighashType
  console.log('Preimage:', preimage)
  
  const sighash = hash256(Buffer.from(preimage, 'hex'))
  console.log('Sighash:', sighash.toString('hex'))
  
  // Sign using Node's crypto (ECDSA with secp256k1)
  const privKey = Buffer.from(MONEO_PRIVKEY, 'hex')
  const sign = crypto.createSign('sha256')
  // We've already hashed, so we need to use the raw sighash
  // Actually crypto.sign expects to hash the message, but we've already hashed
  // Let's use the ECDSA directly
  
  const { privateKeyExport, signatureExport } = await import('@noble/secp256k1')
  const { sign: ecdsaSign, utils } = await import('@noble/secp256k1')
  
  // Sign the sighash directly
  const sigCompact = ecdsaSign(sighash, privKey, { lowS: true })
  console.log('Signature (compact):', Buffer.from(sigCompact).toString('hex'))
  
  // Convert to DER
  const r = Buffer.from(sigCompact.slice(0, 32))
  const s = Buffer.from(sigCompact.slice(32, 64))
  const sigDER = derEncode(r, s)
  const fullSig = Buffer.concat([sigDER, Buffer.from([SIGHASH_ALL_FORKID])])
  console.log('Signature (DER+hashtype):', fullSig.toString('hex'))
  
  // Build unlocking script: <sig> <preimage>
  const preimageBytes = Buffer.from(PREIMAGE)
  const unlockingScript = writeVarInt(fullSig.length) + fullSig.toString('hex') + writeVarInt(preimageBytes.length) + preimageBytes.toString('hex')
  console.log('Unlocking script:', unlockingScript)
  
  // Build full transaction
  const version = writeUInt32LE(1)
  const inputCount = '01'
  const inputTxid = reverse(HTLC_TXID)
  const inputVout = writeUInt32LE(HTLC_VOUT)
  const inputScriptLen = writeVarInt(unlockingScript.length / 2)
  const inputSequence = writeUInt32LE(0xffffffff)
  const outputCount = '01'
  const outputValue = writeUInt64LE(OUTPUT_AMOUNT)
  const outputScriptLen = writeVarInt(OUTPUT_SCRIPT.length / 2)
  const lockTime = writeUInt32LE(0)
  
  const tx = version + inputCount + inputTxid + inputVout + inputScriptLen + unlockingScript + inputSequence + outputCount + outputValue + outputScriptLen + OUTPUT_SCRIPT + lockTime
  
  console.log('\n=== Transaction ===')
  console.log('Hex:', tx)
  console.log('Size:', tx.length / 2, 'bytes')
  
  // Compute TXID
  const txid = reverse(hash256(Buffer.from(tx, 'hex')).toString('hex'))
  console.log('TXID:', txid)
  
  // Broadcast
  console.log('\nBroadcasting...')
  const res = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: tx })
  })
  
  if (res.ok) {
    console.log('✅ Success:', await res.text())
  } else {
    console.log('❌ Failed:', await res.text())
  }
}

main().catch(console.error)
