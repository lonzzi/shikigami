import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { deriveEncryptionKey } from './env';

const ALGO = 'aes-256-gcm';

/**
 * Settings 敏感字段加密。
 * 架构评审 C/I: 主密钥从独立 ENCRYPTION_KEY 派生 (不复用 JWT_SECRET)。
 * 存储格式: enc:<iv>:<authTag>:<ciphertext> (全 hex)
 */
export function encrypt(plain: string): string {
  const key = deriveEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decrypt(payload: string): string {
  if (!payload.startsWith('enc:')) return payload;
  const [, ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('invalid encrypted payload');
  const key = deriveEncryptionKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}
