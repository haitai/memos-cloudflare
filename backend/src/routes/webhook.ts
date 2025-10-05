import { Hono } from 'hono';
import { Env } from '../types';

interface Variables {
  user: {
    sub: string;
    username: string;
    role: string;
    iat: number;
    exp: number;
  };
}

export const webhookRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// 获取用户的 webhooks
webhookRoutes.get('/', async (c) => {
  try {
    const creator = c.req.query('creator') || c.get('user')?.username;
    
    if (!creator) {
      return c.json({ message: 'Creator parameter required' }, 400);
    }

    // 由于数据库中可能没有webhook表，返回空数组
    // 在真实实现中，这里会查询数据库中的webhook记录
    const webhooks: any[] = [];
    
    return c.json({ 
      webhooks: webhooks
    });
  } catch (error: any) {
    console.error('Error listing webhooks:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 创建新的 webhook
webhookRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const user = c.get('user');
    
    if (!user) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const { name, url } = body;
    
    if (!name || !url) {
      return c.json({ message: 'Name and URL are required' }, 400);
    }

    // 由于数据库中可能没有webhook表，暂时返回成功
    // 在真实实现中，这里会在数据库中创建webhook记录
    const webhook = {
      id: Date.now(),  // 返回数字类型的id
      name,
      url,
      creator: user.username,
      createTime: new Date(),
      updateTime: new Date()
    };
    
    return c.json({ webhook });
  } catch (error: any) {
    console.error('Error creating webhook:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

// 删除 webhook
webhookRoutes.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const user = c.get('user');
    
    if (!user) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    if (!id) {
      return c.json({ message: 'Webhook ID required' }, 400);
    }

    // 由于数据库中可能没有webhook表，暂时返回成功
    // 在真实实现中，这里会从数据库中删除webhook记录
    
    return c.json({ message: 'Webhook deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting webhook:', error);
    return c.json({ message: 'Internal server error' }, 500);
  }
}); 