import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * AI 刮削结构化输出 schema。
 * 架构评审: 删除 title_ro (AI 不输出罗马音); title_hint 仅供识别线索, 权威译名由 Bangumi/TMDB 回填。
 */
export const AnimeMetaSchema = z.object({
  release_group: z.string().nullable(),
  /** AI 识别到的标题 (任意语言), 仅用于匹配 Bangumi/TMDB */
  title_hint: z.string(),
  season: z.number().int().min(1).nullable(),
  episode: z.number().int().min(1).nullable(),
  /** 字幕组常用的连续编号 (跨季连续) */
  absolute_episode: z.number().int().nullable(),
  episode_type: z.enum(['normal', 'special', 'ova', 'movie', 'web']),
  resolution: z.string().nullable(),
  /** BDRip/Web-DL/HDTV */
  source: z.string().nullable(),
  video_codec: z.string().nullable(),
  audio_codec: z.string().nullable(),
  subtitle_lang: z.string().nullable(),
  audio_lang: z.string().nullable(),
  checksum: z.string().nullable(),
  release_date: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  needs_review: z.boolean(),
  raw_tokens: z.record(z.string(), z.string()).optional(),
});

export type AnimeMeta = z.infer<typeof AnimeMetaSchema>;

/**
 * JSON Schema hash 固定, 避免 zod-to-json-schema 字段顺序抖动破坏 prompt 前缀稳定。
 * 注: 当前未引入 zod-to-json-schema 依赖以减少体积; 在 strict 模式下手动构造 schema
 *     并 hash 固定。如需自动生成可后续引入 zod-to-json-schema。
 */
const MANUAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'release_group',
    'title_hint',
    'season',
    'episode',
    'absolute_episode',
    'episode_type',
    'resolution',
    'source',
    'video_codec',
    'audio_codec',
    'subtitle_lang',
    'audio_lang',
    'checksum',
    'release_date',
    'confidence',
    'needs_review',
  ],
  properties: {
    // 可空字段统一用单 type(AI 输出空串表示 null), 兼容 minimax 等不认 type 数组的模型
    release_group: { type: 'string' },
    title_hint: { type: 'string' },
    season: { type: 'integer', minimum: 0 },
    episode: { type: 'integer', minimum: 0 },
    absolute_episode: { type: 'integer', minimum: 0 },
    episode_type: { type: 'string', enum: ['normal', 'special', 'ova', 'movie', 'web'] },
    resolution: { type: 'string' },
    source: { type: 'string' },
    video_codec: { type: 'string' },
    audio_codec: { type: 'string' },
    subtitle_lang: { type: 'string' },
    audio_lang: { type: 'string' },
    checksum: { type: 'string' },
    release_date: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    needs_review: { type: 'boolean' },
  },
} as const;

let _schemaHash = '';
export function getAnimeMetaJsonSchema(): { schema: object; hash: string } {
  if (!_schemaHash) {
    _schemaHash = createHash('sha256')
      .update(JSON.stringify(MANUAL_SCHEMA))
      .digest('hex')
      .slice(0, 16);
  }
  return { schema: MANUAL_SCHEMA as object, hash: _schemaHash };
}
