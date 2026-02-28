import { scryptSync, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SCRYPT_SALT = Buffer.from('vault-mcp-salt');
const KEY_LENGTH = 32;

let cachedKey: Buffer | null = null;
let cachedKeySource: string | null = null; // track what produced the cached key

export function getVaultDir(dataDir?: string): string {
  return dataDir || join(homedir(), '.vault-mcp');
}

export function clearKeyCache(): void {
  cachedKey = null;
  cachedKeySource = null;
}

export async function getMasterKey(dataDir?: string): Promise<Buffer> {
  const envKey = process.env.VAULT_MASTER_KEY;
  const source = envKey || dataDir || 'default';

  // Return cache only if same source
  if (cachedKey && cachedKeySource === source) return cachedKey;

  // 1. Check env var
  if (envKey) {
    cachedKey = scryptSync(envKey, SCRYPT_SALT, KEY_LENGTH);
    cachedKeySource = source;
    return cachedKey;
  }

  const vaultDir = getVaultDir(dataDir);
  const masterKeyFile = join(vaultDir, '.master-key');

  // 2. Check key file
  try {
    const fileContent = await readFile(masterKeyFile);
    if (fileContent.length === KEY_LENGTH) {
      cachedKey = fileContent as Buffer;
      cachedKeySource = source;
      return cachedKey;
    }
  } catch {
    // File doesn't exist — continue to generation
  }

  // 3. Generate new key
  await mkdir(vaultDir, { recursive: true });
  const newKey = randomBytes(KEY_LENGTH);
  await writeFile(masterKeyFile, newKey, { mode: 0o600 });
  console.error('[vault-mcp] Generated new master key at ~/.vault-mcp/.master-key — back it up!');

  cachedKey = newKey;
  cachedKeySource = source;
  return cachedKey;
}
