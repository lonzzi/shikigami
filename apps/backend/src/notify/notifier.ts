import { env } from '../lib/env';
import { logger } from '../logger';

/**
 * 通知层（架构 2.2 / 通知段落）。
 * - Telegram: POST https://api.telegram.org/bot{token}/sendMessage（国内需 HTTPS_PROXY）
 * - 企业微信: POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key={key}
 * 两者都未配置时 no-op；任一失败仅 logger.warn，绝不抛（通知是 best-effort）。
 */

export interface NotifyInput {
  /** 标题（可选，企业微信渲染为加粗首行，Telegram 渲染为 <b>）。 */
  title?: string;
  /** 正文。 */
  text: string;
}

/**
 * 发送通知到所有已配置的渠道（Telegram + 企业微信）。
 * 任一渠道失败不影响其他渠道；全部未配置则 no-op。
 */
export async function notify(input: NotifyInput): Promise<void> {
  const { title, text } = input;
  const tasks: Promise<void>[] = [];

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    tasks.push(sendTelegram(title, text));
  }
  if (env.WECHAT_WORK_WEBHOOK_KEY) {
    tasks.push(sendWechat(title, text));
  }

  if (tasks.length === 0) return; // no-op
  await Promise.allSettled(tasks);
}

/**
 * Telegram Bot sendMessage。
 */
async function sendTelegram(title: string | undefined, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const content = title ? `<b>${escapeHtml(title)}</b>\n${escapeHtml(text)}` : escapeHtml(text);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: content,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      logger.warn({ status: r.status, body }, 'telegram notify failed');
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'telegram notify error');
  }
}

/**
 * 企业微信群机器人 webhook（markdown 消息）。
 */
async function sendWechat(title: string | undefined, text: string): Promise<void> {
  const url = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${env.WECHAT_WORK_WEBHOOK_KEY}`;
  // 企业微信 markdown: **加粗** + 换行
  const content = title ? `**${title}**\n${text}` : text;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { content },
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      logger.warn({ status: r.status, body }, 'wechat notify failed');
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'wechat notify error');
  }
}

/** HTML 转义（Telegram HTML parse_mode）。 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
