#!/usr/bin/env npx tsx
/**
 * Verify the HTLC claim signature locally
 */

import { PrivateKey, PublicKey, Transaction, Script, Hash, TransactionSignature, Signature } from '@bsv/sdk'

// HTLC details
const HTLC_TXID = 'eb6cd86bc9323edd281eb2d5ab74ed853d50fbccdf12df1980413c0795d62ec8'
const HTLC_VOUT = 0
const HTLC_AMOUNT = 1000

// Moneo's key
const MONEO_PRIVKEY = '6acf2d2e086189b82480dfdb96214e6fb974f3b9cf6f8c2aae4df034ee4787af'
const MONEO_PUBKEY = '02b034bdb4bb942dec3bc192b9b6989690c7239e7a5da1a3470b3666e885136f27'

// HTLC locking script
const HTLC_SCRIPT_HEX = 'a82012e90b8e74f20fc0a7274cff9fcbae14592db12292757f1ea0d7503d30799fd2882102b034bdb4bb942dec3bc192b9b6989690c7239e7a5da1a3470b3666e885136f27ac'

// The signature from our claim attempt
const SIG_DER_HEX = '304402204ef8b1cb7373d4b417281b3cb46bd78d700b5d9f9b2281f53c6e1052a394f381022069d7078c9432f0ac60b024b6c24f1c5c154906fa6059d01074ddd4e6e0b5bca2'

async function main() {
  console.log('=== Signature Verification ===\n')
  
  const moneoKey = PrivateKey.fromString(MONEO_PRIVKEY, 'hex')
  const moneoPubKey = PublicKey.fromString(MONEO_PUBKEY)
  
  // Verify key derivation
  console.log('Private key derives to:', moneoKey.toPublicKey().toString())
  console.log('Expected pubkey:       ', MONEO_PUBKEY)
  console.log('Match:', moneoKey.toPublicKey().toString() === MONEO_PUBKEY)
  
  // Fetch HTLC tx
  console.log('\nFetching HTLC tx...')
  const htlcTxRes = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${HTLC_TXID}/hex`)
  const htlcTxHex = await htlcTxRes.text()
  const htlcTx = Transaction.fromHex(htlcTxHex)
  
  // Build the same claim tx
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
  const { P2PKH } = await import('@bsv/sdk')
  const p2pkh = new P2PKH()
  claimTx.addOutput({
    lockingScript: p2pkh.lock(moneoPubKey.toAddress()),
    satoshis: outputAmount
  })
  
  const htlcScript = Script.fromHex(HTLC_SCRIPT_HEX)
  const SIGHASH_ALL_FORKID = 0x41
  
  // Compute sighash preimage
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
  
  const sighash = Hash.hash256(preimage)
  console.log('\nSighash:', Buffer.from(sighash).toString('hex'))
  
  // Parse the existing signature
  const sigBytes = Buffer.from(SIG_DER_HEX, 'hex')
  const sig = Signature.fromDER(Array.from(sigBytes), 'strict')
  console.log('\nSignature R:', sig.r.toString(16))
  console.log('Signature S:', sig.s.toString(16))
  
  // Verify the signature against the sighash
  const verified = moneoPubKey.verify(sighash, sig)
  console.log('\nSignature valid:', verified)
  
  // Also try signing fresh and compare
  const freshSig = moneoKey.sign(sighash)
  console.log('\nFresh signature R:', freshSig.r.toString(16))
  console.log('Fresh signature S:', freshSig.s.toString(16))
  console.log('Fresh sig matches:', freshSig.r.toString(16) === sig.r.toString(16))
  
  // Verify fresh signature
  const freshVerified = moneoPubKey.verify(sighash, freshSig)
  console.log('Fresh sig valid:', freshVerified)
}

main().catch(console.error)
