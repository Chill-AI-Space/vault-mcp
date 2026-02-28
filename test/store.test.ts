import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EncryptedStore } from '../src/store/encrypted-store.js';
import { clearKeyCache } from '../src/store/keychain.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('EncryptedStore', () => {
  let store: EncryptedStore;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = join(await mkdtemp(join(tmpdir(), 'vault-test-')), '.vault-mcp');
    process.env.VAULT_MASTER_KEY = 'test-master-key-123';
    clearKeyCache();
    store = new EncryptedStore(dataDir);
    await store.init();
  });

  afterEach(async () => {
    delete process.env.VAULT_MASTER_KEY;
    clearKeyCache();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('should encrypt and decrypt round-trip', async () => {
    const plainData = { email: 'test@example.com', password: 'secret123!' };
    await store.addCredential('github', 'web_login', plainData, 'https://github.com/login', {
      email: '#login_field', password: '#password', submit: 'input[type="submit"]',
    });

    const result = await store.getCredential('github');
    expect(result).not.toBeNull();
    expect(result!.data.email).toBe('test@example.com');
    expect(result!.data.password).toBe('secret123!');
  });

  it('should fail decryption with wrong key', async () => {
    const plainData = { email: 'test@example.com', password: 'secret123!' };
    await store.addCredential('github', 'web_login', plainData);

    // Change master key and clear cache
    process.env.VAULT_MASTER_KEY = 'wrong-key-456';
    clearKeyCache();
    const store2 = new EncryptedStore(dataDir);
    await store2.init();

    await expect(store2.getCredential('github')).rejects.toThrow();
  });

  it('should use unique IV for each credential', async () => {
    await store.addCredential('site1', 'api_key', { apiKey: 'key1' });
    await store.addCredential('site2', 'api_key', { apiKey: 'key1' }); // same data

    // Both decrypt correctly
    const cred1 = await store.getCredential('site1');
    const cred2 = await store.getCredential('site2');
    expect(cred1!.data.apiKey).toBe('key1');
    expect(cred2!.data.apiKey).toBe('key1');
  });

  it('listCredentials should NOT contain secrets', async () => {
    await store.addCredential('github', 'web_login', {
      email: 'secret@email.com', password: 'super-secret-pass',
    });

    const list = store.listCredentials();
    expect(list.length).toBe(1);

    const json = JSON.stringify(list);
    expect(json).not.toContain('secret@email.com');
    expect(json).not.toContain('super-secret-pass');
    expect(json).not.toContain('encryptedData');
  });

  it('should add, list, and remove credentials', async () => {
    await store.addCredential('site1', 'web_login', { email: 'a', password: 'b' });
    await store.addCredential('site2', 'api_key', { apiKey: 'k' });

    expect(store.listCredentials()).toHaveLength(2);

    const removed = await store.removeCredential('site1');
    expect(removed).toBe(true);
    expect(store.listCredentials()).toHaveLength(1);
    expect(store.listCredentials()[0].siteId).toBe('site2');

    const notFound = await store.removeCredential('nonexistent');
    expect(notFound).toBe(false);
  });

  it('should toggle active status', async () => {
    await store.addCredential('test', 'web_login', { email: 'a', password: 'b' });
    expect(store.listCredentials()[0].active).toBe(true);

    await store.toggleActive('test', false);
    expect(store.listCredentials()[0].active).toBe(false);

    await store.toggleActive('test', true);
    expect(store.listCredentials()[0].active).toBe(true);
  });

  it('getCredential should return null for nonexistent', async () => {
    const result = await store.getCredential('nonexistent');
    expect(result).toBeNull();
  });
});
