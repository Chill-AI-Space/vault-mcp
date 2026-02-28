import { createHash } from 'node:crypto';
import { readFile, appendFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AuditEntry {
  eventId: string;
  timestamp: string;
  action: string;
  credentialId: string;
  botId?: string;
  result: 'success' | 'failure';
  details?: string;
  prevHash: string;
  hash: string;
}

function computeHash(prevHash: string, entry: Omit<AuditEntry, 'hash'>): string {
  const data = prevHash + JSON.stringify(entry);
  return createHash('sha256').update(data).digest('hex');
}

function formatEventId(n: number): string {
  return `evt_${String(n).padStart(3, '0')}`;
}

export class AuditLogger {
  private auditFile: string;
  private vaultDir: string;

  constructor(dataDir?: string) {
    this.vaultDir = dataDir || join(homedir(), '.vault-mcp');
    this.auditFile = join(this.vaultDir, 'audit.jsonl');
  }

  async init(): Promise<void> {
    await mkdir(this.vaultDir, { recursive: true });
    try {
      await readFile(this.auditFile);
    } catch {
      await writeFile(this.auditFile, '', { mode: 0o600 });
    }
  }

  async log(
    action: string,
    credentialId: string,
    result: 'success' | 'failure',
    botId?: string,
    details?: string,
  ): Promise<AuditEntry> {
    const entries = await this.getEntries();
    const prevHash = entries.length > 0 ? entries[entries.length - 1].hash : 'genesis';
    const eventId = formatEventId(entries.length + 1);

    const partial: Omit<AuditEntry, 'hash'> = {
      eventId,
      timestamp: new Date().toISOString(),
      action,
      credentialId,
      result,
      prevHash,
    };
    if (botId !== undefined) partial.botId = botId;
    if (details !== undefined) partial.details = details;

    const hash = computeHash(prevHash, partial);
    const entry: AuditEntry = { ...partial, hash };

    await appendFile(this.auditFile, JSON.stringify(entry) + '\n');
    return entry;
  }

  async getEntries(siteId?: string): Promise<AuditEntry[]> {
    let content: string;
    try {
      content = await readFile(this.auditFile, 'utf-8');
    } catch {
      return [];
    }

    const lines = content.trim().split('\n').filter(Boolean);
    const entries: AuditEntry[] = lines.map((line) => JSON.parse(line));

    if (siteId) {
      return entries.filter((e) => e.credentialId === siteId);
    }
    return entries;
  }

  async verifyChain(): Promise<{ valid: boolean; brokenAt?: number; totalEntries: number }> {
    const entries = await this.getEntries();
    if (entries.length === 0) {
      return { valid: true, totalEntries: 0 };
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const expectedPrevHash = i === 0 ? 'genesis' : entries[i - 1].hash;

      if (entry.prevHash !== expectedPrevHash) {
        return { valid: false, brokenAt: i, totalEntries: entries.length };
      }

      const { hash: _hash, ...rest } = entry;
      const expectedHash = computeHash(entry.prevHash, rest);
      if (entry.hash !== expectedHash) {
        return { valid: false, brokenAt: i, totalEntries: entries.length };
      }
    }

    return { valid: true, totalEntries: entries.length };
  }

  async getLastHash(): Promise<string> {
    const entries = await this.getEntries();
    if (entries.length === 0) return 'genesis';
    return entries[entries.length - 1].hash;
  }
}
