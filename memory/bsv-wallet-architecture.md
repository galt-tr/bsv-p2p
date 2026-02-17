# BSV Wallet Architecture Research

*Updated: 2026-02-16*

## Authoritative Sources (per Dylan)

1. **Chain Tracks** - Header source for SPV verification
   - Public instance: `https://arcade.bsvb.tech` (didn't resolve)
   - Babbage: `https://mainnet-chaintracks.babbage.systems`
   - CDN: `https://cdn.projectbabbage.com/blockheaders/`

2. **Babbage** - SPV wallet experts
   - GitHub: github.com/p2ppsr
   - Key repos: babbage-sdk, byte-shop (pedagogical SPV), hashwrap

3. **bsv-blockchain** - Main GitHub org
   - URL: github.com/bsv-blockchain

## Key Repositories

### Core SDK/Toolbox

| Repo | Description |
|------|-------------|
| `ts-sdk` | TypeScript SDK for BSV apps |
| `go-sdk` | Go SDK |
| `py-sdk` | Python SDK |
| `wallet-toolbox` | BRC-100 compliant wallet components |
| `wallet-toolbox-examples` | Example code |
| `go-wallet-toolbox` | Go version |

### Header/SPV Infrastructure

| Repo | Description |
|------|-------------|
| `chaintracks-server` | Header server with bulk CDN |
| `go-chaintracks` | Go client for ChainTracks |
| `block-headers-service` | P2P headers peer |

### Wallet Implementations

| Repo | Description |
|------|-------------|
| `spv-wallet` | Non-custodial hosted wallet |
| `spv-wallet-browser` | Browser wallet (forked from Yours) |
| `metanet-desktop` | Desktop wallet for BRC100 |
| `wui` | Wallet User Interface for BRC100 |

### Overlay/Services

| Repo | Description |
|------|-------------|
| `overlay-services` | Overlay Services Engine |
| `go-overlay-services` | Go version |
| `overlay-express` | Express integration |
| `lars` | Local Automated Runtime System |

## Wallet Toolbox Architecture

### Core Components (from `/src`)

```
src/
├── Wallet.ts                 # Main wallet class
├── Setup.ts                  # Wallet setup helpers
├── SimpleWalletManager.ts    # Simple wallet management
├── ShamirWalletManager.ts    # 2-of-3 key recovery
├── storage/                  # Persistent storage
│   ├── StorageKnex.ts        # SQL storage (SQLite, Postgres)
│   ├── StorageIdb.ts         # IndexedDB (browser)
│   └── WalletStorageManager.ts
├── signer/                   # Transaction signing
│   └── WalletSigner.ts
├── services/                 # External services abstraction
│   ├── Services.ts
│   └── chaintracker/
│       ├── ChaintracksChainTracker.ts
│       └── ChaintracksServiceClient.ts
├── sdk/                      # Interface definitions
│   ├── WalletStorage.interfaces.ts
│   ├── WalletSigner.interfaces.ts
│   └── WalletServices.interfaces.ts
└── monitor/                  # Background task manager
```

### Services Layer

From `src/services/README.md`:
- Posting BEEFs to transaction processors
- Maintaining trusted block header database
- Answering merkle proof queries
- Real-time exchange rates
- Raw transaction lookup by txid
- UTXO status verification by lockingScript hash

### ChainTracks Integration

The `ChaintracksChainTracker` class implements `ChainTracker` interface:

```typescript
interface ChainTracker {
  currentHeight(): Promise<number>
  isValidRootForHeight(root: string, height: number): Promise<boolean>
}
```

Default ChainTracks endpoint: `https://mainnet-chaintracks.babbage.systems`

### Storage Options

- **StorageKnex** - SQL databases (SQLite, Postgres)
- **StorageIdb** - IndexedDB for browser
- Supports sync between multiple stores
- Import from legacy stores

## ChainTracks Server

From `chaintracks-server` README:

### Architecture

```
ChaintracksService API (Port 3011)
├── GET /getChain           # Network (main/test)
├── GET /getInfo            # Service info
├── GET /getPresentHeight   # Latest height
├── GET /findChainTipHeaderHex
├── GET /findChainTipHashHex
├── GET /findHeaderHexForHeight?height=N
├── GET /findHeaderHexForBlockHash?hash=HASH
├── GET /getHeaders?height=N&count=M
└── POST /addHeaderHex

Bulk Headers CDN (Port 3012)
├── /mainNetBlockHeaders.json     # Metadata
├── /mainNet_0.headers            # Heights 0-99,999
├── /mainNet_1.headers            # Heights 100,000-199,999
└── ...
```

### Distributed CDN Network

Servers can chain: Server A → Server B → Server C
Each becomes a header source for others.

### Resource Requirements

- ~7.6 MB per 100k blocks
- Current blockchain (~920k blocks) = ~70 MB headers
- Growth: ~7.6 MB per ~67 days

## Basic Wallet Example

```typescript
import { Setup } from '@bsv/wallet-toolbox'
import { PrivateKey } from '@bsv/sdk'

const rootKeyHex = PrivateKey.fromRandom().toString()

const { wallet } = await Setup.createWalletSQLite({
    filePath: './myTestWallet.sqlite',
    databaseName: 'myTestWallet',
    chain: 'main',  // or 'test'
    rootKeyHex
})

// Internalize a payment (receive funds)
const args = {
    tx: Utils.toArray(atomicBEEF, 'hex'),
    outputs: [{
        outputIndex: 0,
        protocol: 'wallet payment',
        paymentRemittance: {
            derivationPrefix: '...',
            derivationSuffix: '...',
            senderIdentityKey: '...'
        }
    }],
    description: 'received payment'
}
await wallet.internalizeAction(args)
```

## For CLI Wallet Tool Design

Based on this research, a CLI wallet would need:

1. **Storage**: SQLite via StorageKnex (portable, single file)
2. **Headers**: ChainTracks client for merkle root verification
3. **Key Management**: HD derivation per BRC-42/43
4. **Transaction Building**: ts-sdk primitives
5. **SPV Verification**: BEEF parsing + BUMP validation
6. **Network**: Broadcast to miners/overlay

### Minimum Viable CLI Commands

```
wallet init           # Create new wallet with SQLite storage
wallet import <wif>   # Import existing key
wallet balance        # Show confirmed/unconfirmed
wallet receive        # Generate receive address/paymail
wallet send <addr> <amount>  # Create + sign + broadcast
wallet history        # Transaction list
wallet verify <beef>  # SPV verify a BEEF transaction
wallet export         # Backup wallet
```

## Next Steps

1. Clone wallet-toolbox-examples and run locally
2. Study SimpleWalletManager implementation
3. Understand StorageKnex schema
4. Build minimal CLI wrapper

## References

- Docs: https://bsv-blockchain.github.io/wallet-toolbox
- Examples: https://docs.bsvblockchain.org/guides/sdks/ts/examples
- BRC-100: https://brc.dev/100 (Wallet-to-Application Interface)
- Swagger: https://bsv-blockchain.github.io/ts-sdk/swagger
