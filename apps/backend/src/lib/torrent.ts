import { createHash } from 'node:crypto';
import bencode from 'bencode';
import { logger } from '../logger';

/**
 * .torrent 文件解析（bencode）。
 *
 * 用途: bangumi.moe / mikan 的 RSS 只给 torrentFileUrl（.torrent 链接），
 * 不给 magnet/infoHash。下载 .torrent 后解析出 infoHash，才能走 qB 入队 + DownloadTask 记录。
 *
 * infoHash 规范: SHA1(bencode 编码的 info 字典)。
 */

export interface ParsedTorrent {
  infoHash: string; // 40 位大写 hex
  name: string | null;
}

/**
 * 从 .torrent 文件 Buffer 解析 infoHash + name。
 * infoHash = SHA1(bencode(info 字典))，规范与 BT 协议一致。
 */
export function parseTorrentBuffer(buf: Buffer): ParsedTorrent | null {
  try {
    const decoded = bencode.decode(buf) as { info?: Record<string, unknown> };
    const info = decoded.info;
    if (!info) return null;
    // 重新编码 info 字典再 SHA1（不能用原 buf 切片——info 起止需精确，bencode 重编码保证一致）
    const infoEncoded = Buffer.from(bencode.encode(info) as Uint8Array);
    const infoHash = createHash('sha1').update(infoEncoded).digest('hex').toUpperCase();
    const name =
      (info['name.utf-8'] as Uint8Array | undefined) ?? (info['name'] as Uint8Array | undefined);
    return { infoHash, name: name ? Buffer.from(name).toString('utf8') : null };
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'parseTorrentBuffer failed');
    return null;
  }
}

/**
 * 下载 .torrent 并解析 infoHash。
 * @param torrentFileUrl .torrent 文件 URL（bangumi.moe/mikan 的 enclosure/link）
 * @returns 解析结果，失败返回 null
 */
export async function fetchTorrentInfoHash(torrentFileUrl: string): Promise<ParsedTorrent | null> {
  try {
    // httpGet 返回 string（用于 XML/JSON），这里要二进制 Buffer → 直接用 fetch（走代理）
    const proxy =
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY ||
      process.env.https_proxy ||
      process.env.http_proxy;
    const res = await fetch(torrentFileUrl, {
      ...(proxy ? { proxy } : {}),
      headers: { 'User-Agent': 'Mozilla/5.0 (Shikigami/1.0)' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      logger.warn({ url: torrentFileUrl, status: res.status }, 'fetch .torrent failed');
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return parseTorrentBuffer(buf);
  } catch (e) {
    logger.warn({ err: (e as Error).message, url: torrentFileUrl }, 'fetchTorrentInfoHash failed');
    return null;
  }
}
