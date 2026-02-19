/**
 * Create and sign a closing transaction for a funded payment channel
 */

import { PrivateKey, PublicKey, Transaction, P2PKH, Hash } from '@bsv/sdk'
import { 
  createMultisigLockingScript, 
  signCommitment,
  createMultisigUnlockingScript 
} from './src/channels/multisig.js'
import { fetchTransaction, broadcastTransaction } from './src/channels/bsv-services.js'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

const { hash160 } = Hash

async function main() {
  // Load config
  const configPath = join(homedir(), '.bsv-p2p', 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  
  // Our keys
  const myPrivateKey = PrivateKey.fromHex(config.bsvPrivateKey)
  const myPubKey = PublicKey.fromString(config.bsvPublicKey)
  
  // Moneo's pubkey (from the funding tx)
  const moneoPubKey = PublicKey.fromString('02b034bdb4bb942dec3bc192b9b6989690c7239e7a5da1a3470b3666e885136f27')
  
  // Funding tx details
  const fundingTxId = '9306d47516a0c69244990b8076453af71481edca62d689c2c684b7ff6a258270'
  const fundingVout = 0
  const capacity = 10000
  
  // Final balances (since no payments on this channel, split it 50/50 for demo)
  const myFinalBalance = 5000
  const moneoFinalBalance = 5000
  const fee = 200
  
  console.log('Creating closing transaction...')
  console.log(`Funding TX: ${fundingTxId}`)
  console.log(`My balance: ${myFinalBalance} sats`)
  console.log(`Moneo balance: ${moneoFinalBalance} sats`)
  
  // Fetch the funding transaction
  const fundingTxInfo = await fetchTransaction(fundingTxId)
  const fundingTx = Transaction.fromHex(fundingTxInfo.hex)
  
  // Create multisig script (same as funding)
  const multisigScript = createMultisigLockingScript(myPubKey, moneoPubKey)
  
  // Create closing transaction
  const closeTx = new Transaction()
  
  // Input: spend the funding tx output
  closeTx.addInput({
    sourceTXID: fundingTxId,
    sourceOutputIndex: fundingVout,
    sourceTransaction: fundingTx,
    sequence: 0xffffffff
  })
  
  // Outputs: pay each party their final balance
  const p2pkh = new P2PKH()
  
  // My output
  if (myFinalBalance - fee/2 > 546) {
    closeTx.addOutput({
      satoshis: myFinalBalance - fee/2,
      lockingScript: p2pkh.lock(hash160(myPubKey.encode(true)))
    })
  }
  
  // Moneo's output
  if (moneoFinalBalance - fee/2 > 546) {
    // Moneo's address from his pubkey
    closeTx.addOutput({
      satoshis: moneoFinalBalance - fee/2,
      lockingScript: p2pkh.lock(hash160(moneoPubKey.encode(true)))
    })
  }
  
  console.log('\nClose TX created (unsigned)')
  console.log(`Outputs: ${closeTx.outputs.length}`)
  
  // Sign our half
  const { signature: mySig } = signCommitment(
    closeTx,
    0,
    myPrivateKey,
    multisigScript,
    capacity
  )
  
  console.log(`\nMy signature: ${Buffer.from(mySig).toString('hex')}`)
  console.log('\nSending to Moneo for co-signature...')
  
  // Output the close tx hex and my signature for Moneo
  const closeData = {
    closeTxHex: closeTx.toHex(),
    mySignature: Buffer.from(mySig).toString('hex'),
    myPubKey: config.bsvPublicKey,
    moneoPubKey: '02b034bdb4bb942dec3bc192b9b6989690c7239e7a5da1a3470b3666e885136f27',
    fundingTxId,
    fundingVout,
    capacity,
    myFinalBalance,
    moneoFinalBalance,
    fee
  }
  
  console.log('\n=== CLOSE DATA FOR MONEO ===')
  console.log(JSON.stringify(closeData, null, 2))
}

main().catch(console.error)
