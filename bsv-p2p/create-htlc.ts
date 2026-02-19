#!/usr/bin/env npx tsx
/**
 * Create an HTLC (Hash Time Locked Contract) transaction
 * Moneo can claim 1000 sats by revealing the preimage "poop"
 */

import { PrivateKey, PublicKey, Transaction, Script, Hash, P2PKH } from '@bsv/sdk'
import * as fs from 'fs'
import * as path from 'path'

const CONFIG_DIR = path.join(process.env.HOME!, '.bsv-p2p')

// The hash of "poop"
const SECRET = 'poop'
const SECRET_HASH = Hash.sha256(Buffer.from(SECRET, 'utf8'))
console.log('Secret hash:', Buffer.from(SECRET_HASH).toString('hex'))

// Moneo's public key (from channel record)
const MONEO_PUBKEY = '02b034bdb4bb942dec3bc192b9b6989690c7239e7a5da1a3470b3666e885136f27'

// Amount to lock
const HTLC_AMOUNT = 1000

async function main() {
  // Load my wallet key
  const configPath = path.join(CONFIG_DIR, 'config.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const myKey = PrivateKey.fromString(config.bsvPrivateKey, 'hex')
  
  // Get UTXOs from daemon
  const utxoRes = await fetch('http://127.0.0.1:4002/wallet/sync', { method: 'POST' })
  const utxoData = await utxoRes.json() as any
  
  const balanceRes = await fetch('http://127.0.0.1:4002/wallet/utxos')
  const utxos = (await balanceRes.json() as any).utxos
  
  // Fetch fresh UTXOs from WoC instead of local DB (DB may be stale)
  const wocRes = await fetch('https://api.whatsonchain.com/v1/bsv/main/address/1Dodgcnetv9bkMxVvrD18XTMZ7u76WtXgJ/unspent')
  const wocUtxos = await wocRes.json() as any[]
  
  if (!wocUtxos || wocUtxos.length === 0) {
    console.error('No UTXOs available on-chain')
    process.exit(1)
  }
  
  // Pick a UTXO with enough value
  const wocUtxo = wocUtxos.find((u: any) => u.value >= HTLC_AMOUNT + 200)
  if (!wocUtxo) {
    console.error('No UTXO with sufficient funds')
    process.exit(1)
  }
  
  // Map WoC format to our format
  const utxo = {
    txid: wocUtxo.tx_hash,
    vout: wocUtxo.tx_pos,
    satoshis: wocUtxo.value
  }
  
  console.log('Using UTXO:', utxo.txid, 'vout:', utxo.vout, 'sats:', utxo.satoshis)
  
  // Fetch the source transaction
  const txidClean = utxo.txid.trim()
  console.log('Fetching source tx:', txidClean)
  const srcTxRes = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txidClean}/hex`)
  if (!srcTxRes.ok) {
    console.error('Failed to fetch source tx')
    process.exit(1)
  }
  const srcTxHex = await srcTxRes.text()
  const sourceTx = Transaction.fromHex(srcTxHex)
  console.log('Source tx fetched, outputs:', sourceTx.outputs.length)
  
  // Build the HTLC locking script
  // OP_SHA256 <hash> OP_EQUALVERIFY <pubkey> OP_CHECKSIG
  const moneoPubKey = PublicKey.fromString(MONEO_PUBKEY)
  
  const htlcScript = new Script()
  htlcScript.writeOpCode(0xa8) // OP_SHA256
  htlcScript.writeBin(SECRET_HASH)
  htlcScript.writeOpCode(0x88) // OP_EQUALVERIFY
  htlcScript.writeBin(moneoPubKey.encode(true) as number[])
  htlcScript.writeOpCode(0xac) // OP_CHECKSIG
  
  console.log('HTLC Script (hex):', htlcScript.toHex())
  console.log('HTLC Script (asm):', htlcScript.toASM())
  
  // Create the transaction
  const tx = new Transaction()
  
  // Add input (my UTXO)
  tx.addInput({
    sourceTXID: txidClean,
    sourceOutputIndex: utxo.vout,
    sourceTransaction: sourceTx,
    unlockingScriptTemplate: new P2PKH().unlock(myKey),
    sequence: 0xffffffff
  })
  
  // Add HTLC output (1000 sats locked for Moneo)
  tx.addOutput({
    lockingScript: htlcScript,
    satoshis: HTLC_AMOUNT
  })
  
  // Add change output back to me
  const fee = 150
  const change = utxo.satoshis - HTLC_AMOUNT - fee
  if (change > 546) { // dust threshold
    tx.addOutput({
      lockingScript: new P2PKH().lock(myKey.toPublicKey().toAddress()),
      satoshis: change
    })
  }
  
  // Sign the transaction
  await tx.sign()
  
  const txHex = tx.toHex()
  const txid = tx.id('hex')
  
  console.log('\n=== HTLC Transaction ===')
  console.log('TXID:', txid)
  console.log('Hex:', txHex)
  console.log('Size:', txHex.length / 2, 'bytes')
  
  // Broadcast
  console.log('\nBroadcasting...')
  const broadcastRes = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: txHex })
  })
  
  if (broadcastRes.ok) {
    const result = await broadcastRes.text()
    console.log('✅ Broadcast successful!')
    console.log('TXID:', result.replace(/"/g, ''))
    console.log('\nMoneo can claim by providing:')
    console.log('  - Preimage: "poop"')
    console.log('  - His signature')
    console.log('\nHTLC Output Index: 0')
    console.log('HTLC Amount:', HTLC_AMOUNT, 'sats')
  } else {
    const error = await broadcastRes.text()
    console.error('❌ Broadcast failed:', error)
  }
}

main().catch(console.error)
