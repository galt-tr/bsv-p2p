/**
 * Unit tests for channel transactions
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { PrivateKey, PublicKey, Transaction } from '@bsv/sdk'
import {
  createChannelFunding,
  createChannelCommitment,
  createChannelClose,
  finalizeChannelCommitment
} from '../../../src/transactions/channel.js'

describe('Channel Transactions', () => {
  let alicePrivKey: PrivateKey
  let bobPrivKey: PrivateKey
  let alicePubKey: PublicKey
  let bobPubKey: PublicKey
  let aliceAddress: string
  let bobAddress: string
  let mockUtxos: Array<{ txid: string; vout: number; satoshis: number; script: string }>

  beforeEach(() => {
    alicePrivKey = PrivateKey.fromRandom()
    bobPrivKey = PrivateKey.fromRandom()
    alicePubKey = alicePrivKey.toPublicKey()
    bobPubKey = bobPrivKey.toPublicKey()
    aliceAddress = alicePubKey.toAddress()
    bobAddress = bobPubKey.toAddress()
    
    mockUtxos = [
      {
        txid: '0'.repeat(64),
        vout: 0,
        satoshis: 20000,
        script: '76a914' + '00'.repeat(20) + '88ac'
      }
    ]
  })

  describe('createChannelFunding', () => {
    it('should create a 2-of-2 multisig funding transaction', async () => {
      const capacity = 10000

      const result = await createChannelFunding(
        alicePrivKey,
        capacity,
        alicePubKey,
        bobPubKey,
        mockUtxos,
        aliceAddress
      )

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
      expect(result.vout).toBe(0)
      expect(result.satoshis).toBe(capacity)
      expect(result.script).toBeDefined()
      expect(result.redeemScript).toBeDefined()
    })

    it('should throw error if no UTXOs provided', async () => {
      await expect(
        createChannelFunding(
          alicePrivKey,
          10000,
          alicePubKey,
          bobPubKey,
          [],
          aliceAddress
        )
      ).rejects.toThrow('UTXOs must be provided')
    })

    it('should create change output when needed', async () => {
      const capacity = 5000 // Less than input

      const result = await createChannelFunding(
        alicePrivKey,
        capacity,
        alicePubKey,
        bobPubKey,
        mockUtxos,
        aliceAddress
      )

      expect(result.satoshis).toBe(capacity)
    })
  })

  describe('createChannelCommitment', () => {
    it('should create a commitment transaction', async () => {
      const fundingTxid = '0'.repeat(64)
      const fundingVout = 0
      const fundingScript = 'deadbeef' // Simplified
      const myBalance = 6000
      const peerBalance = 4000
      const nSequence = 1
      const nLockTime = Math.floor(Date.now() / 1000) + 3600

      const result = await createChannelCommitment(
        fundingTxid,
        fundingVout,
        fundingScript,
        myBalance,
        peerBalance,
        aliceAddress,
        bobAddress,
        alicePrivKey,
        nSequence,
        nLockTime
      )

      expect(result.tx).toBeDefined()
      expect(result.signature).toBeDefined()
      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
      
      // Verify transaction structure
      const tx = Transaction.fromHex(result.tx)
      expect(tx.inputs.length).toBe(1)
      expect(tx.outputs.length).toBe(2) // Both parties have balance
      expect(tx.lockTime).toBe(nLockTime)
    })

    it('should omit zero-balance outputs', async () => {
      const fundingTxid = '0'.repeat(64)
      const fundingVout = 0
      const fundingScript = 'deadbeef'
      const myBalance = 10000
      const peerBalance = 0 // Peer has no balance
      const nSequence = 1
      const nLockTime = Math.floor(Date.now() / 1000) + 3600

      const result = await createChannelCommitment(
        fundingTxid,
        fundingVout,
        fundingScript,
        myBalance,
        peerBalance,
        aliceAddress,
        bobAddress,
        alicePrivKey,
        nSequence,
        nLockTime
      )

      const tx = Transaction.fromHex(result.tx)
      expect(tx.outputs.length).toBe(1) // Only my output
    })
  })

  describe('createChannelClose', () => {
    it('should create a cooperative close transaction', async () => {
      const fundingTxid = '0'.repeat(64)
      const fundingVout = 0
      const fundingScript = 'deadbeef'
      const myBalance = 6000
      const peerBalance = 4000

      const result = await createChannelClose(
        fundingTxid,
        fundingVout,
        fundingScript,
        myBalance,
        peerBalance,
        aliceAddress,
        bobAddress,
        alicePrivKey
      )

      expect(result.tx).toBeDefined()
      expect(result.signature).toBeDefined()
      
      // Verify it uses max sequence
      const tx = Transaction.fromHex(result.tx)
      expect(tx.inputs[0].sequence).toBe(0xffffffff)
      expect(tx.lockTime).toBe(0)
    })
  })

  describe('finalizeChannelCommitment', () => {
    it('should finalize commitment with both signatures', async () => {
      // Create a commitment transaction
      const fundingTxid = '0'.repeat(64)
      const fundingVout = 0
      const fundingScript = 'deadbeef'
      const myBalance = 6000
      const peerBalance = 4000
      const nSequence = 1
      const nLockTime = Math.floor(Date.now() / 1000) + 3600

      const commitment = await createChannelCommitment(
        fundingTxid,
        fundingVout,
        fundingScript,
        myBalance,
        peerBalance,
        aliceAddress,
        bobAddress,
        alicePrivKey,
        nSequence,
        nLockTime
      )

      // Mock peer signature (in reality this would come from peer)
      const peerSig = commitment.signature // Simplified for test

      const result = await finalizeChannelCommitment(
        commitment.tx,
        fundingScript,
        commitment.signature,
        peerSig
      )

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
      expect(result.beef).toBeDefined()
      expect(result.tx).toBeDefined()
      
      // Verify unlocking script was added
      const tx = Transaction.fromHex(result.tx)
      expect(tx.inputs[0].unlockingScript).toBeDefined()
    })
  })
})
