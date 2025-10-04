import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { updateMemoTags } from '../utils';

type Env = {
  DB: D1Database;
};

interface Variables {
  user: {
    sub: string;
    username: string;
    role: string;
  };
}

const memoRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// 创建笔记
memoRoutes.post('/', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const { content, visibility = 'PRIVATE', resourceIdList = [], resources = [] } = await c.req.json();
    
    if (!content) {
      return c.json({ message: 'Content is required' }, 400);
    }

    const memoUid = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    // 获取用户ID
    const user = await c.env.DB.prepare(
      'SELECT id FROM user WHERE uid = ?'
    ).bind(userPayload.sub).first();

    if (!user) {
      return c.json({ message: 'User not found' }, 404);
    }

    // 创建笔记
    const memoResult = await c.env.DB.prepare(`
      INSERT INTO memo (uid, creator_id, content, visibility, row_status, created_ts, updated_ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(memoUid, user.id, content, visibility, 'NORMAL', now, now).run();

    if (!memoResult.success) {
      throw new Error('Failed to create memo');
    }

    const memoId = memoResult.meta.last_row_id;

    // 处理资源关联 - 支持两种格式
    let finalResourceIdList = resourceIdList;
    
    // 如果传入的是 resources 数组（Resource对象），需要转换为ID
    if (resources.length > 0) {
      console.log('🔄 Converting resources to resource IDs...');
      const resourceIds = [];
      
      for (const resource of resources) {
        // 从资源名称中提取UID，格式：resources/{uid}
        const resourceUid = resource.name?.split('/').pop();
        if (resourceUid) {
          const dbResource = await c.env.DB.prepare(
            'SELECT id FROM resource WHERE uid = ?'
          ).bind(resourceUid).first();
          
          if (dbResource) {
            resourceIds.push(dbResource.id);
            console.log(`✅ Found resource ID ${dbResource.id} for UID ${resourceUid}`);
          } else {
            console.log(`❌ Resource not found for UID ${resourceUid}`);
          }
        }
      }
      
      finalResourceIdList = resourceIds;
      console.log('🔄 Final resource ID list:', finalResourceIdList);
    }

    // 关联资源
    if (finalResourceIdList.length > 0) {
      for (const resourceId of finalResourceIdList) {
        await c.env.DB.prepare(`
          INSERT INTO memo_resource (memo_id, resource_id) VALUES (?, ?)
        `).bind(memoId, resourceId).run();
      }
    }

    // 自动提取并创建标签
    try {
      await updateMemoTags(c.env.DB, memoId as number, user.id as number, content);
    } catch (error) {
      console.error('Failed to update memo tags:', error);
      // 标签创建失败不影响memo创建
    }

    // 获取创建的笔记信息
    const newMemo = await getMemoWithDetails(c.env.DB, memoId);
    
    return c.json(newMemo);

  } catch (error) {
    console.error('Create memo error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 获取笔记列表
memoRoutes.get('/', async (c) => {
  try {
    const url = new URL(c.req.url);
    const rowStatus = url.searchParams.get('rowStatus') || 'NORMAL';
    const creatorId = url.searchParams.get('creatorId');
    const tag = url.searchParams.get('tag');
    const visibility = url.searchParams.get('visibility');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
	const oldFilter = url.searchParams.get('oldFilter'); // 例如：content_search == ["hello"] && tag_search == ["tag1"]

    let whereClause = 'WHERE m.row_status = ?';
    const params = [rowStatus];

    if (creatorId) {
      whereClause += ' AND m.creator_id = ?';
      params.push(creatorId);
    }
	// 处理内容搜索
	if (oldFilter) {
	  // 匹配 content_search == ["xxx"]
	  const contentSearchMatch = oldFilter.match(/content_search == \[([^\]]+)\]/);
	  if (contentSearchMatch) {
		// 提取内容关键词数组
		const words = JSON.parse(`[${contentSearchMatch[1]}]`);
		words.forEach((word: string) => {
		  whereClause += ' AND m.content LIKE ?';
		  params.push(`%${word}%`);
		});
	  }
	  // 你可以在这里继续处理 tag_search、其他条件
	  const tag_search = oldFilter.match(/tag_search == \[([^\]]+)\]/);
	  if (tag_search) {
		// 提取内容关键词数组
		const tags = JSON.parse(`[${tag_search[1]}]`);
		tags.forEach((tag: string) => {
			whereClause += ` AND EXISTS (
			SELECT 1 FROM memo_tag mt 
			JOIN tag t ON mt.tag_id = t.id 
			WHERE mt.memo_id = m.id AND t.name = ?
		)`;
		  params.push(`%${tag}%`);
		});
	  }
	}
    if (visibility) {
      whereClause += ' AND m.visibility = ?';
      params.push(visibility);
    } else {
      // 默认只显示公开的笔记，除非指定了 creatorId
      if (!creatorId) {
        whereClause += ' AND m.visibility = ?';
        params.push('PUBLIC');
      }
    }

    if (tag) {
      whereClause += ` AND EXISTS (
        SELECT 1 FROM memo_tag mt 
        JOIN tag t ON mt.tag_id = t.id 
        WHERE mt.memo_id = m.id AND t.name = ?
      )`;
      params.push(tag);
    }

    params.push(limit.toString(), offset.toString());

    const memos = await c.env.DB.prepare(`
      SELECT m.*, u.username as creator_username
      FROM memo m
      JOIN user u ON m.creator_id = u.id
      ${whereClause}
      ORDER BY m.created_ts DESC
      LIMIT ? OFFSET ?
    `).bind(...params).all();

    // 为每个笔记获取详细信息
    const memosWithDetails = [];
    for (const memo of memos.results || []) {
      const memoWithDetails = await getMemoWithDetails(c.env.DB, memo.id as number);
      memosWithDetails.push(memoWithDetails);
    }

    return c.json(memosWithDetails);

  } catch (error) {
    console.error('Get memos error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 获取单个笔记
memoRoutes.get('/:id', async (c) => {
  try {
    const memoId = parseInt(c.req.param('id'));
    
    const memo = await c.env.DB.prepare(
      'SELECT m.*, u.username as creator_username FROM memo m JOIN user u ON m.creator_id = u.id WHERE m.id = ?'
    ).bind(memoId).first();

    if (!memo) {
      return c.json({ message: 'Memo not found' }, 404);
    }

    // 检查访问权限
    if (memo.visibility === 'PRIVATE') {
      const userPayload = c.get('user');
      if (!userPayload || memo.creator_id !== (await getUserIdFromUid(c.env.DB, userPayload.sub))) {
        return c.json({ message: 'Forbidden' }, 403);
      }
    }

    const memoWithDetails = await getMemoWithDetails(c.env.DB, memoId);
    
    return c.json(memoWithDetails);

  } catch (error) {
    console.error('Get memo error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 更新笔记
memoRoutes.patch('/:id', async (c) => {
  try {
    const memoId = parseInt(c.req.param('id'));
    const userPayload = c.get('user');
    
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const memo = await c.env.DB.prepare(
      'SELECT * FROM memo WHERE id = ?'
    ).bind(memoId).first();

    if (!memo) {
      return c.json({ message: 'Memo not found' }, 404);
    }

    const userId = await getUserIdFromUid(c.env.DB, userPayload.sub);
    if (memo.creator_id !== userId && userPayload.role !== 'HOST') {
      return c.json({ message: 'Forbidden' }, 403);
    }

    const { content, visibility, state, resourceIdList, resources = [] } = await c.req.json();
    const now = Math.floor(Date.now() / 1000);
	// 新增：将 state 转为 rowStatus
	let rowStatus;
	if (state !== undefined) {
	  if (state === 'ARCHIVED') {
		rowStatus = 'ARCHIVED';
	  } else if (state === 'NORMAL') {
		rowStatus = 'NORMAL';
	  }
	}
    // 构建更新字段
    const updates = [];
    const values = [];
    
    if (content !== undefined) {
      updates.push('content = ?');
      values.push(content);
    }
    
    if (visibility !== undefined) {
      updates.push('visibility = ?');
      values.push(visibility);
    }
    // 支持归档
    if (rowStatus !== undefined) {
      updates.push('row_status = ?');
      values.push(rowStatus);
    }
    updates.push('updated_ts = ?');
    values.push(now);
    values.push(memoId);

    if (updates.length > 1) {
      await c.env.DB.prepare(`
        UPDATE memo SET ${updates.join(', ')} WHERE id = ?
      `).bind(...values).run();
    }

    // 处理资源关联更新 - 支持两种格式
    let finalResourceIdList = resourceIdList;
    
    // 如果传入的是 resources 数组（Resource对象），需要转换为ID
    if (resources.length > 0) {
      console.log('🔄 Converting resources to resource IDs for update...');
      const resourceIds = [];
      
      for (const resource of resources) {
        // 从资源名称中提取UID，格式：resources/{uid}
        const resourceUid = resource.name?.split('/').pop();
        if (resourceUid) {
          const dbResource = await c.env.DB.prepare(
            'SELECT id FROM resource WHERE uid = ?'
          ).bind(resourceUid).first();
          
          if (dbResource) {
            resourceIds.push(dbResource.id);
            console.log(`✅ Found resource ID ${dbResource.id} for UID ${resourceUid}`);
          } else {
            console.log(`❌ Resource not found for UID ${resourceUid}`);
          }
        }
      }
      
      finalResourceIdList = resourceIds;
      console.log('🔄 Final resource ID list for update:', finalResourceIdList);
    }

    // 更新资源关联
    if (finalResourceIdList !== undefined) {
      // 删除现有关联
      await c.env.DB.prepare(
        'DELETE FROM memo_resource WHERE memo_id = ?'
      ).bind(memoId).run();

      // 添加新关联
      if (finalResourceIdList.length > 0) {
        for (const resourceId of finalResourceIdList) {
          await c.env.DB.prepare(`
            INSERT INTO memo_resource (memo_id, resource_id) VALUES (?, ?)
          `).bind(memoId, resourceId).run();
        }
      }
    }

    // 如果内容更新了，重新提取标签
    if (content !== undefined && userId) {
      try {
        await updateMemoTags(c.env.DB, memoId, userId, content);
      } catch (error) {
        console.error('Failed to update memo tags:', error);
        // 标签更新失败不影响memo更新
      }
    }

    const updatedMemo = await getMemoWithDetails(c.env.DB, memoId);
    
    return c.json(updatedMemo);

  } catch (error) {
    console.error('Update memo error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 删除笔记
memoRoutes.delete('/:id', async (c) => {
  try {
    const memoId = parseInt(c.req.param('id'));
    const userPayload = c.get('user');
    
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const memo = await c.env.DB.prepare(
      'SELECT * FROM memo WHERE id = ?'
    ).bind(memoId).first();

    if (!memo) {
      return c.json({ message: 'Memo not found' }, 404);
    }

    const userId = await getUserIdFromUid(c.env.DB, userPayload.sub);
    if (memo.creator_id !== userId && userPayload.role !== 'HOST') {
      return c.json({ message: 'Forbidden' }, 403);
    }

    // 逻辑删除
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(`
      UPDATE memo SET row_status = ?, updated_ts = ? WHERE id = ?
    `).bind('ARCHIVED', now, memoId).run();

    return c.json({ message: 'Memo deleted successfully' });

  } catch (error) {
    console.error('Delete memo error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 获取笔记统计
memoRoutes.get('/stats', async (c) => {
  try {
    // 总数统计
    const totalResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM memo WHERE row_status = ? AND visibility = ?'
    ).bind('NORMAL', 'PUBLIC').first();

    // 每日统计（最近30天）
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
    
    const dailyStats = await c.env.DB.prepare(`
      SELECT 
        DATE(created_ts, 'unixepoch') as date,
        COUNT(*) as count
      FROM memo 
      WHERE row_status = ? 
        AND visibility = ? 
        AND created_ts > ?
      GROUP BY DATE(created_ts, 'unixepoch')
      ORDER BY date DESC
    `).bind('NORMAL', 'PUBLIC', thirtyDaysAgo).all();

    const dailyHistogram = (dailyStats.results || []).map((row: any) => ({
      ts: Math.floor(new Date(row.date).getTime() / 1000),
      count: row.count
    }));

    return c.json({
      total: totalResult?.total || 0,
      dailyHistogram
    });

  } catch (error) {
    console.error('Get memo stats error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 辅助函数：获取笔记详细信息（包括资源和标签）
async function getMemoWithDetails(db: any, memoId: number) {
  const memo = await db.prepare(
    'SELECT m.*, u.username as creator_username FROM memo m JOIN user u ON m.creator_id = u.id WHERE m.id = ?'
  ).bind(memoId).first();

  if (!memo) return null;

  // 获取关联的资源详细信息
  const resources = await db.prepare(`
    SELECT r.id, r.uid, r.filename, r.type, r.size, r.external_link, r.created_ts
    FROM resource r
    JOIN memo_resource mr ON r.id = mr.resource_id 
    WHERE mr.memo_id = ?
  `).bind(memoId).all();

  const resourceIdList = (resources.results || []).map((r: any) => r.id);
  
  // 转换为前端期望的资源格式
  const resourceList = (resources.results || []).map((r: any) => ({
    name: `resources/${r.uid}`,
    uid: r.uid,
    createTime: new Date(r.created_ts * 1000).toISOString(),
    filename: r.filename,
    content: new Uint8Array(), // 空数组
    externalLink: '', // 空字符串，让前端构建正确的URL
    type: r.type,
    size: r.size,
    memo: `memos/${memo.id}`, // 关联的memo
  }));

  // 获取标签
  const tags = await db.prepare(`
    SELECT t.name FROM tag t 
    JOIN memo_tag mt ON t.id = mt.tag_id 
    WHERE mt.memo_id = ?
  `).bind(memoId).all();

  const tagList = (tags.results || []).map((t: any) => t.name);

  return {
    id: memo.id,
    uid: memo.uid,
    creatorId: memo.creator_id,
    content: memo.content,
    visibility: memo.visibility,
    rowStatus: memo.row_status,
    createdTs: memo.created_ts,
    updatedTs: memo.updated_ts,
    resourceIdList, // 保留向后兼容
    resources: resourceList, // 新增：完整的资源对象数组
    tags: tagList
  };
}

// 辅助函数：通过 UID 获取用户 ID
async function getUserIdFromUid(db: any, uid: string): Promise<number | null> {
  const user = await db.prepare('SELECT id FROM user WHERE uid = ?').bind(uid).first();
  return user ? user.id : null;
}

export { memoRoutes }; 