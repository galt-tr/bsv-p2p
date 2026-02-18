/**
 * Assemble both signatures and broadcast closing transaction
 */

import { PrivateKey, PublicKey, Transaction, P2PKH, Hash, UnlockingScript, OP } from '@bsv/sdk'
import { createMultisigLockingScript, createMultisigUnlockingScript } from './src/channels/multisig.js'
import { fetchTransaction, broadcastTransaction } from './src/channels/bsv-services.js'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const { hash160 } = Hash

async function main() {
  // Load config
  const configPath = join(homedir(), '.bsv-p2p', 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  
  // Keys
  const myPubKey = PublicKey.fromString(config.bsvPublicKey)
  const moneoPubKey = PublicKey.fromString('02b034bdb4bb942dec3bc192b9b6989690c7239e7a5da1a3470b3666e885136f27')
  
  // Signatures (in order: first key in multisig, then second)
  const mySigHex = '3044022005272026e5f94c13c63773cbb80c986a72c937fa0b1d40ede58b3b5aecc3a79902204e5e7d1884dbc7a041e5ce321fbb22149421104e6019d6f5ed1c01493327404a41'
  const moneoSigHex = '3045022100f4abc5e5c9b75f58c7c5daa459ad70427b94b8d374dc1d6e42704e47f730c78a02202bf3617042694eda4542f6a8b57e0837589965e1833af46efa60607c24421baf41'
  
  const mySig = Array.from(Buffer.from(mySigHex, 'hex'))
  const moneoSig = Array.from(Buffer.from(moneoSigHex, 'hex'))
  
  // Funding tx
  const fundingTxId = '9306d47516a0c69244990b8076453af71481edca62d689c2c684b7ff6a258270'
  const fundingVout = 0
  const capacity = 10000
  
  // Final balances
  const myFinalBalance = 4900  // 5000 - 100 fee
  const moneoFinalBalance = 4900
  
  console.log('Assembling closing transaction...')
  
  // Fetch funding tx
  const fundingTxInfo = await fetchTransaction(fundingTxId)
  const fundingTx = Transaction.fromHex(fundingTxInfo.hex)
  
  // Create closing transaction
  const closeTx = new Transaction()
  
  // Input with unlocking script (try Moneo's sig first)
  const unlockingScript = createMultisigUnlockingScript(moneoSig, mySig)
  
  closeTx.addInput({
    sourceTXID: fundingTxId,
    sourceOutputIndex: fundingVout,
    sourceTransaction: fundingTx,
    unlockingScript,
    sequence: 0xffffffff
  })
  
  // Outputs
  const p2pkh = new P2PKH()
  
  // My output
  closeTx.addOutput({
    satoshis: myFinalBalance,
    lockingScript: p2pkh.lock(hash160(myPubKey.encode(true)))
  })
  
  // Moneo's output  
  closeTx.addOutput({
    satoshis: moneoFinalBalance,
    lockingScript: p2pkh.lock(hash160(moneoPubKey.encode(true)))
  })
  
  console.log('Close TX assembled!')
  console.log(`TX Hex: ${closeTx.toHex()}`)
  console.log(`\nBroadcasting...`)
  
  try {
    const txid = await broadcastTransaction(closeTx.toHex())
    console.log(`\n🎉 SUCCESS! TXID: ${txid}`)
    console.log(`View: https://whatsonchain.com/tx/${txid}`)
  } catch (err: any) {
    console.error(`Broadcast failed: ${err.message}`)
  }
}

main().catch(console.error)
