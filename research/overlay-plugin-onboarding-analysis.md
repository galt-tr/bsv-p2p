# BSV Overlay Plugin Onboarding Analysis

**Date:** 2026-02-02  
**Analyst:** Research subagent  
**Purpose:** Compare current BSV overlay plugin onboarding against OpenClaw plugin best practices and identify improvements.

---

## 1. OpenClaw Plugin Best Practices (Summary)

Based on comprehensive review of `/docs/plugin.md`, `/docs/plugins/manifest.md`, `/docs/plugins/agent-tools.md`, and the voice-call reference plugin.

### 1.1 Required Plugin Structure

Every plugin **must** include:

1. **`openclaw.plugin.json` manifest** with:
   - `id` (string): canonical plugin id
   - `configSchema` (JSON Schema): validates plugin config without executing code
   - Optional: `name`, `description`, `version`, `uiHints`, `kind`, `channels`, `providers`, `skills`

2. **`package.json`** with `openclaw.extensions` pointing to entry file(s)

3. **Entry file** exporting either:
   - A function: `(api) => { ... }`
   - An object: `{ id, name, configSchema, register(api) { ... } }`

### 1.2 Plugin Registration API

Plugins can register:
- **Tools** via `api.registerTool()` — with optional `{ optional: true }` for opt-in tools
- **Services** via `api.registerService()` — for background services (start/stop lifecycle)
- **CLI commands** via `api.registerCli()`
- **Auto-reply commands** via `api.registerCommand()` — execute without AI agent invocation
- **Gateway RPC methods** via `api.registerGatewayMethod()`
- **Channels** via `api.registerChannel()`
- **Provider auth flows** via `api.registerProvider()`

### 1.3 Config Best Practices

- Config lives under `plugins.entries.<id>.config`
- All config fields should have **JSON Schema validation**
- Use `uiHints` for labels, placeholders, `sensitive` flags, `advanced` flags
- Config changes require gateway restart

### 1.4 Installation & Distribution

- `openclaw plugins install <npm-spec>` — installs from npm
- `openclaw plugins install <path>` — installs from local directory
- `openclaw plugins install -l <path>` — links for development (no copy)
- Plugins auto-enable after install (can be disabled via config)

### 1.5 Reference: Voice Call Plugin Pattern

The voice-call plugin demonstrates excellent patterns:
- Clear, minimal onboarding: install → restart → configure → use
- Comprehensive `uiHints` for every config field
- Detailed `configSchema` with proper types, defaults, patterns
- CLI commands for status/operations
- Agent tool for programmatic access
- Well-documented README with examples

---

## 2. Current BSV Overlay Plugin Onboarding Flow

Based on review of `/git/openclaw-overlay-plugin/index.ts`, `openclaw.plugin.json`, `README.md`.

### 2.1 What Currently Exists

**Installation:**
```bash
openclaw plugins install @bsv/openclaw-overlay-plugin
```

**Auto-Setup Flow (in plugin `register()` function):**
1. Auto-enables hooks in config if not configured (writes to config file)
2. Creates wallet if missing (`overlay-cli setup`)
3. Gets wallet address for onboarding message
4. Checks registration state
5. If funded (≥1000 sats) but not registered → auto-registers
6. If not registered and not funded → sends onboarding message via `wakeAgent()`

**Onboarding Message (sent via `/hooks/agent`):**
```
🔌 **BSV Overlay Plugin — Setup**

The OpenClaw Overlay Network plugin is installed and your BSV wallet has been initialized.

✅ **Hooks auto-configured** — (if applicable)

**To join the network, your wallet needs funding.**

📬 **Wallet address**: `<address>`
💰 **Amount needed**: 1,000–10,000 sats (~$0.05–$0.50)

Send BSV from any wallet...
```

**Post-Registration:**
- Another wake message is sent with next steps (choose agent name, advertise services)

### 2.2 Available Actions (Tool)

The `overlay` tool exposes these actions:
- `setup`, `address`, `balance`, `status`, `import`, `register`
- `discover`, `request`, `pay`
- `advertise`, `readvertise`, `remove-service`
- `services`, `pending-requests`, `fulfill`
- `onboard` (manual trigger for full onboarding sequence)
- `unregister` (requires confirmation token)

### 2.3 Configuration Options

From `openclaw.plugin.json`:
- `overlayUrl` — overlay server URL
- `agentName` — display name on network
- `agentDescription` — agent description
- `walletDir` — wallet storage directory
- `maxAutoPaySats` — max auto-payment per request (default: 200)
- `dailyBudgetSats` — daily spending limit (default: 5000)
- `autoAcceptPayments` — auto-accept incoming payments
- `preferCheapest` — prefer cheapest provider
- `services` — list of service IDs to auto-advertise

