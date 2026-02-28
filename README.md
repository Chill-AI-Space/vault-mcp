# Vault MCP

MCP server for credential isolation in LLM agents. Your bot uses passwords and API keys — but never sees them in its context window.

## The Problem

```
  User                     LLM                    Website
   │                        │                        │
   │  "password: MyP@ss!"   │                        │
   ├───────────────────────►│                        │
   │                        │──── MyP@ss! ──────────►│
   │                        │                        │
   │                        │◄──── 200 OK ───────────│
   │                        │                        │
   ▼                        ▼                        ▼
                     ┌──────────────┐
                     │ MyP@ss! is   │
                     │ now stored   │
                     │ in LLM       │
                     │ context,     │
                     │ conversation │
                     │ history,     │
                     │ session logs │
                     └──────────────┘
```

## The Solution

```
  User          Browser Form       Vault MCP         LLM          Website
   │            (localhost)          │                 │              │
   │  ●●●●●●●●    │                 │                 │              │
   ├──────────────►│                 │                 │              │
   │               │── encrypt ─────►│                 │              │
   │               │                 │◄── vault_login ─┤              │
   │               │                 │── fill form ───────────────────►│
   │               │                 │◄──── 200 OK ───────────────────┤
   │               │                 │── { status: ok }─►│            │
   │               │                 │                 │              │
   ▼               ▼                 ▼                 ▼              ▼
                              ┌──────────────┐  ┌──────────────┐
                              │ Password:    │  │ LLM context: │
                              │ AES-256-GCM  │  │              │
                              │ encrypted    │  │ "status: ok" │
                              │ on disk      │  │ (no password)│
                              └──────────────┘  └──────────────┘
```

---

## Scenarios

### Scenario 1: First-time Login (vault_add → vault_login)

The agent needs credentials it doesn't have. It calls `vault_add()` — a browser form opens where you enter the password. Then `vault_login()` fills the form via Chrome.

```
  User              Claude Code           Vault MCP            Chrome
   │                    │                     │                   │
   │ "Log me into       │                     │                   │
   │  Jira"             │                     │                   │
   ├───────────────────►│                     │                   │
   │                    │── vault_list() ────►│                   │
   │                    │◄─ { credentials:[] }┤                   │
   │                    │                     │                   │
   │                    │── vault_add ───────►│                   │
   │                    │   { site: "jira" }  │                   │
   │                    │                     │                   │
   │   ┌────────────────────────────┐         │                   │
   │   │ Browser opens             │         │                   │
   │   │ localhost:9900/add         │         │                   │
   │   │                           │         │                   │
   │   │ Site ID:  [jira]          │         │                   │
   │   │ Email:    [me@work.com]   │         │                   │
   │   │ Password: [●●●●●●●●●●]   │         │                   │
   │   │ URL:      [jira.com/login]│         │                   │
   │   │                           │         │                   │
   │   │ [Add to Vault]            │         │                   │
   │   └────────────┬───────────────┘         │                   │
   │                │                         │                   │
   │                └── POST (encrypted) ────►│                   │
   │                                          │                   │
   │                    │◄─ { status: ok } ───┤                   │
   │                    │   site_id: "jira"   │                   │
   │                    │                     │                   │
   │                    │   (no password      │                   │
   │                    │    in this response) │                   │
   │                    │                     │                   │
   │                    │── vault_login ─────►│                   │
   │                    │   { site: "jira" }  │── decrypt ──┐     │
   │                    │                     │◄────────────┘     │
   │                    │                     │── fill email ────►│
   │                    │                     │── fill pass  ────►│
   │                    │                     │── click submit ──►│
   │                    │                     │◄─ page loaded ───┤
   │                    │                     │── clear pass ────►│
   │                    │                     │                   │
   │                    │◄─ { status: ok,  ───┤                   │
   │                    │    title: "Jira     │                   │
   │                    │    Dashboard" }     │                   │
   │                    │                     │                   │
   │◄── "You're logged  │                     │                   │
   │     into Jira!"    │                     │                   │
```

### Scenario 2: API Key Proxy (vault_api_request)

The agent makes an API call. Vault injects the API key into headers — the key never appears in the LLM context.

