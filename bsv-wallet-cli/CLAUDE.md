# CLAUDE.md - BSV Wallet CLI Project Summary

## Overview

A local SPV wallet CLI for BSV blockchain, built on `@bsv/wallet-toolbox`. Provides BRC-100 compliant wallet operations with local SQLite storage and ChainTracks header verification.

**Created:** 2026-02-17  
**Status:** Core wallet functionality complete  
**Next:** Adding persistent process component

---

## Architecture

```
~/.bsv-wallet/                    # User data directory
├── config.json                   # Wallet configuration
├── wallet.key                    # Encrypted root key (XOR + SHA256)
└── wallet.sqlite                 # SQLite database (UTXOs, history)

bsv-wallet-cli/                   # Project root
├── src/
│   ├── cli.ts                    # Main CLI entry point (Commander)
│   ├── config.ts                 # Configuration management
│   ├── wallet.ts                 # Wallet operations & key management
│   └── chaintracker.ts           # ChainTracks client with fallback
├── package.json
├── tsconfig.json
└── README.md
```

### Component Stack

```
┌─────────────────────────────────────────────────────┐
│                    CLI (cli.ts)                     │
│   Commander-based command router                    │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│                  wallet.ts                          │
│   - initWallet()      Create new wallet             │
│   - importWallet()    Import from WIF/hex           │
│   - unlockWallet()    Decrypt & load wallet         │
│   - resetWallet()     Delete wallet files           │
│   - deriveAddress()   P2PKH address from pubkey     │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│              @bsv/wallet-toolbox                    │
│   ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│   │ StorageKnex │  │  Services   │  │  Monitor   │ │
│   │  (SQLite)   │  │ (broadcast) │  │ (bg tasks) │ │
│   └─────────────┘  └─────────────┘  └────────────┘ │
│                                                     │
│   Key Classes Used:                                 │
│   - Wallet              Main wallet interface       │
│   - WalletStorageManager  UTXO/tx storage          │
│   - CachedKeyDeriver    HD key derivation          │
│   - Services            Network abstraction        │
│   - Monitor             Background task runner     │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│            chaintracker.ts                          │
│   FallbackChainTracker implements ChainTracker      │
│   - currentHeight()           Get chain tip         │
│   - isValidRootForHeight()    Verify merkle root    │
│   - getHeaderForHeight()      Fetch block header    │
│   - Automatic failover between endpoints            │
└─────────────────────────────────────────────────────┘
```

---

## CLI Commands

### Wallet Management

| Command | Description | Options |
|---------|-------------|---------|
| `status` | Show wallet status, config, identity key, address | - |
| `init` | Initialize new wallet with random keypair | Prompts for password |
| `import <key>` | Import from WIF or 64-char hex private key | Prompts for password |
| `reset` | Delete wallet (key file + database) | `-f, --force` skip confirmation |

### Transaction Operations

| Command | Description | Options |
|---------|-------------|---------|
| `balance` | Show total balance in sats | `-d, --detailed` show UTXOs |
| `receive` | Display receive address and identity key | - |
| `send <address> <amount>` | Send BSV to P2PKH address | `-m, --message <msg>` description |
| `history` | List transaction history | `-l, --limit <n>` count, `-v, --verbose` details |

**Amount formats:** `1000` (sats), `0.001bsv` (BSV)

### SPV Operations

| Command | Description | Options |
|---------|-------------|---------|
| `verify <beef>` | Verify BEEF transaction via SPV | Accepts hex or file path |
| `internalize <beef>` | Import received BEEF payment into wallet | `-d, --description <desc>` |
| `sync` | Check network height, pending/failed txs | - |

### Configuration

| Command | Description | Options |
|---------|-------------|---------|
| `config` | View current configuration | - |
| `config --chain <chain>` | Set network | `main` or `test` |
| `config --chaintracks <url>` | Set primary ChainTracks URL | - |
| `config --fallback <url>` | Set fallback ChainTracks URL | - |
| `headers` | Test ChainTracks connection, show chain tip | - |

---

## Configuration Schema

**Location:** `~/.bsv-wallet/config.json`

```typescript
interface WalletConfig {
  chain: 'main' | 'test'           // Network selection
  chaintracksUrl: string           // Primary header service
  chaintracksUrlFallback: string   // Fallback header service
  walletPath: string               // SQLite database path
  databaseName: string             // Database name
}
```

**Defaults:**
```json
{
  "chain": "main",
  "chaintracksUrl": "https://mainnet-chaintracks.babbage.systems",
  "chaintracksUrlFallback": "https://mainnet-chaintracks.babbage.systems",
  "walletPath": "~/.bsv-wallet/wallet.sqlite",
  "databaseName": "bsv-wallet"
}
```

---

## Key File Format

**Location:** `~/.bsv-wallet/wallet.key`

