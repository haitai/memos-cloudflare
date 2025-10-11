// REST API Client for Cloudflare Workers Backend
import { apiClient } from "./api/client";

// Create compatible service clients that use REST API
const createServiceClient = (service: any) => ({
  [service]: apiClient,
});

// Workspace Service
export const workspaceServiceClient = {
  getWorkspaceProfile: async () => {
    try {
      const profile = await apiClient.getWorkspaceProfile();
      console.log('✅ Workspace profile loaded:', profile);
      return profile;
    } catch (error) {
      console.error('❌ Failed to load workspace profile:', error);
      // Return a fallback profile if API fails
      return {
        version: '0.24.0-cloudflare',
        mode: 'prod',
        instanceUrl: window.location.origin,
        owner: 'users/1',
      };
    }
  },
};

export const workspaceSettingServiceClient = {
  getWorkspaceSetting: (request: { name: string }) => {
    return apiClient.getWorkspaceSetting(request.name);
  },
  setWorkspaceSetting: (request: { setting: any }) => {
    return apiClient.setWorkspaceSetting(request.setting);
  },
};

// Auth Service  
export const authServiceClient = {
  signIn: (request: { passwordCredentials?: { username: string; password: string }; neverExpire?: boolean }) => {
    if (request.passwordCredentials) {
      return apiClient.signIn(request.passwordCredentials.username, request.passwordCredentials.password);
    }
    throw new Error('Password credentials required');
  },
  signUp: (request: { username: string; password: string; email?: string }) =>
    apiClient.signUp(request.username, request.password, request.email),
  signOut: () => {
    // 清除本地 token
    localStorage.removeItem("accessToken");
    sessionStorage.removeItem("accessToken"); // 如果你也用 sessionStorage
    // 可以根据你的项目实际情况清理其它相关信息
    return Promise.resolve();
  },
  getAuthStatus: () => apiClient.getCurrentUser(),
};

// User Service
export const userServiceClient = {
  getCurrentUser: () => apiClient.getCurrentUser(),
  getUser: (request: { name: string }) => {
    const id = parseInt(request.name.replace('users/', ''));
    return apiClient.getUser(id);
  },
  getUserByUsername: (request: { username: string }) => apiClient.getUserByUsername(request.username),
  listUsers: () => apiClient.listUsers(),
updateUser: (request: { user: any; updateMask: any }) => {
  const id = parseInt(request.user.name.replace('users/', ''));
  // 构造后端期望的数据格式
  const userData: any = {
    username: request.user.username,
    nickname: request.user.nickname,
    email: request.user.email,
    avatarUrl: request.user.avatarUrl,
    description: request.user.description,
  };
  // 修复：补充 password 字段
  if (request.user.password) {
    userData.password = request.user.password;
  }
  return apiClient.updateUser(id, userData);
},
  deleteUser: (request: { name: string }) => {
    const id = parseInt(request.name.replace('users/', ''));
    return apiClient.deleteUser(id);
  },
  getUserSetting: async (request?: { name?: string }) => {
    // 获取当前用户信息来提取ID
    const currentUser = await apiClient.getCurrentUser();
    const currentUserId = parseInt(currentUser.name.replace('users/', ''));
    return apiClient.getUserSetting(currentUserId);
  },
  updateUserSetting: async (request: { setting: any; updateMask: string[] }) => {
    // 获取当前用户信息来提取ID
    const currentUser = await apiClient.getCurrentUser();
    const currentUserId = parseInt(currentUser.name.replace('users/', ''));
    return apiClient.updateUserSetting(currentUserId, request.setting);
  },
  getUserStats: (request: { name: string }) => {
    const userId = parseInt(request.name.replace('users/', ''));
    return apiClient.getUserStats(userId);
  },
  listAllUserStats: () => apiClient.getAllUserStats(),
};

