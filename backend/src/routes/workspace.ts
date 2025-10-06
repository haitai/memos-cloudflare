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

    // 从数据库获取设置
    const setting = await c.env.DB.prepare(
      'SELECT * FROM workspace_setting WHERE name = ?'
    ).bind(name).first();

    if (setting) {
      // 如果数据库中有设置，返回解析后的JSON
      return c.json(JSON.parse(setting.setting_data));
    }

    // 如果数据库中没有设置，返回默认设置
    const key = name.replace('settings/', '');
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
          storageType: 'R2',
          filepathTemplate: '{{filename}}',
          uploadSizeLimitMb: 32,
        }
      }
    };

    const defaultSetting = defaultSettings[key];
    if (!defaultSetting) {
      return c.json({ message: 'Setting not found' }, 404);
    }

    return c.json(defaultSetting);
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
    
    const setting = body.setting || body;
    const settingName = setting.name;
    const settingData = JSON.stringify(setting);
    const now = Math.floor(Date.now() / 1000);

    // 检查是否已存在设置
    const existingSetting = await c.env.DB.prepare(
      'SELECT * FROM workspace_setting WHERE name = ?'
    ).bind(settingName).first();

    if (existingSetting) {
      // 更新现有设置
      await c.env.DB.prepare(`
        UPDATE workspace_setting 
        SET setting_data = ?, updated_ts = ?
        WHERE name = ?
      `).bind(settingData, now, settingName).run();
    } else {
      // 创建新设置
      await c.env.DB.prepare(`
        INSERT INTO workspace_setting (name, setting_data, created_ts, updated_ts)
        VALUES (?, ?, ?, ?)
      `).bind(settingName, settingData, now, now).run();
    }

    console.log('Workspace setting saved successfully:', settingName);
    return c.json(setting);
  } catch (error) {
    console.error('Update workspace setting error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

export { workspaceRoutes }; 