import type { ChatCompletion } from 'openai/resources/chat/completions';
import { getScrapeCache, normalizeFingerprint, saveScrapeCache } from '../lib/cache';
import { env } from '../lib/env';
import { BudgetExceededError, NeedsReviewError, RetryableError } from '../lib/errors';
import { httpGet } from '../lib/http';
import { bangumiThrottle } from '../lib/ratelimit';
import { logger } from '../logger';
import { llm, markEndpointHealthy, supportsJsonSchema } from './client';
import { checkBudget, estimateCostUsd, estimateTokens, recordLlmCall } from './cost';
import { retrieveFewShot } from './fewshot';
import { type AnimeMeta, AnimeMetaSchema, getAnimeMetaJsonSchema } from './schema';

/**
 * AI 文件名刮削主流程（架构 5.2 scrape.ts）。
 * 缓存命中 → 预算熔断 → 能力探测 → 构造 messages → 调用 →
 * finish_reason 检查 → Zod 解析 → Bangumi 交叉验证 → 写缓存 + 记账。
 */

// SYSTEM prompt（原文对齐架构 5.2，修正文档笔误 "scares null" → "无则 null"）
const SYSTEM = `你是动漫发布文件名识别专家。从 [字幕组] 标题 - 集数 [来源][分辨率][编码][语言] 中提取结构化字段。
规则:
1. release_group = 方括号内第一个非数字 token（字幕组），无则 null
2. title_hint = 识别到的标题（任意语言，仅用于匹配 Bangumi/TMDB，权威译名由元数据层回填）
3. absolute_episode = 文件名里的连续编号（字幕组常用，跨季连续）
4. season/episode = 按"播出季"拆分；absolute_episode 不一定等于 episode
5. 不确定 season/episode 时填 null 且 needs_review=true
6. SP/OVA/剧场版 episode_type=special/ova/movie，正片=normal
7. subtitle_lang: 简中=CHS, 繁中=CHT, 双语=DUAL, 无则 null
8. confidence 反映整体把握；<${env.LLM_REVIEW_THRESHOLD} 一律 needs_review=true`;

/** Bangumi 搜索召回后用于交叉验证的最小相似度阈值（低于则降置信 + 进人工）。 */
const TITLE_SIM_THRESHOLD = 0.6;

export interface ScrapeOptions {
  /** 关联的 MediaFile id（记账用，可选）。 */
  mediaFileId?: string;
}

/**
 * 刮削文件名 → 结构化 AnimeMeta。
 * @param filename 原始文件名（含扩展名也可）
 * @param preParsed anitomy/regex 的预解析提示，作为 user 消息追加（可选）
 */
