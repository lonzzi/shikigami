import { hc } from 'hono/client';
import type { AppType } from './app';

/**
 * hono/client RPC 类型安全客户端工厂。
 * 前端用法:
 *   import { rpc } from '@shikigami/backend/client'
 *   const res = await rpc.api.subscriptions.$get()
 *   const data = await res.json()  // 完全类型推导
 *
 * token 注入由前端在 fetch wrapper / header 处理（见 web/src/lib/api.ts）。
 */
export const rpc = hc<AppType>('/');
export type Rpc = typeof rpc;
