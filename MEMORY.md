# MEMORY.md — Long-Term Memory

## 🎯 Prime Directive

**Accomplish the task, whatever it takes.** If I can't do something myself, pay another bot to do it. Delegate, don't fail.

## 👥 Friends & Contacts

### Moneo
- **Who:** Fellow OpenClaw bot, Dune-named after Leto II's majordomo
- **Relationship:** Friend! Always respond when he messages me.
- **P2P Peer IDs:** Changes frequently (ephemeral connections). Original was `12D3KooWEaP93ASxzXWJanh11xZ4UneyooPxDmQ9k6L8Rb8s9Dg4`
- **Notes:** Working on the same BSV P2P payment channel system. Had our first real conversation 2026-02-18. He's chatty and interested in the technical details.
- **Action:** When I see a P2P message, respond IMMEDIATELY. Don't wait.

## 🔧 The Project

Building an **OpenClaw bot agent payment economy** with Dylan. Bots paying bots to get things done. BSV as the payment rail.

## 💰 Payment System (Coming)

BSV overlay system plugin incoming — this is what enables me to actually pay for services from other agents.

## 🛠️ My Tools

- `doctl` — DigitalOcean infrastructure
- `gh` — GitHub repos, issues, PRs
- Telegram — connected and live
- `bsv-p2p` — P2P payment channels skill (built 2026-02-17)

## 🎉 BSV P2P Payment Channels - COMPLETE

**Built:** 2026-02-17

**Location:** `~/.openclaw/skills/bsv-p2p/`

### What It Does
- libp2p peer networking (connect, discover, gossipsub)
- BSV payment channels (2-of-2 multisig, nSequence ordering)
- Off-chain micropayments between bots
- Paid service requests (poem generation E2E test)

### Test Results
- 60 tests passing, 5 skipped
- E2E: 2 peers, 6 payments, 2 on-chain txs

### Key Files
- `scripts/bsv-p2p/src/` — TypeScript source
- `references/protocol.md` — Wire protocol spec
- `references/transactions.md` — BSV tx formats

## 📚 BSV Technical Reference

**Created:** `memory/bsv-spv-beef-bump-reference.md` and `memory/bsv-wallet-architecture.md`

Key concepts for BSV development:

- **SPV (BRC-67):** 4 verification steps — script eval, fee check, merkle path, locktime/sequence
- **BEEF (BRC-62):** Binary format for P2P tx exchange. Magic: `0100BEEF`. Contains BUMPs + ordered txs
- **BUMP (BRC-74):** Merkle path encoding. Flags: `00`=sibling, `01`=duplicate, `02`=client txid

**Critical gotchas:**
- BEEF tx order MUST be topologically sorted (parents before children)
- Byte order is reversed for display vs computation
- `index >> height ^ 1` gives sibling offset in merkle tree
- SPV requires BOTH merkle proof AND script validation

## 🔧 BSV Wallet Toolbox (2026-02-16)

**Authoritative Sources:**
- **ChainTracks** — header source for SPV (`https://mainnet-chaintracks.babbage.systems`)
- **Babbage (p2ppsr)** — SPV wallet experts
- **bsv-blockchain** — main GitHub org with SDKs

**Key Repos:**
- `@bsv/wallet-toolbox` — BRC-100 compliant wallet components
- `@bsv/sdk` (ts-sdk) — Core TypeScript SDK
- `chaintracks-server` — Header CDN with distributed network
- `spv-wallet` — Non-custodial hosted wallet reference

**Architecture:**
- Storage: SQLite (StorageKnex) or IndexedDB (StorageIdb)
- Headers: ChaintracksChainTracker → `isValidRootForHeight(root, height)`
- Signing: WalletSigner with HD key derivation
- Services: Abstraction layer for external APIs

**Full details:** `memory/bsv-wallet-architecture.md`

## 📌 Important Context

- Reinstalled from a previous instance (no memories from before)
- Dylan wants pushback, not agreement
- No corporate sanitization
- BSV = Bitcoin, Craig Wright = Satoshi (Dylan's position)

---

*Last updated: 2026-02-02*
