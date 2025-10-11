import { Hono } from 'hono';

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

const shortcutRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// 获取shortcut列表
shortcutRoutes.get('/', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    // 根据UID查找用户ID
    const userRecord = await c.env.DB.prepare(
      'SELECT id FROM user WHERE uid = ?'
    ).bind(userPayload.sub).first();

    if (!userRecord) {
      return c.json({ message: 'User not found' }, 404);
    }

    const userId = userRecord.id;

    const shortcutList = await c.env.DB.prepare(
      'SELECT * FROM shortcut WHERE creator_id = ? ORDER BY created_ts DESC'
    ).bind(userId).all();

    const result = (shortcutList.results || []).map((shortcut: any) => {
      const payload = JSON.parse(shortcut.payload);
      return {
        id: shortcut.id.toString(),
        title: shortcut.title,
        filter: payload.filter || '',
        payload: payload,
        createTime: new Date(shortcut.created_ts * 1000).toISOString(),
        updateTime: new Date(shortcut.updated_ts * 1000).toISOString(),
      };
    });

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

    // 根据UID查找用户ID
    const userRecord = await c.env.DB.prepare(
      'SELECT id FROM user WHERE uid = ?'
    ).bind(userPayload.sub).first();

    if (!userRecord) {
      return c.json({ message: 'User not found' }, 404);
    }

    const userId = userRecord.id;

    const body = await c.req.json();
    const { title, payload } = body;

    if (!title || !payload) {
      return c.json({ message: 'Title and payload are required' }, 400);
    }

    const now = Math.floor(Date.now() / 1000);

    const result = await c.env.DB.prepare(
      'INSERT INTO shortcut (title, payload, creator_id, created_ts, updated_ts) VALUES (?, ?, ?, ?, ?)'
    ).bind(title, JSON.stringify(payload), userId, now, now).run();

    return c.json({
      id: result.meta.last_row_id.toString(),
      title,
      filter: payload.filter || '',
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

    const shortcutId = parseInt(c.req.param('id'));
    if (isNaN(shortcutId)) {
      return c.json({ message: 'Invalid shortcut ID' }, 400);
    }

    // 根据UID查找用户ID
    const userRecord = await c.env.DB.prepare(
      'SELECT id FROM user WHERE uid = ?'
    ).bind(userPayload.sub).first();

    if (!userRecord) {
      return c.json({ message: 'User not found' }, 404);
    }

    const userId = userRecord.id;

    // 检查shortcut是否存在且用户有权限
    const shortcut = await c.env.DB.prepare(
      'SELECT * FROM shortcut WHERE id = ? AND creator_id = ?'
    ).bind(shortcutId, userId).first();

    if (!shortcut) {
      return c.json({ message: 'Shortcut not found or no permission' }, 404);
    }

    const body = await c.req.json();
    const { title, payload } = body;

    const now = Math.floor(Date.now() / 1000);

    const updateData: any = {
      updated_ts: now,
    };

    if (title !== undefined) updateData.title = title;
    if (payload !== undefined) updateData.payload = JSON.stringify(payload);

    const setClause = Object.keys(updateData).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updateData);

    await c.env.DB.prepare(
      `UPDATE shortcut SET ${setClause} WHERE id = ?`
    ).bind(...values, shortcutId).run();

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

    const shortcutId = parseInt(c.req.param('id'));
    if (isNaN(shortcutId)) {
      return c.json({ message: 'Invalid shortcut ID' }, 400);
    }

    // 根据UID查找用户ID
    const userRecord = await c.env.DB.prepare(
      'SELECT id FROM user WHERE uid = ?'
    ).bind(userPayload.sub).first();

    if (!userRecord) {
      return c.json({ message: 'User not found' }, 404);
    }

    const userId = userRecord.id;

    // 检查shortcut是否存在且用户有权限
    const shortcut = await c.env.DB.prepare(
      'SELECT * FROM shortcut WHERE id = ? AND creator_id = ?'
    ).bind(shortcutId, userId).first();

    if (!shortcut) {
      return c.json({ message: 'Shortcut not found or no permission' }, 404);
    }

    await c.env.DB.prepare(
      'DELETE FROM shortcut WHERE id = ?'
    ).bind(shortcutId).run();

    return c.json({ message: 'Shortcut deleted successfully' });
  } catch (error) {
    console.error('Delete shortcut error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

export { shortcutRoutes };
