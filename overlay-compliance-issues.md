# Clawdbot Overlay & OpenClaw Plugin — BRC Compliance Audit

## Overview

This document analyzes `clawdbot-overlay` (the server) and `openclaw-overlay-plugin` (the client) against BSV BRC specifications and best practices.

**Reviewed BRCs:**
- BRC-22: Transaction Submission (Overlay)
- BRC-24: Lookup Services
- BRC-31: Authrite (Identity/Authentication)
- BRC-29: Wallet Payment Protocol
- BRC-62: BEEF (Background Evaluation Extended Format)
- BRC-67: SPV Verification
- BRC-88: SHIP/SLAP (Overlay Discovery)
- BRC-100: Wallet Architecture

---

## 🔴 CRITICAL: Security Issues

### 1. **BRC-31 Identity Verification NOT Implemented**
**Severity:** CRITICAL  
**Location:** Both repositories  
**BRC Reference:** BRC-31 (Authrite)

**Issue:** The DESIGN.md explicitly acknowledges:
> "Transaction signature verification (BRC-31) is NOT implemented in v0.1. Transactions are not verified to be signed by the claimed identityKey."

**Impact:** Any agent can impersonate another by simply claiming their identityKey. This breaks the entire trust model.

**Fix Required:**
- Server: Add BRC-31 signature verification in topic managers before admitting outputs
- Plugin: Sign payloads with the identity key using Authrite-compatible signatures
- Verify signature on both `/submit` and `/relay/send` endpoints

---

## 🟠 HIGH: Protocol Compliance Issues

### 2. **Custom Protocol Instead of Standard SHIP/SLAP**
**Severity:** HIGH  
**Location:** Both repositories  
**BRC Reference:** BRC-88 (SHIP/SLAP)

**Issue:** The overlay uses a custom `clawdbot-overlay-v1` protocol with custom topic/lookup names instead of implementing BRC-88's SHIP/SLAP standards for peer discovery.

**Current Implementation:**
```
Topics: tm_clawdbot_identity, tm_clawdbot_services
Lookups: ls_clawdbot_agents, ls_clawdbot_services
```

**BRC-88 Standard:**
```
Topics: tm_ship (for hosting), tm_slap (for lookups)
Token format: [protocol, identityKey, domain, topicOrService]
```

**Impact:** The overlay is a walled garden. Other BSV overlay implementations cannot discover or interact with it using standard protocols.

**Recommendation:** Either:
- Add SHIP/SLAP support alongside custom topics (preferred)
- Or document this as an intentional deviation

### 3. **Missing SPV Verification in Topic Managers**
**Severity:** HIGH  
**Location:** `clawdbot-overlay/src/topic-managers/*.ts`  
**BRC Reference:** BRC-67, BRC-9

**Issue:** Topic managers extract transaction data from BEEF but do not perform full SPV verification. They rely on `@bsv/overlay` to handle this, but there's no explicit verification that merkle paths are validated.

**Expected per BRC-67:**
1. Validate script evaluation
2. Verify fees are adequate
3. Verify merkle path to block header
4. Check locktime/sequence constraints

**Current Code:**
```typescript
// Only parses BEEF and extracts outputs, no explicit SPV
const tx = this.getSubjectTransaction(beef)
```

### 4. **Relay Messaging Not On-Chain**
**Severity:** HIGH  
**Location:** `clawdbot-overlay/src/relay.ts`  
**BRC Reference:** None (custom feature)

**Issue:** The message relay system is a centralized database mailbox, not an on-chain protocol. Messages are stored in MySQL/SQLite and can be lost if the server fails.

**Impact:** 
- Central point of failure
- No permanent record of communications
- Server operator can read/modify messages

**Recommendation:** Either:
- Keep as-is but document clearly as off-chain relay
- Or implement an on-chain messaging topic (e.g., `tm_clawdbot_messages`)

---

## 🟡 MEDIUM: Implementation Gaps