// Memo Service  
export const memoServiceClient = {
  listMemos: (request: any) => apiClient.getMemos(request),
  getMemo: (request: { name: string }) => {
    const id = parseInt(request.name.replace('memos/', ''));
    return apiClient.getMemo(id);
  },
  createMemo: (request: { memo: any }) => apiClient.createMemo(request.memo),
  updateMemo: (request: { memo: any; updateMask: any }) => {
    if (!request.memo || !request.memo.name) {
      throw new Error('Memo name is required for update');
    }
    
    const memoName = request.memo.name;
    
    // 提取ID，添加更严格的验证
    const idString = memoName.replace('memos/', '');
    const id = parseInt(idString, 10);
    
    if (isNaN(id) || id <= 0) {
      throw new Error(`Invalid memo ID: ${idString} from name: ${memoName}`);
    }
    
    return apiClient.updateMemo(id, request.memo);
  },
  deleteMemo: (request: { name: string }) => {
    const id = parseInt(request.name.replace('memos/', ''));
    return apiClient.deleteMemo(id);
  },
  createMemoComment: (request: { name: string; comment: any }) => {
    const parentMemoId = parseInt(request.name.replace('memos/', ''));
    return apiClient.createMemoComment(parentMemoId, request.comment);
  },
  upsertMemoReaction: (request: { name: string; reaction: any }) => {
    const memoId = parseInt(request.name.replace('memos/', ''));
    return apiClient.upsertMemoReaction(memoId, request.reaction.reactionType);
  },
  deleteMemoReaction: (request: { id: number }) => {
    return apiClient.deleteMemoReaction(request.id);
  },
  renameMemoTag: (request: { parent: string; oldTag: string; newTag: string }) => Promise.resolve({}),
  deleteMemoTag: (request: { parent: string; tag: string; deleteRelatedMemos?: boolean }) => Promise.resolve({}),
};

// Resource Service
export const resourceServiceClient = {
  getResource: (request: { name: string }) => Promise.resolve({
    name: request.name,
    uid: '',
    createTime: '',
    filename: '',
    content: new Uint8Array(),
    externalLink: '',
    type: '',
    size: 0,
    memo: '',
  }),
  createResource: (request: { resource?: any, filename?: string, type?: string }) => {
    if (request.resource?.content || request.resource?.blob) {
      const data = request.resource.content || request.resource.blob;
      const file = new File([data], request.resource.filename, { type: request.resource.type });
      return apiClient.uploadResource(file);
    }
    return Promise.resolve({
      name: 'resources/1',
      uid: '',
      createTime: new Date().toISOString(),
      filename: request.filename || '',
      content: new Uint8Array(),
      externalLink: '',
      type: request.type || '',
      size: 0,
      memo: '',
    });
  },
  updateResource: (request: any) => Promise.resolve(request.resource),
  deleteResource: (request: { name: string }) => Promise.resolve({}),
  listResources: (request: { parent: string }) => Promise.resolve({ resources: [] }),
};

