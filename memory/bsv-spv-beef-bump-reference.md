# BSV SPV, BEEF, and BUMP Reference Guide

> Critical technical reference for BSV development involving merkle proofs, transaction verification, and peer-to-peer transaction exchange.

---

## Executive Summary

| Standard | BRC | Purpose |
|----------|-----|---------|
| **SPV** | BRC-67 | Defines the verification steps for validating transactions without a full node |
| **BEEF** | BRC-62 | Binary format for transmitting transactions with their merkle proofs |
| **BUMP** | BRC-74 | Efficient encoding format for merkle paths (used inside BEEF) |

**Relationship Chain:**
```
BEEF contains → BUMPs (merkle proofs) + Raw Transactions
SPV requires → Merkle paths to prove inclusion in blocks
BUMP provides → The merkle path data that SPV needs
```

---

## BRC-67: Simplified Payment Verification (SPV)

### What It Defines

SPV is Bitcoin's security model for lightweight clients. Instead of downloading the entire blockchain, clients only need block headers and can verify transactions using merkle proofs.

### The Four SPV Verification Steps

When receiving a transaction from a counterparty, perform these checks:

#### 1. Script Evaluation
```
Each unlocking script + previous locking script → must evaluate to TRUE
```
- Concatenate input's unlocking script with the referenced output's locking script
- Execute the script interpreter
- Result must be a truthy value on the stack
- Note: "Check signatures" is the common case, but technically it's "script evaluation"

#### 2. Fee Check
```
sum(satoshis_in) > sum(satoshis_out)
```
- Each input references a previous output with a satoshi value
- Calculate: `fee = sum_inputs - sum_outputs`
- Calculate rate: `fee / tx_size_bytes`
- Standard rate: ~1 sat/byte minimum

#### 3. Merkle Path Verification (Critical!)
- **Every input must trace back to a mined transaction**
- If input is from a mined tx → must have merkle path proving inclusion in a block
- If input is from an unmined tx → must include that ancestor tx, recursively until all inputs trace to mined txs
- Merkle path leads txid → merkle root (which matches a block header you have)

#### 4. Locktime and Sequence
- Default `nLocktime`: `0x00000000`
- Default `nSequence`: `0xFFFFFFFF`
- Non-default values indicate special conditions (timelock, RBF, etc.)

### Key Insight for Offline Chains
When many transactions happen offline, each new tx appends to the SPV data. All prior ancestry propagates to all counterparties until broadcast. This is rare in practice.

---

## BRC-62: Background Evaluation Extended Format (BEEF)

### What It Defines

BEEF is a binary format for transmitting transactions between peers with all data needed for SPV verification. Optimized for minimal bandwidth.

### Magic Number
```
Version: 4022206465 (decimal)
Encoded: 0x0100BEEF (Uint32LE)
```
When you see `0100BEEF` at the start of data, you know it's BEEF format.

### Binary Structure

| Field | Size | Description |
|-------|------|-------------|
| Version | 4 bytes | `0100BEEF` (Uint32LE) |
| nBUMPs | 1-9 bytes (VarInt) | Number of BUMP structures following |
| BUMP data | variable × nBUMPs | Merkle proofs per BRC-74 |
| nTransactions | 1-9 bytes (VarInt) | Number of transactions following |
| *For each transaction:* | | |
| Raw Transaction | variable | Standard raw tx bytes (BRC-12) |
| Has BUMP | 1 byte | `0x01` if has merkle path, `0x00` if not |
| BUMP index | 1-9 bytes (VarInt) | Only if Has BUMP=0x01; index into BUMP array |

### Transaction Ordering (Critical!)

**Order matters!** Transactions must be topologically sorted:
- Oldest ancestors first (those with merkle proofs)
- Newest transaction last (the actual payment)
- Parents must appear before children

Use **Kahn's Algorithm** for topological sorting:

```javascript
function khanTopologicalSort(graph) {
  const inDegree = {}
  const queue = []
  const result = []
  
  for (let node in graph) {
    inDegree[node] = 0
  }
  for (let node in graph) {
    for (let neighbor in graph[node]) {
      inDegree[neighbor]++
    }
  }
  for (let node in inDegree) {
    if (inDegree[node] === 0) {
      queue.push(node)
    }
  }
  while (queue.length) {
    let node = queue.shift()
    result.push(node)
    for (let neighbor in graph[node]) {
      inDegree[neighbor]--
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor)
      }
    }
  }
  return result.reverse()
}
```

### BEEF Validation Process

1. **Parse BUMPs** → store in array by index
2. **Parse each transaction:**
   - Double SHA256 raw bytes → txid
   - Store in hashmap: `txid => parsedTx`
3. **If transaction has merkle path:**
   - Lookup BUMP by index
   - Find txid in BUMP's level 0 leaves
   - Calculate merkle root from BUMP data
   - Verify root against your block header service
   - Mark tx as valid/invalid
4. **If transaction has no merkle path (local parent):**
   - Verify parent txid exists in memory and is marked valid
   - Script evaluation: all scripts must return TRUE
   - Fee check: `satoshis_in > satoshis_out`
   - Mark tx as valid
