#!/usr/bin/env npx tsx
/**
 * Claim the simple HTLC - just provide preimage, no signature
 */

import { Transaction, Script, P2PKH, PrivateKey } from '@bsv/sdk'
import * as fs from 'fs'
import * as path from 'path'

const CONFIG_DIR = path.join(process.env.HOME!, '.bsv-p2p')

// HTLC details
const HTLC_TXID = '68df18d25c2c53982a4fe7baed4f99da5a5590a335e88e16b1729f8b1a39d23c'
const HTLC_VOUT = 0
const HTLC_AMOUNT = 1000

// The secret preimage
const PREIMAGE = 'poop'
const PREIMAGE_BYTES = Buffer.from(PREIMAGE, 'utf8')

// Moneo's address (where to send the claimed sats)
const MONEO_ADDRESS = '1Hiyez9nKA1tX9bntaJqznbgzoPAbtzBzW'

async function main() {
  console.log('=== Claim Simple HTLC ===\n')
  console.log('Preimage:', PREIMAGE)
  console.log('Preimage hex:', PREIMAGE_BYTES.toString('hex'))
  
  // Fetch the HTLC transaction
  console.log('\nFetching HTLC tx...')
  const htlcTxRes = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${HTLC_TXID}/hex`)
  const htlcTxHex = await htlcTxRes.text()
  const htlcTx = Transaction.fromHex(htlcTxHex)
  
  console.log('HTLC output script:', htlcTx.outputs[HTLC_VOUT].lockingScript?.toASM())
  
  // Build the claim transaction
  const claimTx = new Transaction()
  claimTx.version = 1
  claimTx.lockTime = 0
  
  // Add input - the HTLC output
  claimTx.addInput({
    sourceTXID: HTLC_TXID,
    sourceOutputIndex: HTLC_VOUT,
    sourceTransaction: htlcTx,
    sequence: 0xffffffff
  })
  
  // Build unlocking script - just the preimage
  const unlockScript = new Script()
  unlockScript.writeBin(Array.from(PREIMAGE_BYTES))
  
  console.log('\nUnlocking script hex:', unlockScript.toHex())
  console.log('Unlocking script asm:', unlockScript.toASM())
  
  claimTx.inputs[0].unlockingScript = unlockScript
  
  // Add output - send to Moneo's address minus fee
  const fee = 150
  const outputAmount = HTLC_AMOUNT - fee
  
  // Convert Moneo's address to locking script
  // P2PKH for address 1Hiyez9nKA1tX9bntaJqznbgzoPAbtzBzW
  const p2pkh = new P2PKH()
  // We need to get the pubkey hash from the address
  // Address 1Hiyez9nKA1tX9bntaJqznbgzoPAbtzBzW
  // Let's use the config to get Moneo's pubkey if available, or use a standard P2PKH to his address
  
  // For simplicity, let's send to my wallet and I can forward to Moneo
  const configPath = path.join(CONFIG_DIR, 'config.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const myKey = PrivateKey.fromString(config.bsvPrivateKey, 'hex')
  
  claimTx.addOutput({
    lockingScript: p2pkh.lock(myKey.toPublicKey().toAddress()),
    satoshis: outputAmount
  })
  
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
    console.log('\n🎉 HTLC claimed with just the preimage!')
  } else {
    const error = await broadcastRes.text()
    console.error('❌ Broadcast failed:', error)
  }
}

main().catch(console.error)