```
  Claude Code           Vault MCP                  Stripe API
   │                      │                            │
   │── vault_api_request ►│                            │
   │   service: "stripe"  │                            │
   │   url: "/v1/charges" │                            │
   │   method: "GET"      │                            │
   │                      │── decrypt API key          │
   │                      │                            │
   │                      │── GET /v1/charges ────────►│
   │                      │   Authorization:           │
   │                      │   Bearer sk-live-****      │
   │                      │                            │
   │                      │◄── { data: [...] } ───────┤
   │                      │                            │
   │                      │── scan response            │
   │                      │   for leaked key           │
   │                      │   (replace with ***)       │
   │                      │                            │
   │◄── { status: ok,  ───┤                            │
   │     body: "..." }    │                            │
   │                      │                            │
   │   (API key NOT in    │                            │
   │    this response)    │                            │
```

### Scenario 3: Returning User (credentials already stored)

If credentials already exist, the agent skips `vault_add` and goes straight to `vault_login`:

```
  User              Claude Code           Vault MCP            Chrome
   │                    │                     │                   │
   │ "Open GitHub"      │                     │                   │
   ├───────────────────►│                     │                   │
   │                    │── vault_list() ────►│                   │
   │                    │◄─ [{ siteId:       ─┤                   │
   │                    │     "github",       │                   │
   │                    │     active: true }] │                   │
   │                    │                     │                   │
   │                    │── vault_login ─────►│                   │
   │                    │   { site: "github" }│── decrypt ───┐    │
   │                    │                     │◄─────────────┘    │
   │                    │                     │── CDP login ─────►│
   │                    │                     │◄─ success ───────┤
   │                    │◄─ { status: ok } ───┤                   │
   │                    │                     │                   │
   │◄── "Done!"         │                     │                   │
```

### Scenario 4: Credential Revocation

Remove access instantly — the agent can no longer use the credential:

```
  Admin (CLI)           Vault MCP            Claude Code
   │                      │                      │
   │── vault-mcp remove   │                      │
   │   "jira"             │                      │
   │                      │── delete from store   │
   │                      │── audit: removed      │
   │◄── "Removed: jira"   │                      │
   │                      │                      │
   │                      │    ... later ...      │
   │                      │                      │
   │                      │◄── vault_login ──────┤
   │                      │    { site: "jira" }  │
   │                      │                      │
   │                      │── { status: FAIL, ──►│
   │                      │   "Credential not    │
   │                      │    found: jira" }    │
   │                      │                      │
```

### Scenario 5: Audit Trail

Every credential use is logged with a tamper-proof hash chain:

```
  ~/.vault-mcp/audit.jsonl

  ┌─────────────────────────────────────────────────────────────┐
  │ evt_001 │ credential.created │ jira    │ success │ hash_1  │
  │         │                    │         │         │    │    │
  │ evt_002 │ credential.used    │ jira    │ success │    │    │
  │         │ bot: claude        │         │         │    ▼    │
  │         │                    │         │ prevHash: hash_1  │
  │         │                    │         │         │ hash_2  │
  │         │                    │         │         │    │    │
  │ evt_003 │ credential.used    │ jira    │ success │    ▼    │
  │         │ bot: claude        │         │ prevHash: hash_2  │
  │         │                    │         │         │ hash_3  │
  │         │                    │         │         │    │    │
  │ evt_004 │ credential.removed │ jira    │ success │    ▼    │
  │         │                    │         │ prevHash: hash_3  │
  └─────────────────────────────────────────────────────────────┘

  Modify any entry → hash chain breaks → tamper detected

  $ vault-mcp audit
  Chain integrity: VALID (4 entries)
```

---

## Quickstart

```bash
# 1. Clone and build
git clone https://github.com/Chill-AI-Space/vault-mcp.git
cd vault-mcp
npm install
npm run build

# 2. Register with Claude Code
claude mcp add -s user vault -- node ~/path/to/vault-mcp/dist/index.js

# 3. Use in Claude Code
#    "Log me into GitHub" →
#    Claude calls vault_add("github") → browser form opens → you enter password
#    Claude calls vault_login("github") → Chrome logs in via CDP
#    Claude sees only { status: "success" }
```

