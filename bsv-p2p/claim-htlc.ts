#!/usr/bin/env npx tsx
/**
 * Claim the HTLC for Moneo
 */

import { PrivateKey, Transaction, Script, P2PKH, Hash, TransactionSignature } from '@bsv/sdk'

// HTLC details
const HTLC_TXID = 'eb6cd86bc9323edd281eb2d5ab74ed853d50fbccdf12df1980413c0795d62ec8'
const HTLC_VOUT = 0
const HTLC_AMOUNT = 1000

// The secret
const PREIMAGE = 'poop'
const PREIMAGE_BYTES = Buffer.from(PREIMAGE, 'utf8')

// Moneo's key
const MONEO_PRIVKEY = '6acf2d2e086189b82480dfdb96214e6fb974f3b9cf6f8c2aae4df034ee4787af'

// HTLC locking script
const HTLC_SCRIPT_HEX = 'a82012e90b8e74f20fc0a7274cff9fcbae14592db12292757f1ea0d7503d30799fd2882102b034bdb4bb942dec3bc192b9b6989690c7239e7a5da1a3470b3666e885136f27ac'

async function main() {
  console.log('=== HTLC Claim Transaction ===\n')
  
  const moneoKey = PrivateKey.fromString(MONEO_PRIVKEY, 'hex')
  const moneoPubKey = moneoKey.toPublicKey()
  console.log('Moneo pubkey:', moneoPubKey.toString())
  
  // Verify preimage hash
  const preimageHash = Hash.sha256(Array.from(PREIMAGE_BYTES))
  console.log('Preimage:', PREIMAGE, '(hex:', Buffer.from(PREIMAGE_BYTES).toString('hex'), ')')
  console.log('SHA256(preimage):', Buffer.from(preimageHash).toString('hex'))
  
  // Fetch HTLC tx
  console.log('\nFetching HTLC tx...')
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
  
  // Add output - send to Moneo's address
  const fee = 200
  const outputAmount = HTLC_AMOUNT - fee
  const p2pkh = new P2PKH()
  claimTx.addOutput({
    lockingScript: p2pkh.lock(moneoPubKey.toAddress()),
    satoshis: outputAmount
  })
  
  // The HTLC locking script
  const htlcScript = Script.fromHex(HTLC_SCRIPT_HEX)
  
  // Sighash type
  const SIGHASH_ALL_FORKID = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID // 0x41
  
  // Format the sighash preimage
  const preimage = TransactionSignature.format({
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
  
  console.log('\nSighash preimage length:', preimage.length)
  
  // Hash the preimage (double SHA256)
  const sighash = Hash.hash256(preimage)
  console.log('Sighash:', Buffer.from(sighash).toString('hex'))
  
  // Sign with the private key
  const signature = moneoKey.sign(sighash)
  console.log('Signature R:', signature.r.toString(16))
  console.log('Signature S:', signature.s.toString(16))
  
  // DER encode and add sighash type
  const sigDER = signature.toDER()
  const fullSig = [...sigDER, SIGHASH_ALL_FORKID]
  console.log('Full sig:', Buffer.from(fullSig).toString('hex'))
  
  // Build unlocking script: <sig> <preimage>
  const unlockScript = new Script()
  unlockScript.writeBin(fullSig)
  unlockScript.writeBin(Array.from(PREIMAGE_BYTES))
  
  console.log('\nUnlocking script hex:', unlockScript.toHex())
  console.log('Unlocking script asm:', unlockScript.toASM())
  
  // Set the unlocking script
  claimTx.inputs[0].unlockingScript = unlockScript
  
  const claimTxHex = claimTx.toHex()
  const claimTxId = claimTx.id('hex')
  
  console.log('\n=== Claim Transaction ===')
  console.log('TXID:', claimTxId)
  console.log('Hex:', claimTxHex)
  console.log('Size:', claimTxHex.length / 2, 'bytes')
  
  // Broadcast
  console.log('\nBroadcasting...')
  const broadcastRes = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: claimTxHex })
  })
  
  if (broadcastRes.ok) {
    const result = await broadcastRes.text()
    console.log('✅ Broadcast successful!')
    console.log('TXID:', result.replace(/"/g, ''))
    console.log('\n🎉 Moneo claimed', outputAmount, 'sats!')
  } else {
    const error = await broadcastRes.text()
    console.error('❌ Broadcast failed:', error)
  }
}

main().catch(console.error)