5. **Final validation:** await the newest transaction being marked valid

### BEEF Example (Annotated)

```
0100beef                              // Version marker
01                                    // nBUMPs = 1
fe636d0c00...                         // BUMP data (see BRC-74)
02                                    // nTransactions = 2

// First transaction (parent, has merkle proof)
0100000001cd4e4cac...00000000         // Raw transaction bytes
01                                    // Has BUMP = true
00                                    // BUMP index = 0

// Second transaction (current payment, no merkle proof)
0100000001ac4e164f...00000000         // Raw transaction bytes
00                                    // Has BUMP = false (has local parent)
```

---

## BRC-74: BSV Unified Merkle Path (BUMP)

### What It Defines

BUMP is the format for encoding merkle proofs. It efficiently represents one or more txids from a single block along with all the hashes needed to compute the merkle root.

### Key Concepts

- **Block Height**: Identifies which block (not block hash - saves bytes)
- **Tree Height**: Depth of merkle tree in that block
- **Levels**: From 0 (txid level) up to tree height - 1
- **Leaves**: Hashes at each level needed for computation

### Binary Encoding

#### Global Header
| Field | Size | Description |
|-------|------|-------------|
| blockHeight | 1-9 bytes (VarInt) | Block number |
| treeHeight | 1 byte | Depth of merkle tree (max 64) |

#### Per Level (repeat for each level 0 to treeHeight-1)
| Field | Size | Description |
|-------|------|-------------|
| nLeaves | 1-9 bytes (VarInt) | Number of leaves at this level |
| *For each leaf:* | | |
| offset | 1-9 bytes (VarInt) | Position from left in tree |
| flags | 1 byte | See flag table below |
| hash | 0 or 32 bytes | Only if flags ≠ 0x01 |

#### Flags
| Binary | Hex | Meaning |
|--------|-----|---------|
| 0000 0000 | 0x00 | Data follows, NOT a client txid (sibling hash) |
| 0000 0001 | 0x01 | DUPLICATE working hash, no data follows |
| 0000 0010 | 0x02 | Data follows, IS a client txid |

### JSON Encoding

```json
{
  "blockHeight": 813706,
  "path": [
    // Level 0 - txids and their siblings
    [
      { "offset": 3048, "hash": "304e73..." },
      { "offset": 3049, "txid": true, "hash": "d88871..." },
      { "offset": 3050, "txid": true, "hash": "98c9c5..." },
      { "offset": 3051, "duplicate": true }
    ],
    // Level 1 - internal hashes
    [
      { "offset": 1524, "hash": "811ae7..." },
      { "offset": 1525, "hash": "82520a..." }
    ],
    // ... continues up the tree
  ]
}
```

### Calculating Merkle Root from BUMP

```javascript
const { createHash } = require('crypto')

// Hash utilities (handles byte reversal convention)
const hexRevToBuf = (str) => Buffer.from(str, 'hex').reverse()
const bufRevToHex = (buf) => Buffer.from(buf.toString('hex'), 'hex').reverse().toString('hex')
const hash = (str) => bufRevToHex(
  createHash('sha256').update(
    createHash('sha256').update(hexRevToBuf(str)).digest()
  ).digest()
)

function calculateMerkleRootFromBUMP(bump, txid) {
  // Find txid's offset at level 0
  const index = bump.path[0].find(l => l.hash === txid).offset
  if (index === undefined) throw Error(`BUMP does not contain txid: ${txid}`)
  
  let workingHash = txid
  
  bump.path.map((leaves, height) => {
    // XOR with 1 gives sibling offset
    const offset = index >> height ^ 1
    const leaf = leaves.find(l => l.offset === offset)
    
    if (!leaf) throw new Error(`Missing hash at height: ${height}`)
    
    if (leaf.duplicate) {
      // Duplicate: hash with itself
      workingHash = hash(workingHash + workingHash)
    } else if (offset % 2) {
      // Odd offset: sibling on left
      workingHash = hash(leaf.hash + workingHash)
    } else {
      // Even offset: sibling on right
      workingHash = hash(workingHash + leaf.hash)
    }
  })
  
  return workingHash
}
```

### Merging BUMPs

Two BUMPs can be combined if:
1. Same `blockHeight`
2. Same calculated merkle root

```javascript
function combinePaths(one, two) {
  if (one.blockHeight !== two.blockHeight)
    throw Error('Cannot combine: different blockHeight')
  
  const root1 = calculateMerkleRootFromBUMP(one, one.path[0].find(l => l.hash).hash)
  const root2 = calculateMerkleRootFromBUMP(two, two.path[0].find(l => l.hash).hash)
  
  if (root1 !== root2)
    throw Error('Cannot combine: different merkle roots')
  
  // Merge leaves, avoiding duplicates
  const combinedPath = []
  for (let h = 0; h < one.path.length; h++) {
    combinedPath.push([...one.path[h]])
    for (const leaf of two.path[h]) {
      if (!combinedPath[h].find(l => l.offset === leaf.offset)) {
        combinedPath[h].push(leaf)
      } else if (leaf.txid) {
        // Preserve txid flag
        combinedPath[h].find(l => l.offset === leaf.offset).txid = true
      }
    }
  }
  
  return { blockHeight: one.blockHeight, path: combinedPath }
}
```

