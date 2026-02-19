#!/usr/bin/env npx tsx
/**
 * Create another simple HTLC for Moneo to claim
 */

import { PrivateKey, Transaction, Script, Hash, P2PKH } from '@bsv/sdk'
import * as fs from 'fs'
import * as path from 'path'

const CONFIG_DIR = path.join(process.env.HOME!, '.bsv-p2p')

// New secret for this round
const SECRET = 'moneo'
const SECRET_HASH = Hash.sha256(Buffer.from(SECRET, 'utf8'))
console.log('Secret:', SECRET)
console.log('Secret hash:', Buffer.from(SECRET_HASH).toString('hex'))

const HTLC_AMOUNT = 1000

async function main() {
  const configPath = path.join(CONFIG_DIR, 'config.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const myKey = PrivateKey.fromString(config.bsvPrivateKey, 'hex')
  
  const address = myKey.toPublicKey().toAddress()
  console.log('\nMy address:', address)
  
  // Fetch UTXOs
  const wocRes = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`)
  const wocUtxos = await wocRes.json() as any[]
  
  const wocUtxo = wocUtxos.find((u: any) => u.value >= HTLC_AMOUNT + 200)
  if (!wocUtxo) {
    console.error('No UTXO with sufficient funds')
    process.exit(1)
  }
  
  const utxo = { txid: wocUtxo.tx_hash, vout: wocUtxo.tx_pos, satoshis: wocUtxo.value }
  console.log('Using UTXO:', utxo.txid, 'vout:', utxo.vout, 'sats:', utxo.satoshis)
  
  const srcTxRes = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${utxo.txid}/hex`)
  const srcTxHex = await srcTxRes.text()
  const sourceTx = Transaction.fromHex(srcTxHex)
  
  // Simple HTLC: OP_SHA256 <hash> OP_EQUAL
  const htlcScript = new Script()
  htlcScript.writeOpCode(0xa8) // OP_SHA256
  htlcScript.writeBin(SECRET_HASH)
  htlcScript.writeOpCode(0x87) // OP_EQUAL
  
  console.log('\nHTLC Script:', htlcScript.toASM())
  
  const tx = new Transaction()
  tx.addInput({
    sourceTXID: utxo.txid,
    sourceOutputIndex: utxo.vout,
    sourceTransaction: sourceTx,
    unlockingScriptTemplate: new P2PKH().unlock(myKey),
    sequence: 0xffffffff
  })
  
  tx.addOutput({ lockingScript: htlcScript, satoshis: HTLC_AMOUNT })
  
  const fee = 150
  const change = utxo.satoshis - HTLC_AMOUNT - fee
  if (change > 546) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(myKey.toPublicKey().toAddress()),
      satoshis: change
    })
  }
  
  await tx.sign()
  
  const txHex = tx.toHex()
  const txid = tx.id('hex')
  
  console.log('\n=== HTLC Transaction ===')
  console.log('TXID:', txid)
  console.log('Size:', txHex.length / 2, 'bytes')
  
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
    console.log('\n🔐 Moneo needs to reveal the preimage to claim!')
  } else {
    const error = await broadcastRes.text()
    console.error('❌ Broadcast failed:', error)
  }
}

main().catch(console.error)
