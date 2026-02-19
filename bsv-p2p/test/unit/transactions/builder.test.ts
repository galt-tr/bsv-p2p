/**
 * Unit tests for transaction builder
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { PrivateKey, Transaction } from '@bsv/sdk'
import { TransactionBuilder } from '../../../src/transactions/builder.js'

describe('TransactionBuilder', () => {
  let privKey: PrivateKey
  let address: string
  let mockUtxos: Array<{ txid: string; vout: number; satoshis: number; script: string }>

  beforeEach(() => {
    privKey = PrivateKey.fromRandom()
    address = privKey.toPublicKey().toAddress()
    
    mockUtxos = [
      {
        txid: '0'.repeat(64),
        vout: 0,
        satoshis: 20000,
        script: '76a914' + '00'.repeat(20) + '88ac'
      }
    ]
  })

  describe('constructor', () => {
    it('should create a builder instance', () => {
      const builder = new TransactionBuilder(privKey, mockUtxos)
      expect(builder).toBeInstanceOf(TransactionBuilder)
    })

    it('should throw error if no UTXOs provided', () => {
      expect(() => new TransactionBuilder(privKey, [])).toThrow('UTXOs must be provided')
    })
  })

  describe('addP2PKHOutput', () => {
    it('should add a P2PKH output', async () => {
      const recipient = PrivateKey.fromRandom().toPublicKey().toAddress()
      
      const result = await new TransactionBuilder(privKey, mockUtxos)
        .addP2PKHOutput(recipient, 5000)
        .build()

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
      
      const tx = Transaction.fromHex(result.tx)
      expect(tx.outputs.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('addPubKeyOutput', () => {
    it('should add output from public key', async () => {
      const recipientPubKey = PrivateKey.fromRandom().toPublicKey()
      
      const result = await new TransactionBuilder(privKey, mockUtxos)
        .addPubKeyOutput(recipientPubKey, 5000)
        .build()

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should accept public key as string', async () => {
      const recipientPubKeyStr = PrivateKey.fromRandom().toPublicKey().toString()
      
      const result = await new TransactionBuilder(privKey, mockUtxos)
        .addPubKeyOutput(recipientPubKeyStr, 5000)
        .build()

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('addMultisigOutput', () => {
    it('should add 2-of-2 multisig output', async () => {
      const pubKey1 = PrivateKey.fromRandom().toPublicKey()
      const pubKey2 = PrivateKey.fromRandom().toPublicKey()
      
      const result = await new TransactionBuilder(privKey, mockUtxos)
        .addMultisigOutput([pubKey1, pubKey2], 2, 5000)
        .build()

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should add 2-of-3 multisig output', async () => {
      const pubKey1 = PrivateKey.fromRandom().toPublicKey()
      const pubKey2 = PrivateKey.fromRandom().toPublicKey()
      const pubKey3 = PrivateKey.fromRandom().toPublicKey()
      
      const result = await new TransactionBuilder(privKey, mockUtxos)
        .addMultisigOutput([pubKey1, pubKey2, pubKey3], 2, 5000)
        .build()

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should throw if required > total keys', async () => {
      const pubKey1 = PrivateKey.fromRandom().toPublicKey()
      
      await expect(
        new TransactionBuilder(privKey, mockUtxos)
          .addMultisigOutput([pubKey1], 2, 5000)
          .build()
      ).rejects.toThrow('Required signatures cannot exceed number of public keys')
    })
  })

  describe('addDataOutput', () => {
    it('should add OP_RETURN data output', async () => {
      const result = await new TransactionBuilder(privKey, mockUtxos)
        .addDataOutput('Hello, World!')
        .build()

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
      
      const tx = Transaction.fromHex(result.tx)
      const opReturn = tx.outputs.find(out => 
        out.lockingScript.toASM().includes('OP_RETURN')
      )
      expect(opReturn).toBeDefined()
      expect(opReturn!.satoshis).toBe(0)
    })
  })

  describe('addMultiDataOutput', () => {
    it('should add multi-chunk OP_RETURN', async () => {
      const result = await new TransactionBuilder(privKey, mockUtxos)
        .addMultiDataOutput(['chunk1', 'chunk2', 'chunk3'])
        .build()

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('setChangeAddress', () => {
    it('should use custom change address', async () => {
      const changeAddr = PrivateKey.fromRandom().toPublicKey().toAddress()
      
      const result = await new TransactionBuilder(privKey, mockUtxos)
        .addP2PKHOutput(address, 1000)
        .setChangeAddress(changeAddr)
        .build()

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('setLockTime', () => {
    it('should set transaction lock time', async () => {
      const lockTime = Math.floor(Date.now() / 1000) + 3600
      
      const result = await new TransactionBuilder(privKey, mockUtxos)
        .addP2PKHOutput(address, 5000)
        .setLockTime(lockTime)
        .build()

      const tx = Transaction.fromHex(result.tx)
      expect(tx.lockTime).toBe(lockTime)
    })
  })

  describe('setSequence', () => {
    it('should set input sequence number', async () => {
      const sequence = 100
      
      const result = await new TransactionBuilder(privKey, mockUtxos)
        .addP2PKHOutput(address, 5000)
        .setSequence(sequence)
        .build()

      const tx = Transaction.fromHex(result.tx)
      expect(tx.inputs[0].sequence).toBe(sequence)
    })
  })

  describe('fluent API', () => {
    it('should chain multiple operations', async () => {
      const recipient1 = PrivateKey.fromRandom().toPublicKey().toAddress()
      const recipient2 = PrivateKey.fromRandom().toPublicKey().toAddress()
      
      const result = await new TransactionBuilder(privKey, mockUtxos)
        .addP2PKHOutput(recipient1, 3000)
        .addP2PKHOutput(recipient2, 2000)
        .addDataOutput('Payment metadata')
        .setDescription('Multi-recipient payment')
        .build()

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
      expect(result.beef).toBeDefined()
      expect(result.tx).toBeDefined()
      
      const tx = Transaction.fromHex(result.tx)
      expect(tx.outputs.length).toBeGreaterThanOrEqual(3) // 2 payments + OP_RETURN + maybe change
    })
  })
})
