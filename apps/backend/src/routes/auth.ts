import { zValidator } from '@hono/zod-validator';
import bcryptjs from 'bcryptjs';
import { Hono } from 'hono';
import { z } from 'zod';
import { env } from '../lib/env';
import { signJwt } from '../lib/jwt';
import { authMiddleware } from '../middleware/auth';

/**
 * 认证路由。
 * - POST /login: 校验 ADMIN_USERNAME + ADMIN_PASSWORD(bcrypt) → 签发 JWT
 * - POST /logout: 仅前端清 token（无服务端 session）
 */
const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const auth = new Hono()
  .post('/login', zValidator('json', loginSchema), async (c) => {
    const { username, password } = c.req.valid('json');
    if (username !== env.ADMIN_USERNAME) {
      return c.json({ error: 'invalid credentials' }, 401);
    }
    // 兼容: ADMIN_PASSWORD 可能是 bcrypt hash 或明文（开发期）
    let ok = false;
    if (env.ADMIN_PASSWORD.startsWith('$2')) {
      ok = await bcryptjs.compare(password, env.ADMIN_PASSWORD);
    } else {
      ok = password === env.ADMIN_PASSWORD;
    }
    if (!ok) return c.json({ error: 'invalid credentials' }, 401);

    const token = signJwt({ sub: username });
    return c.json({ token, username });
  })
  .post('/logout', authMiddleware(), (c) => {
    // 无服务端 session，前端丢弃 token 即可
    return c.json({ ok: true });
  })
  .get('/me', authMiddleware(), (c) => {
    return c.json({ user: c.get('user') });
  });