export async function scrapeFilename(
  filename: string,
  preParsed?: Partial<AnimeMeta>,
  options: ScrapeOptions = {},
): Promise<AnimeMeta> {
  // 1. 文件名指纹缓存（归一化后，去 CRC/分辨率/版本号差异）
  const fp = normalizeFingerprint(filename);
  const cached = await getScrapeCache(fp);
  if (cached) {
    // 命中缓存不消耗预算，记一笔 cached 调用
    const usage = extractUsage(cached.result);
    await recordLlmCall({
      cached: true,
      model: cached.model,
      success: true,
      costUsd: 0,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      mediaFileId: options.mediaFileId,
    }).catch(() => {
      /* 记账失败不影响主流程 */
    });
    return AnimeMetaSchema.parse(JSON.parse(cached.result));
  }

  // 2. 预算熔断
  const budgetOk = await checkBudget();
  if (!budgetOk) {
    throw new BudgetExceededError(`LLM daily budget exceeded (${env.LLM_DAILY_BUDGET_USD} USD)`);
  }

  // 3. 能力探测决定 response_format
  const useSchema = await supportsJsonSchema();
  const { schema: jsonSchema } = getAnimeMetaJsonSchema();

  // 4. few-shot 动态检索
  const fewshot = await retrieveFewShot(filename).catch(() => '');
  const userHint = preParsed ? `\n(预解析提示: ${JSON.stringify(preParsed)})` : '';

  // 第二条 system: 静态 JSON Schema 字符串前缀，利于 prompt caching
  const SCHEMA_STR = JSON.stringify(jsonSchema);

  // 5. 构造 messages（结构对齐架构: SYSTEM + 第二条 system(schema) + fewshot user + filename user）
  const messages: OpenAIChatMessage[] = [
    { role: 'system', content: SYSTEM },
    { role: 'system', content: `输出 JSON Schema: ${SCHEMA_STR}` },
    // few-shot 为空时不注入（避免空 user 消息干扰部分端点）
    ...(fewshot ? [{ role: 'user' as const, content: fewshot }] : []),
    { role: 'user', content: `filename: ${filename}${userHint}` },
  ];

  // 6. 调用（区分错误类型: 限流/网络 → 重试；其余直接抛）
  let completion: ChatCompletion;
  try {
    completion = await llm.chat.completions.create({
      model: env.LLM_MODEL,
      temperature: 0,
      max_tokens: 4096, // reasoning 模型(glm-5.2 等)思维链占大量 token, 调大防 content 被截断
      messages,
      ...(useSchema
        ? {
            response_format: {
              type: 'json_schema' as const,
              json_schema: {
                name: 'anime_meta',
                strict: true,
                schema: jsonSchema as Record<string, unknown>,
              },
            },
          }
        : { response_format: { type: 'json_object' as const } }),
    });
  } catch (err) {
    const e = err as { status?: number; code?: string; message?: string };
    // 429 限流 / 网络类错误 → 可重试
    if (e?.status === 429 || e?.code === 'ECONNRESET' || e?.code === 'ETIMEDOUT') {
      throw new RetryableError(`LLM transient error: ${e.message ?? 'unknown'}`, err);
    }
    throw err;
  }

  markEndpointHealthy();

  // 7. finish_reason 检查
  const choice = completion.choices[0];
  if (!choice) {
    throw new RetryableError('LLM returned no choices');
  }
  // finish_reason='length' 时, reasoning 模型可能 content 已含完整 JSON（只是思维链被截断）
  // → 先尝试解析, 解析不出再当截断重试
  if (choice.finish_reason === 'length') {
    const tryRaw = choice.message?.content ?? '';
    if (!tryRaw || !extractJson(tryRaw)) {
      throw new RetryableError('LLM completion truncated by max_tokens');
    }
    logger.warn({ finish_reason: 'length' }, 'length 但 content 可解析, 继续');
  }

  const raw = choice.message?.content ?? '{}';
  // 剥 ```json ... ``` 代码块包裹 + 提取第一个完整 JSON 对象(reasoning 模型常包裹代码块)
  const jsonStr = extractJson(raw);

  // 8. Zod 解析（失败 → NeedsReviewError，不重试）
  let parsed: AnimeMeta;
  try {
    parsed = AnimeMetaSchema.parse(JSON.parse(jsonStr));
  } catch (e) {
    throw new NeedsReviewError(`schema validation failed: ${(e as Error).message}`);
  }
  // schema 兼容: AI 用空串/0 表示 null, 还原成 null
  parsed = normalizeEmpties(parsed);

  // 9. Bangumi 交叉验证: title_hint 必须搜索召回且相似度 > 阈值
  try {
    const candidates = await searchSubjects(parsed.title_hint);
    if (
      candidates.length === 0 ||
      titleSimilarity(parsed.title_hint, candidates[0]!.name) < TITLE_SIM_THRESHOLD
    ) {
      parsed.needs_review = true;
      parsed.confidence = Math.min(parsed.confidence, 0.5);
    }
  } catch (e) {
    // 交叉验证失败不应阻塞刮削（Bangumi 限流/不可达），仅记日志
    logger.warn({ err: (e as Error).message }, 'bangumi cross-validation failed, skipping');
  }

  // 10. 写缓存 + 记账
  const usage = completion.usage;
  const promptTokens = usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages));
  const completionTokens = usage?.completion_tokens ?? estimateTokens(raw);
  await saveScrapeCache(fp, filename, parsed, env.LLM_MODEL, {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
  }).catch(() => {
    /* 缓存写入失败不阻塞 */
  });

  await recordLlmCall({
    model: env.LLM_MODEL,
    success: true,
    costUsd: estimateCostUsd(env.LLM_MODEL, promptTokens, completionTokens),
    promptTokens,
    completionTokens,
    finishReason: choice.finish_reason ?? undefined,
    mediaFileId: options.mediaFileId,
  }).catch(() => {
    /* 记账失败不阻塞 */
  });

  return parsed;
}

