# Security

## Threat Model

### What Vault MCP protects against

- **LLM context leakage**: Credentials never appear in the LLM's context window, conversation history, or tool responses
- **Accidental exposure**: Passwords are stored encrypted at rest, not in plaintext config files
- **Audit trail tampering**: SHA-256 hash chain ensures any modification to the audit log is detectable
- **Unauthorized use**: Credentials can be toggled active/inactive, and every use is logged

### What Vault MCP does NOT protect against

- **Compromised host machine**: If an attacker has root access, they can read memory, intercept CDP, or extract the master key
- **Malicious MCP client**: A compromised Claude Code instance could call `vault_login` for any stored credential
- **Browser-level attacks**: Vault fills forms via CDP — the credentials exist briefly in Chrome's memory
- **Network MITM**: Vault doesn't control the TLS connection to target sites

## Encryption Details

| Property | Value |
|----------|-------|
| Algorithm | AES-256-GCM |
| Key derivation | scrypt (from `VAULT_MASTER_KEY` env var) |
| IV | 16 bytes, random per credential |
| Auth tag | 16 bytes (GCM integrity) |
| Storage format | `base64(IV + ciphertext + authTag)` |

Each credential is encrypted independently with a unique random IV. Modifying any byte of the ciphertext will cause decryption to fail (GCM authenticated encryption).

## Audit Log Integrity

The audit log (`~/.vault-mcp/audit.jsonl`) uses a SHA-256 hash chain:

```
Entry 1: hash = SHA-256("genesis" + JSON(entry))
Entry 2: hash = SHA-256(entry1.hash + JSON(entry))
Entry N: hash = SHA-256(entryN-1.hash + JSON(entry))
```

Modifying or deleting any entry breaks the chain. Verify integrity:

```bash
vault-mcp audit  # Shows chain status at the bottom
```

## Responsible Disclosure

If you find a security vulnerability, please report it via GitHub Issues with the `security` label, or email the maintainers directly. We will respond within 48 hours.

Please do **not** open public issues for active exploits.
