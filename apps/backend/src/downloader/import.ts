/**
 * 种子内容导入（架构第 5.3 节：硬链接 + EEXIST/EXDEV 处理 + 内容枚举）。
 *
 * 职责：
 *  - {@link importFile} 硬链接单文件到媒体库，处理 EEXIST（inode 比较幂等）/
 *    EXDEV（跨文件系统降级 copyFile）/ 撞名冲突（suffix/reject）。
 *  - {@link importDownloadTask} 枚举 DownloadTask.savePath 下所有文件，
 *    按 video/subtitle/font/other 分类落 MediaFile（PENDING 态，等待下游 AI 刮削赋集号）。
 *
 * 关键边界（架构 2.3 + 评审 C1/C5）：
 *  - 硬链接幂等：EEXIST 必须 stat 比 inode（同 inode skipped，不同 inode 走冲突策略）。
 *  - 做种不打断：导入只硬链 + 重命名，绝不调 qb.removeTorrent(hash, true)。
 *  - 合集种子 fan-out：一个 DownloadTask 产出多个 MediaFile；集号/series 由下游刮削层填充。
 */
import { copyFile, link, mkdir, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { env } from '../lib/env';
import { ConflictError } from '../lib/errors';
import { classifyFileKind } from '../lib/path';
import { prisma } from '../lib/prisma';
import { logger } from '../logger';

/** 文件冲突策略：suffix=加序号后缀重试；reject=抛 {@link ConflictError}。 */
export type ConflictStrategy = 'suffix' | 'reject';

/** importFile 的返回语义（供调用方统计/日志）。 */
export type ImportFileResult = 'hardlink' | 'copy' | 'skipped';

/** suffix 策略递归上限，防极端撞名导致栈溢出。 */
const MAX_SUFFIX_ATTEMPTS = 99;

/**
 * 硬链接导入单个文件（架构行 1282-1313 伪代码严格对齐）。
 *
 * 流程：
 *  1. mkdir -p 目标目录。
 *  2. link(src, dst) 成功 → 'hardlink'。
 *  3. EEXIST → stat 比较两端 inode：
 *       - 同 inode → 'skipped'（已导入，幂等跳过，reconcile/rescrape 安全重跑）。
 *       - 不同 inode → 撞名冲突：
 *           · reject → 抛 {@link ConflictError}。
 *           · suffix → 加 `.2` 后缀递归（`.3`/`.4`…，达上限转 reject）。
 *  4. EXDEV → 跨文件系统，降级 copyFile（磁盘翻倍，架构强警告）→ 'copy'。
 *
 * @param srcPath 源路径（qB content_path 下的实际文件）。
 * @param dstPath 目标路径（媒体库内）。
 * @param conflictStrategy 撞名冲突策略，默认 'suffix'。
 * @param _attempt 内部递归计数，外部调用勿传。
 */
export async function importFile(
  srcPath: string,
  dstPath: string,
  conflictStrategy: ConflictStrategy = 'suffix',
  _attempt = 0,
): Promise<ImportFileResult> {
  await mkdir(dirname(dstPath), { recursive: true });

  try {
    await link(srcPath, dstPath);
    return 'hardlink';
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;

    if (code === 'EEXIST') {
      // 显式 stat 比较 inode（评审 C1）
      const [srcStat, dstStat] = await Promise.all([stat(srcPath), stat(dstPath)]);
      if (srcStat.ino === dstStat.ino) {
        // 同 inode = 已导入，幂等跳过
        return 'skipped';
      }

      // 不同 inode = 撞名冲突
      if (conflictStrategy === 'reject') {
        throw new ConflictError(`EEXIST different inode: ${dstPath}`);
      }

      // suffix 策略：加序号后缀递归（.2/.3/…）
      if (_attempt >= MAX_SUFFIX_ATTEMPTS) {
        throw new ConflictError(
          `EEXIST suffix exhausted (${MAX_SUFFIX_ATTEMPTS} attempts): ${dstPath}`,
        );
      }
      const dot = dstPath.lastIndexOf('.');
      const ext = dot > 0 ? dstPath.slice(dot) : '';
      const stem = dot > 0 ? dstPath.slice(0, dot) : dstPath;
      const newPath = `${stem}.${_attempt + 2}${ext}`;
      return importFile(srcPath, newPath, conflictStrategy, _attempt + 1);
    }

    if (code === 'EXDEV') {
      // 跨文件系统：降级 copyFile（磁盘翻倍强警告）
      logger.warn(
        { srcPath, dstPath },
        'EXDEV: hardlink across filesystems, falling back to copyFile (disk usage doubles)',
      );
      await copyFile(srcPath, dstPath);
      return 'copy';
    }

    throw e;
  }
}

// ----------------------------------------------------------------------------
// 种子内容枚举
// ----------------------------------------------------------------------------

/** 枚举出的单个物理文件（相对 savePath 的完整绝对路径 + 文件名 + 体积）。 */
export interface ContentFile {
  /** 完整绝对路径。 */
  path: string;
  /** 文件名（basename）。 */
  name: string;
  /** 体积（字节）。 */
  size: bigint;
}

/**
 * 枚举 contentPath 下所有文件（递归）。合集种子 fan-out 的基础（评审 C5）。
 *
 * - 若 contentPath 是普通文件 → 返回单元素数组。
 * - 若是目录 → 深度优先递归列出全部文件。
 * - 路径不存在 / 不可读 → 返回空数组（由调用方决定是否告警）。
 */
export async function enumerateContent(contentPath: string): Promise<ContentFile[]> {
  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(contentPath);
  } catch {
    logger.warn({ contentPath }, 'enumerateContent: path not accessible');
    return [];
  }

  if (!s.isDirectory()) {
    return [{ path: contentPath, name: basename(contentPath), size: BigInt(s.size) }];
  }

  const out: ContentFile[] = [];
  const stack: string[] = [contentPath];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      // 显式 encoding:'utf8' 让 Dirent.name 为 string（避免推断成 Buffer）
      entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch (e) {
      logger.warn({ dir, err: e }, 'enumerateContent: readdir failed');
      continue;
    }
    for (const ent of entries) {
      const name: string = ent.name;
      const full = join(dir, name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile()) {
        try {
          const fs = await stat(full);
          out.push({ path: full, name, size: BigInt(fs.size) });
        } catch {
          // 单文件 stat 失败跳过，不阻断整体枚举
        }
      }
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// DownloadTask 级导入
// ----------------------------------------------------------------------------

/** importDownloadTask 的返回汇总（供队列日志/重试决策）。 */
export interface ImportDownloadTaskResult {
  /** 枚举到的文件总数。 */
  enumerated: number;
  /** 本次新建的 MediaFile 数。 */
  created: number;
  /** 已存在被跳过的 MediaFile 数（幂等）。 */
  skipped: number;
}

/**
 * 导入一个 DownloadTask：枚举 savePath 下全部文件，分类后落 MediaFile。
 *
 * 设计（架构行 1318-1331 + 评审 C5/I7）：
 *  - 枚举 content_path（task.savePath）下所有 video/subtitle/font/other 文件。
 *  - 每文件生成一条 MediaFile（PENDING 态）：
 *      · kind = classifyFileKind(fileName) → video/subtitle/font/other。
 *      · 字段对齐 schema：downloadTaskId / kind / sourcePath / fileName / sizeBytes。
 *      · seriesId / episodeId / 集号留空，交由下游 AI 刮削层填充
 *        （合集种子“先解析包标题定 series+季，再按文件名分配集号”属刮削层职责）。
 *  - 幂等：按 (downloadTaskId, sourcePath) 已存在则跳过，支持 reconcile/rescrape 重跑。
 *
 * 注意：本函数只做文件落库，**不**执行硬链接到媒体库（那是 RENAMED 阶段，
 * scrapeState=MATCHED/REVIEWED 之后的事），也**绝不**调 qb.removeTorrent(hash, true)。
 *
 * @param downloadTaskId DownloadTask.id
 */
export async function importDownloadTask(
  downloadTaskId: string,
): Promise<ImportDownloadTaskResult> {
  const task = await prisma.downloadTask.findUnique({ where: { id: downloadTaskId } });
  if (!task) {
    throw new Error(`importDownloadTask: task not found (id=${downloadTaskId})`);
  }

  const contentPath = task.savePath ?? env.DOWNLOADS_ROOT;
  const files = await enumerateContent(contentPath);

  if (files.length === 0) {
    logger.warn(
      { downloadTaskId, contentPath, rawTitle: task.rawTitle },
      'importDownloadTask: no files enumerated under savePath',
    );
    return { enumerated: 0, created: 0, skipped: 0 };
  }

  // 预取已存在的 MediaFile（按 sourcePath 全局查），实现跨 task 幂等跳过。
  // 不同 DownloadTask 可能指向同一物理文件（合集种子 + 单集种子重复、或多次 import），
  // 按 sourcePath 全局去重避免同一文件被多个 task 各落一条 MediaFile（数据膨胀）。
  const filePaths = files.map((f) => f.path);
  const existing = await prisma.mediaFile.findMany({
    where: { sourcePath: { in: filePaths } },
    select: { sourcePath: true },
  });
  const seen = new Set(existing.map((m: { sourcePath: string }) => m.sourcePath));

  let created = 0;
  let skipped = 0;
  for (const f of files) {
    if (seen.has(f.path)) {
      skipped += 1;
      continue;
    }
    const kind = classifyFileKind(f.name); // 'video' | 'subtitle' | 'font' | 'other'
    await prisma.mediaFile.create({
      data: {
        downloadTaskId,
        kind,
        sourcePath: f.path,
        fileName: f.name,
        sizeBytes: f.size,
        // scrapeState 默认 PENDING；seriesId/episodeId/libraryPath 留空待刮削/重命名阶段填
      },
    });
    created += 1;
  }

  logger.info(
    { downloadTaskId, enumerated: files.length, created, skipped },
    'importDownloadTask: media files recorded',
  );
  return { enumerated: files.length, created, skipped };
}
