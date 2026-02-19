#!/usr/bin/env npx tsx
/**
 * Compare manual BIP143 vs SDK sighash preimage
 */

import { Transaction, Script, Hash, TransactionSignature, P2PKH, PrivateKey } from '@bsv/sdk'
import * as crypto from 'crypto'

const HTLC_TXID = 'eb6cd86bc9323edd281eb2d5ab74ed853d50fbccdf12df1980413c0795d62ec8'
const HTLC_VOUT = 0
const HTLC_AMOUNT = 1000
const HTLC_SCRIPT_HEX = 'a82012e90b8e74f20fc0a7274cff9fcbae14592db12292757f1ea0d7503d30799fd2882102b034bdb4bb942dec3bc192b9b6989690c7239e7a5da1a3470b3666e885136f27ac'
const MONEO_PRIVKEY = '6acf2d2e086189b82480dfdb96214e6fb974f3b9cf6f8c2aae4df034ee4787af'

function sha256(data: Buffer): Buffer {
  return crypto.createHash('sha256').update(data).digest()
}

function hash256(data: Buffer): Buffer {
  return sha256(sha256(data))
}

function reverseBuffer(buf: Buffer): Buffer {
  return Buffer.from(buf).reverse()
}

function writeUInt64LE(value: number): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(BigInt(value))
  return buf
}

function writeUInt32LE(value: number): Buffer {
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(value)
  return buf
}

function writeVarInt(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n])
  throw new Error('VarInt too large')
}

async function main() {
  const moneoKey = PrivateKey.fromString(MONEO_PRIVKEY, 'hex')
  
  // Fetch HTLC tx
  const htlcTxRes = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${HTLC_TXID}/hex`)
  const htlcTxHex = await htlcTxRes.text()
  const htlcTx = Transaction.fromHex(htlcTxHex)
  
  // Build claim tx
  const claimTx = new Transaction()
  claimTx.version = 1
  claimTx.lockTime = 0
  
  claimTx.addInput({
    sourceTXID: HTLC_TXID,
    sourceOutputIndex: HTLC_VOUT,
    sourceTransaction: htlcTx,
    sequence: 0xffffffff
  })
  
  const fee = 200
  const outputAmount = HTLC_AMOUNT - fee
  const p2pkh = new P2PKH()
  claimTx.addOutput({
    lockingScript: p2pkh.lock(moneoKey.toPublicKey().toAddress()),
    satoshis: outputAmount
  })
  
  const htlcScript = Script.fromHex(HTLC_SCRIPT_HEX)
  const SIGHASH_ALL_FORKID = 0x41
  
  // === SDK PREIMAGE ===
  const sdkPreimage = TransactionSignature.format({
    sourceTXID: HTLC_TXID,
    sourceOutputIndex: HTLC_VOUT,
    sourceSatoshis: HTLC_AMOUNT,
    transactionVersion: claimTx.version,
    otherInputs: [],
    outputs: claimTx.outputs,
    inputIndex: 0,
    subscript: htlcScript,
    inputSequence: 0xffffffff,
    lockTime: claimTx.lockTime,
    scope: SIGHASH_ALL_FORKID
  })
  
  console.log('=== SDK Preimage ===')
  console.log('Length:', sdkPreimage.length)
  console.log('Hex:', Buffer.from(sdkPreimage).toString('hex'))
  console.log('Sighash:', Buffer.from(Hash.hash256(sdkPreimage)).toString('hex'))
  
  // === MANUAL PREIMAGE ===
  const htlcScriptBuf = Buffer.from(HTLC_SCRIPT_HEX, 'hex')
  
  // 1. nVersion
  const nVersion = writeUInt32LE(1)
  
  // 2. hashPrevouts
  const prevoutTxid = reverseBuffer(Buffer.from(HTLC_TXID, 'hex'))
  const prevoutVout = writeUInt32LE(HTLC_VOUT)
  const hashPrevouts = hash256(Buffer.concat([prevoutTxid, prevoutVout]))
  
  // 3. hashSequence
  const hashSequence = hash256(writeUInt32LE(0xffffffff))
  
  // 4. outpoint
  const outpoint = Buffer.concat([prevoutTxid, prevoutVout])
  
  // 5. scriptCode (with length prefix)
  const scriptCode = Buffer.concat([writeVarInt(htlcScriptBuf.length), htlcScriptBuf])
  
  // 6. value
  const value = writeUInt64LE(HTLC_AMOUNT)
  
  // 7. nSequence
  const nSequence = writeUInt32LE(0xffffffff)
  
  // 8. hashOutputs
  const outputScript = Buffer.from(claimTx.outputs[0].lockingScript!.toHex(), 'hex')
  const outputData = Buffer.concat([
    writeUInt64LE(outputAmount),
    writeVarInt(outputScript.length),
    outputScript
  ])
  const hashOutputs = hash256(outputData)
  
  // 9. nLockTime
  const nLockTime = writeUInt32LE(0)
  
  // 10. sighash type
  const sighashType = writeUInt32LE(SIGHASH_ALL_FORKID)
  
  const manualPreimage = Buffer.concat([
    nVersion,
    hashPrevouts,
    hashSequence,
    outpoint,
    scriptCode,
    value,
    nSequence,
    hashOutputs,
    nLockTime,
    sighashType
  ])
  
  console.log('\n=== Manual Preimage ===')
  console.log('Length:', manualPreimage.length)
  console.log('Hex:', manualPreimage.toString('hex'))
  console.log('Sighash:', hash256(manualPreimage).toString('hex'))
  
  // === COMPARE ===
  console.log('\n=== Comparison ===')
  console.log('Lengths match:', sdkPreimage.length === manualPreimage.length)
  
  const sdkBuf = Buffer.from(sdkPreimage)
  for (let i = 0; i < Math.min(sdkBuf.length, manualPreimage.length); i++) {
    if (sdkBuf[i] !== manualPreimage[i]) {
      console.log(`First difference at byte ${i}: SDK=${sdkBuf[i].toString(16)} Manual=${manualPreimage[i].toString(16)}`)
      console.log('Context (SDK):', sdkBuf.slice(Math.max(0, i-4), i+10).toString('hex'))
      console.log('Context (Manual):', manualPreimage.slice(Math.max(0, i-4), i+10).toString('hex'))
      break
    }
  }
  
  // Print components
  console.log('\n=== Components ===')
  console.log('nVersion:', nVersion.toString('hex'))
  console.log('hashPrevouts:', hashPrevouts.toString('hex'))
  console.log('hashSequence:', hashSequence.toString('hex'))
  console.log('outpoint:', outpoint.toString('hex'))
  console.log('scriptCode:', scriptCode.toString('hex'))
  console.log('value:', value.toString('hex'))
  console.log('nSequence:', nSequence.toString('hex'))
  console.log('hashOutputs:', hashOutputs.toString('hex'))
  console.log('nLockTime:', nLockTime.toString('hex'))
  console.log('sighashType:', sighashType.toString('hex'))
}

main().catch(console.error)
