import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { createDb, shortcuts, users } from '../db';

type Env = {
  DB: any; // D1Database
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

const shortcutRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// 获取shortcut列表
shortcutRoutes.get('/', async (c) => {
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

    const shortcutList = await db
      .select()
      .from(shortcuts)
      .where(eq(shortcuts.creatorId, userId))
      .orderBy(desc(shortcuts.createdTs));

    const result = shortcutList.map(shortcut => ({
      id: shortcut.id,
      title: shortcut.title,
      payload: JSON.parse(shortcut.payload),
      createTime: new Date(shortcut.createdTs * 1000).toISOString(),
      updateTime: new Date(shortcut.updatedTs * 1000).toISOString(),
    }));

    return c.json({ shortcuts: result });
  } catch (error) {
    console.error('Get shortcuts error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 创建shortcut
shortcutRoutes.post('/', async (c) => {
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

    const body = await c.req.json();
    const { title, payload } = body;

    if (!title || !payload) {
      return c.json({ message: 'Title and payload are required' }, 400);
    }

    const now = Math.floor(Date.now() / 1000);

    const result = await db
      .insert(shortcuts)
      .values({
        title,
        payload: JSON.stringify(payload),
        creatorId: userId,
        createdTs: now,
        updatedTs: now,
      })
      .returning({ id: shortcuts.id });

    return c.json({
      id: result[0].id,
      title,
      payload,
      createTime: new Date(now * 1000).toISOString(),
      updateTime: new Date(now * 1000).toISOString(),
    });
  } catch (error) {
    console.error('Create shortcut error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 更新shortcut
shortcutRoutes.patch('/:id', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const db = createDb(c.env.DB);

    const shortcutId = parseInt(c.req.param('id'));
    if (isNaN(shortcutId)) {
      return c.json({ message: 'Invalid shortcut ID' }, 400);
    }

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

    // 检查shortcut是否存在且用户有权限
    const shortcut = await db
      .select()
      .from(shortcuts)
      .where(and(eq(shortcuts.id, shortcutId), eq(shortcuts.creatorId, userId)))
      .limit(1);

    if (!shortcut.length) {
      return c.json({ message: 'Shortcut not found or no permission' }, 404);
    }

    const body = await c.req.json();
    const { title, payload } = body;

    const now = Math.floor(Date.now() / 1000);

    const updateData: any = {
      updatedTs: now,
    };

    if (title !== undefined) updateData.title = title;
    if (payload !== undefined) updateData.payload = JSON.stringify(payload);

    await db
      .update(shortcuts)
      .set(updateData)
      .where(eq(shortcuts.id, shortcutId));

    return c.json({ message: 'Shortcut updated successfully' });
  } catch (error) {
    console.error('Update shortcut error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 删除shortcut
shortcutRoutes.delete('/:id', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const db = createDb(c.env.DB);

    const shortcutId = parseInt(c.req.param('id'));
    if (isNaN(shortcutId)) {
      return c.json({ message: 'Invalid shortcut ID' }, 400);
    }

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

    // 检查shortcut是否存在且用户有权限
    const shortcut = await db
      .select()
      .from(shortcuts)
      .where(and(eq(shortcuts.id, shortcutId), eq(shortcuts.creatorId, userId)))
      .limit(1);

    if (!shortcut.length) {
      return c.json({ message: 'Shortcut not found or no permission' }, 404);
    }

    await db
      .delete(shortcuts)
      .where(eq(shortcuts.id, shortcutId));

    return c.json({ message: 'Shortcut deleted successfully' });
  } catch (error) {
    console.error('Delete shortcut error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

export { shortcutRoutes };
