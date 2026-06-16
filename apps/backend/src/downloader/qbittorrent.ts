/**
 * qBittorrent 集成（架构第 5 章：下载层）。
 *
 * 职责：
 *  - 封装 {@link QBittorrent} 客户端为惰性单例，连接失败只 warn 不崩进程
 *    （调度层 cron 会兜底 try/catch 并按 QB_POLL_INTERVAL 轮询重试）。
 *  - 暴露高层语义方法，供 RSS 同步链路 / qb-poll 调度 / API 路由复用：
 *      · {@link addMagnet}        addMagnet 响应三态解析（Ok. / Already added. / Fails.）
 *      · {@link getAllTorrents}   不带 filter 的全量 list（含 error/stalledDL）
 *      · {@link removeTorrent}    仅 removeTorrent(hash, false) 保留数据
 *      · {@link pauseTorrent} / {@link resumeTorrent}
 *      · {@link getStatus}        连接状态 / 版本 / 磁盘剩余（/api/qb/status）
 *
 * 关键边界（架构 2.3）：
 *  - 完成检测无 webhook，必须轮询；轮询全 state。
 *  - 做种不打断：绝不 removeTorrent(hash, true)。
 *  - addMagnet 已存在视为幂等成功（不报错不重试）。
 */

import type { Torrent } from '@ctrl/qbittorrent';
import { QBittorrent } from '@ctrl/qbittorrent';

import { env } from '../lib/env';
import { RetryableError } from '../lib/errors';
import { addMagnetDirect, torrentExists } from '../lib/qb-direct';
import { logger } from '../logger';
import { parseInfoHash } from '../scrapers/types';

/** addMagnet 的高层选项。 */
export interface AddMagnetOptions {
  /** qB 分类（默认取 env.QBT_CATEGORY_DEFAULT）。 */
  category?: string;
  /** 保存路径（root，对应 WebAPI savepath）。 */
  savePath?: string;
  /** 标签列表，逗号拼接后下发。 */
  tags?: string[];
}

/** addMagnet 三态结果（架构评审 I12）。 */
export type AddMagnetResult = 'added' | 'already_added' | 'failed';

/** /api/qb/status 返回的聚合状态。 */
export interface QbStatus {
  /** 是否成功连通 qBittorrent（getAppVersion 成功即视为在线）。 */
  connected: boolean;
  /** qBittorrent 应用版本号；离线时为 null。 */
  appVersion: string | null;
  /** WebAPI 版本号；离线时为 null。 */
  apiVersion: string | null;
  /** server_state.free_space（来自 /sync/maindata），单位字节；不可用时为 null。 */
  freeSpaceBytes: bigint | null;
  /** 当前种子总数；离线时为 null。 */
  torrentsCount: number | null;
}

/** QBittorrent 连接/调用失败的统一可重试错误。 */
class QbUnavailableError extends RetryableError {}

// ----------------------------------------------------------------------------
// 惰性单例：构造期不连接，首次请求才鉴权；连接异常 warn 后抛 RetryableError。
// ----------------------------------------------------------------------------

let _client: QBittorrent | null = null;
/** 标记最近一次连接探活结果，避免getStatus 在断网时反复打满日志。 */
let _lastConnectOk = true;

/** 构造并缓存底层 QBittorrent 客户端实例（惰性）。 */
function client(): QBittorrent {
  if (_client) return _client;
  _client = new QBittorrent({
    baseUrl: env.QBT_BASE_URL,
    username: env.QBT_USERNAME,
    password: env.QBT_PASSWORD,
    apiKey: env.QBT_API_KEY || undefined,
  });
  logger.debug({ baseUrl: env.QBT_BASE_URL }, 'qbittorrent client created (lazy)');
  return _client;
}

/**
 * 统一包装 qB 调用：捕获连接类异常 → logger.warn + 抛 {@link QbUnavailableError}，
 * 让调度层（cron 顶层 try/catch / better-queue 重试）接管，进程不崩。
 */
async function withQb<T>(label: string, fn: (c: QBittorrent) => Promise<T>): Promise<T> {
  try {
    const r = await fn(client());
    if (!_lastConnectOk) {
      _lastConnectOk = true;
      logger.info({ label }, 'qbittorrent connection recovered');
    }
    return r;
  } catch (e) {
    _lastConnectOk = false;
    logger.warn({ label, err: e }, 'qbittorrent call failed (will retry on next poll)');
    throw new QbUnavailableError(`qbittorrent ${label} failed: ${(e as Error).message}`, e);
  }
}

// ----------------------------------------------------------------------------
// 高层 API
// ----------------------------------------------------------------------------

/**
 * 全量拉取种子列表（架构评审 C3：不带 filter，含 error/stalledDL）。
 * 供 qb-poll 做 state 分类。
 */
export async function getAllTorrents(): Promise<Torrent[]> {
  return withQb('getAllTorrents', (c) => c.listTorrents({}));
}

