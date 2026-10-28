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

    const { content, visibility = 'PRIVATE', resourceIdList = [], resources = [], relations = [], location } = await c.req.json();
    
    // 允许只有资源而没有文本内容的memo
    if (!content && (!resources || resources.length === 0) && (!resourceIdList || resourceIdList.length === 0)) {
      return c.json({ message: 'Content or resources are required' }, 400);
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
      INSERT INTO memo (uid, creator_id, content, visibility, row_status, location_placeholder, location_latitude, location_longitude, created_ts, updated_ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      memoUid, 
      user.id, 
      content, 
      visibility, 
      'NORMAL', 
      location?.placeholder || null,
      location?.latitude || null,
      location?.longitude || null,
      now, 
      now
    ).run();

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

    // 处理memo关系
    if (relations.length > 0) {
      console.log('🔗 Processing memo relations...', JSON.stringify(relations, null, 2));
      for (const relation of relations) {
        try {
          // 从relatedMemo.name中提取memo ID，格式：memos/{id}
          const relatedMemoName = relation.relatedMemo?.name;
          console.log(`🔗 Processing relation with relatedMemo: ${relatedMemoName}`);
          
          if (relatedMemoName && relatedMemoName.startsWith('memos/')) {
            const relatedMemoId = parseInt(relatedMemoName.replace('memos/', ''));
            if (!isNaN(relatedMemoId)) {
              // 检查被引用的memo是否存在
              const relatedMemo = await c.env.DB.prepare(
                'SELECT id FROM memo WHERE id = ? AND row_status = ?'
              ).bind(relatedMemoId, 'NORMAL').first();
              
              if (relatedMemo) {
                await c.env.DB.prepare(`
                  INSERT INTO memo_relation (memo_id, related_memo_id, type, created_ts)
                  VALUES (?, ?, ?, ?)
                `).bind(memoId, relatedMemoId, relation.type || 'REFERENCE', now).run();
                console.log(`✅ Created relation: memo ${memoId} -> memo ${relatedMemoId} (${relation.type || 'REFERENCE'})`);
              } else {
                console.log(`❌ Related memo not found: ${relatedMemoId}`);
              }
            } else {
              console.log(`❌ Invalid related memo ID: ${relatedMemoName}`);
            }
          } else {
            console.log(`❌ Invalid related memo name format: ${relatedMemoName}`);
          }
        } catch (relationError) {
          console.error('❌ Error creating memo relation:', relationError);
          // 继续处理其他关系，即使某个关系创建失败
        }
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
    const parent = url.searchParams.get('parent'); // 处理parent参数，格式如 "users/1"
    const tag = url.searchParams.get('tag');
    const visibility = url.searchParams.get('visibility');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
	const filter = url.searchParams.get('filter'); // 新的filter参数
	const oldFilter = url.searchParams.get('oldFilter'); // 例如：content_search == ["hello"] && tag_search == ["tag1"]

    let whereClause = 'WHERE m.row_status = ? AND m.id NOT IN (SELECT memo_id FROM memo_relation WHERE type = ?)';
    const params = [rowStatus, 'COMMENT'];

    if (creatorId) {
      whereClause += ' AND m.creator_id = ?';
      params.push(creatorId);
    }
    
    // 处理parent参数，格式如 "users/1"
    if (parent && parent.startsWith('users/')) {
      const parentUserId = parent.replace('users/', '');
      whereClause += ' AND m.creator_id = ?';
      params.push(parentUserId);
    }
	// 处理筛选条件 - 同时处理filter和oldFilter参数
	const processFilter = (filterString: string) => {
	  if (!filterString) return;
	  
	  console.log('🔍 Backend - Processing filter:', filterString);
	  // 匹配 content_search == ["xxx"]
	  const contentSearchMatch = filterString.match(/content_search == \[([^\]]+)\]/);
	  if (contentSearchMatch) {
		// 提取内容关键词数组
		const words = JSON.parse(`[${contentSearchMatch[1]}]`);
		console.log('🔍 Backend - Content search words:', words);
		words.forEach((word: string) => {
		  whereClause += ' AND m.content LIKE ?';
		  params.push(`%${word}%`);
		});
	  }
	  // 处理标签搜索
	  const tag_search = filterString.match(/tag_search == \[([^\]]+)\]/);
	  if (tag_search) {
		// 提取标签名称数组
		const tags = JSON.parse(`[${tag_search[1]}]`);
		console.log('🏷️ Backend - Processing tag search:', tags);
		tags.forEach((tag: string) => {
			// 移除引号，因为JSON.parse会保留引号
			const cleanTag = tag.replace(/"/g, '');
			console.log('🏷️ Backend - Searching for tag:', cleanTag);
			whereClause += ` AND EXISTS (
			SELECT 1 FROM memo_tag mt 
			JOIN tag t ON mt.tag_id = t.id 
			WHERE mt.memo_id = m.id AND t.name = ?
		)`;
		  params.push(cleanTag);
		});
	  }
	  // 处理属性筛选器
	  const hasTaskListMatch = filterString.match(/has_task_list == true/);
	  if (hasTaskListMatch) {
		console.log('📋 Backend - Processing hasTaskList filter');
		whereClause += ` AND m.content LIKE '%- [%]%'`;
	  }
	  
	  const hasLinkMatch = filterString.match(/has_link == true/);
	  if (hasLinkMatch) {
		console.log('🔗 Backend - Processing hasLink filter');
		whereClause += ` AND m.content LIKE '%http%'`;
	  }
	  
	  const hasCodeMatch = filterString.match(/has_code == true/);
	  if (hasCodeMatch) {
		console.log('💻 Backend - Processing hasCode filter');
		whereClause += " AND (m.content LIKE '%```%' OR m.content LIKE '%`%')";
	  }
	  
	  // 处理置顶筛选器
	  const pinnedMatch = filterString.match(/pinned == true/);
	  if (pinnedMatch) {
		console.log('📌 Backend - Processing pinned filter');
		whereClause += ' AND m.pinned = 1';
	  }
	  
	  // 处理displayTime时间范围筛选器
	  const displayTimeAfterMatch = filterString.match(/display_time_after == (\d+)/);
	  const displayTimeBeforeMatch = filterString.match(/display_time_before == (\d+)/);
	  if (displayTimeAfterMatch) {
		const timestamp = parseInt(displayTimeAfterMatch[1]);
		console.log('📅 Backend - Processing displayTimeAfter filter:', timestamp);
		whereClause += ' AND m.created_ts >= ?';
		params.push(timestamp);
	  }
	  if (displayTimeBeforeMatch) {
		const timestamp = parseInt(displayTimeBeforeMatch[1]);
		console.log('📅 Backend - Processing displayTimeBefore filter:', timestamp);
		whereClause += ' AND m.created_ts < ?';
		params.push(timestamp);
	  }
	};
	
	// 调用筛选处理函数
	processFilter(filter);
	processFilter(oldFilter);
	
    if (visibility) {
      whereClause += ' AND m.visibility = ?';
      params.push(visibility);
    } else {
      // 默认只显示公开的笔记，除非指定了 creatorId 或 parent
      if (!creatorId && !parent) {
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

    // 一次性批量补齐所有关联数据，避免逐条查询的 N+1 问题
    // 之前：1 + N*6 次 D1 往返（N=16 时约 97 次）
    // 现在：1 + 5 次 D1 往返，与页数无关
    const memosWithDetails = await attachDetailsToMemoRows(c.env.DB, memos.results || []);

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
      // 对于GET请求，我们需要手动检查认证
      const authHeader = c.req.header('Authorization');
      let userPayload = null;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
          const jwtSecret = c.env.JWT_SECRET || 'your-super-secret-jwt-key-for-local-development-only-this-should-be-at-least-32-characters-long';
          userPayload = await verifyJWT(token, jwtSecret);
        } catch (error) {
          console.log('🔐 JWT verification failed:', error);
        }
      }
      
      console.log('🔐 Memo access check - memoId:', memoId, 'userPayload:', userPayload);
      if (!userPayload) {
        console.log('🔐 No user payload found');
        return c.json({ message: 'Unauthorized' }, 401);
      }
      
      const userId = await getUserIdFromUid(c.env.DB, userPayload.sub);
      console.log('🔐 User ID from UID:', userId, 'memo creator ID:', memo.creator_id);
      if (!userId) {
        console.log('🔐 User not found in database');
        return c.json({ message: 'User not found' }, 401);
      }
      
      // 如果用户是memo的创建者，直接允许访问
      if (memo.creator_id === userId) {
        // 允许访问
      } else {
        // 检查是否是评论memo，如果是，则检查父memo的访问权限
        const commentRelation = await c.env.DB.prepare(
          'SELECT related_memo_id FROM memo_relation WHERE memo_id = ? AND type = ?'
        ).bind(memoId, 'COMMENT').first();
        
        if (commentRelation) {
          // 这是评论memo，检查父memo的访问权限
          const parentMemo = await c.env.DB.prepare(
            'SELECT creator_id, visibility FROM memo WHERE id = ?'
          ).bind(commentRelation.related_memo_id).first();
          
          if (!parentMemo) {
            return c.json({ message: 'Parent memo not found' }, 404);
          }
          
          // 如果父memo是公开的，或者用户是父memo的创建者，则允许访问
          if (parentMemo.visibility !== 'PUBLIC' && parentMemo.creator_id !== userId) {
            return c.json({ message: 'Forbidden' }, 403);
          }
        } else {
          // 不是评论memo，按正常逻辑处理
          return c.json({ message: 'Forbidden' }, 403);
        }
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

    const { content, visibility, state, pinned, resourceIdList, resources = [], relations, location } = await c.req.json();
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
    
    if (pinned !== undefined) {
      updates.push('pinned = ?');
      values.push(pinned ? 1 : 0);
    }
    
    // 处理location数据
    if (location !== undefined) {
      updates.push('location_placeholder = ?');
      values.push(location?.placeholder || null);
      updates.push('location_latitude = ?');
      values.push(location?.latitude || null);
      updates.push('location_longitude = ?');
      values.push(location?.longitude || null);
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

    // 处理memo关系更新
    if (relations !== undefined) {
      console.log('🔗 Updating memo relations...', JSON.stringify(relations, null, 2));
      // 删除现有关联
      await c.env.DB.prepare(
        'DELETE FROM memo_relation WHERE memo_id = ?'
      ).bind(memoId).run();

      // 添加新关联
      if (relations.length > 0) {
        for (const relation of relations) {
          try {
            // 从relatedMemo.name中提取memo ID，格式：memos/{id}
            const relatedMemoName = relation.relatedMemo?.name;
            console.log(`🔗 Updating relation with relatedMemo: ${relatedMemoName}`);
            
            if (relatedMemoName && relatedMemoName.startsWith('memos/')) {
              const relatedMemoId = parseInt(relatedMemoName.replace('memos/', ''));
              if (!isNaN(relatedMemoId)) {
                // 检查被引用的memo是否存在
                const relatedMemo = await c.env.DB.prepare(
                  'SELECT id FROM memo WHERE id = ? AND row_status = ?'
                ).bind(relatedMemoId, 'NORMAL').first();
                
                if (relatedMemo) {
                  await c.env.DB.prepare(`
                    INSERT INTO memo_relation (memo_id, related_memo_id, type, created_ts)
                    VALUES (?, ?, ?, ?)
                  `).bind(memoId, relatedMemoId, relation.type || 'REFERENCE', now).run();
                  console.log(`✅ Updated relation: memo ${memoId} -> memo ${relatedMemoId} (${relation.type || 'REFERENCE'})`);
                } else {
                  console.log(`❌ Related memo not found: ${relatedMemoId}`);
                }
              } else {
                console.log(`❌ Invalid related memo ID: ${relatedMemoName}`);
              }
            } else {
              console.log(`❌ Invalid related memo name format: ${relatedMemoName}`);
            }
          } catch (relationError) {
            console.error('❌ Error updating memo relation:', relationError);
            // 继续处理其他关系，即使某个关系更新失败
          }
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

  const [row] = await attachDetailsToMemoRows(db, [memo]);
  return row ?? null;
}

/**
 * 批量为一批 memo 行补齐资源 / 标签 / 关系 / reaction。
 *
 * 关键优化：所有关联数据通过 5 条 `IN (...)` 查询一次性取回（用 D1 batch 并发发出），
 * 而不是对每条 memo 各发 6 条查询。这样列表接口的 D1 往返次数从 1+N*6 降到固定 ~6 次。
 * D1 每次往返即使是跨机房调用也有几十毫秒延迟，这是列表加载慢的主要来源。
 */
async function attachDetailsToMemoRows(db: any, memoRows: any[]) {
  if (memoRows.length === 0) return [];

  const ids = memoRows.map((m: any) => m.id as number);
  const inClause = ids.map(() => '?').join(',');

  const [resourceRes, tagRes, outgoingRes, incomingRes, reactionRes] = await db.batch([
    db.prepare(`
      SELECT mr.memo_id, r.id, r.uid, r.filename, r.type, r.size, r.external_link, r.created_ts
      FROM memo_resource mr
      JOIN resource r ON r.id = mr.resource_id
      WHERE mr.memo_id IN (${inClause})
    `).bind(...ids),

    db.prepare(`
      SELECT mt.memo_id, t.name
      FROM memo_tag mt
      JOIN tag t ON t.id = mt.tag_id
      WHERE mt.memo_id IN (${inClause})
    `).bind(...ids),

    db.prepare(`
      SELECT mr.memo_id, mr.type, mr.related_memo_id, m.uid as related_memo_uid, m.content as related_memo_content
      FROM memo_relation mr
      JOIN memo m ON mr.related_memo_id = m.id
      WHERE mr.memo_id IN (${inClause})
    `).bind(...ids),

    db.prepare(`
      SELECT mr.related_memo_id as anchor_memo_id, mr.type, mr.memo_id, m.uid as memo_uid, m.content as memo_content
      FROM memo_relation mr
      JOIN memo m ON mr.memo_id = m.id
      WHERE mr.related_memo_id IN (${inClause})
    `).bind(...ids),

    db.prepare(`
      SELECT mr.memo_id, mr.id, mr.reaction_type, mr.creator_id, mr.created_ts, u.username as creator_username
      FROM memo_reaction mr
      JOIN user u ON mr.creator_id = u.id
      WHERE mr.memo_id IN (${inClause})
      ORDER BY mr.created_ts ASC
    `).bind(...ids),
  ]);

  // 按 memo 归集结果，避免 O(N*M) 的查找
  const groupBy = <T,>(rows: T[] | undefined, keyOf: (row: T) => number) => {
    const map = new Map<number, T[]>();
    for (const row of rows || []) {
      const key = keyOf(row);
      const bucket = map.get(key);
      if (bucket) bucket.push(row);
      else map.set(key, [row]);
    }
    return map;
  };

  const resourcesByMemo = groupBy(resourceRes.results as any[], (r) => r.memo_id);
  const tagsByMemo = groupBy(tagRes.results as any[], (r) => r.memo_id);
  const outgoingByMemo = groupBy(outgoingRes.results as any[], (r) => r.memo_id);
  const incomingByMemo = groupBy(incomingRes.results as any[], (r) => r.anchor_memo_id);
  const reactionsByMemo = groupBy(reactionRes.results as any[], (r) => r.memo_id);

  return memoRows.map((memo: any) => {
    const memoId = memo.id as number;

    const resources = resourcesByMemo.get(memoId) || [];
    const outgoing = outgoingByMemo.get(memoId) || [];
    const incoming = incomingByMemo.get(memoId) || [];
    const reactions = reactionsByMemo.get(memoId) || [];

    const resourceList = resources.map((r: any) => ({
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

    const outgoingRelations = outgoing.map((r: any) => ({
      memo: { name: `memos/${memoId}`, uid: memo.uid, id: memoId },
      relatedMemo: {
        name: `memos/${r.related_memo_id}`,
        uid: r.related_memo_uid,
        id: r.related_memo_id,
        snippet: r.related_memo_content ? r.related_memo_content.slice(0, 100) : '',
      },
      type: r.type,
    }));

    const incomingRelations = incoming.map((r: any) => ({
      memo: {
        name: `memos/${r.memo_id}`,
        uid: r.memo_uid,
        id: r.memo_id,
        snippet: r.memo_content ? r.memo_content.slice(0, 100) : '',
      },
      relatedMemo: { name: `memos/${memoId}`, uid: memo.uid, id: memoId },
      type: r.type,
    }));

    const reactionList = reactions.map((r: any) => ({
      id: r.id,
      reactionType: r.reaction_type,
      creator: `users/${r.creator_id}`,
      contentId: `memos/${memoId}`,
      createdTs: r.created_ts,
    }));

    return {
      id: memo.id,
      uid: memo.uid,
      creatorId: memo.creator_id,
      content: memo.content,
      visibility: memo.visibility,
      rowStatus: memo.row_status,
      pinned: Boolean(memo.pinned),
      createdTs: memo.created_ts,
      updatedTs: memo.updated_ts,
      resourceIdList: resources.map((r: any) => r.id), // 保留向后兼容
      resources: resourceList,
      tags: (tagsByMemo.get(memoId) || []).map((t: any) => t.name),
      relations: [...outgoingRelations, ...incomingRelations],
      reactions: reactionList,
      snippet: memo.content ? memo.content.slice(0, 100) : '',
      location: memo.location_placeholder || memo.location_latitude || memo.location_longitude ? {
        placeholder: memo.location_placeholder || '',
        latitude: memo.location_latitude || 0,
        longitude: memo.location_longitude || 0,
      } : undefined,
    };
  });
}

// 创建memo评论
memoRoutes.post('/:id/comment', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const memoId = parseInt(c.req.param('id'));
    if (isNaN(memoId)) {
      return c.json({ message: 'Invalid memo ID' }, 400);
    }

    const { content, visibility = 'PRIVATE' } = await c.req.json();
    
    if (!content) {
      return c.json({ message: 'Content is required' }, 400);
    }

    // 检查父memo是否存在
    const parentMemo = await c.env.DB.prepare(
      'SELECT id FROM memo WHERE id = ? AND row_status = ?'
    ).bind(memoId, 'NORMAL').first();

    if (!parentMemo) {
      return c.json({ message: 'Parent memo not found' }, 404);
    }

    // 获取用户ID
    const user = await c.env.DB.prepare(
      'SELECT id FROM user WHERE uid = ?'
    ).bind(userPayload.sub).first();

    if (!user) {
      return c.json({ message: 'User not found' }, 404);
    }

    const commentUid = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    // 创建评论memo
    const commentResult = await c.env.DB.prepare(`
      INSERT INTO memo (uid, creator_id, content, visibility, row_status, created_ts, updated_ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(commentUid, user.id, content, visibility, 'NORMAL', now, now).run();

    const commentId = commentResult.meta.last_row_id;
    console.log('💬 Created comment with ID:', commentId);

    // 创建memo关系（评论关系）
    try {
      await c.env.DB.prepare(`
        INSERT INTO memo_relation (memo_id, related_memo_id, type, created_ts)
        VALUES (?, ?, ?, ?)
      `).bind(commentId, memoId, 'COMMENT', now).run();
      console.log('💬 Created memo relation successfully');
    } catch (relationError) {
      console.error('💬 Error creating memo relation:', relationError);
      // 继续执行，即使关系创建失败
    }

    // 返回创建的评论
    console.log('💬 Returning comment data...');
    return c.json({
      id: commentId,
      uid: commentUid,
      creatorId: user.id,
      content: content,
      visibility: visibility,
      rowStatus: 'NORMAL',
      pinned: false,
      createdTs: now,
      updatedTs: now,
      resourceIdList: [],
      resources: [],
      tags: [],
      relations: []
    });

  } catch (error) {
    console.error('Create memo comment error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 添加或更新memo reaction
memoRoutes.post('/:id/reaction', async (c) => {
  try {
    const memoId = parseInt(c.req.param('id'));
    const userPayload = c.get('user');
    
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    if (isNaN(memoId)) {
      return c.json({ message: 'Invalid memo ID' }, 400);
    }

    const { reactionType } = await c.req.json();
    
    if (!reactionType) {
      return c.json({ message: 'Reaction type is required' }, 400);
    }

    // 检查memo是否存在
    const memo = await c.env.DB.prepare(
      'SELECT id FROM memo WHERE id = ? AND row_status = ?'
    ).bind(memoId, 'NORMAL').first();

    if (!memo) {
      return c.json({ message: 'Memo not found' }, 404);
    }

    // 获取用户ID
    const user = await c.env.DB.prepare(
      'SELECT id FROM user WHERE uid = ?'
    ).bind(userPayload.sub).first();

    if (!user) {
      return c.json({ message: 'User not found' }, 404);
    }

    const now = Math.floor(Date.now() / 1000);

    // 使用 INSERT OR REPLACE 来处理重复的reaction
    const reactionResult = await c.env.DB.prepare(`
      INSERT OR REPLACE INTO memo_reaction (memo_id, creator_id, reaction_type, created_ts)
      VALUES (?, ?, ?, ?)
    `).bind(memoId, user.id, reactionType, now).run();

    return c.json({
      id: reactionResult.meta.last_row_id,
      memoId,
      creatorId: user.id,
      reactionType,
      createdTs: now
    });

  } catch (error) {
    console.error('Create memo reaction error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 删除memo reaction
memoRoutes.delete('/:id/reaction/:reactionId', async (c) => {
  try {
    const memoId = parseInt(c.req.param('id'));
    const reactionId = parseInt(c.req.param('reactionId'));
    const userPayload = c.get('user');
    
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    if (isNaN(memoId) || isNaN(reactionId)) {
      return c.json({ message: 'Invalid memo ID or reaction ID' }, 400);
    }

    // 获取用户ID
    const user = await c.env.DB.prepare(
      'SELECT id FROM user WHERE uid = ?'
    ).bind(userPayload.sub).first();

    if (!user) {
      return c.json({ message: 'User not found' }, 404);
    }

    // 检查reaction是否存在且属于当前用户
    const reaction = await c.env.DB.prepare(
      'SELECT id FROM memo_reaction WHERE id = ? AND memo_id = ? AND creator_id = ?'
    ).bind(reactionId, memoId, user.id).first();

    if (!reaction) {
      return c.json({ message: 'Reaction not found' }, 404);
    }

    // 删除reaction
    await c.env.DB.prepare(
      'DELETE FROM memo_reaction WHERE id = ?'
    ).bind(reactionId).run();

    return c.json({ message: 'Reaction deleted successfully' });

  } catch (error) {
    console.error('Delete memo reaction error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 通过reaction ID直接删除reaction（用于前端调用）
memoRoutes.delete('/reaction/:reactionId', async (c) => {
  try {
    const reactionId = parseInt(c.req.param('reactionId'));
    const userPayload = c.get('user');
    
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    if (isNaN(reactionId)) {
      return c.json({ message: 'Invalid reaction ID' }, 400);
    }

    // 获取用户ID
    const user = await c.env.DB.prepare(
      'SELECT id FROM user WHERE uid = ?'
    ).bind(userPayload.sub).first();

    if (!user) {
      return c.json({ message: 'User not found' }, 404);
    }

    // 检查reaction是否存在且属于当前用户
    const reaction = await c.env.DB.prepare(
      'SELECT id FROM memo_reaction WHERE id = ? AND creator_id = ?'
    ).bind(reactionId, user.id).first();

    if (!reaction) {
      return c.json({ message: 'Reaction not found' }, 404);
    }

    // 删除reaction
    await c.env.DB.prepare(
      'DELETE FROM memo_reaction WHERE id = ?'
    ).bind(reactionId).run();

    return c.json({ message: 'Reaction deleted successfully' });

  } catch (error) {
    console.error('Delete memo reaction error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 辅助函数：通过 UID 获取用户 ID
async function getUserIdFromUid(db: any, uid: string): Promise<number | null> {
  const user = await db.prepare('SELECT id FROM user WHERE uid = ?').bind(uid).first();
  return user ? user.id : null;
}

// JWT 验证函数
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

export { memoRoutes }; 