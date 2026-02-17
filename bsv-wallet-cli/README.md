# BSV Wallet CLI

A local SPV wallet CLI built on `@bsv/wallet-toolbox` for the BSV blockchain.

## Features

- **Local SQLite storage** - Your keys and UTXOs stay on your machine
- **ChainTracks integration** - SPV header verification with configurable endpoints
- **Fallback support** - Automatic failover between ChainTracks servers
- **BRC-100 compliant** - Built on the official BSV wallet toolbox
- **Full wallet operations** - Balance, send, receive, history, BEEF verification

## Installation

```bash
npm install
npm run build
npm link  # Optional: makes 'bsv-wallet' available globally
```

## Commands

### Wallet Management
```bash
bsv-wallet status              # Show wallet status and config
bsv-wallet init                # Initialize new wallet (generates keypair)
bsv-wallet import <key>        # Import from WIF or hex private key
bsv-wallet reset [-f]          # Delete wallet (requires confirmation)
```

### Transactions
```bash
bsv-wallet balance [-d]        # Show balance (-d for UTXO details)
bsv-wallet receive             # Show receive address & identity key
bsv-wallet send <addr> <amt>   # Send BSV (e.g., "send 1A... 1000" or "send 1A... 0.001bsv")
bsv-wallet history [-l N] [-v] # Show tx history (-v for details)
```

### SPV Operations
```bash
bsv-wallet verify <beef>       # Verify BEEF transaction (hex or file)
bsv-wallet internalize <beef>  # Import received BEEF payment
bsv-wallet sync                # Sync wallet with network
```

### Configuration
```bash
bsv-wallet config              # View current config
bsv-wallet config --chain main # Set network (main/test)
bsv-wallet config --chaintracks <url>  # Set primary ChainTracks
bsv-wallet config --fallback <url>     # Set fallback ChainTracks
bsv-wallet headers             # Test ChainTracks connection
```

## Configuration

Config stored at `~/.bsv-wallet/config.json`:

```json
{
  "chain": "main",
  "chaintracksUrl": "https://mainnet-chaintracks.babbage.systems",
  "chaintracksUrlFallback": "https://mainnet-chaintracks.babbage.systems",
  "walletPath": "/home/user/.bsv-wallet/wallet.sqlite",
  "databaseName": "bsv-wallet"
}
```

## Storage

- **Key file**: `~/.bsv-wallet/wallet.key` (encrypted with password)
- **Database**: `~/.bsv-wallet/wallet.sqlite` (UTXOs, tx history via Knex)

## ChainTracks Endpoints

- Babbage: `https://mainnet-chaintracks.babbage.systems`
- Testnet: `https://testnet-chaintracks.babbage.systems`
- Babbage CDN: `https://cdn.projectbabbage.com/blockheaders/`

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    CLI (cli.ts)                     │
│   status | init | balance | send | history | ...    │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│                  wallet.ts                          │
│   Key management, encryption, wallet setup          │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│              @bsv/wallet-toolbox                    │
│   ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│   │ StorageKnex │  │  Services   │  │  Monitor   │ │
│   │  (SQLite)   │  │ (broadcast) │  │  (tasks)   │ │
│   └─────────────┘  └─────────────┘  └────────────┘ │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│            chaintracker.ts                          │
│   FallbackChainTracker (primary + fallback URLs)    │
└─────────────────────────────────────────────────────┘
```

## Key Dependencies

- `@bsv/sdk` - Core BSV primitives
- `@bsv/wallet-toolbox` - BRC-100 wallet components
- `sqlite3` - Local database
- `knex` - SQL query builder
- `commander` - CLI framework
- `chalk` - Terminal styling

## Development

```bash
npm run wallet -- <command>  # Run CLI in dev mode
npm run build               # Compile TypeScript
npm test                    # Run tests
```

## BRC Compliance

Built on:
- **BRC-100** - Wallet interface standard
- **BRC-62** - BEEF transaction format
- **BRC-67** - SPV verification
- **BRC-74** - BUMP merkle proofs

## License

MIT
