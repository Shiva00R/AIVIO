import crypto from 'node:crypto';

let ephemeralFallbackKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  const configured = process.env.PROVIDER_ENCRYPTION_KEY?.trim();
  if (configured && configured.length > 0) {
    return crypto.createHash('sha256').update(configured).digest();
  }
  if (!ephemeralFallbackKey) {
    ephemeralFallbackKey = crypto.randomBytes(32);
  }
  return ephemeralFallbackKey;
}

export interface EncryptedSecret {
  encryptedKey: string;
  iv: string;
  authTag: string;
  keyHint: string;
}

export function maskApiKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length <= 8) {
    return '••••' + trimmed.slice(-2);
  }
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••${suffix}`;
}

export function encryptApiKey(plaintextKey: string): EncryptedSecret {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintextKey.trim(), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedKey: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyHint: maskApiKey(plaintextKey),
  };
}

export function decryptApiKey(payload: {
  encryptedKey: string;
  iv: string;
  authTag: string;
}): string | null {
  if (!payload.encryptedKey || !payload.iv || !payload.authTag) {
    return null;
  }
  try {
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(payload.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.encryptedKey, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}
