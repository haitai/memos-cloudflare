import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import { createDb, users, userSettings, memos, memoReactions } from '../db';
import { hashPassword } from '../routes/auth';

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

const userRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// 获取当前用户信息
userRoutes.get('/me', async (c) => {
  try {
    // 从中间件获取用户信息
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const db = createDb(c.env.DB);

    // 查询完整用户信息
    const user = await db
      .select()
      .from(users)
      .where(eq(users.uid, userPayload.sub))
      .limit(1);

    if (!user.length) {
      return c.json({ message: 'User not found' }, 404);
    }

    const userData = user[0];

    // 查询用户设置
    const settings = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userData.id))
      .limit(1);

    const userSetting = settings[0] || null;

    return c.json({
      id: userData.id,
      name: `users/${userData.id}`,
      uid: userData.uid,
      username: userData.username,
      email: userData.email,
      nickname: userData.nickname,
      avatarUrl: userData.avatarUrl,
      description: userData.description,
      role: userData.role,
      rowStatus: userData.rowStatus,
      createTime: new Date(userData.createdTs * 1000).toISOString(),
      updateTime: new Date(userData.updatedTs * 1000).toISOString(),
      setting: userSetting ? {
        id: userSetting.id,
        name: `user_settings/${userSetting.id}`,
        locale: userSetting.locale,
        appearance: userSetting.appearance,
        memoVisibility: userSetting.memoVisibility,
        createTime: new Date(userSetting.createdTs * 1000).toISOString(),
        updateTime: new Date(userSetting.updatedTs * 1000).toISOString(),
      } : null,
    });
  } catch (error) {
    console.error('Get user info error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 获取用户统计信息
userRoutes.get('/stats', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const db = createDb(c.env.DB);

    // 根据UID查找用户ID
    const userRecord = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.uid, userPayload.sub))
      .limit(1);

    if (!userRecord.length) {
      return c.json({ message: 'User not found' }, 404);
    }

    const userId = userRecord[0].id;

    // 计算30天前的时间戳
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

    // 获取memo数量统计
    const memoStats = await db
      .select({
        total: sql<number>`count(*)`.as('total'),
        public: sql<number>`count(case when visibility = 'PUBLIC' then 1 end)`.as('public'),
        private: sql<number>`count(case when visibility = 'PRIVATE' then 1 end)`.as('private'),
      })
      .from(memos)
      .where(
        and(
          eq(memos.creatorId, userId),
          eq(memos.rowStatus, 'NORMAL')
        )
      );

    // 获取最近30天的memo时间戳
    const memoDisplayTimestamps = await db
      .select({ createdTs: memos.createdTs })
      .from(memos)
      .where(
        and(
          eq(memos.creatorId, userId),
          eq(memos.rowStatus, 'NORMAL'),
          sql`${memos.createdTs} > ${thirtyDaysAgo}`
        )
      )
      .orderBy(desc(memos.createdTs));

    // 获取reaction数量统计
    const reactionStats = await db
      .select({
        total: sql<number>`count(*)`.as('total'),
      })
      .from(memoReactions)
      .where(eq(memoReactions.creatorId, userId));

    const stats = memoStats[0] || { total: 0, public: 0, private: 0 };
    const reactionCount = reactionStats[0]?.total || 0;

    return c.json({
      name: `users/${userId}`,
      memoDisplayTimestamps: memoDisplayTimestamps.map(row => 
        new Date(row.createdTs * 1000).toISOString()
      ),
      memoCount: stats.total,
      publicMemoCount: stats.public,
      privateMemoCount: stats.private,
      reactionCount: reactionCount,
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 获取所有用户统计信息（管理员功能）
userRoutes.get('/stats/all', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload || userPayload.role !== 'HOST') {
      return c.json({ message: 'Forbidden: only admin can access all user stats' }, 403);
    }

    const db = createDb(c.env.DB);

    // 计算30天前的时间戳
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

    // 获取所有用户的统计信息
    const allUserStats = await db
      .select({
        userId: users.id,
        username: users.username,
        nickname: users.nickname,
        memoCount: sql<number>`count(${memos.id})`.as('memoCount'),
        publicMemoCount: sql<number>`count(case when ${memos.visibility} = 'PUBLIC' then 1 end)`.as('publicMemoCount'),
        privateMemoCount: sql<number>`count(case when ${memos.visibility} = 'PRIVATE' then 1 end)`.as('privateMemoCount'),
        reactionCount: sql<number>`count(${memoReactions.id})`.as('reactionCount'),
      })
      .from(users)
      .leftJoin(memos, and(
        eq(memos.creatorId, users.id),
        eq(memos.rowStatus, 'NORMAL')
      ))
      .leftJoin(memoReactions, eq(memoReactions.creatorId, users.id))
      .where(eq(users.rowStatus, 'NORMAL'))
      .groupBy(users.id, users.username, users.nickname);

    // 获取每个用户最近30天的memo时间戳
    const userMemoTimestamps: Record<number, string[]> = {};
    
    for (const userStat of allUserStats) {
      const memoDisplayTimestamps = await db
        .select({ createdTs: memos.createdTs })
        .from(memos)
        .where(
          and(
            eq(memos.creatorId, userStat.userId),
            eq(memos.rowStatus, 'NORMAL'),
            sql`${memos.createdTs} > ${thirtyDaysAgo}`
          )
        )
        .orderBy(desc(memos.createdTs));

      userMemoTimestamps[userStat.userId] = memoDisplayTimestamps.map(row => 
        new Date(row.createdTs * 1000).toISOString()
      );
    }

    const result = allUserStats.map(userStat => ({
      name: `users/${userStat.userId}`,
      username: userStat.username,
      nickname: userStat.nickname,
      memoDisplayTimestamps: userMemoTimestamps[userStat.userId] || [],
      memoCount: userStat.memoCount || 0,
      publicMemoCount: userStat.publicMemoCount || 0,
      privateMemoCount: userStat.privateMemoCount || 0,
      reactionCount: userStat.reactionCount || 0,
    }));

    return c.json(result);
  } catch (error) {
    console.error('Get all user stats error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 更新用户信息
userRoutes.patch('/me', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { nickname, description, email } = body;

    const db = createDb(c.env.DB);

    // 根据UID查找用户ID
    const userRecord = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.uid, userPayload.sub))
      .limit(1);

    if (!userRecord.length) {
      return c.json({ message: 'User not found' }, 404);
    }

    const userId = userRecord[0].id;
    const now = Math.floor(Date.now() / 1000);

    // 更新用户信息
    await db
      .update(users)
      .set({
        nickname: nickname || undefined,
        description: description || undefined,
        email: email || undefined,
        updatedTs: now,
      })
      .where(eq(users.id, userId));

    return c.json({ message: 'User updated successfully' });
  } catch (error) {
    console.error('Update user error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 更新用户密码
userRoutes.patch('/me/password', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { oldPassword, newPassword } = body;

    if (!oldPassword || !newPassword) {
      return c.json({ message: 'Old password and new password are required' }, 400);
    }

    const db = createDb(c.env.DB);

    // 根据UID查找用户
    const userRecord = await db
      .select()
      .from(users)
      .where(eq(users.uid, userPayload.sub))
      .limit(1);

    if (!userRecord.length) {
      return c.json({ message: 'User not found' }, 404);
    }

    const user = userRecord[0];

    // 验证旧密码
    const hashedOldPassword = await hashPassword(oldPassword);
    if (user.passwordHash !== hashedOldPassword) {
      return c.json({ message: 'Invalid old password' }, 400);
    }

    // 更新密码
    const hashedNewPassword = await hashPassword(newPassword);
    const now = Math.floor(Date.now() / 1000);

    await db
      .update(users)
      .set({
        passwordHash: hashedNewPassword,
        updatedTs: now,
      })
      .where(eq(users.id, user.id));

    return c.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Update password error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

export { userRoutes };
