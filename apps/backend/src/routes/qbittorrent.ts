import { Hono } from 'hono';
import { getStatus, qb } from '../downloader/qbittorrent';

/**
 * qBittorrent 路由。
 */
export const qbittorrent = new Hono()
  .get('/status', async (c) => c.json(await getStatus()))
  .post('/connect', async (c) => {
    const s = await getStatus();
    return c.json({ connected: s.connected, appVersion: s.appVersion });
  })
  .get('/torrents', async (c) => {
    const list = await qb.getAllTorrents();
    return c.json(list);
  });
