/**
 * Final broadcast with both signatures
 */

import { PrivateKey, PublicKey, Transaction, P2PKH, Hash } from '@bsv/sdk'
import { createMultisigLockingScript, createMultisigUnlockingScript, signCommitment } from './src/channels/multisig.js'
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
  const myPrivateKey = PrivateKey.fromHex(config.bsvPrivateKey)
  const myPubKey = PublicKey.fromString(config.bsvPublicKey)
  const moneoPubKey = PublicKey.fromString('02b034bdb4bb942dec3bc192b9b6989690c7239e7a5da1a3470b3666e885136f27')
  
  // Funding tx
  const fundingTxId = '9306d47516a0c69244990b8076453af71481edca62d689c2c684b7ff6a258270'
  const fundingVout = 0
  const capacity = 10000
  
  // Final balances (all to me since channel was never used)
  const myFinalBalance = 9900  // 10000 - 100 fee (all goes to initiator since remote balance was 0)
  
  console.log('Creating and signing closing transaction...')
  
  // Fetch funding tx
  const fundingTxInfo = await fetchTransaction(fundingTxId)
  const fundingTx = Transaction.fromHex(fundingTxInfo.hex)
  
  // Create multisig script
  const multisigScript = createMultisigLockingScript(myPubKey, moneoPubKey)
  
  // Create closing transaction  
  const closeTx = new Transaction()
  
  closeTx.addInput({
    sourceTXID: fundingTxId,
    sourceOutputIndex: fundingVout,
    sourceTransaction: fundingTx,
    sequence: 0xffffffff
  })
  
  // Single output - all to me (since remote balance was 0)
  const p2pkh = new P2PKH()
  closeTx.addOutput({
    satoshis: myFinalBalance,
    lockingScript: p2pkh.lock(hash160(myPubKey.encode(true)))
  })
  
  // Sign my half
  const { signature: mySig } = signCommitment(
    closeTx,
    0,
    myPrivateKey,
    multisigScript,
    capacity
  )
  
  console.log('My signature:', Buffer.from(mySig).toString('hex'))
  
  // Moneo's signature from his message
  const moneoSigHex = '304402203a93ba801ef94ca0f575e148648439dca874b402153326f4a74a8eef8db61064022034168337ea4fe4eda5cfbefa09bbcb5abd3e4b641b99bb6708e03db81867f43941'
  const moneoSig = Array.from(Buffer.from(moneoSigHex, 'hex'))
  
  // Assemble with both signatures
  const unlockingScript = createMultisigUnlockingScript(mySig, moneoSig)
  
  // Create final tx
  const finalTx = new Transaction()
  
  finalTx.addInput({
    sourceTXID: fundingTxId,
    sourceOutputIndex: fundingVout,
    sourceTransaction: fundingTx,
    unlockingScript,
    sequence: 0xffffffff
  })
  
  finalTx.addOutput({
    satoshis: myFinalBalance,
    lockingScript: p2pkh.lock(hash160(myPubKey.encode(true)))
  })
  
  console.log('\nFinal TX Hex:', finalTx.toHex())
  console.log('\nBroadcasting...')
  
  try {
    const txid = await broadcastTransaction(finalTx.toHex())
    console.log(`\n🎉 SUCCESS! TXID: ${txid}`)
    console.log(`View: https://whatsonchain.com/tx/${txid.trim()}`)
  } catch (err: any) {
    console.error(`Broadcast failed: ${err.message}`)
    
    // Try swapped order
    console.log('\nTrying swapped signature order...')
    const unlockingScript2 = createMultisigUnlockingScript(moneoSig, mySig)
    
    const finalTx2 = new Transaction()
    finalTx2.addInput({
      sourceTXID: fundingTxId,
      sourceOutputIndex: fundingVout,
      sourceTransaction: fundingTx,
      unlockingScript: unlockingScript2,
      sequence: 0xffffffff
    })
    finalTx2.addOutput({
      satoshis: myFinalBalance,
      lockingScript: p2pkh.lock(hash160(myPubKey.encode(true)))
    })
    
    try {
      const txid2 = await broadcastTransaction(finalTx2.toHex())
      console.log(`\n🎉 SUCCESS! TXID: ${txid2}`)
      console.log(`View: https://whatsonchain.com/tx/${txid2.trim()}`)
    } catch (err2: any) {
      console.error(`Swapped order also failed: ${err2.message}`)
    }
  }
}

main().catch(console.error)