### 5. **Plugin ID Mismatch**
**Severity:** MEDIUM  
**Location:** `openclaw-overlay-plugin/manifest.json` vs config  

**Issue:** Repeated config warnings:
```
plugin id mismatch (manifest uses "bsv-overlay", entry hints "openclaw-overlay-plugin")
```

**Fix:** Align the plugin ID in manifest.json with the entry point expectations.

### 6. **BEEF Ancestry Chain Depth Limitation**
**Severity:** MEDIUM  
**Location:** `openclaw-overlay-plugin/src/scripts/overlay/transaction.ts`  

**Issue:** Source chain depth is arbitrarily limited:
```typescript
saveStoredChange({
  ...
  sourceChain: newSourceChain.slice(0, 10), // limit chain depth
});
```

**Impact:** Long-running agents may lose transaction ancestry, causing SPV verification failures.

**Recommendation:** Document the limit and/or implement proper BEEF pruning when confirmations are achieved.

### 7. **Payment Amount Not Verified**
**Severity:** MEDIUM  
**Location:** `openclaw-overlay-plugin/src/core/verify.ts`

**Issue:** `verifyPayment` accepts `expectedAmount` but doesn't actually verify it:
```typescript
export async function verifyPayment(params: VerifyParams): Promise<VerifyResult> {
  // expectedAmount is in params but never checked against actual outputs
}
```

**Fix:** Add output amount verification against `expectedAmount` when provided.

### 8. **Sender Identity Not Cryptographically Verified**
**Severity:** MEDIUM  
**Location:** `openclaw-overlay-plugin/src/core/verify.ts`

**Issue:** `expectedSender` validation only checks format, not cryptographic proof:
```typescript
if (params.expectedSender) {
  if (!/^0[23][0-9a-fA-F]{64}$/.test(params.expectedSender)) {
    errors.push('expectedSender is not a valid compressed public key');
  }
}
```

**BRC-29 Requirement:** The payment should be cryptographically linked to the sender's identity key.

### 9. **No Rate Limiting on Relay Endpoints**
**Severity:** MEDIUM  
**Location:** `clawdbot-overlay/src/index.ts` (relay routes)

**Issue:** The `/relay/send` and `/relay/inbox` endpoints have no rate limiting, enabling spam attacks.

**Recommendation:** Add rate limiting per identity key.

---

## 🟢 LOW: Best Practice Suggestions

### 10. **Hardcoded TAAL API Keys**
**Severity:** LOW  
**Location:** `openclaw-overlay-plugin/src/core/config.ts`

**Issue:**
```typescript
export const DEFAULT_TAAL_API_KEYS: Record<Chain, string> = {
  main: 'mainnet_9596de07e92300c6287e4393594ae39c',
  test: 'testnet_0e6cf72133b43ea2d7861da2a38684e3',
};
```

**Recommendation:** These appear to be public demo keys. Document this clearly and encourage users to provide their own keys.

### 11. **SDK Version Compatibility Hacks**
**Severity:** LOW  
**Location:** Both repositories (topic managers, lookup services)

**Issue:** Extensive code to handle different `@bsv/sdk` chunk parsing formats:
```typescript
// --- Legacy 4+ chunk format (older SDK) ---
// --- Collapsed 2-chunk format (SDK v1.10+) ---
```

**Recommendation:** Pin SDK version and simplify, or abstract into a shared utility.

### 12. **Missing WebSocket Authentication**
**Severity:** LOW  
**Location:** `clawdbot-overlay/src/relay.ts`

**Issue:** WebSocket connections only validate identity format, not proof of ownership:
```typescript
const identity = url.searchParams.get('identity')
if (!identity || !/^0[23][0-9a-fA-F]{64}$/.test(identity)) {
  ws.close(4001, 'Invalid or missing identity parameter')
}
```

Anyone can subscribe as any identity and receive their messages.

### 13. **No Transaction Expiry/Revocation Model**
**Severity:** LOW  
**Location:** Both repositories

**Issue:** Identity and service records can only be "revoked" by spending the UTXO, but there's no documented expiry model for dormant records.