---

## Working with @bsv/sdk

### Importing a Transaction with BEEF

```typescript
import { Transaction, Beef, MerklePath } from '@bsv/sdk'

// Parse BEEF from hex
const beef = Beef.fromHex(beefHex)

// Get the newest transaction (last in the list)
const tx = beef.txs[beef.txs.length - 1]

// Each input should have its source transaction available
for (const input of tx.inputs) {
  const sourceTx = beef.findTxid(input.sourceTXID)
  if (sourceTx) {
    input.sourceTransaction = sourceTx
  }
}
```

### Creating a BEEF for Sending

```typescript
import { Transaction, Beef, MerklePath } from '@bsv/sdk'

// Create new transaction
const tx = new Transaction()
// ... add inputs and outputs ...

// Create BEEF with ancestors
const beef = new Beef()

// Add ancestor transactions with their merkle proofs
for (const input of tx.inputs) {
  const ancestorTx = input.sourceTransaction
  if (ancestorTx.merklePath) {
    beef.mergeBump(ancestorTx.merklePath)
  }
  beef.addTransaction(ancestorTx, ancestorTx.merklePath ? true : false)
}

// Add the new transaction (no merkle path yet)
beef.addTransaction(tx, false)

// Export as hex
const beefHex = beef.toHex()
```

### Attaching Merkle Paths After Mining

```typescript
import { Transaction, MerklePath } from '@bsv/sdk'

// After broadcast, get merkle proof from a service
const proofResponse = await getMerkleProof(txid)

// Create MerklePath from response
const merklePath = MerklePath.fromHex(proofResponse.bump)

// Or from JSON format
const merklePath = new MerklePath(
  proofResponse.blockHeight,
  proofResponse.path
)

// Attach to transaction
tx.merklePath = merklePath

// Verify it computes correct root
const computedRoot = merklePath.computeRoot(txid)
const isValid = computedRoot === expectedMerkleRoot
```

---

## Common Mistakes and How to Avoid Them

### 1. Wrong Transaction Order in BEEF
**Problem:** Child transactions appear before their parents.
**Solution:** Always use topological sort (Kahn's algorithm) before creating BEEF.

### 2. Missing Ancestor Transactions
**Problem:** Input references a transaction not in the BEEF and not mined.
**Solution:** Recursively include all unmined ancestors until you reach mined transactions.

### 3. Byte Order Confusion
**Problem:** Txids and hashes displayed in wrong byte order.
**Solution:** Remember display convention reverses bytes. When computing:
```javascript
// Display/JSON uses reversed bytes
const displayTxid = "abc123..."
// Actual bytes for hashing
const bytes = Buffer.from(displayTxid, 'hex').reverse()
```

### 4. Not Verifying Merkle Root Against Headers
**Problem:** Accepting any merkle path without checking the root exists in a real block.
**Solution:** Always verify computed merkle root against your block header source.

### 5. Ignoring the Duplicate Flag
**Problem:** Expecting hash data when `duplicate=true`.
**Solution:** When flag is `0x01`, duplicate the working hash instead of reading more data.

### 6. Wrong Index Calculation for Merkle Path
**Problem:** Using wrong sibling offset during merkle root computation.
**Solution:** Use `index >> height ^ 1` to get sibling offset at each level.

### 7. Forgetting Script Evaluation
**Problem:** Only checking merkle proofs, not that scripts actually validate.
**Solution:** SPV requires BOTH merkle proof AND script evaluation to pass.

---

## Quick Reference

### BEEF Magic Number
```
0x0100BEEF (little-endian uint32)
Decimal: 4022206465
```

### BUMP Flags Quick Reference
```
0x00 = hash follows (sibling)
0x01 = duplicate working hash (no data)
0x02 = hash follows (client txid)
```

### SPV Checklist
- [ ] Scripts evaluate to TRUE
- [ ] Fees are positive (inputs > outputs)
- [ ] All inputs trace to merkle proofs
- [ ] Locktime/sequence are expected

### Useful Links
- [BRC-67 SPV](https://bsv.brc.dev/transactions/0067)
- [BRC-62 BEEF](https://bsv.brc.dev/transactions/0062)
- [BRC-74 BUMP](https://bsv.brc.dev/transactions/0074)
- [BUMP Showcase (Interactive)](https://bitcoin-sv.github.io/showcase-merkle-paths/)
- [ts-sdk](https://github.com/bsv-blockchain/ts-sdk)
- [go-sdk](https://github.com/bsv-blockchain/go-sdk)
- [py-sdk](https://github.com/bsv-blockchain/py-sdk)

---

*Reference created: 2026-02-02*
*Sources: BRC-62, BRC-67, BRC-74 specifications*
