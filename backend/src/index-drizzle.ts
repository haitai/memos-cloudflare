import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authMiddleware } from './middleware/auth';
import { userRoutes } from './routes/user-drizzle';
import { memoRoutes } from './routes/memo-drizzle';
import { resourceRoutes } from './routes/resource-drizzle';
import { authRoutes } from './routes/auth';
import { tagRoutes } from './routes/tag';
import { workspaceRoutes } from './routes/workspace';
import { webhookRoutes } from './routes/webhook';
import { shortcutRoutes } from './routes/shortcut';

type Env = {
  DB: D1Database;
  R2: R2Bucket;
  JWT_SECRET: string;
  LOG_LEVEL?: string;
  BASE_URL?: string;
};

interface Variables {
  user: {
    sub: string;
    username: string;
    role: string;
    iat: number;
    exp: number;
  };
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 全局中间件
app.use('*', logger());
app.use('*', cors({
  origin: ['http://localhost:3001', 'http://localhost:3000', 'https://memos-cloudflare.haitai.workers.dev'],
  credentials: true,
}));

// 健康检查端点
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'memos-cloudflare',
    version: '0.2.0',
    orm: 'drizzle'
  });
});

// 公开路由（不需要认证）
app.route('/api/auth', authRoutes);

// 需要认证的路由
app.use('/api/user/*', authMiddleware);
app.use('/api/memo/*', authMiddleware);
app.use('/api/resource/*', authMiddleware);
app.use('/api/tag/*', authMiddleware);
app.use('/api/workspace/*', authMiddleware);
app.use('/api/webhook/*', authMiddleware);
app.use('/api/shortcut/*', authMiddleware);

// API路由
app.route('/api/user', userRoutes);
app.route('/api/memo', memoRoutes);
app.route('/api/resource', resourceRoutes);
app.route('/api/tag', tagRoutes);
app.route('/api/workspace', workspaceRoutes);
app.route('/api/webhook', webhookRoutes);
app.route('/api/shortcut', shortcutRoutes);

// 404处理
app.notFound((c) => {
  return c.json({ message: 'Not Found' }, 404);
});

// 错误处理
app.onError((err, c) => {
  console.error('Global error:', err);
  return c.json({ message: 'Internal Server Error' }, 500);
});

export default app;
