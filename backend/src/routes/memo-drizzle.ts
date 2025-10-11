import { Hono } from 'hono';
import { eq, and, desc, asc, sql, like, inArray, or } from 'drizzle-orm';
import { createDb, memos, users, tags, memoTags, memoRelations, memoReactions, resources, memoResources } from '../db';
import { v4 as uuidv4 } from 'uuid';

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

const memoRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// 获取memo列表
memoRoutes.get('/', async (c) => {
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

    const url = new URL(c.req.url);
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const oldFilter = url.searchParams.get('oldFilter') || '';

    // 构建查询条件
    let whereConditions = and(
      eq(memos.creatorId, userId),
      eq(memos.rowStatus, 'NORMAL')
    );

    // 处理标签筛选器
    const tagMatch = oldFilter.match(/tag == "([^"]+)"/);
    if (tagMatch) {
      const tagName = tagMatch[1];
      const tagIds = await db
        .select({ id: tags.id })
        .from(tags)
        .where(eq(tags.name, tagName));

      if (tagIds.length > 0) {
        const memoIds = await db
          .select({ memoId: memoTags.memoId })
          .from(memoTags)
          .where(eq(memoTags.tagId, tagIds[0].id));

        if (memoIds.length > 0) {
          whereConditions = and(
            whereConditions,
            inArray(memos.id, memoIds.map(m => m.memoId))
          );
        } else {
          // 如果没有找到匹配的memo，返回空结果
          return c.json([]);
        }
      } else {
        // 如果没有找到标签，返回空结果
        return c.json([]);
      }
    }

    // 处理内容搜索
    const contentMatch = oldFilter.match(/content == "([^"]+)"/);
    if (contentMatch) {
      const searchContent = contentMatch[1];
      whereConditions = and(
        whereConditions,
        like(memos.content, `%${searchContent}%`)
      );
    }

    // 处理可见性筛选器
    const visibilityMatch = oldFilter.match(/visibility == "([^"]+)"/);
    if (visibilityMatch) {
      const visibility = visibilityMatch[1];
      whereConditions = and(
        whereConditions,
        eq(memos.visibility, visibility)
      );
    }

    // 处理displayTime时间范围筛选器
    const displayTimeAfterMatch = oldFilter.match(/display_time_after == (\d+)/);
    const displayTimeBeforeMatch = oldFilter.match(/display_time_before == (\d+)/);
    if (displayTimeAfterMatch) {
      const timestamp = parseInt(displayTimeAfterMatch[1]);
      console.log('📅 Backend - Processing displayTimeAfter filter:', timestamp);
      whereConditions = and(
        whereConditions,
        sql`${memos.createdTs} >= ${timestamp}`
      );
    }
    if (displayTimeBeforeMatch) {
      const timestamp = parseInt(displayTimeBeforeMatch[1]);
      console.log('📅 Backend - Processing displayTimeBefore filter:', timestamp);
      whereConditions = and(
        whereConditions,
        sql`${memos.createdTs} < ${timestamp}`
      );
    }

    // 查询memos
    const memoList = await db
      .select()
      .from(memos)
      .where(whereConditions)
      .orderBy(desc(memos.createdTs))
      .limit(limit)
      .offset(offset);

    // 为每个memo获取标签和资源
    const result = await Promise.all(
      memoList.map(async (memo) => {
        // 获取标签
        const memoTagList = await db
          .select({
            id: tags.id,
            name: tags.name,
          })
          .from(tags)
          .innerJoin(memoTags, eq(tags.id, memoTags.tagId))
          .where(eq(memoTags.memoId, memo.id));

        // 获取资源
        const memoResourceList = await db
          .select({
            id: resources.id,
            uid: resources.uid,
            filename: resources.filename,
            type: resources.type,
            size: resources.size,
            externalLink: resources.externalLink,
          })
          .from(resources)
          .innerJoin(memoResources, eq(resources.id, memoResources.resourceId))
          .where(eq(memoResources.memoId, memo.id));

        // 获取reactions
        const reactionList = await db
          .select({
            id: memoReactions.id,
            reactionType: memoReactions.reactionType,
            creatorId: memoReactions.creatorId,
          })
          .from(memoReactions)
          .where(eq(memoReactions.memoId, memo.id));

        return {
          id: memo.id,
          name: `memos/${memo.id}`,
          uid: memo.uid,
          creator: `users/${memo.creatorId}`,
          content: memo.content,
          visibility: memo.visibility,
          pinned: memo.pinned === 1,
          rowStatus: memo.rowStatus,
          location: memo.locationPlaceholder || memo.locationLatitude || memo.locationLongitude ? {
            placeholder: memo.locationPlaceholder || '',
            latitude: memo.locationLatitude || 0,
            longitude: memo.locationLongitude || 0,
          } : undefined,
          tags: memoTagList.map(tag => ({
            id: tag.id,
            name: tag.name,
          })),
          resources: memoResourceList.map(resource => ({
            id: resource.id,
            uid: resource.uid,
            name: `resources/${resource.uid}`,
            filename: resource.filename,
            type: resource.type,
            size: resource.size,
            externalLink: resource.externalLink,
          })),
          reactions: reactionList.map(reaction => ({
            id: reaction.id,
            reactionType: reaction.reactionType,
            creator: `users/${reaction.creatorId}`,
          })),
          relations: [], // 暂时为空，后续可以添加
          snippet: memo.content ? memo.content.slice(0, 100) : '',
          createTime: new Date(memo.createdTs * 1000).toISOString(),
          updateTime: new Date(memo.updatedTs * 1000).toISOString(),
          displayTime: new Date(memo.createdTs * 1000).toISOString(),
          state: memo.rowStatus === 'ARCHIVED' ? 'ARCHIVED' : 'NORMAL',
        };
      })
    );

    return c.json(result);
  } catch (error) {
    console.error('Get memos error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 获取单个memo详情
memoRoutes.get('/:id', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const db = createDb(c.env.DB);

    const memoId = parseInt(c.req.param('id'));
    if (isNaN(memoId)) {
      return c.json({ message: 'Invalid memo ID' }, 400);
    }

    // 查询memo
    const memo = await db
      .select()
      .from(memos)
      .where(eq(memos.id, memoId))
      .limit(1);

    if (!memo.length) {
      return c.json({ message: 'Memo not found' }, 404);
    }

    const memoData = memo[0];

    // 检查权限（只有创建者或公开memo可以访问）
    if (memoData.visibility !== 'PUBLIC') {
      const userRecord = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.uid, userPayload.sub))
        .limit(1);

      if (!userRecord.length || userRecord[0].id !== memoData.creatorId) {
        return c.json({ message: 'Forbidden' }, 403);
      }
    }

    // 获取标签
    const memoTagList = await db
      .select({
        id: tags.id,
        name: tags.name,
      })
      .from(tags)
      .innerJoin(memoTags, eq(tags.id, memoTags.tagId))
      .where(eq(memoTags.memoId, memoId));

    // 获取资源
    const memoResourceList = await db
      .select({
        id: resources.id,
        uid: resources.uid,
        filename: resources.filename,
        type: resources.type,
        size: resources.size,
        externalLink: resources.externalLink,
      })
      .from(resources)
      .innerJoin(memoResources, eq(resources.id, memoResources.resourceId))
      .where(eq(memoResources.memoId, memoId));

    // 获取reactions
    const reactionList = await db
      .select({
        id: memoReactions.id,
        reactionType: memoReactions.reactionType,
        creatorId: memoReactions.creatorId,
      })
      .from(memoReactions)
      .where(eq(memoReactions.memoId, memoId));

    // 获取关系（引用和评论）
    const outgoingRelations = await db
      .select({
        type: memoRelations.type,
        relatedMemoId: memoRelations.relatedMemoId,
        relatedMemoUid: sql<string>`m.uid`.as('related_memo_uid'),
        relatedMemoContent: sql<string>`m.content`.as('related_memo_content'),
      })
      .from(memoRelations)
      .innerJoin(memos, eq(memos.id, memoRelations.relatedMemoId))
      .where(eq(memoRelations.memoId, memoId));

    const incomingRelations = await db
      .select({
        type: memoRelations.type,
        memoId: memoRelations.memoId,
        memoUid: sql<string>`m.uid`.as('memo_uid'),
        memoContent: sql<string>`m.content`.as('memo_content'),
      })
      .from(memoRelations)
      .innerJoin(memos, eq(memos.id, memoRelations.memoId))
      .where(eq(memoRelations.relatedMemoId, memoId));

    const relationList = [
      ...outgoingRelations.map((r) => ({
        memo: { name: `memos/${memoId}`, uid: memoData.uid, id: memoId },
        relatedMemo: {
          name: `memos/${r.relatedMemoId}`,
          uid: r.relatedMemoUid,
          id: r.relatedMemoId,
          snippet: r.relatedMemoContent ? r.relatedMemoContent.slice(0, 100) : ''
        },
        type: r.type
      })),
      ...incomingRelations.map((r) => ({
        memo: {
          name: `memos/${r.memoId}`,
          uid: r.memoUid,
          id: r.memoId,
          snippet: r.memoContent ? r.memoContent.slice(0, 100) : ''
        },
        relatedMemo: { name: `memos/${memoId}`, uid: memoData.uid, id: memoId },
        type: r.type
      }))
    ];

    return c.json({
      id: memoData.id,
      name: `memos/${memoData.id}`,
      uid: memoData.uid,
      creator: `users/${memoData.creatorId}`,
      content: memoData.content,
      visibility: memoData.visibility,
      pinned: memoData.pinned === 1,
      rowStatus: memoData.rowStatus,
      location: memoData.locationPlaceholder || memoData.locationLatitude || memoData.locationLongitude ? {
        placeholder: memoData.locationPlaceholder || '',
        latitude: memoData.locationLatitude || 0,
        longitude: memoData.locationLongitude || 0,
      } : undefined,
      tags: memoTagList.map(tag => ({
        id: tag.id,
        name: tag.name,
      })),
      resources: memoResourceList.map(resource => ({
        id: resource.id,
        uid: resource.uid,
        name: `resources/${resource.uid}`,
        filename: resource.filename,
        type: resource.type,
        size: resource.size,
        externalLink: resource.externalLink,
      })),
      reactions: reactionList.map(reaction => ({
        id: reaction.id,
        reactionType: reaction.reactionType,
        creator: `users/${reaction.creatorId}`,
      })),
      relations: relationList,
      snippet: memoData.content ? memoData.content.slice(0, 100) : '',
      createTime: new Date(memoData.createdTs * 1000).toISOString(),
      updateTime: new Date(memoData.updatedTs * 1000).toISOString(),
      displayTime: new Date(memoData.createdTs * 1000).toISOString(),
      state: memoData.rowStatus === 'ARCHIVED' ? 'ARCHIVED' : 'NORMAL',
    });
  } catch (error) {
    console.error('Get memo error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 创建memo
memoRoutes.post('/', async (c) => {
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
    const { content, visibility = 'PRIVATE', tags: tagNames = [], resources: resourceIds = [], relations = [] } = body;

    // 修改后：允许只有资源而没有文本内容
    if (!content && (!resources || resources.length === 0) && (!resourceIds || resourceIds.length === 0)) {
      return c.json({ message: 'Content or resources are required' }, 400);
    }

    const memoUid = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    // 创建memo
    const memoResult = await db
      .insert(memos)
      .values({
        uid: memoUid,
        creatorId: userId,
        content: content || '',
        visibility,
        createdTs: now,
        updatedTs: now,
      })
      .returning({ id: memos.id });

    const memoId = memoResult[0].id;

    // 处理标签
    if (tagNames.length > 0) {
      for (const tagName of tagNames) {
        // 查找或创建标签
        let tag = await db
          .select()
          .from(tags)
          .where(and(eq(tags.name, tagName), eq(tags.creatorId, userId)))
          .limit(1);

        if (!tag.length) {
          const newTag = await db
            .insert(tags)
            .values({
              name: tagName,
              creatorId: userId,
              createdTs: now,
            })
            .returning({ id: tags.id });
          tag = newTag;
        }

        // 创建memo-tag关联
        await db
          .insert(memoTags)
          .values({
            memoId: memoId,
            tagId: tag[0].id,
          });
      }
    }

    // 处理资源关联
    if (resourceIds.length > 0) {
      for (const resourceId of resourceIds) {
        await db
          .insert(memoResources)
          .values({
            memoId: memoId,
            resourceId: resourceId,
          });
      }
    }

    // 处理关系
    if (relations.length > 0) {
      for (const relation of relations) {
        if (relation.relatedMemo && relation.relatedMemo.name) {
          const relatedMemoName = relation.relatedMemo.name;
          const relatedMemoId = parseInt(relatedMemoName.replace('memos/', ''));
          
          if (!isNaN(relatedMemoId)) {
            await db
              .insert(memoRelations)
              .values({
                memoId: memoId,
                relatedMemoId: relatedMemoId,
                type: relation.type || 'REFERENCE',
                createdTs: now,
              });
          }
        }
      }
    }

    return c.json({
      id: memoId,
      name: `memos/${memoId}`,
      uid: memoUid,
      creator: `users/${userId}`,
      content: content || '',
      visibility,
      pinned: false,
      rowStatus: 'NORMAL',
      tags: tagNames.map((name: string) => ({ name })),
      resources: resourceIds.map((id: number) => ({ id })),
      relations: relations,
      snippet: content ? content.slice(0, 100) : '',
      createTime: new Date(now * 1000).toISOString(),
      updateTime: new Date(now * 1000).toISOString(),
      displayTime: new Date(now * 1000).toISOString(),
      state: 'NORMAL',
    });
  } catch (error) {
    console.error('Create memo error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 更新memo
memoRoutes.patch('/:id', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const db = createDb(c.env.DB);

    const memoId = parseInt(c.req.param('id'));
    if (isNaN(memoId)) {
      return c.json({ message: 'Invalid memo ID' }, 400);
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

    // 检查memo是否存在且用户有权限
    const memo = await db
      .select()
      .from(memos)
      .where(and(eq(memos.id, memoId), eq(memos.creatorId, userId)))
      .limit(1);

    if (!memo.length) {
      return c.json({ message: 'Memo not found or no permission' }, 404);
    }

    const body = await c.req.json();
    const { content, visibility, tags: tagNames = [], resources: resourceIds = [], relations = [] } = body;

    const now = Math.floor(Date.now() / 1000);

    // 更新memo基本信息
    const updateData: any = {
      updatedTs: now,
    };

    if (content !== undefined) updateData.content = content;
    if (visibility !== undefined) updateData.visibility = visibility;

    await db
      .update(memos)
      .set(updateData)
      .where(eq(memos.id, memoId));

    // 更新标签
    if (tagNames !== undefined) {
      // 删除现有标签关联
      await db
        .delete(memoTags)
        .where(eq(memoTags.memoId, memoId));

      // 添加新标签关联
      if (tagNames.length > 0) {
        for (const tagName of tagNames) {
          // 查找或创建标签
          let tag = await db
            .select()
            .from(tags)
            .where(and(eq(tags.name, tagName), eq(tags.creatorId, userId)))
            .limit(1);

          if (!tag.length) {
            const newTag = await db
              .insert(tags)
              .values({
                name: tagName,
                creatorId: userId,
                createdTs: now,
              })
              .returning({ id: tags.id });
            tag = newTag;
          }

          await db
            .insert(memoTags)
            .values({
              memoId: memoId,
              tagId: tag[0].id,
            });
        }
      }
    }

    // 更新资源关联
    if (resourceIds !== undefined) {
      // 删除现有资源关联
      await db
        .delete(memoResources)
        .where(eq(memoResources.memoId, memoId));

      // 添加新资源关联
      if (resourceIds.length > 0) {
        for (const resourceId of resourceIds) {
          await db
            .insert(memoResources)
            .values({
              memoId: memoId,
              resourceId: resourceId,
            });
        }
      }
    }

    // 更新关系
    if (relations !== undefined) {
      // 删除现有关系
      await db
        .delete(memoRelations)
        .where(eq(memoRelations.memoId, memoId));

      // 添加新关系
      if (relations.length > 0) {
        for (const relation of relations) {
          if (relation.relatedMemo && relation.relatedMemo.name) {
            const relatedMemoName = relation.relatedMemo.name;
            const relatedMemoId = parseInt(relatedMemoName.replace('memos/', ''));
            
            if (!isNaN(relatedMemoId)) {
              await db
                .insert(memoRelations)
                .values({
                  memoId: memoId,
                  relatedMemoId: relatedMemoId,
                  type: relation.type || 'REFERENCE',
                  createdTs: now,
                });
            }
          }
        }
      }
    }

    return c.json({ message: 'Memo updated successfully' });
  } catch (error) {
    console.error('Update memo error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 删除memo
memoRoutes.delete('/:id', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const db = createDb(c.env.DB);

    const memoId = parseInt(c.req.param('id'));
    if (isNaN(memoId)) {
      return c.json({ message: 'Invalid memo ID' }, 400);
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

    // 检查memo是否存在且用户有权限
    const memo = await db
      .select()
      .from(memos)
      .where(and(eq(memos.id, memoId), eq(memos.creatorId, userId)))
      .limit(1);

    if (!memo.length) {
      return c.json({ message: 'Memo not found or no permission' }, 404);
    }

    // 软删除：更新row_status为ARCHIVED
    const now = Math.floor(Date.now() / 1000);
    await db
      .update(memos)
      .set({
        rowStatus: 'ARCHIVED',
        updatedTs: now,
      })
      .where(eq(memos.id, memoId));

    return c.json({ message: 'Memo deleted successfully' });
  } catch (error) {
    console.error('Delete memo error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

export { memoRoutes };
