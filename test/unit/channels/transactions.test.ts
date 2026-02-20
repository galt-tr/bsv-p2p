import { describe, it, expect } from 'vitest'
import { 
  buildMultisigScript, 
  buildFundingTx,
  buildCommitmentTx,
  buildSettlementTx
} from '../../../src/channels/transactions.js'

describe('Channel Transactions', () => {
  // Test keypairs (not real, just for testing script structure)
  const pubKey1 = '02' + 'a'.repeat(64)  // 33 bytes compressed
  const pubKey2 = '02' + 'b'.repeat(64)

  describe('buildMultisigScript', () => {
    it('should create a 2-of-2 multisig script', () => {
      const script = buildMultisigScript(pubKey1, pubKey2)
      const hex = script.toHex()
      
      // Should contain OP_2 ... OP_2 OP_CHECKMULTISIG
      expect(hex).toContain('52')  // OP_2
      expect(hex).toContain('ae')  // OP_CHECKMULTISIG
    })

    it('should sort pubkeys for determinism', () => {
      // Order shouldn't matter - should get same script
      const script1 = buildMultisigScript(pubKey1, pubKey2)
      const script2 = buildMultisigScript(pubKey2, pubKey1)
      
      expect(script1.toHex()).toBe(script2.toHex())
    })
  })

  describe('buildFundingTx', () => {
    it('should create a transaction with multisig output', () => {
      const tx = buildFundingTx({
        localPubKey: pubKey1,
        remotePubKey: pubKey2,
        amountSats: 10000,
        inputs: [{
          txid: 'a'.repeat(64),
          vout: 0,
          script: '76a914' + 'c'.repeat(40) + '88ac',
          satoshis: 20000
        }],
        changeAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
      })

      expect(tx.outputs.length).toBeGreaterThanOrEqual(1)
      expect(tx.outputs[0].satoshis).toBe(10000)
    })

    it('should add change output when sufficient', () => {
      const tx = buildFundingTx({
        localPubKey: pubKey1,
        remotePubKey: pubKey2,
        amountSats: 5000,
        inputs: [{
          txid: 'a'.repeat(64),
          vout: 0,
          script: '76a914' + 'c'.repeat(40) + '88ac',
          satoshis: 20000
        }],
        changeAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
      })

      // Should have multisig output + change
      expect(tx.outputs.length).toBe(2)
    })
  })

  describe('buildCommitmentTx', () => {
    it('should create commitment with correct balances', () => {
      const tx = buildCommitmentTx({
        fundingTxId: 'a'.repeat(64),
        fundingVout: 0,
        capacitySats: 10000,
        seq: 5,
        localBalanceSats: 6000,
        remoteBalanceSats: 4000,
        localPubKey: pubKey1,
        remotePubKey: pubKey2,
        localAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        remoteAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
      })

      expect(tx.outputs.length).toBe(2)
      expect(tx.outputs[0].satoshis).toBe(6000)
      expect(tx.outputs[1].satoshis).toBe(4000)
    })

    it('should use decreasing nSequence for replacement', () => {
      const tx1 = buildCommitmentTx({
        fundingTxId: 'a'.repeat(64),
        fundingVout: 0,
        capacitySats: 10000,
        seq: 1,
        localBalanceSats: 5000,
        remoteBalanceSats: 5000,
        localPubKey: pubKey1,
        remotePubKey: pubKey2,
        localAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        remoteAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
      })

      const tx2 = buildCommitmentTx({
        fundingTxId: 'a'.repeat(64),
        fundingVout: 0,
        capacitySats: 10000,
        seq: 5,
        localBalanceSats: 5000,
        remoteBalanceSats: 5000,
        localPubKey: pubKey1,
        remotePubKey: pubKey2,
        localAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        remoteAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
      })

      // Higher seq = lower nSequence
      expect(tx2.inputs[0].sequence).toBeLessThan(tx1.inputs[0].sequence!)
    })

    it('should reject invalid balances', () => {
      expect(() => buildCommitmentTx({
        fundingTxId: 'a'.repeat(64),
        fundingVout: 0,
        capacitySats: 10000,
        seq: 1,
        localBalanceSats: 6000,
        remoteBalanceSats: 5000, // Sums to 11000, not 10000
        localPubKey: pubKey1,
        remotePubKey: pubKey2,
        localAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        remoteAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
      })).toThrow()
    })

    it('should skip dust outputs', () => {
      const tx = buildCommitmentTx({
        fundingTxId: 'a'.repeat(64),
        fundingVout: 0,
        capacitySats: 10000,
        seq: 1,
        localBalanceSats: 100, // Below dust
        remoteBalanceSats: 9900,
        localPubKey: pubKey1,
        remotePubKey: pubKey2,
        localAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        remoteAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
      })

      // Only remote output (local is dust)
      expect(tx.outputs.length).toBe(1)
      expect(tx.outputs[0].satoshis).toBe(9900)
    })
  })

  describe('buildSettlementTx', () => {
    it('should create final settlement (no replacement)', () => {
      const tx = buildSettlementTx({
        fundingTxId: 'a'.repeat(64),
        fundingVout: 0,
        capacitySats: 10000,
        localBalanceSats: 6000,
        remoteBalanceSats: 4000,
        localPubKey: pubKey1,
        remotePubKey: pubKey2,
        localAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        remoteAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
      })

      // Settlement should have final sequence
      expect(tx.inputs[0].sequence).toBe(0xffffffff)
      expect(tx.lockTime).toBe(0)
    })
  })
})
