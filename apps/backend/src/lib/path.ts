import sanitize from 'sanitize-filename';

/**
 * 路径段 sanitize。
 * 架构评审: Linux 本地允许 ? * | : < > "，但 SMB/CIFS/NTFS 外挂盘或 Jellyfin NFO 解析会出错; / 会拆目录。
 */
const ILLEGAL = /[\\/:*?"<>|]/g;

export function sanitizePathSegment(name: string, maxLen = 120): string {
  let s = name.replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim();
  // Windows 不允许首尾 . 或空格
  s = s.replace(/^\.+|\.+$/g, '').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  // sanitize-filename 兜底 (去除控制字符等)
  s = sanitize(s);
  return s || 'Unknown';
}

/** 从文件名提取扩展名（小写，无点）。 */
export function extOf(fileName: string): string {
  const m = fileName.match(/\.([a-z0-9]{2,4})$/i);
  return m ? m[1]!.toLowerCase() : '';
}

/** 视频扩展名集合。 */
export const VIDEO_EXTS = new Set([
  'mp4',
  'mkv',
  'avi',
  'mov',
  'wmv',
  'flv',
  'webm',
  'm4v',
  'ts',
  'm2ts',
]);
/** 字幕扩展名集合。 */
export const SUBTITLE_EXTS = new Set(['srt', 'ass', 'ssa', 'sub', 'vtt', 'idx', 'sup']);
/** 字体扩展名集合。 */
export const FONT_EXTS = new Set(['ttf', 'otf', 'ttc', 'woff', 'woff2']);

export type FileKind = 'video' | 'subtitle' | 'font' | 'other';

export function classifyFileKind(fileName: string): FileKind {
  const ext = extOf(fileName);
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (SUBTITLE_EXTS.has(ext)) return 'subtitle';
  if (FONT_EXTS.has(ext)) return 'font';
  return 'other';
}
