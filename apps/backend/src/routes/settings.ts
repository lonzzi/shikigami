import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { decrypt, encrypt } from '../lib/crypto';
import { env } from '../lib/env';
import { prisma } from '../lib/prisma';

/**
 * 设置路由。
 * GET: 优先从 Settings 表读, fallback 到 .env 当前值(让用户看到实际生效的配置)。
 * PUT: 写 Settings 表(覆盖 .env)。敏感字段加密。
 */

/** 设置页暴露的字段(只展示这些, 敏感的脱敏)。 */
const DISPLAY_FIELDS: { key: string; sensitive: boolean }[] = [
  { key: 'LLM_BASE_URL', sensitive: false },
  { key: 'LLM_API_KEY', sensitive: true },
  { key: 'LLM_MODEL', sensitive: false },
  { key: 'QBT_BASE_URL', sensitive: false },
  { key: 'QBT_USERNAME', sensitive: false },
  { key: 'QBT_PASSWORD', sensitive: true },
  { key: 'TMDB_API_KEY', sensitive: true },
];

const updateSchema = z.record(z.string(), z.string());

export const settings = new Hono()
  .get('/', async (c) => {
    const rows = await prisma.settings.findMany();
    const dbMap = new Map(rows.map((r) => [r.key, r]));
    const out: Record<string, string> = {};

    for (const f of DISPLAY_FIELDS) {
      const dbRow = dbMap.get(f.key);
      if (dbRow) {
        // DB 有值(Settings 表覆盖 .env)
        if (dbRow.encrypted) {
          try {
            const v = decrypt(dbRow.value);
            out[f.key] = f.sensitive ? '***' : v;
          } catch {
            out[f.key] = '***';
          }
        } else {
          out[f.key] = dbRow.value;
        }
      } else {
        // fallback: 读 .env 当前值
        const envVal = (env as unknown as Record<string, string>)[f.key];
        if (envVal) {
          out[f.key] = f.sensitive ? '***' : envVal;
        }
      }
    }
    return c.json(out);
  })
  .put('/', zValidator('json', updateSchema), async (c) => {
    const input = c.req.valid('json');
    for (const [key, value] of Object.entries(input)) {
      if (!value || value === '***') continue; // 空或脱敏占位跳过
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
    return c.json({
      ok: true,
      updated: Object.keys(input).filter((k) => input[k] && input[k] !== '***'),
    });
  });

function guessCategory(key: string): string {
  const k = key.toLowerCase();
  if (k.includes('llm') || k.includes('ai')) return 'ai';
  if (k.includes('qbt') || k.includes('qbit')) return 'qbittorrent';
  if (k.includes('tmdb')) return 'metadata';
  return 'general';
}
