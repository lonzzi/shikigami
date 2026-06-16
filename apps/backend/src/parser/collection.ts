import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyFileKind, type FileKind } from '../lib/path';

/**
 * 种子内容枚举 (架构 5.3 collection.ts)。
 *
 * 供 downloader/import.ts 在合集种 fan-out 时遍历 savePath 下所有文件，
 * 区分 video / subtitle / font，逐文件解析集号并建 MediaFile。
 */

export interface ContentFile {
  /** 文件绝对路径 */
  path: string;
  /** 文件名 (含扩展名) */
  name: string;
  /** 字节数 (BigInt，匹配 Prisma sizeBytes) */
  size: bigint;
}

/**
 * 递归遍历目录下所有常规文件。
 * @param dirPath 种子保存根目录 (content_path)
 * @returns ContentFile[] (仅文件，不含目录)；权限/不存在目录静默跳过
 */
export async function enumerateContent(dirPath: string): Promise<ContentFile[]> {
  const out: ContentFile[] = [];
  const stack: string[] = [dirPath];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // 权限不足 / 已不存在 / 非目录 → 跳过，不阻断整批导入
      continue;
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          const s = await stat(full);
          out.push({ path: full, name: entry.name, size: BigInt(s.size) });
        }
        // 符号链接等其它类型不处理，避免环 / 跨设备异常
      } catch {}
    }
  }

  return out;
}

/**
 * 按 FileKind 分组 (供 import.ts 分类 fan-out)。
 */
export function groupContentByKind(files: ContentFile[]): Record<FileKind, ContentFile[]> {
  const acc: Record<FileKind, ContentFile[]> = {
    video: [],
    subtitle: [],
    font: [],
    other: [],
  };
  for (const f of files) {
    acc[classifyFileKind(f.name)].push(f);
  }
  return acc;
}

/** 重新导出 classifyFileKind，便于 import.ts 单点 import。 */
export { classifyFileKind } from '../lib/path';