/**
 * 添加磁链 / .torrent URL。
 *
 * 响应三态解析（架构评审 I12 + 行 132-135、2016）：
 *  - 若该 infoHash 已存在于 qB → `already_added`（幂等成功，不报错不重试）。
 *  - `addTorrent` 返回 true  → `added`。
 *  - 返回 false / 抛错       → `failed`。
 *
 * 底层 {@link QBittorrent.addTorrent} 已把 "Ok."/"Already added." 折叠为 true，
 * 这里在 add 前用 infoHash 预查以显式区分 already_added（供 DownloadTask 状态机决策）。
 */
export async function addMagnet(
  magnet: string,
  opts: AddMagnetOptions = {},
): Promise<AddMagnetResult> {
  const category = opts.category ?? env.QBT_CATEGORY_DEFAULT;
  const savepath = opts.savePath ?? env.QBT_SAVEPATH_ROOT;
  const tags = opts.tags?.length ? opts.tags.join(',') : undefined;
  const hash = parseInfoHash(magnet);

  // 1. 预查幂等：已存在 → already_added
  if (hash) {
    try {
      const existing = await withQb('addMagnet.lookup', (c) =>
        c.listTorrents({ hashes: hash.toLowerCase() }),
      );
      if (existing.length > 0) {
        logger.info({ hash }, 'addMagnet: torrent already added (idempotent success)');
        return 'already_added';
      }
    } catch {
      /* 预查失败不阻断 */
    }
  }

  // 2. 下发 add —— 用直接 SID 层（@ctrl/qbittorrent 在 qB v5 上 cookie 鉴权坏）
  const added = await addMagnetDirect(magnet, {
    savePath: savepath,
    category,
    ...(tags ? { tags } : {}),
  });
  if (!added) return 'failed';

  // 3. 回查确认（qB 对 base32 magnet 可能返回 Fails. 但实际已入列）
  if (hash) {
    await new Promise((r) => setTimeout(r, 1500)); // 等 qB 入列
    const exists = await torrentExists(hash);
    if (exists) {
      logger.info({ hash }, 'addMagnet: verified in qB');
      return 'added';
    }
    logger.warn({ hash }, 'addMagnet: not found after add (rejected by qB)');
    return 'failed';
  }
  return 'added';
}

/**
 * 删除种子。deleteFiles 恒为 false —— 做种达标后只移除任务、保留数据
 * （架构 2.3 做种不打断边界）。调用方仍可传 deleteFiles，但默认 false。
 */
export async function removeTorrent(hash: string, deleteFiles = false): Promise<boolean> {
  return withQb('removeTorrent', (c) => c.removeTorrent(hash, deleteFiles));
}

/** 暂停种子。 */
export async function pauseTorrent(hash: string): Promise<boolean> {
  return withQb('pauseTorrent', (c) => c.pauseTorrent(hash));
}

/** 恢复种子。 */
export async function resumeTorrent(hash: string): Promise<boolean> {
  return withQb('resumeTorrent', (c) => c.resumeTorrent(hash));
}

/**
 * 聚合 qBittorrent 连接状态（供 GET /api/qb/status 与 readiness 探针）。
 * 任一子调用失败即视为离线，返回 connected=false 而非抛错（API 层需要稳定响应）。
 */
export async function getStatus(): Promise<QbStatus> {
  try {
    const c = client();
    const [appVersion, apiVersion, mainData] = await Promise.all([
      c.getAppVersion(),
      c.getApiVersion(),
      c.getSyncMainData(),
    ]);
    _lastConnectOk = true;
    const freeSpaceRaw = mainData?.server_state?.free_space;
    // server_state 类型为 Record<string, unknown>，free_space 在 WebAPI 里是数字字符串
    const freeSpaceBytes =
      freeSpaceRaw != null && freeSpaceRaw !== '' ? BigInt(String(freeSpaceRaw)) : null;
    return {
      connected: true,
      appVersion,
      apiVersion,
      freeSpaceBytes,
      torrentsCount: mainData?.torrents ? Object.keys(mainData.torrents).length : 0,
    };
  } catch (e) {
    _lastConnectOk = false;
    logger.warn({ err: e }, 'qbittorrent getStatus: unreachable');
    return {
      connected: false,
      appVersion: null,
      apiVersion: null,
      freeSpaceBytes: null,
      torrentsCount: null,
    };
  }
}

/**
 * qB 高层门面对象：聚合上述方法，兼容调度层 `qb.getAllTorrents()` /
 * `qb.removeTorrent(hash, false)` 直调写法（见 scheduler/jobs/qb-poll.ts）。
 */
export const qb = {
  getAllTorrents,
  addMagnet,
  removeTorrent,
  pauseTorrent,
  resumeTorrent,
  getStatus,
};

/**
 * 暴露底层 {@link QBittorrent} 实例（惰性创建）。
 * 仅在确需 lib 原生方法（如 setPreferences / torrentFiles）时使用。
 */
export function getQbClient(): QBittorrent {
  return client();
}

/** 判定错误是否为 qB 连接类可重试错误（供 isRetryable 兜底）。 */
export function isQbUnavailableError(e: unknown): e is QbUnavailableError {
  return e instanceof QbUnavailableError;
}
