import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { createDb, resources, users, workspaceSettings } from '../db';
import { v4 as uuidv4 } from 'uuid';

type Env = {
  DB: D1Database;
  R2: R2Bucket;
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

const resourceRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// 获取存储设置
async function getStorageSetting(c: any) {
  try {
    const db = createDb(c.env.DB);
    const setting = await db
      .select()
      .from(workspaceSettings)
      .where(eq(workspaceSettings.name, 'settings/STORAGE'))
      .limit(1);

    if (setting.length > 0) {
      return JSON.parse(setting[0].settingData);
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
    
    const db = createDb(c.env.DB);

    // 根据UID查找用户ID
    const userRecord = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.uid, user.sub))
      .limit(1);
    
    if (!userRecord.length) {
      console.log('❌ User not found:', user.sub);
      return c.json({ message: 'User not found' }, 404);
    }
    
    const userId = userRecord[0].id;
    console.log('👤 User ID found:', userId);

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
        db,
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
      console.log('📍 R2 key:', r2Key);
      
      uploadSuccess = await uploadToR2(
        c.env.R2,
        r2Key,
        file
      );
      
      // 存储R2 key到数据库，但返回HTTP URL给前端
      externalLink = `r2://${r2Key}`;
    } else {
      // 默认使用R2存储
      console.log('☁️ Using default R2 storage');
      
      if (!c.env.R2) {
        console.log('❌ R2 bucket not configured - c.env.R2 is undefined');
        return c.json({ message: 'R2 bucket not configured' }, 500);
      }
      
      const r2Key = `${resourceUid}/${fileName}`;
      console.log('📍 R2 key:', r2Key);
      
      uploadSuccess = await uploadToR2(
        c.env.R2,
        r2Key,
        file
      );
      
      // 存储R2 key到数据库，但返回HTTP URL给前端
      externalLink = `r2://${r2Key}`;
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
      const dbResult = await uploadToDatabase(
        db,
        resourceUid,
        fileName,
        mimeType,
        file
      );
      
      if (!dbResult.success || !dbResult.buffer) {
        throw new Error('Failed to process file for database storage');
      }
      
      result = await db
        .insert(resources)
        .values({
          uid: resourceUid,
          creatorId: userId,
          filename: fileName,
          type: mimeType,
          size: file.size,
          blob: dbResult.buffer,
          externalLink: externalLink,
          createdTs: now,
          updatedTs: now,
        })
        .returning({ id: resources.id });
    } else {
      // R2存储：只存储元数据，不存储文件内容
      result = await db
        .insert(resources)
        .values({
          uid: resourceUid,
          creatorId: userId,
          filename: fileName,
          type: mimeType,
          size: file.size,
          externalLink: externalLink,
          createdTs: now,
          updatedTs: now,
        })
        .returning({ id: resources.id });
    }

    if (result.length > 0) {
      console.log('✅ Resource saved to database with ID:', result[0].id);
      
      // 返回HTTP URL给前端，而不是存储的协议URL
      const httpUrl = externalLink.startsWith('r2://') || externalLink.startsWith('database://') 
        ? `/api/resource/blob/${resourceUid}`
        : externalLink;

      return c.json({
        id: result[0].id,
        uid: resourceUid,
        name: `resources/${resourceUid}`,
        creator: `users/${userId}`,
        filename: fileName,
        type: mimeType,
        size: file.size,
        externalLink: httpUrl,
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

// 文件访问端点 - 从R2或数据库获取文件
resourceRoutes.get('/blob/:uid', async (c) => {
  try {
    const resourceUid = c.req.param('uid');
    console.log('📁 Accessing resource:', resourceUid);

    const db = createDb(c.env.DB);

    // 从数据库获取资源信息
    const resource = await db
      .select()
      .from(resources)
      .where(eq(resources.uid, resourceUid))
      .limit(1);

    if (!resource.length) {
      return c.json({ message: 'Resource not found' }, 404);
    }

    const resourceData = resource[0];

    console.log('📋 Resource found:', {
      uid: resourceData.uid,
      filename: resourceData.filename,
      type: resourceData.type,
      external_link: resourceData.externalLink
    });

    // 检查存储类型
    if (resourceData.externalLink?.startsWith('r2://')) {
      // 从R2获取文件
      const r2Key = resourceData.externalLink.replace('r2://', '');
      console.log('☁️ Fetching from R2:', r2Key);

      if (!c.env.R2) {
        return c.json({ message: 'R2 bucket not configured' }, 500);
      }

      const r2Object = await c.env.R2.get(r2Key);
      if (!r2Object) {
        return c.json({ message: 'File not found in R2' }, 404);
      }

      const fileData = await r2Object.arrayBuffer();
      return new Response(fileData, {
        headers: {
          'Content-Type': resourceData.type || 'application/octet-stream',
          'Content-Disposition': `inline; filename="${resourceData.filename}"`,
          'Cache-Control': 'public, max-age=31536000', // 1 year cache
        },
      });
    } else if (resourceData.externalLink?.startsWith('database://')) {
      // 从数据库获取文件
      console.log('🗄️ Fetching from database');
      
      if (!resourceData.blob) {
        return c.json({ message: 'File not found in database' }, 404);
      }

      return new Response(resourceData.blob, {
        headers: {
          'Content-Type': resourceData.type || 'application/octet-stream',
          'Content-Disposition': `inline; filename="${resourceData.filename}"`,
          'Cache-Control': 'public, max-age=31536000', // 1 year cache
        },
      });
    } else {
      return c.json({ message: 'Unknown storage type' }, 500);
    }
  } catch (error: any) {
    console.error('Resource access error:', error);
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

    const resourceList = await db
      .select()
      .from(resources)
      .where(eq(resources.creatorId, userId))
      .orderBy(desc(resources.createdTs))
      .limit(limit)
      .offset(offset);

    const result = resourceList.map(resource => ({
      id: resource.id,
      uid: resource.uid,
      name: `resources/${resource.uid}`,
      creator: `users/${resource.creatorId}`,
      filename: resource.filename,
      type: resource.type,
      size: resource.size,
      externalLink: resource.externalLink?.startsWith('r2://') || resource.externalLink?.startsWith('database://') 
        ? `/api/resource/blob/${resource.uid}`
        : resource.externalLink,
      createTime: new Date(resource.createdTs * 1000).toISOString(),
      updateTime: new Date(resource.updatedTs * 1000).toISOString()
    }));

    return c.json(result);
  } catch (error) {
    console.error('Get resources error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 获取单个资源
resourceRoutes.get('/:uid', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const db = createDb(c.env.DB);

    const resourceUid = c.req.param('uid');

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

    const resource = await db
      .select()
      .from(resources)
      .where(and(eq(resources.uid, resourceUid), eq(resources.creatorId, userId)))
      .limit(1);

    if (!resource.length) {
      return c.json({ message: 'Resource not found' }, 404);
    }

    const resourceData = resource[0];

    return c.json({
      id: resourceData.id,
      uid: resourceData.uid,
      name: `resources/${resourceData.uid}`,
      creator: `users/${resourceData.creatorId}`,
      filename: resourceData.filename,
      type: resourceData.type,
      size: resourceData.size,
      externalLink: resourceData.externalLink?.startsWith('r2://') || resourceData.externalLink?.startsWith('database://') 
        ? `/api/resource/blob/${resourceData.uid}`
        : resourceData.externalLink,
      createTime: new Date(resourceData.createdTs * 1000).toISOString(),
      updateTime: new Date(resourceData.updatedTs * 1000).toISOString()
    });
  } catch (error) {
    console.error('Get resource error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 删除资源
resourceRoutes.delete('/:uid', async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const db = createDb(c.env.DB);

    const resourceUid = c.req.param('uid');

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

    const resource = await db
      .select()
      .from(resources)
      .where(and(eq(resources.uid, resourceUid), eq(resources.creatorId, userId)))
      .limit(1);

    if (!resource.length) {
      return c.json({ message: 'Resource not found' }, 404);
    }

    const resourceData = resource[0];

    // 如果是R2存储，从R2删除文件
    if (resourceData.externalLink?.startsWith('r2://') && c.env.R2) {
      const r2Key = resourceData.externalLink.replace('r2://', '');
      try {
        await c.env.R2.delete(r2Key);
        console.log('✅ File deleted from R2:', r2Key);
      } catch (error) {
        console.error('❌ Failed to delete file from R2:', error);
      }
    }

    // 从数据库删除资源记录
    await db
      .delete(resources)
      .where(eq(resources.uid, resourceUid));

    return c.json({ message: 'Resource deleted successfully' });
  } catch (error) {
    console.error('Delete resource error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

export { resourceRoutes };