---

## 3. Gap Analysis: Ideal vs Current

### 3.1 Ideal Onboarding Workflow

1. User installs the overlay plugin
2. Plugin prompts user for:
   - Name to register
   - Which services to enable
   - Config bits (budget limits, etc.)
3. Plugin gives user an address to fund
4. User supplies transaction ID
5. Plugin imports the transaction properly
6. Plugin registers agent with overlay and advertises all services

### 3.2 Current Implementation Gaps

| Aspect | Ideal | Current | Gap |
|--------|-------|---------|-----|
| **Name Configuration** | Prompt during setup | Uses config or hostname default | ⚠️ No interactive prompt; user must edit config manually |
| **Service Selection** | Interactive selection during onboarding | User must call `advertise` for each service manually after registration | ❌ No guided service selection |
| **Config Prompting** | Wizard-style prompts | Wake message with manual config instructions | ⚠️ Non-interactive, user must edit config file |
| **Funding Address** | Clear display + copy support | Address shown in wake message | ✅ Works but formatting could improve |
| **Transaction Import** | Prompt for txid, validate, auto-import | User must call `overlay({ action: "import", txid: "..." })` manually | ⚠️ Auto-import exists but 60s polling; manual import still required |
| **Registration** | Automatic after funding | Auto-registers when ≥1000 sats detected | ✅ Works well |
| **Service Advertising** | Auto-advertise selected services | Manual via `advertise` action | ❌ `services` config option exists but not used |
| **First-Run Experience** | Cohesive wizard flow | Fragmented wake messages | ⚠️ Messages are informative but not interactive |

### 3.3 Technical Gaps

1. **No CLI Setup Wizard**
   - Voice-call plugin has clear CLI commands
   - Overlay plugin has CLI commands but no interactive setup wizard
   - `openclaw overlay setup` could guide users through the full flow

2. **Config `services` Field Not Used**
   - `openclaw.plugin.json` defines `services: string[]` for auto-advertising
   - But the code doesn't use this during registration
   - Services must be advertised manually post-registration

3. **Auto-Import Polling Delay**
   - Auto-import polls every 60 seconds
   - User may need to wait up to 60s after funding before import happens
   - No immediate import after manual txid entry

4. **No Verification of Transaction Import**
   - Import action returns success/failure but no verification UI
   - User doesn't know if import actually credited their balance

5. **Hook Auto-Configuration Requires Restart**
   - Plugin auto-enables hooks but gateway restart needed
   - No automated restart or clear indication of this requirement

---

## 4. Specific Recommendations

### 4.1 High Priority — Essential for Good UX

#### A. Implement `services` Auto-Advertising

**Current:** The `services` config field exists but isn't used.

**Recommendation:** After registration, automatically advertise services listed in config:

```typescript
// In handleRegister or auto-registration flow
const servicesToAdvertise = config.services || [];
if (servicesToAdvertise.length > 0 && isRegistered) {
  for (const serviceId of servicesToAdvertise) {
    // Get service details from predefined list
    const serviceInfo = PREDEFINED_SERVICES[serviceId];
    if (serviceInfo) {
      await handleAdvertise({
        serviceId,
        name: serviceInfo.name,
        description: serviceInfo.description,
        priceSats: serviceInfo.suggestedPrice
      }, env, cliPath);
    }
  }
}
```

#### B. Add Interactive CLI Setup Command

**Current:** No guided setup via CLI.

**Recommendation:** Add `openclaw overlay wizard` command:

```typescript
overlay.command("wizard")
  .description("Interactive setup wizard for BSV Overlay Network")
  .action(async () => {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    // Step 1: Get agent name
    const agentName = await prompt(rl, "Agent name for the network: ");
    
    // Step 2: Show available services, let user select
    console.log("\nAvailable services to offer:");
    PREDEFINED_SERVICES.forEach((s, i) => console.log(`  ${i+1}. ${s.name} (${s.suggestedPrice} sats)`));
    const selections = await prompt(rl, "Select services (comma-separated numbers): ");
    
    // Step 3: Get budget limits
    const maxPay = await prompt(rl, "Max auto-pay per request (default 200): ") || "200";
    const dailyBudget = await prompt(rl, "Daily budget (default 5000): ") || "5000";
    
    // Step 4: Generate config snippet
    const configSnippet = {
      agentName,
      services: parseSelections(selections),
      maxAutoPaySats: parseInt(maxPay),
      dailyBudgetSats: parseInt(dailyBudget)
    };
    
    // Step 5: Write to config or show user
    console.log("\nAdd this to your config under plugins.entries.bsv-overlay.config:");
    console.log(JSON.stringify(configSnippet, null, 2));
    
    // Step 6: Show funding address
    const address = await getAddress();
    console.log(`\nFund your wallet: ${address}`);
    console.log("Minimum: 1,000 sats (~$0.05)");
    
    // Step 7: Option to wait for funding
    const waitForFunding = await prompt(rl, "\nWait for funding? (y/n): ");
    if (waitForFunding === 'y') {
      // Poll until funded, then auto-register
    }
  });
```

