import { createHmac } from 'node:crypto';
import { env } from './env';

/**
 * 极简 HS256 JWT（签发 + 校验）。避免引入 jsonwebtoken 依赖。
 * 仅用于内部 admin token 签名，密钥 = env.JWT_SECRET。
 */
export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
}

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const TOKEN_TTL_SEC = 7 * 24 * 60 * 60; // 7 天

export function signJwt(payload: Pick<JwtPayload, 'sub'>): string {
  const now = Math.floor(Date.now() / 1000);
  const body: JwtPayload = { sub: payload.sub, iat: now, exp: now + TOKEN_TTL_SEC };
  const data = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = sign(`${HEADER}.${data}`);
  return `${HEADER}.${data}.${sig}`;
}

export function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  const sig = sign(`${parts[0]!}.${parts[1]!}`);
  if (sig !== parts[2]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function sign(data: string): string {
  return createHmac('sha256', env.JWT_SECRET).update(data).digest('base64url');
}
