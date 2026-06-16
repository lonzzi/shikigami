import { hc } from 'hono/client';
import type { AppType } from '../../../backend/src/app';

/**
 * 后端 RPC 客户端（hono/client 类型安全）。
 * Token 从 localStorage 注入到每次请求的 header。
 *
 * AppType = typeof app（含 /api 前缀），故调用形如 rpc.api.subscriptions.$get()。
 */

const TOKEN_KEY = 'shikigami_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export const rpc = hc<AppType>('/', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = getToken();
    if (token) {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token}`);
      init = { ...init, headers };
    }
    const res = await fetch(input as RequestInfo | URL, init);
    // 401 统一处理: token 过期/失效 → 清 token + 跳登录(避免卡加载页)
    if (res.status === 401) {
      clearToken();
      if (location.pathname !== '/login') location.assign('/login');
      // 抛带状态码的错误，让 TanStack Query 的 onError 也能感知
      throw new Error(`401 Unauthorized`);
    }
    return res;
  },
});

/** 带 token 的请求头（手动 fetch 时用）。 */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 登录。 */
export async function login(username: string, password: string): Promise<boolean> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  if ('token' in data && data.token) {
    setToken(data.token);
    return true;
  }
  return false;
}
