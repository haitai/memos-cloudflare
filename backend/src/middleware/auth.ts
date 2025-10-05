import { Context, Next } from 'hono';

type Env = {
  DB: D1Database;
  JWT_SECRET: string;
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

// JWT 验证中间件
export async function authMiddleware(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const authHeader = c.req.header('Authorization');
  console.log('🔐 Auth middleware - URL:', c.req.url, 'Auth header:', authHeader ? 'Present' : 'Missing');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('🔐 No valid auth header');
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const token = authHeader.substring(7);
  
  try {
    // 使用固定的JWT_SECRET进行本地开发
    const jwtSecret = c.env.JWT_SECRET || 'your-super-secret-jwt-key-for-local-development-only-this-should-be-at-least-32-characters-long';
    const payload = await verifyJWT(token, jwtSecret);
    
    if (!payload) {
      console.log('🔐 Invalid token payload');
      return c.json({ message: 'Invalid token' }, 401);
    }

    console.log('🔐 Valid token, user:', payload.sub);
    // 将用户信息添加到上下文
    c.set('user', payload);
    
    await next();
  } catch (error) {
    console.log('🔐 Auth error:', error);
    return c.json({ message: 'Unauthorized' }, 401);
  }
}

// 简化的 JWT 验证函数
async function verifyJWT(token: string, secret: string): Promise<any | null> {
  try {
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) return null;

    // 验证签名
    const data = `${header}.${payload}`;
    const expectedSignature = await hmacSHA256(data, secret);
    
    if (signature !== expectedSignature) return null;

    // 解析 payload
    const decodedPayload = JSON.parse(atob(payload));
    
    // 检查过期时间
    if (decodedPayload.exp && decodedPayload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return decodedPayload;
  } catch (error) {
    return null;
  }
}

// HMAC-SHA256 签名
async function hmacSHA256(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(data)
  );
  
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
} 