Or add credentials via CLI (outside of Claude Code):

```bash
vault-mcp add --site github --email you@example.com --url https://github.com/login
# Password is prompted interactively (masked with *)
```

## MCP Tools

| Tool | What it does | What the LLM sees |
|------|-------------|-------------------|
| `vault_add(site_id?)` | Opens browser form for secure credential entry | `{ status, site_id }` |
| `vault_login(site_id)` | Logs into website via Chrome CDP | `{ status, page_title }` |
| `vault_api_request(service, url, ...)` | Makes API call with injected credentials | `{ status, body }` |
| `vault_list()` | Lists stored credentials | `[{ siteId, type, active }]` |
| `vault_status(site_id)` | Shows credential metadata + audit stats | `{ siteId, active, lastUsed }` |

**What the LLM never sees:** passwords, API keys, emails, tokens, encrypted data.

## CLI Commands

```bash
vault-mcp add                        # Interactive: add credential (password masked)
vault-mcp add --site X --email Y     # Semi-interactive
vault-mcp list                       # List credentials (no secrets)
vault-mcp remove <site_id>           # Remove credential
vault-mcp audit [site_id]            # View audit log + chain integrity
vault-mcp dashboard                  # Web UI on localhost:9900
vault-mcp serve                      # Start MCP server (for debugging)
```

## Architecture

```
vault-mcp/
├── src/
│   ├── index.ts              ── Entry: CLI or MCP mode (auto-detect)
│   ├── server.ts             ── MCP server, 5 tools registered
│   ├── cli.ts                ── CLI commands (commander + inquirer)
│   ├── tools/
│   │   ├── vault-add.ts      ── Opens browser form, waits for submit
│   │   ├── vault-login.ts    ── Decrypt → CDP → fill form → status
│   │   ├── vault-api.ts      ── Decrypt → inject headers → fetch → sanitize
│   │   ├── vault-list.ts     ── Return metadata only
│   │   └── vault-status.ts   ── Metadata + audit stats
│   ├── store/
│   │   ├── encrypted-store.ts ── AES-256-GCM CRUD, JSON file backend
│   │   └── keychain.ts        ── Master key: env var or auto-generate
│   ├── browser/
│   │   └── cdp-bridge.ts     ── Playwright connectOverCDP, form fill
│   ├── audit/
│   │   └── logger.ts         ── Append-only JSONL, SHA-256 hash chain
│   └── dashboard/
│       ├── server.ts         ── HTTP server (127.0.0.1:9900 only)
│       ├── index.html        ── Full dashboard (CRUD + audit viewer)
│       └── add.html          ── Focused add-credential form (for vault_add)
└── test/                     ── 29 tests including credential sanitization
```

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `VAULT_MASTER_KEY` | (auto-generated) | Encryption key. Without it, a random key is saved to `~/.vault-mcp/.master-key` |
| `VAULT_CDP_URL` | `http://localhost:9222` | Chrome DevTools Protocol endpoint |

```bash
# Register with env vars
claude mcp add -s user vault \
  -e VAULT_MASTER_KEY=my-secret-key \
  -e VAULT_CDP_URL=ws://localhost:9222 \
  -- node ~/path/to/vault-mcp/dist/index.js
```

## Storage

```
~/.vault-mcp/
├── credentials.json    ── Encrypted credentials (AES-256-GCM, unique IV per entry)
├── audit.jsonl         ── Append-only log with SHA-256 hash chain
└── .master-key         ── Auto-generated master key (mode 0600)
```

## Security

See [SECURITY.md](SECURITY.md) for full threat model.

```
  Protects against                 Does NOT protect against
  ─────────────────                ────────────────────────
  ✓ LLM context leakage           ✗ User typing password in chat
  ✓ Plaintext credential storage   ✗ Compromised host (root access)
  ✓ Audit log tampering            ✗ Malicious MCP client
  ✓ Accidental exposure in logs    ✗ Browser-level memory attacks
```

## Testing

```bash
npm test              # 29 tests
npm run test:watch    # Watch mode
```

Tests verify: encryption round-trip, wrong-key rejection, credential sanitization in all tool responses, hash chain integrity, tamper detection, full lifecycle flows.

## License

MIT