**Recommendation:** Add optional TTL field and periodic cleanup.

### 14. **Lookup Service Query Limit**
**Severity:** LOW  
**Location:** Lookup services (both)

**Issue:** Hardcoded limit of 100 results:
```typescript
const rows = await qb.limit(100)
```

**Recommendation:** Make configurable and implement pagination.

---

## ✅ Compliant Areas

### What's Working Well

1. **BRC-22 Submission API** — The server correctly implements `/submit` with BEEF body and `X-Topics` header, returning STEAK response format.

2. **BRC-24 Lookup API** — The `/lookup` endpoint follows the spec with service name and query object.

3. **BRC-62 BEEF Handling** — Both repositories correctly parse and construct BEEF binary format, including proper atomic transaction extraction.

4. **BRC-29 Payment Protocol** — The wallet implementation uses BRC-29 key derivation with derivationPrefix/derivationSuffix for proper address uniqueness.

5. **BRC-100 Wallet Architecture** — Uses `@bsv/wallet-toolbox` correctly with proper key derivation, storage manager, and monitor setup.

6. **OP_RETURN Format** — Correctly uses `OP_FALSE OP_RETURN <protocol> <json>` format with proper PUSHDATA handling.

7. **Topic Manager Interface** — Implements `@bsv/overlay` TopicManager interface correctly with `identifyAdmissibleOutputs`, `getDocumentation`, and `getMetaData`.

8. **Lookup Service Interface** — Implements `@bsv/overlay` LookupService interface correctly with admission modes and spend notifications.

---

## Recommended Priority

1. **CRITICAL** — Implement BRC-31 signature verification (Issue #1)
2. **HIGH** — Add WebSocket authentication (Issue #12 elevated due to relay access)
3. **HIGH** — Fix payment amount verification (Issue #7)
4. **MEDIUM** — Fix plugin ID mismatch (Issue #5)
5. **MEDIUM** — Add relay rate limiting (Issue #9)
6. **LOW** — Everything else

---

## Summary Table

| Issue | Severity | BRC | Status |
|-------|----------|-----|--------|
| No BRC-31 signature verification | 🔴 CRITICAL | BRC-31 | NOT IMPLEMENTED |
| Custom protocol (no SHIP/SLAP) | 🟠 HIGH | BRC-88 | DEVIATION |
| Missing explicit SPV in topic managers | 🟠 HIGH | BRC-67 | UNCLEAR |
| Relay messaging not on-chain | 🟠 HIGH | N/A | DESIGN CHOICE |
| Plugin ID mismatch | 🟡 MEDIUM | N/A | BUG |
| BEEF ancestry depth limit | 🟡 MEDIUM | BRC-62 | LIMITATION |
| Payment amount not verified | 🟡 MEDIUM | BRC-29 | BUG |
| Sender identity not crypto-verified | 🟡 MEDIUM | BRC-31 | NOT IMPLEMENTED |
| No relay rate limiting | 🟡 MEDIUM | N/A | MISSING |
| Hardcoded TAAL keys | 🟢 LOW | N/A | DOCUMENTATION |
| SDK version hacks | 🟢 LOW | N/A | TECHNICAL DEBT |
| No WebSocket auth | 🟢 LOW | BRC-31 | NOT IMPLEMENTED |
| No record expiry model | 🟢 LOW | N/A | MISSING |
| Hardcoded query limit | 🟢 LOW | BRC-24 | LIMITATION |
| BRC-22 submission | ✅ | BRC-22 | COMPLIANT |
| BRC-24 lookup | ✅ | BRC-24 | COMPLIANT |
| BRC-62 BEEF handling | ✅ | BRC-62 | COMPLIANT |
| BRC-29 payment protocol | ✅ | BRC-29 | COMPLIANT |
| BRC-100 wallet architecture | ✅ | BRC-100 | COMPLIANT |

---

*Generated: 2026-02-02*  
*Repositories: clawdbot-overlay, openclaw-overlay-plugin*
