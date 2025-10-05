import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, Variables } from '../types';

const resourceRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// 上传文件
resourceRoutes.post('/blob', async (c) => {
  try {
    console.log('🔍 Starting blob upload...');
    
    const userPayload = c.get('user');
    if (!userPayload) {
      console.log('❌ No user payload');
      return c.json({ message: 'Unauthorized' }, 401);
    }
    console.log('✅ User authenticated:', userPayload.sub);

    // 获取用户ID
    const user = await c.env.DB.prepare(
      'SELECT id FROM user WHERE uid = ?'
    ).bind(userPayload.sub).first();

    if (!user) {
      console.log('❌ User not found in database:', userPayload.sub);
      return c.json({ message: 'User not found' }, 404);
    }
    console.log('✅ User found in database:', user.id);

    // 解析 multipart/form-data
    console.log('📋 Parsing form data...');
    const formData = await c.req.formData();
    const fileEntry = formData.get('file');

    if (!fileEntry || typeof fileEntry === 'string') {
      console.log('❌ No file provided or invalid file');
      return c.json({ message: 'No file provided' }, 400);
    }

    const file = fileEntry as File;
    console.log('📁 File info:', {
      name: file.name,
      size: file.size,
      type: file.type
    });

    // 检查文件大小（限制 100MB）
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxSize) {
      console.log('❌ File too large:', file.size);
      return c.json({ message: 'File too large' }, 413);
    }

    // 生成资源 UID 和文件路径
    const resourceUid = uuidv4();
    const fileExtension = file.name.split('.').pop() || '';
    const fileName = file.name;
    const mimeType = file.type || 'application/octet-stream';
    console.log('🆔 Generated resource UID:', resourceUid);
    
    // 检查 R2 绑定是否存在
    console.log('🪣 Checking R2 binding...');
    if (!c.env.R2) {
      console.log('❌ R2 bucket not configured - c.env.R2 is undefined');
      return c.json({ message: 'R2 bucket not configured' }, 500);
    }
    console.log('✅ R2 binding exists');

    // R2 存储路径
    const r2Key = `${resourceUid}/${fileName}`;
    const externalLink = `r2://${r2Key}`; // 改为 external_link
    console.log('📍 R2 key:', r2Key);

    // 上传到 R2
    console.log('☁️ Uploading to R2...');
    const uploadSuccess = await uploadToR2(
      c.env.R2,
      r2Key,
      file
    );

    if (!uploadSuccess) {
      console.log('❌ R2 upload failed');
      throw new Error('Failed to upload file to R2');
    }
    console.log('✅ R2 upload successful');

    const now = Math.floor(Date.now() / 1000);

    // 保存资源记录到数据库
    console.log('💾 Saving to database...');
    const result = await c.env.DB.prepare(`
      INSERT INTO resource (uid, creator_id, filename, type, size, external_link, created_ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(resourceUid, user.id, fileName, mimeType, file.size, externalLink, now).run();

    if (!result.success) {
      console.log('❌ Database insert failed:', result);
      throw new Error('Failed to save resource record');
    }
    console.log('✅ Database record saved with ID:', result.meta.last_row_id);

    // 返回资源信息
    const newResource = await c.env.DB.prepare(
      'SELECT * FROM resource WHERE id = ?'
    ).bind(result.meta.last_row_id).first();

    if (!newResource) {
      console.log('❌ Failed to retrieve created resource');
      throw new Error('Failed to retrieve created resource');
    }

    console.log('🎉 Upload completed successfully');
    return c.json({
      name: `resources/${newResource.uid}`, // 前端期望的 name 格式
      uid: newResource.uid,
      createTime: new Date((newResource as any).created_ts * 1000).toISOString(), // 转换为 ISO 字符串
      filename: newResource.filename,
      content: new Uint8Array(), // 空数组，因为文件已经存储在 R2 中
      externalLink: '', // 空字符串，让前端自动构建 /o/r/{uid}/{filename} 格式的 URL
      type: (newResource as any).type, // 数据库字段是 type
      size: newResource.size,
      memo: undefined, // 新上传的资源暂时没有关联 memo
    });

  } catch (error) {
    console.error('💥 Upload resource error:', error);
    console.error('📊 Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    return c.json({ 
      message: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// 获取资源列表
resourceRoutes.get('/', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    // 获取用户ID
    const user = await c.env.DB.prepare(
      'SELECT id FROM user WHERE uid = ?'
    ).bind(userPayload.sub).first();

    if (!user) {
      return c.json({ message: 'User not found' }, 404);
    }

    const url = new URL(c.req.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const resources = await c.env.DB.prepare(`
      SELECT id, uid, filename, type, size, external_link, created_ts
      FROM resource 
      WHERE creator_id = ?
      ORDER BY created_ts DESC
      LIMIT ? OFFSET ?
    `).bind(user.id, limit, offset).all();

    return c.json(resources.results || []);

  } catch (error) {
    console.error('Get resources error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 删除资源
resourceRoutes.delete('/:id', async (c) => {
  try {
    const resourceId = parseInt(c.req.param('id'));
    const userPayload = c.get('user');
    
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    // 获取用户ID
    const user = await c.env.DB.prepare(
      'SELECT id FROM user WHERE uid = ?'
    ).bind(userPayload.sub).first();

    if (!user) {
      return c.json({ message: 'User not found' }, 404);
    }

    // 检查资源是否存在且属于当前用户
    const resource = await c.env.DB.prepare(
      'SELECT * FROM resource WHERE id = ? AND creator_id = ?'
    ).bind(resourceId, user.id).first();

    if (!resource) {
      return c.json({ message: 'Resource not found' }, 404);
    }

    // 删除资源相关的关联
    await c.env.DB.prepare(
      'DELETE FROM memo_resource WHERE resource_id = ?'
    ).bind(resourceId).run();

    // 删除数据库记录
    await c.env.DB.prepare(
      'DELETE FROM resource WHERE id = ?'
    ).bind(resourceId).run();

    // TODO: 删除 R2 中的文件
    // 这里可以考虑异步删除或者定期清理

    return c.json({ message: 'Resource deleted successfully' });

  } catch (error) {
    console.error('Delete resource error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// R2 上传函数，使用Cloudflare Workers的R2绑定
async function uploadToR2(
  bucket: any, // R2Bucket 绑定
  key: string,
  file: File
): Promise<boolean> {
  try {
    console.log('📤 Starting R2 upload with params:', {
      key,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type
    });
    
    // 直接使用Cloudflare Workers的R2绑定进行上传
    console.log('⬆️ Calling bucket.put...');
    const result = await bucket.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type,
      },
    });
    
    console.log('✅ R2 upload result:', result);
    return true;
  } catch (error) {
    console.error('💥 R2 upload error:', error);
    console.error('📊 R2 error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined
    });
    return false;
  }
}

export { resourceRoutes }; 