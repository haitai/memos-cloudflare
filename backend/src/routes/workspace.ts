import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';

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

const workspaceRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// 获取workspace profile
workspaceRoutes.get('/profile', async (c) => {
  try {
    // 获取第一个注册的用户作为owner
    const owner = await c.env.DB.prepare(
      'SELECT uid FROM user WHERE role = ? ORDER BY created_ts ASC LIMIT 1'
    ).bind('HOST').first();

    return c.json({
      owner: owner ? `users/${owner.uid}` : '',
      version: '0.24.0-cloudflare',
      mode: 'prod',
      instanceUrl: new URL(c.req.url).origin
    });
  } catch (error) {
    console.error('Get workspace profile error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 获取workspace setting
workspaceRoutes.get('/setting', async (c) => {
  try {
    const url = new URL(c.req.url);
    const name = url.searchParams.get('name');
    
    if (!name) {
      return c.json({ message: 'Setting name is required' }, 400);
    }

    // 从名称中提取key
    const key = name.replace('settings/', '');
    
    // 根据key返回默认设置
    const defaultSettings: Record<string, any> = {
      'GENERAL': {
        name: 'settings/GENERAL',
        generalSetting: {
          disallowUserRegistration: false,
          disallowPasswordAuth: false,
          additionalScript: '',
          additionalStyle: '',
          customProfile: {
            title: 'Memos',
            description: 'A privacy-first, lightweight note-taking service',
            logoUrl: '/logo.webp',
            locale: 'zh',
            appearance: 'system',
          },
          weekStartDayOffset: 0,
          disallowChangeUsername: false,
          disallowChangeNickname: false,
        }
      },
      'MEMO_RELATED': {
        name: 'settings/MEMO_RELATED',
        memoRelatedSetting: {
          disallowPublicVisibility: false,
          displayWithUpdateTime: false,
          contentLengthLimit: 10000,
          enableAutoCompact: false,
          enableDoubleClickEdit: true,
          enableLinkPreview: true,
          enableComment: true,
          enableLocation: true,
          enableTagSuggestion: true,
          disableMarkdownShortcuts: false,
          reactions: ['👍', '👎', '❤️', '😄', '😢', '😮', '😠']
        }
      },
      'STORAGE': {
        name: 'settings/STORAGE',
        storageSetting: {
          storageType: 'DATABASE',
          filepathTemplate: '{{filename}}',
          uploadSizeLimitMb: 32,
          s3Config: undefined,
        }
      }
    };

    const setting = defaultSettings[key];
    if (!setting) {
      return c.json({ message: 'Setting not found' }, 404);
    }

    return c.json(setting);
  } catch (error) {
    console.error('Get workspace setting error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 更新workspace setting
workspaceRoutes.post('/setting', authMiddleware, async (c) => {
  try {
    const userPayload = c.get('user');
    if (!userPayload || userPayload.role !== 'HOST') {
      return c.json({ message: 'Forbidden: only admin can update workspace settings' }, 403);
    }

    const body = await c.req.json();
    console.log('Update workspace setting:', body);
    
    // 这里应该保存到数据库，但为了简化，我们直接返回传入的设置
    return c.json(body.setting || body);
  } catch (error) {
    console.error('Update workspace setting error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

export { workspaceRoutes }; 