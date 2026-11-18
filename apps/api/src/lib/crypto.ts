import crypto from 'crypto';

/**
 * AES-256-GCM encryption for secrets stored at rest (social OAuth tokens).
 * Key: ENCRYPTION_KEY (64 hex chars) or, failing that, a SHA-256 of JWT_SECRET.
 * Format: "v1:<iv b64>:<tag b64>:<ciphertext b64>". Never send these values to the client.
 */
function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY || '';
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  const seed = hex || process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production';
  return crypto.createHash('sha256').update(`klipforge-token-key:${seed}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (stored.startsWith('v1:')) {
    const [, iv, tag, ct] = stored.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
  }
  // Legacy rows (base64 "enc:<raw>") from before real encryption.
  try {
    const raw = Buffer.from(stored, 'base64').toString('utf8');
    return raw.startsWith('enc:') ? raw.slice(4) : null;
  } catch {
    return null;
  }
}
