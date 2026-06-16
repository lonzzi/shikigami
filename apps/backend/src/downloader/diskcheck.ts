/**
 * 磁盘剩余空间预检（架构评审 M15：新增 diskcheck.ts）。
 *
 * 触发点：下载层 addMagnet 前（架构行 129-131）。
 *  - 调 {@link diskUsage}（statvfs 封装）读取 env.DOWNLOADS_ROOT 剩余空间。
 *  - 不足时返回 false（由调用方将 DownloadTask 标记 PENDING_DISK_FULL + 通知）。
 *  - statvfs 本身失败（路径不存在 / 权限）抛 {@link RetryableError}，让队列按 backoff 重试。
 *
 * 边界（架构 2.3）：/downloads 与 /media/library 必须在同一文件系统，
 * 故只检 DOWNLOADS_ROOT 即可覆盖落盘需求。
 */
import { env } from '../lib/env';
import { RetryableError } from '../lib/errors';
import { diskUsage } from '../lib/statvfs';

/**
 * 安全余量比例：预留一定空间避免填满盘导致 qB/系统异常。
 * 默认 5%，可通过覆盖 env 不暴露（常量，见架构“磁盘翻倍强警告”）。
 */
const SAFETY_MARGIN_RATIO = 0.05;

/**
 * 预检 DOWNLOADS_ROOT 是否有足够剩余空间容纳 bytesNeeded。
 *
 * @param bytesNeeded 待下载体积（字节）。Torrent.size 为 bigint，统一接受 number|bigint。
 * @returns true=空间充足；false=不足（调用方应标 PENDING_DISK_FULL）。
 * @throws {RetryableError} statvfs 读取失败（路径不可达等瞬时错误）。
 */
export async function checkFreeSpace(bytesNeeded: number | bigint): Promise<boolean> {
  const needed = BigInt(bytesNeeded);
  const usage = await diskUsage(env.DOWNLOADS_ROOT);

  if (!usage) {
    // 无法读取磁盘占用（路径不存在 / 权限 / 平台不支持）→ 可重试
    throw new RetryableError(`diskUsage unavailable for ${env.DOWNLOADS_ROOT}`);
  }

  // 预留安全余量后的可用空间
  const reserved = BigInt(Math.floor(Number(usage.totalBytes) * SAFETY_MARGIN_RATIO));
  const effectiveFree = usage.freeBytes - reserved;

  if (effectiveFree < needed) {
    return false;
  }
  return true;
}

/**
 * 计算仍需的额外空间（字节）。正数=缺口，0/负数=充足。
 * 供 PENDING_DISK_FULL 通知/仪表盘展示。
 */
export async function freeSpaceShortfall(bytesNeeded: number | bigint): Promise<bigint | null> {
  const usage = await diskUsage(env.DOWNLOADS_ROOT);
  if (!usage) return null;
  const reserved = BigInt(Math.floor(Number(usage.totalBytes) * SAFETY_MARGIN_RATIO));
  return neededMinusFree(BigInt(bytesNeeded), usage.freeBytes - reserved);
}

function neededMinusFree(needed: bigint, free: bigint): bigint {
  return needed - free;
}