// ============================================================
// 辅助: 标题相似度（简易 Jaccard token 交集）
// ============================================================

/**
 * 标题相似度（token 交集 / Jaccard）。
 * 用作 AI title_hint 与 Bangumi 召回标题的交叉验证，避免高置信拼写偏差错误。
 */
export function titleSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function tokenize(s: string): Set<string> {
  // 去标点，按空白/中英边界拆分，小写
  const cleaned = s
    .toLowerCase()
    .replace(/[[\](){}<>「」『』【】・,.!?_\-:;'"|/\\*?~`]+/g, ' ')
    .replace(/[一-龥]/g, ' $& ') // 中文字符两侧加空格便于按字切
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return new Set();
  // 中文按单字 + 英文/数字按词
  const tokens = new Set<string>();
  for (const part of cleaned.split(' ')) {
    if (!part) continue;
    // 连续中文拆成单字，其余（英文/数字）整体保留
    if (/^[一-龥]+$/.test(part)) {
      for (const ch of part) tokens.add(ch);
    } else {
      tokens.add(part);
    }
  }
  return tokens;
}

// ============================================================
// 辅助: Bangumi 搜索召回（避免对未冻结的 metadata/bangumi 模块强耦合）
// 架构期望 searchSubjects 来自 ../metadata/bangumi，但该模块由并行 agent 实现，
// 此处直接调用 Bangumi v0 search API（已冻结符号: httpGet / bangumiThrottle / env）。
// 接口形态与未来 metadata/bangumi.searchSubjects 一致，便于后续替换。
// ============================================================

interface BangumiSearchCandidate {
  id: number;
  name: string;
  nameCn: string;
}

/** Bangumi v0 搜索: type=2 动画，强制描述性 UA，≤1 req/s。 */
export async function searchSubjects(keyword: string): Promise<BangumiSearchCandidate[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];
  return bangumiThrottle(async () => {
    const body = JSON.stringify({
      keyword: trimmed,
      sort: 'match',
      filter: { type: [2] },
    });
    const resp = await httpGet('https://api.bgm.tv/v0/search/subjects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': env.BANGUMI_USER_AGENT,
        ...(env.BANGUMI_ACCESS_TOKEN
          ? { Authorization: `Bearer ${env.BANGUMI_ACCESS_TOKEN}` }
          : {}),
      },
      body,
      retries: 2,
      backoff: 'exp',
    });
    const data = JSON.parse(resp) as {
      data?: Array<{ id: number; name: string; name_cn?: string }>;
    };
    const list = data.data ?? [];
    return list.slice(0, 5).map((d) => ({
      id: d.id,
      name: d.name,
      nameCn: d.name_cn ?? '',
    }));
  });
}

// ============================================================
// 内部类型 + token 用量反解兜底
// ============================================================

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 从缓存 result 里尽力反解 token 用量（缓存只存 AnimeMeta，不含 usage，返回 null 走估算兜底）。 */
function extractUsage(
  _resultJson: string,
): { prompt_tokens?: number; completion_tokens?: number } | null {
  return null;
}

/**
 * 从 LLM 输出中提取 JSON 对象。
 * 适配 reasoning 模型: 剥 ```json 代码块包裹, 取第一个完整的 {...}。
 * 返回 JSON 字符串; 提取不到返回 ''。
 */
/** 把 AI 用空串/0 表示的"无值"还原成 null（schema 兼容 minimax 等用单 type 的模型）。 */
function normalizeEmpties(m: AnimeMeta): AnimeMeta {
  const strFields = [
    'release_group',
    'resolution',
    'source',
    'video_codec',
    'audio_codec',
    'subtitle_lang',
    'audio_lang',
    'checksum',
    'release_date',
  ] as const;
  const out = { ...m };
  for (const k of strFields) {
    if ((out[k] as string | null | undefined) === '') (out[k] as unknown) = null;
  }
  if (out.season === 0) out.season = null;
  if (out.episode === 0) out.episode = null;
  if (out.absolute_episode === 0) out.absolute_episode = null;
  return out;
}

export function extractJson(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  // 剥 ```json ... ``` 或 ``` ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) s = fence[1].trim();
  // 直接是 JSON
  if (s.startsWith('{')) return s;
  // 从文本里提取第一个 {...} (平衡花括号)
  const start = s.indexOf('{');
  if (start === -1) return '';
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return '';
}
