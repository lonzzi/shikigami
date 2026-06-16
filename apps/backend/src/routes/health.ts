import { Hono } from 'hono';
import { getStatus } from '../downloader/qbittorrent';
import { prisma } from '../lib/prisma';
import { llm } from '../llm/client';

/**
 * 健康检查路由（架构 I7）。
 * - GET /health: liveness（进程在）
 * - GET /health?ready=1: readiness（DB 连通 + qB 连通 + LLM 可达）
 */
export const health = new Hono().get('/', async (c) => {
  const ready = c.req.query('ready') === '1';
  if (!ready) return c.json({ status: 'alive' });

  const checks: Record<string, boolean> = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch {
    checks.db = false;
  }
  try {
    const qb = await getStatus();
    checks.qbittorrent = qb.connected;
  } catch {
    checks.qbittorrent = false;
  }
  try {
    await llm.models.list();
    checks.llm = true;
  } catch {
    checks.llm = false;
  }
  const allOk = Object.values(checks).every(Boolean);
  return c.json({ ready: allOk, checks }, allOk ? 200 : 503);
});
