import { logger } from '../logger';
import { env } from './env';

/**
 * qBittorrent v5 直接 API（绕过 @ctrl/qbittorrent 的 cookie 鉴权问题）。
 *
 * 背景: @ctrl/qbittorrent 在 qB v5.0.3 上 login 成功但拿不到 cookie（库 bug）,
 * 导致 addMagnet 等 multipart 请求 403。这里用 SID cookie 直接 fetch。
 *
 * 同时修正: qB 对 base32 btih 返回 "Fails." 但实际可能成功——add 后回查确认。
 */

let _sid: string | null = null;
let _sidAt = 0;
const SID_TTL = 30 * 60 * 1000; // SID 30 分钟复用

/** 登录获取 SID cookie（缓存复用）。 */
async function getSid(): Promise<string> {
  const now = Date.now();
  if (_sid && now - _sidAt < SID_TTL) return _sid;
  const res = await fetch(`${env.QBT_BASE_URL}/api/v2/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      Referer: env.QBT_BASE_URL,
    },
    body: `username=${encodeURIComponent(env.QBT_USERNAME)}&password=${encodeURIComponent(env.QBT_PASSWORD)}`,
  });
  if (!res.ok) throw new Error(`qB login HTTP ${res.status}`);
  const sc = res.headers.get('set-cookie') ?? '';
  const sid = sc.match(/SID=([^;]+)/)?.[1];
  if (!sid) throw new Error('qB login: no SID cookie');
  _sid = sid;
  _sidAt = now;
  return sid;
}

async function qbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const sid = await getSid();
  const res = await fetch(`${env.QBT_BASE_URL}${path}`, {
    ...init,
    headers: {
      cookie: `SID=${sid}`,
      Referer: env.QBT_BASE_URL,
      ...(init.headers ?? {}),
    },
  });
  // SID 失效 → 清掉重登一次
  if (res.status === 403) {
    _sid = null;
    return qbFetch(path, init);
  }
  return res;
}

export interface AddOptions {
  savePath?: string;
  category?: string;
  tags?: string;
}

/**
 * 添加 magnet 到 qBittorrent。
 * 返回 true=成功添加/已存在, false=确认失败。
 *
 * 注意: qB 对某些 magnet 返回 "Fails." 但实际已入列, 故 add 后按 infoHash 回查确认。
 */
export async function addMagnetDirect(magnet: string, opts: AddOptions = {}): Promise<boolean> {
  const form = new FormData();
  form.append('urls', magnet);
  if (opts.savePath) form.append('savepath', opts.savePath);
  if (opts.category) form.append('category', opts.category);
  if (opts.tags) form.append('tags', opts.tags);

  try {
    const res = await qbFetch('/api/v2/torrents/add', { method: 'POST', body: form });
    const text = await res.text();
    if (text === 'Fails.') {
      logger.debug(
        { magnet: magnet.slice(0, 60) },
        'qB add returned Fails., will verify by lookup',
      );
      // qB 误报, 调用方按 infoHash 回查确认
    }
    return true; // 让调用方回查
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'qB addMagnet failed');
    return false;
  }
}

/** 按 infoHash 查种子是否存在。 */
export async function torrentExists(infoHash: string): Promise<boolean> {
  try {
    const res = await qbFetch(`/api/v2/torrents/info?hashes=${infoHash.toLowerCase()}`);
    if (!res.ok) return false;
    const arr = (await res.json()) as unknown[];
    return arr.length > 0;
  } catch {
    return false;
  }
}

/** 删除种子。 */
export async function removeTorrentDirect(hash: string, deleteFiles: boolean): Promise<boolean> {
  try {
    const res = await qbFetch(`/api/v2/torrents/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `hashes=${hash.toLowerCase()}&deleteFiles=${deleteFiles ? 'true' : 'false'}`,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface QbTorrentLive {
  hash: string;
  name: string | null;
  state: string | null;
  progress: number;
  dlspeed: number;
  upspeed: number;
  numSeeds: number;
  numLeechs: number;
  size: bigint | null;
  savePath: string | null;
}

/** 列出 qB 所有种子（实时, 不经 DB）。供下载任务页直接反映 qB。 */
export async function listTorrentsDirect(filter?: string): Promise<QbTorrentLive[]> {
  try {
    const q = filter ? `?filter=${filter}` : '';
    const res = await qbFetch(`/api/v2/torrents/info${q}`);
    if (!res.ok) return [];
    const arr = (await res.json()) as Array<Record<string, unknown>>;
    return arr.map((t) => ({
      hash: String(t['hash'] ?? ''),
      name: (t['name'] as string) ?? null,
      state: (t['state'] as string) ?? null,
      progress: Number(t['progress'] ?? 0),
      dlspeed: Number(t['dlspeed'] ?? 0),
      upspeed: Number(t['upspeed'] ?? 0),
      numSeeds: Number(t['num_seeds'] ?? 0),
      numLeechs: Number(t['num_leechs'] ?? 0),
      size: t['size'] != null ? BigInt(Number(t['size'])) : null,
      savePath: (t['save_path'] as string) ?? null,
    }));
  } catch {
    return [];
  }
}

/** 实时查询单个种子（直查 qB, 不经 DB 缓存, 供 SSE/详情用）。 */
export async function getTorrentDirect(hash: string): Promise<QbTorrentLive | null> {
  try {
    const res = await qbFetch(`/api/v2/torrents/info?hashes=${hash.toLowerCase()}`);
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<Record<string, unknown>>;
    const t = arr[0];
    if (!t) return null;
    return {
      hash: String(t['hash'] ?? ''),
      name: (t['name'] as string) ?? null,
      state: (t['state'] as string) ?? null,
      progress: Number(t['progress'] ?? 0),
      dlspeed: Number(t['dlspeed'] ?? 0),
      upspeed: Number(t['upspeed'] ?? 0),
      numSeeds: Number(t['num_seeds'] ?? 0),
      numLeechs: Number(t['num_leechs'] ?? 0),
      size: t['size'] != null ? BigInt(Number(t['size'])) : null,
      savePath: (t['save_path'] as string) ?? null,
    };
  } catch {
    return null;
  }
}
