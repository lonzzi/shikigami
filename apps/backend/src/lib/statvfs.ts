import { statfs } from 'node:fs/promises';

/**
 * 磁盘占用。架构评审 I7: metrics 暴露 /downloads + /library 占用率。
 */
export interface DiskUsage {
  totalBytes: bigint;
  freeBytes: bigint;
  usedBytes: bigint;
  usedRatio: number;
}

export async function diskUsage(path: string): Promise<DiskUsage | null> {
  try {
    const s = await statfs(path);
    const totalBytes = BigInt(s.bsize) * BigInt(s.blocks);
    const freeBytes = BigInt(s.bsize) * BigInt(s.bavail);
    const usedBytes = totalBytes - BigInt(s.bsize) * BigInt(s.bfree);
    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usedRatio: totalBytes > 0n ? Number(usedBytes) / Number(totalBytes) : 0,
    };
  } catch {
    return null;
  }
}
