import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env } from '../types';

const authRoutes = new Hono<{ Bindings: Env }>();

// 登录接口
authRoutes.post('/signin', async (c) => {
  try {
    const { username, password } = await c.req.json();
    
    if (!username || !password) {
      return c.json({ message: 'USERNAME_AND_PASSWORD_REQUIRED' }, 400);
    }

    // 查询用户
    const user = await c.env.DB.prepare(
      'SELECT * FROM user WHERE username = ? AND row_status = ?'
    ).bind(username, 'NORMAL').first();

    if (!user) {
      return c.json({ message: 'INVALID_CREDENTIALS' }, 401);
    }

    // 验证密码
    const isPasswordValid = await verifyPassword(password, user.password_hash as string);
    if (!isPasswordValid) {
      return c.json({ message: 'INVALID_CREDENTIALS' }, 401);
    }

    // 生成 JWT token
    const now = Math.floor(Date.now() / 1000);
    const tokenPayload = {
      sub: user.uid,
      username: user.username,
      role: user.role,
      iat: now,
      exp: now + 7 * 24 * 60 * 60 // 7 days
    };

    console.log('JWT_SECRET length:', c.env.JWT_SECRET?.length || 0);
    // 使用固定的JWT_SECRET进行本地开发
    const jwtSecret = c.env.JWT_SECRET || 'your-super-secret-jwt-key-for-local-development-only-this-should-be-at-least-32-characters-long';
    const accessToken = await signJWT(tokenPayload, jwtSecret);

    // 返回用户信息（不包括密码哈希）
    const userResponse = {
      id: user.id,
      uid: user.uid,
      username: user.username,
      role: user.role,
      email: user.email,
      avatarUrl: user.avatar_url,
      createdTs: user.created_ts,
      updatedTs: user.updated_ts
    };

    return c.json({
      accessToken,
      user: userResponse
    });

  } catch (error) {
    console.error('Sign in error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 注册接口（仅限首次安装时创建 HOST 账户）
authRoutes.post('/signup', async (c) => {
  try {
    const { username, password, email } = await c.req.json();
    
    if (!username || !password) {
      return c.json({ message: 'USERNAME_AND_PASSWORD_REQUIRED' }, 400);
    }

    // 检查是否已有用户存在（首次安装检查）
    const existingUser = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM user WHERE row_status = ?'
    ).bind('NORMAL').first();

    if (existingUser && (existingUser.count as number) > 0) {
      return c.json({ message: 'SIGNUP_DISABLED' }, 403);
    }

    // 检查用户名是否已存在
    const existingUsername = await c.env.DB.prepare(
      'SELECT id FROM user WHERE username = ?'
    ).bind(username).first();

    if (existingUsername) {
      return c.json({ message: 'USERNAME_ALREADY_EXISTS' }, 409);
    }

    // 生成用户 UID 和密码哈希
    const userUid = uuidv4();
    const passwordHash = await hashPassword(password);
    const now = Math.floor(Date.now() / 1000);

    // 创建 HOST 用户
    const result = await c.env.DB.prepare(`
      INSERT INTO user (uid, username, role, email, password_hash, row_status, created_ts, updated_ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(userUid, username, 'HOST', email || null, passwordHash, 'NORMAL', now, now).run();

    if (!result.success) {
      throw new Error('Failed to create user');
    }

    // 获取创建的用户信息
    const newUser = await c.env.DB.prepare(
      'SELECT * FROM user WHERE uid = ?'
    ).bind(userUid).first();

    if (!newUser) {
      throw new Error('Failed to retrieve created user');
    }

    // 生成 JWT token
    const tokenPayload = {
      sub: userUid,
      username: username,
      role: 'HOST',
      iat: now,
      exp: now + 7 * 24 * 60 * 60 // 7 days
    };

    console.log('JWT_SECRET length:', c.env.JWT_SECRET?.length || 0);
    const accessToken = await signJWT(tokenPayload, c.env.JWT_SECRET);

    // 返回用户信息
    const userResponse = {
      id: newUser.id,
      uid: newUser.uid,
      username: newUser.username,
      role: newUser.role,
      email: newUser.email,
      avatarUrl: newUser.avatar_url,
      createdTs: newUser.created_ts,
      updatedTs: newUser.updated_ts
    };

    return c.json({
      accessToken,
      user: userResponse
    });

  } catch (error) {
    console.error('Sign up error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 密码哈希函数
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 密码验证函数
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const hashedPassword = await hashPassword(password);
  return hashedPassword === hash;
}

// JWT 签名函数
async function signJWT(payload: any, secret: string): Promise<string> {
  if (!secret || secret.length === 0) {
    throw new Error('JWT_SECRET is empty or undefined');
  }
  
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const encodedHeader = btoa(JSON.stringify(header))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = await hmacSHA256(data, secret);
  
  return `${data}.${signature}`;
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

export { authRoutes }; 