#### C. Implement `onboard` Auto-Reply Command

**Current:** Onboarding happens via wake messages which require AI processing.

**Recommendation:** Register an auto-reply command for instant onboarding status:

```typescript
api.registerCommand({
  name: "overlay",
  description: "Check BSV Overlay onboarding status",
  handler: async (ctx) => {
    const status = await getOnboardingStatus();
    if (status.registered) {
      return { text: `✅ Registered as ${status.agentName}\n💰 Balance: ${status.balance} sats\n📋 Services: ${status.services.length}` };
    } else if (status.funded) {
      return { text: `💰 Funded (${status.balance} sats) but not registered. Registering...` };
    } else {
      return { text: `📬 Fund your wallet: ${status.address}\n💰 Need: 1,000+ sats` };
    }
  }
});
```

### 4.2 Medium Priority — Improved UX

#### D. Reduce Auto-Import Polling Interval

**Current:** 60 seconds between checks.

**Recommendation:** Reduce to 30 seconds or implement exponential backoff (10s, 20s, 40s, etc.) after new wallet creation.

#### E. Add Balance Change Notifications

**Current:** No notification when balance changes from auto-import.

**Recommendation:** When auto-import succeeds, wake agent with funding confirmation:

```typescript
if (importOutput.success) {
  const newBalance = await getBalance();
  wakeAgent(`💰 Wallet funded! New balance: ${newBalance} sats. Auto-registering...`, logger);
}
```

#### F. Service Templates with Reasonable Defaults

**Current:** Services must be advertised with all parameters.

**Recommendation:** Add `advertise-template` action or allow shorthand:

```typescript
overlay({ action: "advertise-preset", presetId: "tell-joke" })
// Automatically uses: name="Random Joke", desc="Get a random joke", price=5
```

### 4.3 Low Priority — Nice to Have

#### G. QR Code for Funding Address

**Current:** Address shown as text.

**Recommendation:** Generate QR code in CLI wizard:

```typescript
import qrcode from 'qrcode-terminal';
qrcode.generate(`bitcoin:${address}?amount=0.00001`, { small: true });
```

#### H. Config Migration/Upgrade Support

**Current:** No migration when config schema changes.

**Recommendation:** Add version field and migration logic for smooth upgrades.

#### I. Onboarding Progress Indicator

**Current:** No visual progress during onboarding.

**Recommendation:** For CLI wizard, show progress steps:

```
[1/5] ✅ Wallet initialized
[2/5] ⏳ Waiting for funding...
[3/5] ✅ Transaction imported
[4/5] ✅ Registered on overlay network
[5/5] ✅ Services advertised (tell-joke, code-review)

🎉 Setup complete! Your agent is live on the BSV Overlay Network.
```

---

## 5. Implementation Checklist

### Quick Wins (< 1 day)

- [ ] Use `services` config field to auto-advertise after registration
- [ ] Add `/overlay` auto-reply command for instant status
- [ ] Reduce auto-import polling to 30 seconds
- [ ] Add balance notification on successful auto-import

### Medium Effort (1-3 days)

- [ ] Implement `openclaw overlay wizard` CLI command
- [ ] Add service presets/templates for easy advertising
- [ ] Improve onboarding wake messages with clearer next steps

### Larger Effort (> 3 days)

- [ ] Full interactive setup wizard with prompts
- [ ] QR code generation for funding addresses
- [ ] Config migration system
- [ ] Visual progress indicators in CLI

---

## 6. Conclusion

The BSV Overlay Plugin has solid core functionality but the onboarding UX is fragmented. The main gaps are:

1. **No interactive setup** — users must manually edit config and call actions
2. **`services` config field unused** — auto-advertise is documented but not implemented
3. **Fragmented guidance** — wake messages are informative but don't guide users step-by-step

**Priority Fixes:**
1. Implement `services` auto-advertising (low effort, high impact)
2. Add `/overlay` auto-reply command (low effort, immediate feedback)
3. Create `openclaw overlay wizard` CLI (medium effort, best UX improvement)

These changes would transform the onboarding from "read the docs and figure it out" to "run one command and follow the prompts."
