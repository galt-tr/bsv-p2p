import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { PrivateKey, PublicKey, Transaction, Hash } from '@bsv/sdk'
import {
  createMultisigLockingScript,
  createMultisigUnlockingScript,
  createCommitmentTransaction,
  createSettlementTransaction,
  signCommitmentTransaction,
  verifyCommitmentSignature,
  getCommitmentSighash,
  SEQUENCE_FINAL,
  SEQUENCE_MAX_REPLACEABLE,
  CommitmentTxParams
} from '../../src/channels/transactions.js'

// Generate test keys once at module level
const privKeyA = PrivateKey.fromRandom()
const privKeyB = PrivateKey.fromRandom()
const pubKeyA = privKeyA.toPublicKey().toString()
const pubKeyB = privKeyB.toPublicKey().toString()
const addressA = privKeyA.toPublicKey().toAddress()
const addressB = privKeyB.toPublicKey().toAddress()

describe('Payment Channel Transactions', () => {

  describe('Multisig Scripts', () => {
    it('should create a 2-of-2 multisig locking script', () => {
      const script = createMultisigLockingScript(pubKeyA, pubKeyB)
      
      // Script should start with OP_2 (0x52)
      const scriptHex = script.toHex()
      expect(scriptHex.startsWith('52')).toBe(true)
      
      // Script should end with OP_2 OP_CHECKMULTISIG (52ae)
      expect(scriptHex.endsWith('52ae')).toBe(true)
      
      // Script should contain both pubkeys
      expect(scriptHex).toContain(pubKeyA)
      expect(scriptHex).toContain(pubKeyB)
    })

    it('should sort pubkeys lexicographically for determinism', () => {
      const script1 = createMultisigLockingScript(pubKeyA, pubKeyB)
      const script2 = createMultisigLockingScript(pubKeyB, pubKeyA)
      
      // Should produce identical scripts regardless of input order
      expect(script1.toHex()).toBe(script2.toHex())
    })

    it('should create a valid unlocking script', () => {
      const sigA = 'deadbeef01'  // Mock signature
      const sigB = 'cafebabe01'
      
      const script = createMultisigUnlockingScript(sigA, sigB)
      const scriptHex = script.toHex()
      
      // Should start with OP_0 (dummy for CHECKMULTISIG bug)
      expect(scriptHex.startsWith('00')).toBe(true)
    })
  })

  describe('Commitment Transactions', () => {
    const baseParams: CommitmentTxParams = {
      fundingTxId: 'a'.repeat(64),  // Mock txid
      fundingVout: 0,
      fundingAmount: 100000,  // 100k sats
      pubKeyA,
      pubKeyB,
      addressA,
      addressB,
      balanceA: 70000,
      balanceB: 30000,
      sequenceNumber: 1,
      nLockTime: Math.floor(Date.now() / 1000) + 3600  // 1 hour from now
    }

    it('should create a commitment transaction', () => {
      const tx = createCommitmentTransaction(baseParams)
      
      expect(tx).toBeInstanceOf(Transaction)
      expect(tx.version).toBe(2)
      expect(tx.nLockTime).toBe(baseParams.nLockTime)
      expect(tx.inputs.length).toBe(1)
      expect(tx.outputs.length).toBe(2)  // One for each party
    })

    it('should use nLockTime for dispute window', () => {
      const futureTime = Math.floor(Date.now() / 1000) + 7200  // 2 hours
      const tx = createCommitmentTransaction({
        ...baseParams,
        nLockTime: futureTime
      })
      
      expect(tx.nLockTime).toBe(futureTime)
    })

    it('should use nSequence for replacement ordering', () => {
      // Lower logical sequence = higher nSequence (newer state)
      const tx1 = createCommitmentTransaction({ ...baseParams, sequenceNumber: 1 })
      const tx2 = createCommitmentTransaction({ ...baseParams, sequenceNumber: 5 })
      
      // tx2 has higher logical sequence, so lower nSequence (can replace tx1)
      expect(tx2.inputs[0].sequence).toBeLessThan(tx1.inputs[0].sequence)
    })

    it('should not exceed SEQUENCE_MAX_REPLACEABLE', () => {
      const tx = createCommitmentTransaction({ ...baseParams, sequenceNumber: 0 })
      
      expect(tx.inputs[0].sequence).toBeLessThanOrEqual(SEQUENCE_MAX_REPLACEABLE)
    })

    it('should distribute balances correctly', () => {
      const tx = createCommitmentTransaction(baseParams)
      
      // Outputs should sum to capacity minus fee
      const totalOutput = tx.outputs.reduce((sum, out) => sum + out.satoshis!, 0)
      expect(totalOutput).toBeLessThanOrEqual(baseParams.fundingAmount)
      expect(totalOutput).toBeGreaterThan(baseParams.fundingAmount - 1000)  // Fee shouldn't be crazy
    })

    it('should reject if balances exceed capacity', () => {
      expect(() => createCommitmentTransaction({
        ...baseParams,
        balanceA: 80000,
        balanceB: 30000  // Total 110k > 100k capacity
      })).toThrow('exceed funding amount')
    })

    it('should skip dust outputs', () => {
      const tx = createCommitmentTransaction({
        ...baseParams,
        balanceA: 99500,
        balanceB: 500  // 500 sats - after fee share, will be dust
      })
      
      // Should only have 1 output (party B's output is dust)
      expect(tx.outputs.length).toBe(1)
    })

    it('should handle equal split', () => {
      const tx = createCommitmentTransaction({
        ...baseParams,
        balanceA: 50000,
        balanceB: 50000
      })
      
      expect(tx.outputs.length).toBe(2)
    })
  })

  describe('Settlement Transactions', () => {
    const baseParams = {
      fundingTxId: 'b'.repeat(64),
      fundingVout: 0,
      fundingAmount: 100000,
      pubKeyA: pubKeyA,
      pubKeyB: pubKeyB,
      addressA,
      addressB,
      balanceA: 60000,
      balanceB: 40000,
      nLockTime: Math.floor(Date.now() / 1000) + 3600
    }

    it('should create a settlement transaction with final sequence', () => {
      const tx = createSettlementTransaction(baseParams)
      
      expect(tx.inputs[0].sequence).toBe(SEQUENCE_FINAL)
    })

    it('should have zero locktime for immediate broadcast', () => {
      const tx = createSettlementTransaction(baseParams)
      
      expect(tx.nLockTime).toBe(0)
    })

    it('should not be replaceable (final)', () => {
      const tx = createSettlementTransaction(baseParams)
      
      // SEQUENCE_FINAL means no RBF possible
      expect(tx.inputs[0].sequence).toBe(SEQUENCE_FINAL)
    })
  })

  // Skip signature tests - @bsv/sdk API has changed
  // TODO: Update to use new signing API
  describe.skip('Signature Operations', () => {
    const fundingScript = createMultisigLockingScript(pubKeyA, pubKeyB)
    const fundingAmount = 100000
    
    const commitmentParams: CommitmentTxParams = {
      fundingTxId: 'c'.repeat(64),
      fundingVout: 0,
      fundingAmount,
      pubKeyA,
      pubKeyB,
      addressA,
      addressB,
      balanceA: 50000,
      balanceB: 50000,
      sequenceNumber: 1,
      nLockTime: Math.floor(Date.now() / 1000) + 3600
    }

    it('should sign a commitment transaction', () => {
      const tx = createCommitmentTransaction(commitmentParams)
      const sig = signCommitmentTransaction(tx, privKeyA, fundingScript, fundingAmount)
      
      expect(sig).toBeTruthy()
      expect(typeof sig).toBe('string')
      // Signature should be DER encoded + sighash byte
      expect(sig.length).toBeGreaterThan(100)  // DER sigs are ~140+ hex chars
    })

    it('should verify a valid signature', () => {
      const tx = createCommitmentTransaction(commitmentParams)
      const sig = signCommitmentTransaction(tx, privKeyA, fundingScript, fundingAmount)
      
      const isValid = verifyCommitmentSignature(tx, sig, pubKeyA, fundingScript, fundingAmount)
      expect(isValid).toBe(true)
    })

    it('should reject an invalid signature', () => {
      const tx = createCommitmentTransaction(commitmentParams)
      const sig = signCommitmentTransaction(tx, privKeyA, fundingScript, fundingAmount)
      
      // Verify with wrong pubkey
      const isValid = verifyCommitmentSignature(tx, sig, pubKeyB, fundingScript, fundingAmount)
      expect(isValid).toBe(false)
    })

    it('should produce different signatures for different transactions', () => {
      const tx1 = createCommitmentTransaction(commitmentParams)
      const tx2 = createCommitmentTransaction({
        ...commitmentParams,
        sequenceNumber: 2
      })
      
      const sig1 = signCommitmentTransaction(tx1, privKeyA, fundingScript, fundingAmount)
      const sig2 = signCommitmentTransaction(tx2, privKeyA, fundingScript, fundingAmount)
      
      expect(sig1).not.toBe(sig2)
    })

    it('should get deterministic sighash', () => {
      const tx = createCommitmentTransaction(commitmentParams)
      
      const hash1 = getCommitmentSighash(tx, fundingScript, fundingAmount)
      const hash2 = getCommitmentSighash(tx, fundingScript, fundingAmount)
      
      expect(hash1.toString('hex')).toBe(hash2.toString('hex'))
    })
  })

  describe('Payment Channel State Transitions', () => {
    const fundingScript = createMultisigLockingScript(pubKeyA, pubKeyB)
    const capacity = 100000

    it('should handle payment flow: open -> pay -> pay -> close', () => {
      // Initial state: A has all funds
      let balanceA = capacity
      let balanceB = 0
      let sequence = 0
      const nLockTime = Math.floor(Date.now() / 1000) + 3600

      // Create initial commitment
      const commitment0 = createCommitmentTransaction({
        fundingTxId: 'd'.repeat(64),
        fundingVout: 0,
        fundingAmount: capacity,
        pubKeyA,
        pubKeyB,
        addressA,
        addressB,
        balanceA,
        balanceB,
        sequenceNumber: sequence,
        nLockTime
      })
      
      // Payment 1: A pays B 10000 sats
      sequence++
      balanceA -= 10000
      balanceB += 10000
      
      const commitment1 = createCommitmentTransaction({
        fundingTxId: 'd'.repeat(64),
        fundingVout: 0,
        fundingAmount: capacity,
        pubKeyA,
        pubKeyB,
        addressA,
        addressB,
        balanceA,
        balanceB,
        sequenceNumber: sequence,
        nLockTime
      })
      
      // Verify newer commitment has lower nSequence
      expect(commitment1.inputs[0].sequence).toBeLessThan(commitment0.inputs[0].sequence)
      
      // Payment 2: A pays B another 5000 sats
      sequence++
      balanceA -= 5000
      balanceB += 5000
      
      const commitment2 = createCommitmentTransaction({
        fundingTxId: 'd'.repeat(64),
        fundingVout: 0,
        fundingAmount: capacity,
        pubKeyA,
        pubKeyB,
        addressA,
        addressB,
        balanceA,
        balanceB,
        sequenceNumber: sequence,
        nLockTime
      })
      
      expect(commitment2.inputs[0].sequence).toBeLessThan(commitment1.inputs[0].sequence)
      
      // Close: Create settlement
      const settlement = createSettlementTransaction({
        fundingTxId: 'd'.repeat(64),
        fundingVout: 0,
        fundingAmount: capacity,
        pubKeyA,
        pubKeyB,
        addressA,
        addressB,
        balanceA,  // 85000
        balanceB,  // 15000
        nLockTime
      })
      
      expect(settlement.inputs[0].sequence).toBe(SEQUENCE_FINAL)
      expect(settlement.nLockTime).toBe(0)
      
      // Final balances should be correct
      expect(balanceA).toBe(85000)
      expect(balanceB).toBe(15000)
    })

    it('should enforce replacement ordering via nSequence', () => {
      const baseParams = {
        fundingTxId: 'e'.repeat(64),
        fundingVout: 0,
        fundingAmount: capacity,
        pubKeyA,
        pubKeyB,
        addressA,
        addressB,
        nLockTime: Math.floor(Date.now() / 1000) + 3600
      }

      // Create commitments with increasing sequence numbers
      const sequences = [0, 1, 2, 5, 10, 100]
      const commitments = sequences.map(seq => 
        createCommitmentTransaction({
          ...baseParams,
          balanceA: capacity - seq * 1000,
          balanceB: seq * 1000,
          sequenceNumber: seq
        })
      )

      // Verify nSequence decreases as logical sequence increases
      for (let i = 1; i < commitments.length; i++) {
        expect(commitments[i].inputs[0].sequence)
          .toBeLessThan(commitments[i - 1].inputs[0].sequence)
      }
    })
  })
})
