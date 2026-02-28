import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EncryptedStore } from '../src/store/encrypted-store.js';
import { AuditLogger } from '../src/audit/logger.js';
import { clearKeyCache } from '../src/store/keychain.js';
import { vaultList } from '../src/tools/vault-list.js';
import { vaultStatus } from '../src/tools/vault-status.js';
import { vaultLogin } from '../src/tools/vault-login.js';
import { vaultApiRequest } from '../src/tools/vault-api.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Tool Response Sanitization', () => {
  let store: EncryptedStore;
  let audit: AuditLogger;
  let dataDir: string;

  const TEST_PASSWORD = 'SuperSecretP@ss!2026';
  const TEST_EMAIL = 'secret-user@company.com';
  const TEST_API_KEY = 'sk-abc123def456ghi789';

  beforeEach(async () => {
    dataDir = join(await mkdtemp(join(tmpdir(), 'vault-tools-test-')), '.vault-mcp');
    process.env.VAULT_MASTER_KEY = 'test-key';
    clearKeyCache();
    store = new EncryptedStore(dataDir);
    audit = new AuditLogger(dataDir);
    await store.init();
    await audit.init();

    await store.addCredential('test-web', 'web_login',
      { email: TEST_EMAIL, password: TEST_PASSWORD },
      'https://example.com/login',
      { email: '#email', password: '#password', submit: '#submit' },
    );
    await store.addCredential('test-api', 'api_key',
      { apiKey: TEST_API_KEY, headers: { Authorization: `Bearer ${TEST_API_KEY}` } },
    );
    await store.addCredential('inactive-site', 'web_login',
      { email: 'a', password: 'b' },
    );
    await store.toggleActive('inactive-site', false);
  });

  afterEach(async () => {
    delete process.env.VAULT_MASTER_KEY;
    clearKeyCache();
    await rm(dataDir, { recursive: true, force: true });
  });

  describe('vault_list', () => {
    it('should return ONLY metadata, no secrets', async () => {
      const result = await vaultList(store);
      const json = JSON.stringify(result);

      expect(json).not.toContain(TEST_PASSWORD);
      expect(json).not.toContain(TEST_EMAIL);
      expect(json).not.toContain(TEST_API_KEY);
      expect(json).not.toContain('encryptedData');

      expect(result.credentials).toHaveLength(3);
      expect(result.credentials[0].siteId).toBe('test-web');
      expect(result.credentials[0].serviceType).toBe('web_login');
      expect(result.credentials[0].active).toBe(true);
    });
  });

  describe('vault_status', () => {
    it('should return ONLY metadata, no secrets', async () => {
      const result = await vaultStatus(store, audit, 'test-web');
      const json = JSON.stringify(result);

      expect(json).not.toContain(TEST_PASSWORD);
      expect(json).not.toContain(TEST_EMAIL);
      expect(json).not.toContain(TEST_API_KEY);

      expect(result.siteId).toBe('test-web');
      expect(result.active).toBe(true);
    });

    it('should handle nonexistent credential', async () => {
      const result = await vaultStatus(store, audit, 'nonexistent');
      expect(result.error).toBeDefined();
    });
  });

  describe('vault_login', () => {
    it('should NOT contain password in response (no Chrome)', async () => {
      const result = await vaultLogin(store, audit, 'test-web');
      const json = JSON.stringify(result);

      expect(json).not.toContain(TEST_PASSWORD);
      expect(json).not.toContain(TEST_EMAIL);
      expect(result.status).toBe('failure');
    });

    it('should reject inactive credentials', async () => {
      const result = await vaultLogin(store, audit, 'inactive-site');
      expect(result.status).toBe('failure');
      expect(result.message).toContain('inactive');
    });

    it('should reject wrong service type', async () => {
      const result = await vaultLogin(store, audit, 'test-api');
      expect(result.status).toBe('failure');
      expect(result.message).toContain('not a web_login');
    });

    it('should handle missing credential', async () => {
      const result = await vaultLogin(store, audit, 'nonexistent');
      expect(result.status).toBe('failure');
      expect(result.message).toContain('not found');
    });
  });

  describe('vault_api_request', () => {
    it('should reject wrong service type', async () => {
      const result = await vaultApiRequest(store, audit, 'test-web', 'https://api.example.com', 'GET');
      expect(result.status).toBe('failure');
      expect(result.message).toContain('not an api_key');
      const json = JSON.stringify(result);
      expect(json).not.toContain(TEST_PASSWORD);
    });

    it('should reject inactive credentials', async () => {
      await store.toggleActive('test-api', false);
      const result = await vaultApiRequest(store, audit, 'test-api', 'https://api.example.com', 'GET');
      expect(result.status).toBe('failure');
      expect(result.message).toContain('inactive');
    });

    it('should handle missing credential', async () => {
      const result = await vaultApiRequest(store, audit, 'nonexistent', 'https://api.example.com', 'GET');
      expect(result.status).toBe('failure');
      const json = JSON.stringify(result);
      expect(json).not.toContain(TEST_API_KEY);
    });
  });

  describe('error messages should never leak secrets', () => {
    it('vault_login error should not contain password', async () => {
      const result = await vaultLogin(store, audit, 'test-web');
      const json = JSON.stringify(result);
      expect(json).not.toContain(TEST_PASSWORD);
    });

    it('vault_status error should not contain credentials', async () => {
      const result = await vaultStatus(store, audit, 'test-web');
      const json = JSON.stringify(result);
      expect(json).not.toContain(TEST_PASSWORD);
      expect(json).not.toContain(TEST_EMAIL);
    });
  });
});
