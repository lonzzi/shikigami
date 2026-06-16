import OpenAI from 'openai';
import { env } from '../lib/env';
import { logger } from '../logger';

/**
 * OpenAI 兼容客户端单例。
 * baseURL / apiKey / 默认 model 全部来自 env（已由 lib/env.ts 校验）。
 * 架构 5.2: 支持指向 Ollama / 任意 OpenAI 兼容网关。
 */
export const llm = new OpenAI({
  baseURL: env.LLM_BASE_URL,
  apiKey: env.LLM_API_KEY || 'unused',
  timeout: 120_000, // reasoning 模型(glm-5.2 等)思维链耗时长, 给足时间
  maxRetries: 0, // 自定义重试在调用层处理（scrape.ts 区分错误类型），避免 SDK 内部重试放大成本
});

// ============================================================
// 能力探测：strict json_schema 仅 OpenAI 官方端点保证，
// Ollama / 第三方兼容网关大多不支持，需带 TTL 探测 + 连续失败重探。
// 架构 5.2 client.ts / AI-cost C1。
// ============================================================

interface ProbeState {
  supports: boolean;
  at: number;
}

let _probe: ProbeState | null = null;
const PROBE_TTL = 60 * 60 * 1000; // 1h
/** 连续失败达到该阈值时强制重探（避免坏缓存卡死）。 */
const FAILURE_REPROBE_THRESHOLD = 3;
let _consecutiveFailures = 0;

/**
 * 探测当前 LLM 端点是否支持 `response_format: json_schema strict`。
 * - 缓存命中（TTL 内且连续失败数 < 阈值）直接返回。
 * - 否则发起一次极小的探测请求，成功→supports=true 并清零失败计数，失败→supports=false。
 */
export async function supportsJsonSchema(): Promise<boolean> {
  const now = Date.now();
  if (_probe && now - _probe.at < PROBE_TTL && _consecutiveFailures < FAILURE_REPROBE_THRESHOLD) {
    return _probe.supports;
  }

  try {
    await llm.chat.completions.create({
      model: env.LLM_MODEL,
      max_tokens: 16,
      messages: [{ role: 'user', content: '{}' }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'probe',
          strict: true,
          schema: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
            additionalProperties: false,
          },
        },
      },
    });
    _probe = { supports: true, at: now };
    _consecutiveFailures = 0;
    return true;
  } catch (e) {
    // 探测失败: 端点不支持 strict json_schema 或网络/鉴权异常 → 降级 json_object
    _probe = { supports: false, at: now };
    _consecutiveFailures += 1;
    logger.debug(
      { err: (e as Error).message, failures: _consecutiveFailures },
      'json_schema capability probe failed, will use json_object',
    );
    return false;
  }
}

/**
 * 在 scrape 实际调用成功后清零失败计数（端点恢复正常）。
 * 供 scrape.ts 在拿到正常 completion 后调用。
 */
export function markEndpointHealthy(): void {
  _consecutiveFailures = 0;
}
