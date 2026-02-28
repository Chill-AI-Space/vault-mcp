import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getMasterKey, getVaultDir } from './keychain.js';

const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// --- Types ---

export interface CredentialMetadata {
  id: string;
  siteId: string;
  serviceType: 'web_login' | 'api_key';
  loginUrl?: string;
  selectors?: { email: string; password: string; submit: string };
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredCredential extends CredentialMetadata {
  encryptedData: string; // base64(iv + ciphertext + authTag)
}

export interface PlainCredentialData {
  email?: string;
  password?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

// --- Encryption helpers ---

async function encrypt(data: PlainCredentialData, dataDir?: string): Promise<string> {
  const key = await getMasterKey(dataDir);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]).toString('base64');
}

async function decrypt(encoded: string, dataDir?: string): Promise<PlainCredentialData> {
  const key = await getMasterKey(dataDir);
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

// --- Store ---

export class EncryptedStore {
  private credentials: StoredCredential[] = [];
  private credentialsFile: string;
  private dataDir?: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir;
    const vaultDir = getVaultDir(dataDir);
    this.credentialsFile = join(vaultDir, 'credentials.json');
  }

  async init(): Promise<void> {
    const vaultDir = getVaultDir(this.dataDir);
    await mkdir(vaultDir, { recursive: true });
    try {
      const raw = await readFile(this.credentialsFile, 'utf8');
      this.credentials = JSON.parse(raw);
    } catch {
      this.credentials = [];
      await this.save();
    }
  }

  async addCredential(
    siteId: string,
    serviceType: 'web_login' | 'api_key',
    plainData: PlainCredentialData,
    loginUrl?: string,
    selectors?: { email: string; password: string; submit: string },
  ): Promise<CredentialMetadata> {
    const now = new Date().toISOString();
    const stored: StoredCredential = {
      id: randomUUID(),
      siteId,
      serviceType,
      loginUrl,
      selectors,
      active: true,
      createdAt: now,
      updatedAt: now,
      encryptedData: await encrypt(plainData, this.dataDir),
    };
    this.credentials.push(stored);
    await this.save();
    return toMetadata(stored);
  }

  async getCredential(siteId: string): Promise<{ metadata: CredentialMetadata; data: PlainCredentialData } | null> {
    const stored = this.credentials.find((c) => c.siteId === siteId);
    if (!stored) return null;
    return {
      metadata: toMetadata(stored),
      data: await decrypt(stored.encryptedData, this.dataDir),
    };
  }

  listCredentials(): CredentialMetadata[] {
    return this.credentials.map(toMetadata);
  }

  async removeCredential(siteId: string): Promise<boolean> {
    const idx = this.credentials.findIndex((c) => c.siteId === siteId);
    if (idx === -1) return false;
    this.credentials.splice(idx, 1);
    await this.save();
    return true;
  }

  async toggleActive(siteId: string, active: boolean): Promise<boolean> {
    const stored = this.credentials.find((c) => c.siteId === siteId);
    if (!stored) return false;
    stored.active = active;
    stored.updatedAt = new Date().toISOString();
    await this.save();
    return true;
  }

  private async save(): Promise<void> {
    await writeFile(this.credentialsFile, JSON.stringify(this.credentials, null, 2), 'utf8');
  }
}

function toMetadata(stored: StoredCredential): CredentialMetadata {
  const { encryptedData: _, ...metadata } = stored;
  return metadata;
}