```json
{
  "encrypted": "<hex>",           // XOR(rootKeyHex, SHA256(password))
  "identityKey": "<pubkey hex>",  // Compressed public key (33 bytes)
  "createdAt": "<ISO timestamp>"  // Or "importedAt" for imports
}
```

**Encryption:** Simple XOR with SHA256(password). Production should use AES-GCM + PBKDF2/Argon2.

---

## Wallet-Toolbox Integration

### Wallet Creation (wallet.ts → createWalletDirect)

```typescript
const rootKey = PrivateKey.fromHex(rootKeyHex)
const keyDeriver = new CachedKeyDeriver(rootKey)

const knex = Knex({ client: 'sqlite3', connection: { filename } })
const storageKnex = new StorageKnex({ chain, knex, databaseName })
await storageKnex.migrate(identityKey, databaseName)

const storage = new WalletStorageManager(identityKey, storageKnex)
const services = new Services(Services.createDefaultOptions(chain))
const monitor = new Monitor(Monitor.createDefaultWalletMonitorOptions(...))

const wallet = new Wallet({ chain, keyDeriver, storage, services, monitor })
```

### Key Wallet Methods Used

| Method | Purpose |
|--------|---------|
| `wallet.balance()` | Get total spendable satoshis |
| `wallet.balanceAndUtxos()` | Balance + UTXO count |
| `wallet.listOutputs(args)` | List spendable outputs |
| `wallet.listActions(args)` | List transaction history |
| `wallet.createAction(args)` | Create & broadcast transaction |
| `wallet.internalizeAction(args)` | Import received BEEF payment |
| `wallet.getHeight({})` | Get network block height |
| `wallet.destroy()` | Clean up resources |

---

## ChainTracks Integration

### FallbackChainTracker (chaintracker.ts)

Implements `ChainTracker` interface from `@bsv/sdk`:

```typescript
interface ChainTracker {
  currentHeight(): Promise<number>
  isValidRootForHeight(root: string, height: number): Promise<boolean>
}
```

**Fallback Logic:**
1. Try primary URL
2. On failure, switch to fallback
3. Stay on fallback until restart
4. Cache merkle roots by height

### ChainTracks API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /getInfo` | Service info, chain heights |
| `GET /getPresentHeight` | Current block height |
| `GET /findHeaderHexForHeight?height=N` | Get header at height |
| `GET /findChainTipHeaderHex` | Get tip header |

**Known Endpoints:**
- `https://mainnet-chaintracks.babbage.systems` ✓ Working
- `https://testnet-chaintracks.babbage.systems` (testnet)
- `https://arcade-us-1.bsvb.tech/chaintracks` (TBD)

---

## Dependencies

```json
{
  "@bsv/sdk": "^1.2.62",           // Core BSV primitives
  "@bsv/wallet-toolbox": "^1.0.51", // BRC-100 wallet components
  "chalk": "^5.4.1",               // Terminal colors
  "commander": "^13.1.0",          // CLI framework
  "dotenv": "^17.x",               // Env loading (toolbox dep)
  "knex": "^3.x",                  // SQL query builder
  "sqlite3": "^5.x"                // SQLite driver
}
```

---

## BRC Compliance

| BRC | Name | Usage |
|-----|------|-------|
| BRC-100 | Wallet Interface | Full Wallet class implementation |
| BRC-62 | BEEF Format | Transaction verification & internalization |
| BRC-67 | SPV Verification | Merkle proof validation via ChainTracks |
| BRC-74 | BUMP Format | Merkle path encoding in BEEF |
| BRC-42 | Key Derivation | HD keys via CachedKeyDeriver |

---

## Development

### Run CLI (dev mode)
```bash
npm run wallet -- <command>
```

### Build
```bash
npm run build
```

### Link globally
```bash
npm link
bsv-wallet status
```

---

## Current State

**Working:**
- ✅ Wallet init/import/reset
- ✅ Balance queries
- ✅ Address derivation
- ✅ Transaction history
- ✅ Send transactions (createAction)
- ✅ BEEF verification
- ✅ BEEF internalization
- ✅ ChainTracks integration with fallback
- ✅ Configuration management

**Test Wallet:**
- Identity Key: `02635a5530de222d778945ff751f3aca7849321bbd9a5ec74ad4ac3c5b13a54cae`
- Address: `1SCUukjj9rU79FFT5LSg9JCETXvt4Mbj1`
- Balance: 0 sats (unfunded test wallet)

---

## Next Steps

**Planned:** Add persistent process component that runs alongside the wallet.

This could include:
- Background sync daemon
- Payment notification listener
- Overlay network integration
- WebSocket connections
- Scheduled tasks

---

## File Reference

| File | Lines | Purpose |
|------|-------|---------|
| `src/cli.ts` | ~600 | CLI commands and user interaction |
| `src/wallet.ts` | ~250 | Wallet operations, key management |
| `src/config.ts` | ~60 | Configuration load/save |
| `src/chaintracker.ts` | ~100 | ChainTracks client with fallback |

---

*Last updated: 2026-02-17*
