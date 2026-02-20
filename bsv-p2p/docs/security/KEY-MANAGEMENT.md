# BSV P2P Key Management Guide

**Audience:** Bot operators deploying BSV P2P payment channels  
**Purpose:** Understand security risks and choose appropriate key storage for your deployment

---

## Table of Contents

1. [Overview](#overview)
2. [Security Model](#security-model)
3. [Testnet vs Mainnet](#testnet-vs-mainnet)
4. [Key Storage Options](#key-storage-options)
5. [Setup Guides](#setup-guides)
6. [Backup & Recovery](#backup--recovery)
7. [Key Rotation](#key-rotation)
8. [Troubleshooting](#troubleshooting)

---

## Overview

The BSV P2P system uses **private keys** for two purposes:

1. **Wallet key** — Controls your on-chain BSV funds
2. **Channel keys** — Signs payment channel state updates (derived from wallet key)

**If your private key is compromised, an attacker can:**
- Steal all your on-chain BSV funds
- Close your payment channels and claim funds
- Impersonate you in the P2P network

This guide helps you choose the right key storage method for your deployment.

---

## Security Model

### What We Protect

| Asset | Threat | Mitigation |
|-------|--------|------------|
| **Private keys** | Theft, exposure | OS keychain / encrypted storage |
| **Channel state** | Rollback attacks | nSequence + monitoring |
| **Payment privacy** | Network surveillance | Encrypted P2P messages |
| **Peer identity** | Impersonation | libp2p PeerId + signatures |

### What We Don't (Yet) Protect Against

- ❌ Memory dump attacks (keys in RAM during runtime)
- ❌ Malware on the same machine
- ❌ Physical access to running process
- ❌ Side-channel attacks (timing, power analysis)

**Defense in depth:** Use multiple layers (OS keychain + disk encryption + firewalls + monitoring).

### Threat Model

**Low-Risk Scenarios (Testnet):**
- Experimental bots with no real funds
- Development/testing environments
- Educational projects
- **→ Plaintext config is acceptable**

**Medium-Risk Scenarios (Mainnet, <$100):**
- Personal bots with small balances
- Hobby projects on secure home networks
- **→ Environment variables or OS keychain**

**High-Risk Scenarios (Mainnet, >$100):**
- Production bots handling customer payments
- Multi-user deployments
- Cloud-hosted bots
- **→ OS keychain + encrypted backups + monitoring**

**Critical Scenarios (Mainnet, >$1000):**
- Enterprise deployments
- Bots managing large payment channels
- Multi-signature wallet integrations
- **→ Hardware HSM + operational security procedures**

---

## Testnet vs Mainnet

### Testnet (Recommended for Getting Started)

**Network:** BSV Testnet  
**Risk:** None (testnet coins have no value)  
**Key Storage:** Plaintext config is fine  
**Setup:**

```bash
# Generate testnet keys
npx tsx scripts/init.ts --network testnet

# Keys stored in ~/.bsv-p2p/config.json
cat ~/.bsv-p2p/config.json
```

**When to use:**
- Learning the system
- Testing integrations
- Development/debugging
- CI/CD pipelines

### Mainnet (Production)

**Network:** BSV Mainnet  
**Risk:** Real money at stake  
**Key Storage:** **NEVER use plaintext**  
**Setup:** See [Setup Guides](#setup-guides) below

**Before going to mainnet:**
- [ ] Read this entire guide
- [ ] Choose appropriate key storage (see table below)
- [ ] Set up backups (offline, encrypted)
- [ ] Test recovery procedure
- [ ] Enable monitoring and alerts
- [ ] Fund wallet with small test amount first

**⚠️ Warning:** Once you broadcast a transaction to mainnet, it cannot be reversed. Test thoroughly on testnet first.

---

## Key Storage Options

### Comparison Table

| Method | Security | Ease of Use | Automation | Mainnet Ready? | Notes |
|--------|----------|-------------|------------|----------------|-------|
| **Plaintext file** | ❌ Very Low | ✅ Easy | ✅ Yes | ❌ **NO** | Only for testnet |
| **Environment variable** | ⚠️ Low-Medium | ✅ Easy | ✅ Yes | ⚠️ Small amounts only | Visible in `ps`, logs |
| **OS keychain** | ✅ High | ✅ Good | ⚠️ Limited | ✅ **YES** | Requires GUI unlock on some Linux |
| **Encrypted config** | ✅ High | ⚠️ Prompt needed | ⚠️ With env passphrase | ✅ **YES** | User enters passphrase at start |
| **Hardware HSM** | ✅✅ Very High | ❌ Complex | ❌ No | ✅ YES | Enterprise only, high cost |

**Recommendation hierarchy:**
1. **Best:** OS keychain (macOS/Windows/Linux with GUI)
2. **Good:** Encrypted config file (headless servers)
3. **Acceptable:** Environment variable (Docker, small amounts)
4. **Never:** Plaintext file (testnet only)

### Detailed Descriptions

#### 1. Plaintext File (Testnet Only)

**Location:** `~/.bsv-p2p/config.json`

```json
{
  "bsvPrivateKey": "your-hex-key-here",
  "bsvPublicKey": "...",
  "port": 4001
}
```

**Pros:**
- ✅ Simple setup
- ✅ No dependencies
- ✅ Works everywhere

**Cons:**
- ❌ Keys exposed to any process/user
- ❌ Exposed in backups, logs
- ❌ No access control
- ❌ **DO NOT USE ON MAINNET**

**Setup:**
```bash
npx tsx scripts/init.ts
# Keys automatically generated and saved
```

---

#### 2. Environment Variables

**Environment:** `BSV_PRIVATE_KEY`, `BSV_PUBLIC_KEY`

```bash
export BSV_PRIVATE_KEY="your-hex-key-here"
bsv-p2p daemon start
```

**Pros:**
- ✅ Standard 12-factor app practice
- ✅ Works with Docker Secrets, Kubernetes
- ✅ Keeps keys out of version control
- ✅ Simple automation

**Cons:**
- ❌ Visible in process listing: `ps auxe | grep BSV_PRIVATE_KEY`
- ❌ Leaked in error dumps, monitoring tools
- ❌ Inherited by child processes
- ⚠️ Still plaintext (just not in a file)

**Setup:**
```bash
# Add to ~/.bashrc or systemd EnvironmentFile
export BSV_PRIVATE_KEY="$(cat ~/.bsv-p2p/private-key.txt)"

# Or use systemd with EnvironmentFile
# /etc/systemd/system/bsv-p2p.service:
[Service]
EnvironmentFile=/etc/bsv-p2p/keys.env
ExecStart=/usr/bin/node daemon.js
```

**Best for:**
- Docker deployments
- CI/CD pipelines
- Small amounts (<$100 on mainnet)

---

#### 3. OS Keychain (Recommended for Mainnet)

**Platforms:**
- **macOS:** Keychain Access (encrypted, Touch ID support)
- **Linux:** GNOME Keyring / KWallet (encrypted with login password)
- **Windows:** Credential Manager (encrypted, Windows Hello support)

**How it works:**
1. Keys stored in OS-managed encrypted storage
2. Automatic unlock on login (configurable)
3. Per-application access control
4. Biometric authentication available (macOS/Windows)

**Setup:**

```bash
# Install dependencies (Linux only)
sudo apt install libsecret-1-dev  # Debian/Ubuntu
sudo dnf install libsecret-devel  # Fedora
sudo pacman -S libsecret          # Arch

# Migrate existing keys to keychain
bsv-p2p config migrate-to-keychain

# Verify
bsv-p2p config check-security
```

**Verification:**
- **macOS:** Open Keychain Access → Search "bsv-p2p"
- **Linux:** `secret-tool search service bsv-p2p`
- **Windows:** Control Panel → Credential Manager → Generic Credentials

**Pros:**
- ✅ Platform-native security
- ✅ Automatic encryption at rest
- ✅ OS-level access control
- ✅ Biometric unlock (macOS/Windows)
- ✅ Audited by OS vendors

**Cons:**
- ❌ Requires GUI unlock on some Linux distros
- ❌ Docker containers need special setup
- ❌ Extra dependency (libsecret on Linux)

**Docker Usage:**

```dockerfile
# Mount host keyring (Linux)
docker run -v $HOME/.local/share/keyrings:/root/.local/share/keyrings \
           -e DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS \
           bsv-p2p:latest

# Or use environment variable fallback
docker run -e BSV_PRIVATE_KEY="..." bsv-p2p:latest
```

---

#### 4. Encrypted Config File

**File:** `~/.bsv-p2p/config.enc` (replaces `config.json`)  
**Encryption:** AES-256-GCM with scrypt KDF

**How it works:**
1. User provides passphrase (once at daemon start)
2. Config encrypted with AES-256-GCM
3. Passphrase derived into encryption key via scrypt (memory-hard)
4. Encrypted file stored on disk
5. Decrypted in memory only

**Setup:**

```bash
# Encrypt existing config
bsv-p2p config encrypt
# Enter passphrase: ********
# Confirm: ********
# ✅ Config encrypted: ~/.bsv-p2p/config.enc

# Start daemon (prompts for passphrase)
bsv-p2p daemon start
# Enter passphrase: ********
```

**Automated Setup (Headless):**

```bash
# Use environment variable for passphrase
export BSV_CONFIG_PASSPHRASE="your-secure-passphrase"
bsv-p2p daemon start
```

**Pros:**
- ✅ Cross-platform (pure Node.js)
- ✅ No external dependencies
- ✅ Works in Docker/headless
- ✅ User-controlled passphrase
- ✅ Can use hardware tokens (YubiKey) for passphrase

**Cons:**
- ❌ User must enter passphrase each start (unless env var)
- ❌ Passphrase in memory during runtime
- ❌ UX friction (prompt on every restart)

**Best for:**
- Headless Linux servers
- Docker containers without keychain access
- Automated deployments with secure env var management

---

#### 5. Hardware Security Module (HSM)

**Options:**
- Software: SoftHSM2, HashiCorp Vault
- Cloud: AWS KMS, Google Cloud KMS
- Hardware: YubiKey, Ledger, enterprise HSMs

**How it works:**
- Private key never leaves HSM
- Signing operations performed in hardware
- Tamper-resistant, audit trails
- FIPS 140-2 compliance

**Setup (Example: SoftHSM2):**

```bash
# Install SoftHSM
sudo apt install softhsm2

# Initialize token
softhsm2-util --init-token --slot 0 --label "bsv-p2p"

# Configure bsv-p2p to use PKCS#11
# (Future feature, see GitHub issue #XXX)
```

**Pros:**
- ✅✅ Maximum security
- ✅ Keys never in software
- ✅ Tamper-resistant
- ✅ Audit trails
- ✅ Compliance-friendly

**Cons:**
- ❌ Complex setup
- ❌ High cost (cloud HSM: $1-5/hour)
- ❌ Latency overhead
- ❌ Not yet implemented in bsv-p2p

**Best for:**
- Enterprise deployments
- Regulatory compliance needs
- Large payment channels (>$10k)

**Status:** 🚧 Planned feature (see roadmap)

---

## Setup Guides

### Quick Start (Testnet)

```bash
# 1. Clone and install
git clone https://github.com/galt-tr/bsv-p2p.git
cd bsv-p2p
npm install

# 2. Generate testnet keys (plaintext is fine)
npx tsx scripts/init.ts --network testnet

# 3. Start daemon
npx tsx src/daemon/index.ts

# 4. Check status
npx tsx check-daemon.ts
```

---

### Production Setup (Mainnet with OS Keychain)

```bash
# 1. Clone and install
git clone https://github.com/galt-tr/bsv-p2p.git
cd bsv-p2p
npm install

# 2. Install system dependencies (Linux only)
sudo apt install libsecret-1-dev

# 3. Generate mainnet keys
npx tsx scripts/init.ts --network mainnet

# 4. Migrate to OS keychain
bsv-p2p config migrate-to-keychain
# Enter your system password when prompted

# 5. Verify security
bsv-p2p config check-security
# ✅ Private key stored in OS keychain
# ✅ Config file permissions: 0600

# 6. Backup your key (CRITICAL)
bsv-p2p config export-key --output ~/secure-usb/bsv-backup-$(date +%Y%m%d).txt
chmod 600 ~/secure-usb/bsv-backup-*.txt

# 7. Test recovery on a different machine
bsv-p2p config import-key --input ~/secure-usb/bsv-backup-20260219.txt

# 8. Start daemon
bsv-p2p daemon start

# 9. Fund wallet with small test amount first
# Get your address:
curl http://localhost:4002/api/wallet/address
# Send 0.001 BSV (100,000 sats) from another wallet

# 10. Verify receipt
curl http://localhost:4002/api/wallet/balance

# 11. Enable monitoring (see MONITORING.md)
```

---

### Docker Deployment (Mainnet with Environment Variables)

```bash
# 1. Generate keys on host
npx tsx scripts/init.ts --network mainnet

# 2. Extract key to secure file
echo "BSV_PRIVATE_KEY=$(jq -r .bsvPrivateKey ~/.bsv-p2p/config.json)" > keys.env
chmod 600 keys.env

# 3. Build Docker image
docker build -t bsv-p2p:latest .

# 4. Run container with env file
docker run -d \
  --name bsv-p2p \
  --env-file keys.env \
  -p 4001:4001 \
  -p 4002:4002 \
  -v bsv-p2p-data:/root/.bsv-p2p \
  bsv-p2p:latest

# 5. Check logs
docker logs -f bsv-p2p
```

**Security notes:**
- Store `keys.env` in secure location (not in repo)
- Use Docker Secrets for production:
  ```bash
  echo "$BSV_PRIVATE_KEY" | docker secret create bsv_key -
  ```
- Encrypt Docker volume at rest

---

## Backup & Recovery

### Why Backups Matter

**Without backups, you lose:**
- Access to all your on-chain BSV funds
- Ability to close payment channels
- Control of your peer identity

**No one can recover your keys for you.** Not us, not BSV, not anyone.

### What to Back Up

| Item | Location | Critical? | Frequency |
|------|----------|-----------|-----------|
| **Private key** | OS keychain or config | ✅ CRITICAL | Once (never changes) |
| **Channel states** | `~/.bsv-p2p/channels.db` | ✅ Important | Daily |
| **Wallet UTXO DB** | `~/.bsv-p2p/wallet.db` | ⚠️ Nice to have | Daily |
| **Config file** | `~/.bsv-p2p/config.json` | ⚠️ Nice to have | On changes |

### Backup Procedure

#### 1. Export Your Private Key

```bash
# Method 1: From OS keychain
bsv-p2p config export-key --output ~/secure-usb/bsv-key-backup.txt

# Method 2: From config file (if still using plaintext)
grep bsvPrivateKey ~/.bsv-p2p/config.json > ~/secure-usb/bsv-key-backup.txt

# Method 3: Manual (from Keychain Access on macOS)
# Open Keychain Access → Search "bsv-p2p" → Show Password → Copy
```

#### 2. Secure Your Backup

**✅ Do:**
- Store on encrypted USB drive
- Keep offline (not cloud)
- Use strong passphrase for encryption
- Store in physical safe or safety deposit box
- Make 2-3 copies in different locations

**❌ Don't:**
- Upload to Dropbox, Google Drive, iCloud
- Email to yourself
- Store in password manager (unless end-to-end encrypted)
- Print and leave on desk
- Store in Git repository

**Recommended: GPG Encryption**

```bash
# Encrypt backup
gpg --symmetric --cipher-algo AES256 ~/secure-usb/bsv-key-backup.txt
# Enter passphrase: ********

# Verify you can decrypt
gpg ~/secure-usb/bsv-key-backup.txt.gpg
```

#### 3. Backup Channel States (Important)

```bash
# Copy database files
cp ~/.bsv-p2p/channels.db ~/secure-usb/channels-backup-$(date +%Y%m%d).db
cp ~/.bsv-p2p/wallet.db ~/secure-usb/wallet-backup-$(date +%Y%m%d).db

# Compress and encrypt
tar -czf - ~/.bsv-p2p/*.db | gpg --symmetric --cipher-algo AES256 > ~/secure-usb/bsv-data-$(date +%Y%m%d).tar.gz.gpg
```

**Why channel states matter:**
- Know which channels are open
- Prove your balance in each channel
- Detect fraud (if peer tries to cheat)

### Recovery Procedure

#### Scenario 1: Restore on Same Machine

```bash
# Stop daemon
bsv-p2p daemon stop

# Restore private key to keychain
bsv-p2p config import-key --input ~/secure-usb/bsv-key-backup.txt

# Restore databases (if needed)
cp ~/secure-usb/channels-backup-*.db ~/.bsv-p2p/channels.db
cp ~/secure-usb/wallet-backup-*.db ~/.bsv-p2p/wallet.db

# Restart daemon
bsv-p2p daemon start

# Verify
curl http://localhost:4002/api/wallet/address
# Should match your old address
```

#### Scenario 2: Restore on New Machine

```bash
# 1. Install bsv-p2p on new machine
git clone https://github.com/galt-tr/bsv-p2p.git
cd bsv-p2p
npm install

# 2. Import private key
bsv-p2p config import-key --input /path/to/bsv-key-backup.txt

# 3. Restore databases
mkdir -p ~/.bsv-p2p
cp /path/to/channels-backup-*.db ~/.bsv-p2p/channels.db
cp /path/to/wallet-backup-*.db ~/.bsv-p2p/wallet.db

# 4. Sync wallet from blockchain
bsv-p2p wallet sync

# 5. Start daemon
bsv-p2p daemon start

# 6. Verify peer ID and address match
```

#### Scenario 3: Lost All Backups (Disaster)

If you lost your private key **and** have no backups:

❌ **Your funds are gone forever.** There is no recovery.

**What you can do:**
- Generate a new key: `bsv-p2p init --force`
- Open new channels with new identity
- Mark old channels as compromised (notify peers if possible)

**Lesson:** Always test your backup recovery procedure.

---

## Key Rotation

### When to Rotate Keys

**Rotate immediately if:**
- 🚨 Key was compromised or suspected leak
- 🚨 Ex-employee/contractor had access
- 🚨 Device was stolen or lost
- 🚨 Config file was accidentally committed to public repo

**Rotate periodically:**
- 📅 Every 6-12 months (best practice)
- 📅 After major version upgrades
- 📅 When moving testnet → mainnet

### Rotation Procedure

> ⚠️ **Warning:** Key rotation is complex and requires closing all channels. Plan downtime.

**Steps:**

1. **Close all active channels** (cooperative close preferred)
   ```bash
   # List channels
   curl http://localhost:4002/api/channels
   
   # Close each channel
   curl -X POST http://localhost:4002/api/channels/{channelId}/close
   ```

2. **Wait for on-chain confirmations** (6+ blocks)
   ```bash
   # Monitor closing transactions
   bsv-p2p channels status
   ```

3. **Sweep funds to new address** (send to yourself)
   ```bash
   # Get balance
   curl http://localhost:4002/api/wallet/balance
   
   # Send to new wallet (created separately)
   curl -X POST http://localhost:4002/api/wallet/send \
     -d '{"address":"NEW_ADDRESS", "amount":balance}'
   ```

4. **Stop daemon**
   ```bash
   bsv-p2p daemon stop
   ```

5. **Backup old key** (for audit trail)
   ```bash
   bsv-p2p config export-key --output ~/old-keys/key-$(date +%Y%m%d).txt.old
   ```

6. **Generate new key**
   ```bash
   bsv-p2p config rotate-key
   # Or manually:
   # bsv-p2p config delete-key
   # npx tsx scripts/init.ts
   ```

7. **Update documentation** (new address, new peer ID)

8. **Notify peers** (share new Peer ID)

9. **Restart daemon**
   ```bash
   bsv-p2p daemon start
   ```

10. **Fund new wallet**
    ```bash
    # Get new address
    curl http://localhost:4002/api/wallet/address
    
    # Transfer funds from old address or external wallet
    ```

11. **Re-open channels** with peers

**Timeline:** Allow 1-2 hours for full rotation with multiple channels.

---

## Troubleshooting

### "Failed to access OS keychain"

**Linux:**
```bash
# Check if keyring daemon is running
ps aux | grep gnome-keyring

# Unlock keyring manually
echo "password" | gnome-keyring-daemon --unlock

# If using SSH, need dbus session
export $(dbus-launch)
```

**macOS:**
```bash
# Keychain locked? Unlock in Keychain Access app
open /Applications/Utilities/Keychain\ Access.app

# Or via CLI
security unlock-keychain ~/Library/Keychains/login.keychain-db
```

---

### "Passphrase prompt hangs in Docker"

Docker containers don't have TTY by default. Solutions:

```bash
# Option 1: Use environment variable
docker run -e BSV_CONFIG_PASSPHRASE="secret" bsv-p2p

# Option 2: Run with TTY (interactive)
docker run -it bsv-p2p daemon start
```

---

### "Key migration failed: permission denied"

```bash
# Fix file permissions
chmod 600 ~/.bsv-p2p/config.json
chown $USER:$USER ~/.bsv-p2p/config.json

# Retry migration
bsv-p2p config migrate-to-keychain
```

---

### "How do I check if my key is secure?"

```bash
bsv-p2p config check-security
```

**Expected output:**
```
🔍 Security Audit

✅ Private key stored in OS keychain
✅ Config file permissions: 0600 (owner only)
✅ No git repository detected

📋 Backup Checklist:
   - Export key to secure offline storage
   - Do NOT store in cloud
   - Test recovery process
```

---

### "I forgot my encrypted config passphrase"

**If you have a backup:**
1. Restore from `~/secure-usb/bsv-key-backup.txt`
2. Import key: `bsv-p2p config import-key --input backup.txt`
3. Create new encrypted config with new passphrase

**If you don't have a backup:**
❌ Your funds are permanently lost. There is no password reset.

**Prevention:** Write down passphrase and store with key backup.

---

### "Can I use the same key for multiple bots?"

**No.** Each bot should have its own private key. Sharing keys causes:
- Nonce collisions (double-spend risk)
- Channel state conflicts
- Identity confusion (same Peer ID)
- Security blast radius (one compromise = all bots)

**Instead:** Use a hierarchical deterministic (HD) wallet to derive multiple keys from one seed (future feature).

---

## Additional Resources

- [Private Key Storage Audit](./PRIVATE-KEY-STORAGE-AUDIT.md) — Deep dive into security research
- [OWASP Key Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html)
- [BSV P2P Architecture](../ARCHITECTURE.md)
- [GitHub Discussions](https://github.com/galt-tr/bsv-p2p/discussions) — Ask questions

---

**Last Updated:** February 19, 2026  
**Maintainers:** Researcher, Backend Team  
**Feedback:** https://github.com/galt-tr/bsv-p2p/issues

