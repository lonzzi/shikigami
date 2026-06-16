import { mkdir, writeFile } from 'node:fs/promises';
import type { NfoEpisode, NfoShow } from './types';

/**
 * 生成 tvdb 风格 NFO（架构 2.2 / 5.3）。
 * Jellyfin/Emby 读取 .nfo 时以 <uniqueid> 为权威，避免本地优先无法纠错。
 * 提供 XML 字符串生成（*_xml）+ 落盘（write*）两个层次。
 */

/**
 * XML 转义（属性/文本通用）。
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 生成子节点，value 为 undefined/null/空字符串时省略。 */
function tag(name: string, value: string | undefined | null): string {
  if (value == null || value === '') return '';
  return `  <${name}>${escapeXml(value)}</${name}>\n`;
}

/**
 * 生成 tvshow.nfo XML 字符串（Jellyfin/Emby 番剧级元数据）。
 */
export function showNfoXml(show: NfoShow): string {
  const inner =
    tag('title', show.title) +
    tag('originaltitle', show.originaltitle) +
    tag('plot', show.plot) +
    tag('premiered', show.premiered) +
    tag('studio', show.studio);

  // uniqueid: tvdb / tmdb 为权威标识，锁定避免被在线源覆盖
  const uniqueids: string[] = [];
  if (show.tvdbid) {
    uniqueids.push(`  <uniqueid type="tvdb" default="true">${escapeXml(show.tvdbid)}</uniqueid>\n`);
  }
  if (show.tmdbid) {
    uniqueids.push(
      `  <uniqueid type="tmdb"${show.tvdbid ? '' : ' default="true"'}>${escapeXml(show.tmdbid)}</uniqueid>\n`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<tvshow>
${inner}${uniqueids.join('')}</tvshow>
`;
}

/**
 * 生成单集 .nfo XML 字符串。
 */
export function episodeNfoXml(ep: NfoEpisode): string {
  const _S = String(ep.season).padStart(2, '0');
  const _E = String(ep.episode).padStart(2, '0');
  const inner =
    tag('title', ep.title) +
    tag('showtitle', ep.showTitle) +
    `  <season>${ep.season}</season>\n` +
    `  <episode>${ep.episode}</episode>\n` +
    tag('aired', ep.aired) +
    tag('plot', ep.plot);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<episodedetails>
${inner}</episodedetails>
`;
}

/**
 * 写番剧级 tvshow.nfo 到指定目录（目录不存在则创建）。
 * @param dir 番剧根目录（含番名）
 * @param show NfoShow
 * @returns 写入的完整路径
 */
export async function writeShowNfo(dir: string, show: NfoShow): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = `${dir.replace(/\/$/, '')}/tvshow.nfo`;
  await writeFile(path, showNfoXml(show), 'utf8');
  return path;
}

/**
 * 写单集 .nfo 到指定目录。
 * @param dir 集所在目录（通常是 Season XX）
 * @param ep NfoEpisode（用 season/episode 拼文件名）
 * @returns 写入的完整路径
 */
export async function writeEpisodeNfo(dir: string, ep: NfoEpisode): Promise<string> {
  await mkdir(dir, { recursive: true });
  const S = String(ep.season).padStart(2, '0');
  const E = String(ep.episode).padStart(2, '0');
  const path = `${dir.replace(/\/$/, '')}/S${S}E${E}.nfo`;
  await writeFile(path, episodeNfoXml(ep), 'utf8');
  return path;
}
