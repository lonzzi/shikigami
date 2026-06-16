import { env } from '../lib/env';
import { prisma } from '../lib/prisma';
import { logger } from '../logger';

/**
 * LLM 调用记账 + 预算熔断（架构 5.2 cost.ts）。
 * - recordLlmCall: 写 LlmCall 表（每次调用 / 缓存命中都记一笔）
 * - checkBudget: 今日累计 costUsd < env.LLM_DAILY_BUDGET_USD
 * - estimateTokens: 粗略 token 估算兜底（端点未返回 usage 时）
 * - estimateCostUsd: 按 model 单价表估算
 */

// ============================================================
// 模型定价表（USD / 每百万 token）。新增模型往这里加。
// 架构要求: gpt-4o-mini / gpt-4o / 默认值
// ============================================================

interface ModelPricing {
  /** 每百万 input token 单价 (USD) */
  input: number;
  /** 每百万 output token 单价 (USD) */
  output: number;
}

export const PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  default: { input: 0.5, output: 1.5 },
};

export function getPricing(model: string): ModelPricing {
  return PRICING[model] ?? PRICING.default!;
}

/**
 * 估算单次调用 USD 费用。
 */
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const p = getPricing(model);
  return (promptTokens / 1_000_000) * p.input + (completionTokens / 1_000_000) * p.output;
}

/**
 * 粗略 token 估算: 英文 ≈ 4 char/token，中文按 2 char/token 折算。
 * 仅在端点未返回 usage 时兜底，记账精度足够。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // 统计中文字符数
  const cjk = (text.match(/[一-龥]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk / 1.5 + rest / 4);
}

// ============================================================
// 记账
// ============================================================

export interface RecordLlmCallInput {
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  success: boolean;
  /** 缓存命中（未实际调用 LLM）。 */
  cached?: boolean;
  /** 关联 MediaFile。 */
  mediaFileId?: string;
  /** finish_reason: stop / length / ... */
  finishReason?: string;
  /** 失败时的错误信息。 */
  error?: string;
  /** OpenAI completion（用于提取 usage/finish_reason，兼容架构伪代码的便利入参）。 */
  completion?: {
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices?: Array<{ finish_reason?: string }>;
  };
}

/**
 * 写一笔 LlmCall。记账失败仅记日志，绝不抛（架构: 非关键路径）。
 * @param input 入参；若提供 completion 则优先用其 usage 覆盖 token 数与 finish_reason。
 */
export async function recordLlmCall(input: RecordLlmCallInput): Promise<void> {
  try {
    const usage = input.completion?.usage;
    const promptTokens = usage?.prompt_tokens ?? input.promptTokens;
    const completionTokens = usage?.completion_tokens ?? input.completionTokens;
    const finishReason =
      input.completion?.choices?.[0]?.finish_reason ?? input.finishReason ?? null;

    await prisma.llmCall.create({
      data: {
        mediaFileId: input.mediaFileId ?? null,
        model: input.model,
        promptTokens,
        completionTokens,
        costUsd: input.cached ? 0 : input.costUsd,
        finishReason,
        success: input.success,
        error: input.error ?? null,
        cached: input.cached ?? false,
      },
    });
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'recordLlmCall failed');
  }
}

/**
 * 今日累计 LLM 费用是否仍在预算内。
 * @returns true=可继续调用，false=已超 LLM_DAILY_BUDGET_USD 应熔断
 */
export async function checkBudget(): Promise<boolean> {
  // 0 预算视为禁用（不允许任何调用）；负数视为禁用
  if (env.LLM_DAILY_BUDGET_USD <= 0) return false;

  const now = new Date();
  // 本地时区当日 0 点起算（与 cron 本地解释对齐）
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  try {
    const agg = await prisma.llmCall.aggregate({
      _sum: { costUsd: true },
      where: { createdAt: { gte: startOfDay } },
    });
    const spent = agg._sum.costUsd ?? 0;
    return spent < env.LLM_DAILY_BUDGET_USD;
  } catch (e) {
    // 聚合失败不阻断（宁可多花不可漏刮），记日志
    logger.warn({ err: (e as Error).message }, 'checkBudget aggregate failed, allowing call');
    return true;
  }
}
