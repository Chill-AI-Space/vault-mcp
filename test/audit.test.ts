import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditLogger } from '../src/audit/logger.js';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('AuditLogger', () => {
  let audit: AuditLogger;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = join(await mkdtemp(join(tmpdir(), 'vault-audit-test-')), '.vault-mcp');
    audit = new AuditLogger(dataDir);
    await audit.init();
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('should create valid JSONL entries', async () => {
    const entry = await audit.log('credential.created', 'github', 'success');
    expect(entry.eventId).toBe('evt_001');
    expect(entry.action).toBe('credential.created');
    expect(entry.credentialId).toBe('github');
    expect(entry.result).toBe('success');
    expect(entry.prevHash).toBe('genesis');
    expect(entry.hash).toBeTruthy();
  });

  it('should build hash chain correctly', async () => {
    const e1 = await audit.log('credential.created', 'github', 'success');
    const e2 = await audit.log('credential.used', 'github', 'success', 'claude');
    const e3 = await audit.log('credential.removed', 'github', 'success');

    expect(e1.prevHash).toBe('genesis');
    expect(e2.prevHash).toBe(e1.hash);
    expect(e3.prevHash).toBe(e2.hash);
  });

  it('should verify valid chain', async () => {
    await audit.log('credential.created', 'site1', 'success');
    await audit.log('credential.used', 'site1', 'success');
    await audit.log('credential.used', 'site1', 'failure');

    const result = await audit.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(3);
  });

  it('should detect tampered entries', async () => {
    await audit.log('credential.created', 'site1', 'success');
    await audit.log('credential.used', 'site1', 'success');
    await audit.log('credential.removed', 'site1', 'success');

    // Tamper with the audit file
    const auditFile = join(dataDir, 'audit.jsonl');
    const content = await readFile(auditFile, 'utf-8');
    const lines = content.trim().split('\n');
    const entry = JSON.parse(lines[1]);
    entry.result = 'failure'; // tamper
    lines[1] = JSON.stringify(entry);
    await writeFile(auditFile, lines.join('\n') + '\n');

    const result = await audit.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it('should filter entries by siteId', async () => {
    await audit.log('credential.created', 'github', 'success');
    await audit.log('credential.created', 'jira', 'success');
    await audit.log('credential.used', 'github', 'success');

    const githubEntries = await audit.getEntries('github');
    expect(githubEntries).toHaveLength(2);

    const jiraEntries = await audit.getEntries('jira');
    expect(jiraEntries).toHaveLength(1);

    const allEntries = await audit.getEntries();
    expect(allEntries).toHaveLength(3);
  });

  it('should return genesis as last hash for empty log', async () => {
    const hash = await audit.getLastHash();
    expect(hash).toBe('genesis');
  });

  it('should auto-increment event IDs', async () => {
    const e1 = await audit.log('credential.created', 'a', 'success');
    const e2 = await audit.log('credential.created', 'b', 'success');
    const e3 = await audit.log('credential.created', 'c', 'success');

    expect(e1.eventId).toBe('evt_001');
    expect(e2.eventId).toBe('evt_002');
    expect(e3.eventId).toBe('evt_003');
  });
});
