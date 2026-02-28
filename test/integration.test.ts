import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EncryptedStore } from '../src/store/encrypted-store.js';
import { AuditLogger } from '../src/audit/logger.js';
import { clearKeyCache } from '../src/store/keychain.js';
import { vaultList } from '../src/tools/vault-list.js';
import { vaultStatus } from '../src/tools/vault-status.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Integration: Full Flow', () => {
  let store: EncryptedStore;
  let audit: AuditLogger;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = join(await mkdtemp(join(tmpdir(), 'vault-integration-')), '.vault-mcp');
    process.env.VAULT_MASTER_KEY = 'integration-test-key';
    clearKeyCache();
    store = new EncryptedStore(dataDir);
    audit = new AuditLogger(dataDir);
    await store.init();
    await audit.init();
  });

  afterEach(async () => {
    delete process.env.VAULT_MASTER_KEY;
    clearKeyCache();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('should complete full lifecycle: add → list → status → remove → verify', async () => {
    // 1. Add credential
    const meta = await store.addCredential('test-site', 'web_login', {
      email: 'user@test.com',
      password: 'P@ssw0rd!',
    }, 'https://test.com/login', {
      email: '#email',
      password: '#pass',
      submit: '#login',
    });
    await audit.log('credential.created', 'test-site', 'success');

    expect(meta.siteId).toBe('test-site');
    expect(meta.active).toBe(true);

    // 2. List — no secrets
    const list = await vaultList(store);
    expect(list.credentials).toHaveLength(1);
    expect(list.credentials[0].siteId).toBe('test-site');
    const listJson = JSON.stringify(list);
    expect(listJson).not.toContain('P@ssw0rd!');
    expect(listJson).not.toContain('user@test.com');

    // 3. Status — metadata only
    const status = await vaultStatus(store, audit, 'test-site');
    expect(status.siteId).toBe('test-site');
    expect(status.auditCount).toBe(1);
    const statusJson = JSON.stringify(status);
    expect(statusJson).not.toContain('P@ssw0rd!');

    // 4. Get credential — decrypted
    const cred = await store.getCredential('test-site');
    expect(cred!.data.email).toBe('user@test.com');
    expect(cred!.data.password).toBe('P@ssw0rd!');

    // 5. Remove
    await store.removeCredential('test-site');
    await audit.log('credential.removed', 'test-site', 'success');

    // 6. Verify removed
    const listAfter = await vaultList(store);
    expect(listAfter.credentials).toHaveLength(0);
    expect(await store.getCredential('test-site')).toBeNull();

    // 7. Audit chain intact
    const chain = await audit.verifyChain();
    expect(chain.valid).toBe(true);
    expect(chain.totalEntries).toBe(2);
  });

  it('should handle multiple credentials independently', async () => {
    await store.addCredential('github', 'web_login', { email: 'a@b.com', password: 'pw1' });
    await store.addCredential('stripe', 'api_key', { apiKey: 'sk-live-123', headers: { Authorization: 'Bearer sk-live-123' } });
    await store.addCredential('jira', 'web_login', { email: 'c@d.com', password: 'pw2' });

    expect(store.listCredentials()).toHaveLength(3);

    await store.removeCredential('stripe');
    expect(store.listCredentials()).toHaveLength(2);
    expect(store.listCredentials().map(c => c.siteId)).toEqual(['github', 'jira']);

    const gh = await store.getCredential('github');
    expect(gh!.data.password).toBe('pw1');
    const jira = await store.getCredential('jira');
    expect(jira!.data.password).toBe('pw2');
  });

  it('should persist across store instances', async () => {
    await store.addCredential('persist-test', 'api_key', { apiKey: 'key123' });

    const store2 = new EncryptedStore(dataDir);
    await store2.init();

    const cred = await store2.getCredential('persist-test');
    expect(cred!.data.apiKey).toBe('key123');
  });
});
