import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, Variables } from '../types';

const resourceRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// 获取存储设置
async function getStorageSetting(c: any) {
  try {
    const setting = await c.env.DB.prepare(
      'SELECT * FROM workspace_setting WHERE name = ?'
    ).bind('settings/STORAGE').first();

    if (setting) {
      return JSON.parse(setting.setting_data);
    }

    // 返回默认设置
    return {
      storageType: 'R2',
      filepathTemplate: '{{filename}}',
      uploadSizeLimitMb: 32,
    };
  } catch (error) {
    console.error('Error getting storage setting:', error);
    return {
      storageType: 'R2',
      filepathTemplate: '{{filename}}',
      uploadSizeLimitMb: 32,
    };
  }
}

// R2 上传函数
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
    const result = await bucket.put(key, file, {
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

// 数据库存储函数（将文件内容存储为BLOB）
async function uploadToDatabase(
  db: any,
  resourceUid: string,
  fileName: string,
  mimeType: string,
  file: File
): Promise<{ success: boolean; buffer?: Buffer }> {
  try {
    console.log('📤 Starting database upload for file:', fileName);
    
    // 将文件转换为ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    console.log('✅ File converted to ArrayBuffer, size:', uint8Array.length);
    
    // 将ArrayBuffer转换为Buffer（SQLite BLOB格式）
    const buffer = Buffer.from(uint8Array);
    
    console.log('✅ File converted to Buffer, size:', buffer.length);
    return { success: true, buffer };
  } catch (error) {
    console.error('💥 Database upload error:', error);
    return { success: false };
  }
}

// 文件上传端点
resourceRoutes.post('/blob', async (c) => {
  try {
    // 获取用户信息
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const user = userPayload;
    console.log('👤 Upload request from user:', user.sub);

    // 解析multipart form data
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return c.json({ message: 'No file provided' }, 400);
    }

    console.log('📁 File details:', {
      name: file.name,
      size: file.size,
      type: file.type
    });

    // 检查文件大小限制 (32MB)
    const maxSize = 32 * 1024 * 1024; // 32MB
    if (file.size > maxSize) {
      return c.json({ message: 'File too large. Maximum size is 32MB.' }, 400);
    }

    // 生成资源ID和文件名
    const resourceUid = uuidv4();
    const fileName = file.name;
    const mimeType = file.type || 'application/octet-stream';

    console.log('🆔 Generated resource UID:', resourceUid);

    // 获取存储设置
    const storageSetting = await getStorageSetting(c);
    console.log('📋 Storage setting:', storageSetting);

    let externalLink: string;
    let uploadSuccess: boolean;

    if (storageSetting.storageType === 'DATABASE') {
      // 使用数据库存储
      console.log('🗄️ Using database storage');
      const dbResult = await uploadToDatabase(
        c.env.DB,
        resourceUid,
        fileName,
        mimeType,
        file
      );
      uploadSuccess = dbResult.success;
      externalLink = `database://${resourceUid}`;
    } else if (storageSetting.storageType === 'R2') {
      // 使用R2存储
      console.log('☁️ Using R2 storage');
      
      // 检查R2存储桶是否配置
      if (!c.env.R2) {
        console.log('❌ R2 bucket not configured - c.env.R2 is undefined');
        return c.json({ message: 'R2 bucket not configured' }, 500);
      }
      
      const r2Key = `${resourceUid}/${fileName}`;
      externalLink = `r2://${r2Key}`;
      console.log('📍 R2 key:', r2Key);
      
      uploadSuccess = await uploadToR2(
        c.env.R2,
        r2Key,
        file
      );
    } else {
      // 默认使用R2存储
      console.log('☁️ Using default R2 storage');
      
      if (!c.env.R2) {
        console.log('❌ R2 bucket not configured - c.env.R2 is undefined');
        return c.json({ message: 'R2 bucket not configured' }, 500);
      }
      
      const r2Key = `${resourceUid}/${fileName}`;
      externalLink = `r2://${r2Key}`;
      console.log('📍 R2 key:', r2Key);
      
      uploadSuccess = await uploadToR2(
        c.env.R2,
        r2Key,
        file
      );
    }

    if (!uploadSuccess) {
      console.log('❌ Upload failed');
      throw new Error('Failed to upload file');
    }
    console.log('✅ Upload successful');

    const now = Math.floor(Date.now() / 1000);

    // 保存资源记录到数据库
    console.log('💾 Saving to database...');
    
    let result;
    if (storageSetting.storageType === 'DATABASE') {
      // 数据库存储：将文件内容存储为BLOB
      // 重新获取文件内容（因为之前已经处理过了）
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const buffer = Buffer.from(uint8Array);
      
      result = await c.env.DB.prepare(`
        INSERT INTO resource (uid, creator_id, filename, type, size, blob, external_link, created_ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(resourceUid, user.sub, fileName, mimeType, file.size, buffer, externalLink, now).run();
    } else {
      // R2存储：只存储元数据，不存储文件内容
      result = await c.env.DB.prepare(`
        INSERT INTO resource (uid, creator_id, filename, type, size, external_link, created_ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(resourceUid, user.sub, fileName, mimeType, file.size, externalLink, now).run();
    }

    if (result.success) {
      console.log('✅ Resource saved to database with ID:', result.meta.last_row_id);
      
      return c.json({
        id: result.meta.last_row_id,
        uid: resourceUid,
        name: `resources/${resourceUid}`,
        creator: `users/${user.sub}`,
        filename: fileName,
        type: mimeType,
        size: file.size,
        externalLink: externalLink,
        createTime: new Date(now * 1000).toISOString(),
        updateTime: new Date(now * 1000).toISOString()
      });
    } else {
      console.log('❌ Failed to save resource to database');
      throw new Error('Failed to save resource to database');
    }
  } catch (error: any) {
    console.error('Resource upload error:', error);
    return c.json({ message: 'Internal server error', details: error.message }, 500);
  }
});

// 获取资源列表
resourceRoutes.get('/', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const user = userPayload;
    const url = new URL(c.req.url);
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const resources = await c.env.DB.prepare(`
      SELECT * FROM resource 
      WHERE creator_id = ? 
      ORDER BY created_ts DESC 
      LIMIT ? OFFSET ?
    `).bind(user.id, limit, offset).all();

    return c.json({
      resources: resources.results || [],
      total: resources.results?.length || 0
    });
  } catch (error: any) {
    console.error('Get resources error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 删除资源
resourceRoutes.delete('/:id', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const user = userPayload;
    const resourceId = c.req.param('id');

    // 获取资源信息
    const resource = await c.env.DB.prepare(
      'SELECT * FROM resource WHERE id = ? AND creator_id = ?'
    ).bind(resourceId, user.id).first();

    if (!resource) {
      return c.json({ message: 'Resource not found' }, 404);
    }

    // 从R2删除文件
    if (c.env.R2 && resource.external_link?.startsWith('r2://')) {
      const r2Key = resource.external_link.replace('r2://', '');
      try {
        await c.env.R2.delete(r2Key);
        console.log('✅ File deleted from R2:', r2Key);
      } catch (error) {
        console.error('❌ Failed to delete file from R2:', error);
        // 继续删除数据库记录，即使R2删除失败
      }
    }

    // 从数据库删除记录
    const result = await c.env.DB.prepare(
      'DELETE FROM resource WHERE id = ? AND creator_id = ?'
    ).bind(resourceId, user.id).run();

    if (result.success) {
      return c.json({ message: 'Resource deleted successfully' });
    } else {
      return c.json({ message: 'Failed to delete resource' }, 500);
    }
  } catch (error: any) {
    console.error('Delete resource error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

export { resourceRoutes };