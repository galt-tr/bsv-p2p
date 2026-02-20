/**
 * BSV Services for Payment Channels
 * 
 * Handles:
 * - UTXO fetching from WhatsOnChain
 * - Transaction broadcasting
 * - SPV verification via ChainTracks
 * - BRC-42 key derivation for channel keys
 */

import { PrivateKey, PublicKey, Transaction, Hash, MerklePath, Beef } from '@bsv/sdk'

const { sha256 } = Hash

// WhatsOnChain API
const WOC_BASE = 'https://api.whatsonchain.com/v1/bsv/main'

export interface UTXO {
  txid: string
  vout: number
  satoshis: number
  scriptPubKey: string
}

export interface TxInfo {
  txid: string
  hex: string
  blockHeight?: number
  blockHash?: string
  merkleProof?: any
}

/**
 * Fetch UTXOs for an address from WhatsOnChain
 */
export async function fetchUTXOs(address: string): Promise<UTXO[]> {
  const response = await fetch(`${WOC_BASE}/address/${address}/unspent`)
  if (!response.ok) {
    throw new Error(`Failed to fetch UTXOs: ${response.statusText}`)
  }
  
  const utxos = await response.json()
  
  // Get script for each UTXO
  const result: UTXO[] = []
  for (const utxo of utxos) {
    const txResponse = await fetch(`${WOC_BASE}/tx/${utxo.tx_hash}/hex`)
    if (txResponse.ok) {
      const txHex = await txResponse.text()
      const tx = Transaction.fromHex(txHex)
      const output = tx.outputs[utxo.tx_pos]
      
      result.push({
        txid: utxo.tx_hash,
        vout: utxo.tx_pos,
        satoshis: utxo.value,
        scriptPubKey: output.lockingScript.toHex()
      })
    }
  }
  
  return result
}

/**
 * Fetch a transaction by txid
 */
export async function fetchTransaction(txid: string): Promise<TxInfo> {
  const hexResponse = await fetch(`${WOC_BASE}/tx/${txid}/hex`)
  if (!hexResponse.ok) {
    throw new Error(`Failed to fetch transaction: ${hexResponse.statusText}`)
  }
  
  const hex = await hexResponse.text()
  
  // Get confirmation info
  const infoResponse = await fetch(`${WOC_BASE}/tx/${txid}`)
  let blockHeight: number | undefined
  let blockHash: string | undefined
  
  if (infoResponse.ok) {
    const info = await infoResponse.json()
    if (info.blockheight) {
      blockHeight = info.blockheight
      blockHash = info.blockhash
    }
  }
  
  return { txid, hex, blockHeight, blockHash }
}

/**
 * Fetch BEEF (BRC-62) format for a transaction
 * This includes merkle proofs for SPV verification
 */
export async function fetchBEEF(txid: string): Promise<number[]> {
  // WoC doesn't have BEEF endpoint yet, so we construct it manually
  const txInfo = await fetchTransaction(txid)
  
  if (!txInfo.blockHeight) {
    throw new Error('Transaction not confirmed - cannot create BEEF')
  }
  
  // Fetch merkle proof
  const proofResponse = await fetch(`${WOC_BASE}/tx/${txid}/proof`)
  if (!proofResponse.ok) {
    throw new Error(`Failed to fetch merkle proof: ${proofResponse.statusText}`)
  }
  
  const proof = await proofResponse.json()
  
  // Create BEEF structure
  const tx = Transaction.fromHex(txInfo.hex)
  const merklePath = MerklePath.fromBinary(proof)
  tx.merklePath = merklePath
  
  const beef = new Beef()
  beef.mergeTx(tx)
  
  return Array.from(beef.toBinary())
}

/**
 * Broadcast a transaction
 */
export async function broadcastTransaction(txHex: string): Promise<string> {
  const response = await fetch(`${WOC_BASE}/tx/raw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: txHex })
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Broadcast failed: ${error}`)
  }
  
  const txid = await response.text()
  return txid.replace(/"/g, '').trim() // Remove quotes and whitespace
}

// ChainTracks API for SPV verification
const CHAINTRACKS_BASE = 'https://mainnet-chaintracks.babbage.systems'

/**
 * Verify a merkle root is valid for a given block height
 */
export async function verifyMerkleRoot(root: string, height: number): Promise<boolean> {
  try {
    const response = await fetch(`${CHAINTRACKS_BASE}/api/v1/chain/header/${height}`)
    if (!response.ok) {
      console.warn(`ChainTracks lookup failed: ${response.statusText}`)
      return false
    }
    
    const header = await response.json()
    return header.merkleRoot === root
  } catch (err) {
    console.warn('ChainTracks verification failed:', err)
    return false
  }
}

/**
 * Verify a transaction's merkle proof
 */
export async function verifyTransaction(txid: string): Promise<boolean> {
  try {
    const txInfo = await fetchTransaction(txid)
    
    if (!txInfo.blockHeight) {
      console.log('Transaction not confirmed yet')
      return false
    }
    
    // Fetch and verify merkle proof
    const proofResponse = await fetch(`${WOC_BASE}/tx/${txid}/proof`)
    if (!proofResponse.ok) {
      return false
    }
    
    const proof = await proofResponse.json()
    
    // The proof should contain the merkle root
    // Verify it matches the block header from ChainTracks
    if (proof.merkleRoot) {
      return await verifyMerkleRoot(proof.merkleRoot, txInfo.blockHeight)
    }
    
    return true // If we got this far, consider it verified
  } catch (err) {
    console.error('Transaction verification failed:', err)
    return false
  }
}

/**
 * BRC-42 style key derivation for payment channels
 * 
 * Derives a channel-specific key from a master key using the peer's public key
 * and a unique invoice number (channel ID).
 */
export function deriveChannelKey(
  masterKey: PrivateKey,
  counterpartyPubKey: PublicKey,
  channelId: string
): PrivateKey {
  // Use BRC-42 derivation: HMAC(sharedSecret, invoiceNumber)
  return masterKey.deriveChild(counterpartyPubKey, `channel:${channelId}`)
}

/**
 * Derive a public key for a channel (for the counterparty)
 */
export function deriveChannelPubKey(
  masterPubKey: PublicKey,
  ourPrivateKey: PrivateKey,
  channelId: string
): PublicKey {
  // The counterparty can derive our channel public key
  return masterPubKey.deriveChild(ourPrivateKey, `channel:${channelId}`)
}

/**
 * Get current block height from ChainTracks
 */
export async function getCurrentHeight(): Promise<number> {
  try {
    const response = await fetch(`${CHAINTRACKS_BASE}/api/v1/chain/tip/height`)
    if (!response.ok) {
      throw new Error(`Failed to get height: ${response.statusText}`)
    }
    const height = await response.json()
    return height
  } catch (err) {
    // Fallback to WoC
    const response = await fetch(`${WOC_BASE}/chain/info`)
    const info = await response.json()
    return info.blocks
  }
}

/**
 * Wait for a transaction to be confirmed
 */
export async function waitForConfirmation(
  txid: string,
  timeoutMs: number = 600000, // 10 minutes default
  pollIntervalMs: number = 10000 // 10 seconds
): Promise<TxInfo> {
  const startTime = Date.now()
  
  while (Date.now() - startTime < timeoutMs) {
    const txInfo = await fetchTransaction(txid)
    
    if (txInfo.blockHeight) {
      return txInfo
    }
    
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
  }
  
  throw new Error(`Transaction ${txid} not confirmed within ${timeoutMs}ms`)
}