// Shortcut Service
export const shortcutServiceClient = {
  listShortcuts: async (request: { parent: string }) => {
    const response = await fetch('/api/shortcut', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  },
  
  createShortcut: async (request: { parent: string; shortcut: any }) => {
    const response = await fetch('/api/shortcut', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: request.shortcut.title,
        payload: request.shortcut.payload,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  },
  
  updateShortcut: async (request: { parent: string; shortcut: any }) => {
    const response = await fetch(`/api/shortcut/${request.shortcut.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: request.shortcut.title,
        payload: request.shortcut.payload,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  },
  
  deleteShortcut: async (request: { parent: string; id: number }) => {
    const response = await fetch(`/api/shortcut/${request.id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  },
};

// Inbox Service  
export const inboxServiceClient = {
  listInboxes: (request: any) => Promise.resolve({ inboxes: [] }),
  updateInbox: (request: { inbox: any; updateMask: string[] }) => Promise.resolve(request.inbox),
  deleteInbox: (request: { name: string }) => Promise.resolve({}),
};

export const activityServiceClient = {
  getActivity: () => Promise.resolve({}),
};

export const webhookServiceClient = {
  listWebhooks: async (request: { creator: string }) => {
    try {
      // 调用后端的webhook API
      const response = await (apiClient as any).request(`/api/webhook?creator=${encodeURIComponent(request.creator)}`, {
        method: 'GET'
      });
      return response; // 后端应该返回 { webhooks: [...] }
    } catch (error) {
      console.warn('Failed to fetch webhooks:', error);
      // 返回空的webhooks数组作为fallback
      return { webhooks: [] };
    }
  },
  createWebhook: async (request: { name: string; url: string }) => {
    try {
      const response = await (apiClient as any).request('/api/webhook', {
        method: 'POST',
        body: JSON.stringify(request)
      });
      return response;
    } catch (error) {
      console.error('Failed to create webhook:', error);
      throw error;
    }
  },
  deleteWebhook: async (request: { id: number }) => {
    try {
      const response = await (apiClient as any).request(`/api/webhook/${request.id}`, {
        method: 'DELETE'
      });
      return response;
    } catch (error) {
      console.error('Failed to delete webhook:', error);
      throw error;
    }
  },
};

export const markdownServiceClient = {
  parseMarkdown: (request: { markdown: string }) => {
    // 这是一个简化版的markdown解析器
    // 在实际生产环境中，应该使用后端的markdown解析服务
    const nodes = parseMarkdownToNodes(request.markdown);
    return Promise.resolve({ nodes });
  },
  restoreMarkdownNodes: (request: { nodes: any[] }) => {
    // 这是一个简化版的节点还原为markdown的功能
    const markdown = restoreNodesToMarkdown(request.nodes);
    return Promise.resolve({ markdown });
  },
  getLinkMetadata: (request: { link: string }) =>
    Promise.resolve({
      title: request.link,
      description: '',
      image: '',
    }),
};

// 简化版markdown解析器
function parseMarkdownToNodes(markdown: string): any[] {
  const lines = markdown.split('\n');
  const nodes: any[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 代码块处理
    if (line.trim().startsWith('```')) {
      const language = line.trim().substring(3);
      const codeLines = [];
      i++; // 跳过开始的```行
      
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      
      nodes.push({
        type: 'CODE_BLOCK',
        codeBlockNode: {
          language: language,
          content: codeLines.join('\n')
        }
      });
      continue;
    }
    
    // 任务列表项
    if (/^(\s*)- \[([ xX])\] (.*)/.test(line)) {
      const match = line.match(/^(\s*)- \[([ xX])\] (.*)/);
      if (match) {
        const indent = Math.floor(match[1].length / 2);
        const isComplete = match[2].toLowerCase() === 'x';
        const content = match[3];
        
        nodes.push({
          type: 'TASK_LIST_ITEM',
          taskListItemNode: {
            symbol: '-',
            indent: indent,
            complete: isComplete,
            children: [
              {
                type: 'TEXT',
                textNode: {
                  content: content
                }
              }
            ]
          }
        });
      }
    }
    // 普通列表项
    else if (/^(\s*)- (.*)/.test(line)) {
      const match = line.match(/^(\s*)- (.*)/);
      if (match) {
        const indent = Math.floor(match[1].length / 2);
        nodes.push({
          type: 'UNORDERED_LIST_ITEM',
          unorderedListItemNode: {
            symbol: '-',
            indent: indent,
            children: [
              {
                type: 'TEXT',
                textNode: {
                  content: match[2]
                }
              }
            ]
          }
        });
      }
    }
    // 有序列表项
    else if (/^(\s*)(\d+)\. (.*)/.test(line)) {
      const match = line.match(/^(\s*)(\d+)\. (.*)/);
      if (match) {
        const indent = Math.floor(match[1].length / 2);
        nodes.push({
          type: 'ORDERED_LIST_ITEM',
          orderedListItemNode: {
            number: match[2],
            indent: indent,
            children: [
              {
                type: 'TEXT',
                textNode: {
                  content: match[3]
                }
              }
            ]
          }
        });
      }
    }
    // 标题
    else if (/^#{1,6} (.*)/.test(line)) {
      const match = line.match(/^(#{1,6}) (.*)/);
      if (match) {
        nodes.push({
          type: 'HEADING',
          headingNode: {
            level: match[1].length,
            children: [
              {
                type: 'TEXT',
                textNode: {
                  content: match[2]
                }
              }
            ]
          }
        });
      }
    }
    // 行内代码
    else if (/`([^`]+)`/.test(line)) {
      // 这是一个简化处理，实际应该更复杂地解析行内元素
      const parts = line.split(/(`[^`]+`)/);
      const textChildren = [];
      
      for (const part of parts) {
        if (part.startsWith('`') && part.endsWith('`')) {
          textChildren.push({
            type: 'CODE',
            codeNode: {
              content: part.slice(1, -1)
            }
          });
        } else if (part.trim()) {
          textChildren.push({
            type: 'TEXT',
            textNode: {
              content: part
            }
          });
        }
      }
      
      if (textChildren.length > 0) {
        nodes.push({
          type: 'PARAGRAPH',
          paragraphNode: {
            children: textChildren
          }
        });
      }
    }
    // 普通文本
    else if (line.trim()) {
      nodes.push({
        type: 'PARAGRAPH',
        paragraphNode: {
          children: [
            {
              type: 'TEXT',
              textNode: {
                content: line
              }
            }
          ]
        }
      });
    }
    // 换行
    else {
      nodes.push({
        type: 'LINE_BREAK'
      });
    }
  }
  
  return nodes;
}

// 简化版节点还原为markdown
function restoreNodesToMarkdown(nodes: any[]): string {
  const lines: string[] = [];
  
  for (const node of nodes) {
    switch (node.type) {
      case 'TASK_LIST_ITEM':
        if (node.taskListItemNode) {
          const indent = '  '.repeat(node.taskListItemNode.indent || 0);
          const checkbox = node.taskListItemNode.complete ? '[x]' : '[ ]';
          const content = extractTextFromChildren(node.taskListItemNode.children || []);
          lines.push(`${indent}- ${checkbox} ${content}`);
        }
        break;
        
      case 'UNORDERED_LIST_ITEM':
        if (node.unorderedListItemNode) {
          const indent = '  '.repeat(node.unorderedListItemNode.indent || 0);
          const content = extractTextFromChildren(node.unorderedListItemNode.children || []);
          lines.push(`${indent}- ${content}`);
        }
        break;
        
      case 'ORDERED_LIST_ITEM':
        if (node.orderedListItemNode) {
          const indent = '  '.repeat(node.orderedListItemNode.indent || 0);
          const content = extractTextFromChildren(node.orderedListItemNode.children || []);
          lines.push(`${indent}${node.orderedListItemNode.number}. ${content}`);
        }
        break;
        
      case 'CODE_BLOCK':
        if (node.codeBlockNode) {
          lines.push(`\`\`\`${node.codeBlockNode.language || ''}`);
          lines.push(node.codeBlockNode.content || '');
          lines.push('```');
        }
        break;
        
      case 'HEADING':
        if (node.headingNode) {
          const level = '#'.repeat(node.headingNode.level || 1);
          const content = extractTextFromChildren(node.headingNode.children || []);
          lines.push(`${level} ${content}`);
        }
        break;
        
      case 'PARAGRAPH':
        if (node.paragraphNode) {
          const content = extractTextFromChildren(node.paragraphNode.children || []);
          lines.push(content);
        }
        break;
        
      case 'TEXT':
        if (node.textNode) {
          lines.push(node.textNode.content || '');
        }
        break;
        
      case 'LINE_BREAK':
        lines.push('');
        break;
        
      default:
        // 对于其他类型，尝试提取文本内容
        if (node.textNode) {
          lines.push(node.textNode.content || '');
        }
        break;
    }
  }
  
  return lines.join('\n');
}

// 辅助函数：从children节点中提取文本内容
function extractTextFromChildren(children: any[]): string {
  const textParts: string[] = [];
  
  for (const child of children) {
    switch (child.type) {
      case 'TEXT':
        if (child.textNode) {
          textParts.push(child.textNode.content || '');
        }
        break;
      case 'CODE':
        if (child.codeNode) {
          textParts.push(`\`${child.codeNode.content || ''}\``);
        }
        break;
      default:
        // 对于其他类型，尝试递归提取
        if (child.children) {
          textParts.push(extractTextFromChildren(child.children));
        } else if (child.textNode) {
          textParts.push(child.textNode.content || '');
        }
        break;
    }
  }
  
  return textParts.join('');
}

export const identityProviderServiceClient = {
  listIdentityProviders: () => Promise.resolve({ identityProviders: [] }),
  getIdentityProvider: (request: { name: string }) => Promise.resolve({
    name: request.name,
    type: 'OAUTH2',
    title: '',
    identifierFilter: '',
    config: undefined,
  }),
  createIdentityProvider: (request: { identityProvider: any }) => Promise.resolve(request.identityProvider),
  updateIdentityProvider: (request: { identityProvider: any }) => Promise.resolve(request.identityProvider),
  deleteIdentityProvider: (request: { name: string }) => Promise.resolve({}),
};
