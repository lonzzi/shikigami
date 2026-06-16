import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { decrypt, encrypt } from '../lib/crypto';
import { prisma } from '../lib/prisma';

/**
 * 设置路由。Settings 表 KV 存储; 敏感字段 enc: 加密。
 * GET 脱敏返回; PUT 加密写入。
 */
const updateSchema = z.record(z.string(), z.string());

export const settings = new Hono()
  .get('/', async (c) => {
    const rows = await prisma.settings.findMany();
    const out: Record<string, string> = {};
    for (const r of rows) {
      if (r.encrypted) {
        try {
          out[r.key] = decrypt(r.value);
        } catch {
          out[r.key] = '***';
        }
        // 脱敏: 含 key/secret/token/password 的值不回显明文
        if (/key|secret|token|password/i.test(r.key)) out[r.key] = '***';
      } else {
        out[r.key] = r.value;
      }
    }
    return c.json(out);
  })
  .put('/', zValidator('json', updateSchema), async (c) => {
    const input = c.req.valid('json');
    for (const [key, value] of Object.entries(input)) {
      const isSensitive = /key|secret|token|password/i.test(key);
      await prisma.settings.upsert({
        where: { key },
        create: {
          key,
          category: guessCategory(key),
          value: isSensitive ? encrypt(value) : value,
          encrypted: isSensitive,
        },
        update: {
          value: isSensitive ? encrypt(value) : value,
          encrypted: isSensitive,
        },
      });
    }
    return c.json({ ok: true, updated: Object.keys(input) });
  });

function guessCategory(key: string): string {
  const k = key.toLowerCase();
  if (k.includes('llm') || k.includes('ai')) return 'ai';
  if (k.includes('qbt') || k.includes('qbit')) return 'qbittorrent';
  if (k.includes('jellyfin') || k.includes('emby') || k.includes('media')) return 'media';
  if (k.includes('bangumi') || k.includes('tmdb')) return 'metadata';
  if (k.includes('telegram') || k.includes('wechat') || k.includes('notify')) return 'notify';
  return 'general';
}
