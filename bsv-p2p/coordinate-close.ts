/**
 * Create exact closing tx and get sighash for Moneo to sign
 */

import { PrivateKey, PublicKey, Transaction, P2PKH, Hash, TransactionSignature } from '@bsv/sdk'
import { createMultisigLockingScript, createSighashPreimage, createMultisigUnlockingScript } from './src/channels/multisig.js'
import { fetchTransaction, broadcastTransaction } from './src/channels/bsv-services.js'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const { hash160, sha256 } = Hash

async function main() {
  // Load config
  const configPath = join(homedir(), '.bsv-p2p', 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  
  // Keys - MUST be in same order as funding tx multisig
  const myPubKey = PublicKey.fromString(config.bsvPublicKey)
  const moneoPubKey = PublicKey.fromString('02b034bdb4bb942dec3bc192b9b6989690c7239e7a5da1a3470b3666e885136f27')
  
  // Funding tx
  const fundingTxId = '9306d47516a0c69244990b8076453af71481edca62d689c2c684b7ff6a258270'
  const fundingVout = 0
  const capacity = 10000
  
  console.log('=== CLOSE TX COORDINATION ===')
  console.log('Funding TX:', fundingTxId)
  console.log('My pubkey:', config.bsvPublicKey)
  console.log('Moneo pubkey:', '02b034bdb4bb942dec3bc192b9b6989690c7239e7a5da1a3470b3666e885136f27')
  
  // Fetch funding tx
  const fundingTxInfo = await fetchTransaction(fundingTxId)
  const fundingTx = Transaction.fromHex(fundingTxInfo.hex)
  
  // Multisig script (from funding tx)
  const multisigScript = createMultisigLockingScript(myPubKey, moneoPubKey)
  console.log('\nMultisig script:', multisigScript.toHex())
  
  // Create closing transaction - single output, all to me
  const closeTx = new Transaction()
  
  closeTx.addInput({
    sourceTXID: fundingTxId,
    sourceOutputIndex: fundingVout,
    sourceTransaction: fundingTx,
    sequence: 0xffffffff
  })
  
  // Output: 9900 sats to my address
  const p2pkh = new P2PKH()
  const myPubKeyHash = hash160(myPubKey.encode(true))
  console.log('\nMy pubkey hash:', Buffer.from(myPubKeyHash).toString('hex'))
  
  closeTx.addOutput({
    satoshis: 9900,
    lockingScript: p2pkh.lock(myPubKeyHash)
  })
  
  console.log('\nOutput script:', closeTx.outputs[0].lockingScript.toHex())
  console.log('Output amount: 9900 sats')
  
  // Create sighash preimage
  const preimage = createSighashPreimage(closeTx, 0, multisigScript, capacity)
  const sighash = sha256(preimage)
  
  console.log('\n=== SIGHASH TO SIGN ===')
  console.log('Preimage:', Buffer.from(preimage).toString('hex'))
  console.log('Sighash:', Buffer.from(sighash).toString('hex'))
  
  // Sign my half
  const myPrivateKey = PrivateKey.fromHex(config.bsvPrivateKey)
  const myRawSig = myPrivateKey.sign(sighash)
  const mySigType = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
  const myTxSig = new TransactionSignature(myRawSig.r, myRawSig.s, mySigType)
  const mySig = myTxSig.toChecksigFormat()
  
  console.log('\n=== MY SIGNATURE ===')
  console.log(Buffer.from(mySig).toString('hex'))
  
  console.log('\n=== FOR MONEO ===')
  console.log('Sign this sighash:', Buffer.from(sighash).toString('hex'))
  console.log('With your privkey for pubkey:', '02b034bdb4bb942dec3bc192b9b6989690c7239e7a5da1a3470b3666e885136f27')
  console.log('Add sighash type 0x41 at end')
  
  // If Moneo provides sig, try broadcast
  const moneoSigArg = process.argv[2]
  if (moneoSigArg) {
    console.log('\n=== ATTEMPTING BROADCAST ===')
    const moneoSig = Array.from(Buffer.from(moneoSigArg, 'hex'))
    
    // Try both orders
    for (const [first, second, label] of [[mySig, moneoSig, 'me-first'], [moneoSig, mySig, 'moneo-first']] as const) {
      const unlockingScript = createMultisigUnlockingScript(first as number[], second as number[])
      
      const finalTx = new Transaction()
      finalTx.addInput({
        sourceTXID: fundingTxId,
        sourceOutputIndex: fundingVout,
        sourceTransaction: fundingTx,
        unlockingScript,
        sequence: 0xffffffff
      })
      finalTx.addOutput({
        satoshis: 9900,
        lockingScript: p2pkh.lock(myPubKeyHash)
      })
      
      console.log(`\nTrying ${label}...`)
      console.log('TX Hex:', finalTx.toHex())
      
      try {
        const txid = await broadcastTransaction(finalTx.toHex())
        console.log(`🎉 SUCCESS! TXID: ${txid}`)
        console.log(`https://whatsonchain.com/tx/${txid.trim()}`)
        return
      } catch (err: any) {
        console.log(`Failed: ${err.message}`)
      }
    }
  }
}

main().catch(console.error)
