import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFile } from '../src/downloader/import';

/**
 * importFile 幂等性测试（EEXIST 同 inode skipped / 不同 inode suffix / EXDEV copy）。
 */
describe('importFile', () => {
  let srcDir: string;
  let dstDir: string;

  beforeAll(async () => {
    srcDir = await mkdtemp(join(tmpdir(), 'shiki-src-'));
    dstDir = await mkdtemp(join(tmpdir(), 'shiki-dst-'));
    await writeFile(join(srcDir, 'a.mkv'), 'hello');
  });

  it('首次硬链接成功', async () => {
    const r = await importFile(join(srcDir, 'a.mkv'), join(dstDir, 'a.mkv'));
    expect(r).toBe('hardlink');
    const s = await stat(join(dstDir, 'a.mkv'));
    expect(s.size).toBe(5);
  });

  it('同 inode 重复 → skipped（幂等）', async () => {
    const r = await importFile(join(srcDir, 'a.mkv'), join(dstDir, 'a.mkv'));
    expect(r).toBe('skipped');
  });

  it('不同 inode 撞名 → suffix 策略', async () => {
    // 在 src 创建不同内容同名文件到另一个目录,然后导入到已存在不同 inode 的目标
    await mkdir(join(srcDir, 'sub'), { recursive: true });
    await writeFile(join(srcDir, 'sub', 'a.mkv'), 'different');
    // dstDir/a.mkv 已存在(来自第一个测试,指向 src/a.mkv) → 不同 inode → suffix
    const r = await importFile(join(srcDir, 'sub', 'a.mkv'), join(dstDir, 'a.mkv'), 'suffix');
    expect(r).toBe('hardlink');
    // 应生成 a.2.mkv
    const s2 = await stat(join(dstDir, 'a.2.mkv'));
    expect(s2.size).toBe(9);
  });

  afterAll(async () => {
    await rm(srcDir, { recursive: true, force: true });
    await rm(dstDir, { recursive: true, force: true });
  });
});
