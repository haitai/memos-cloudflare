// REST API Client for Cloudflare Workers Backend

import { NodeType } from '@/types/proto/api/v1/markdown_service';

// 获取 API 基础 URL，优先级：环境变量 > 同域名下的 /api > 默认后端地址
const getApiBaseUrl = () => {
  // 如果设置了环境变量，使用环境变量
  if (import.meta.env.VITE_API_BASE_URL) {
    const url = import.meta.env.VITE_API_BASE_URL;
    // 确保 URL 包含协议前缀
    if (url && !url.startsWith('http')) {
      return `https://${url}`;
    }
    return url;
  }
  
  // 生产环境使用环境变量配置的后端URL
  if (import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL;
  }
  
  // 开发环境或其他情况，使用相对路径
  return '';
};

const API_BASE_URL = getApiBaseUrl();

interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  message?: string;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
    console.log('🔗 API Client initialized with base URL:', this.baseUrl);
  }

  private async request<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const defaultHeaders: Record<string, string> = {};

    // Only set Content-Type for non-FormData requests
    if (!(options.body instanceof FormData)) {
      defaultHeaders['Content-Type'] = 'application/json';
    }

    // Add auth token if available
    const token = localStorage.getItem('accessToken');
    if (token) {
      defaultHeaders['Authorization'] = `Bearer ${token}`;
    }

    const config: RequestInit = {
      headers: { ...defaultHeaders, ...options.headers },
      credentials: 'include',
      ...options,
    };

    try {
      console.log(`📡 API Request: ${options.method || 'GET'} ${url}`);
      const response = await fetch(url, config);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`❌ API Error: ${response.status}`, errorData);
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log(`✅ API Response: ${options.method || 'GET'} ${url}`, data);
      return data;
    } catch (error) {
      console.error(`💥 API request failed: ${endpoint}`, error);
      throw error;
    }
  }

  // Auth Services
  async signIn(username: string, password: string) {
    const response = await this.request<{ accessToken?: string, user?: any }>('/api/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    
    // 保存 token 到 localStorage
    if (response.accessToken) {
      localStorage.setItem('accessToken', response.accessToken);
    }
    
    return response;
  }

  async signUp(username: string, password: string, email?: string) {
    return this.request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, password, email }),
    });
  }

  // User Services
  async getCurrentUser() {
    const user = await this.request<any>('/api/user/me');
    // 转换为前端期望的protobuf格式
    return {
      name: `users/${user.id}`,
      username: user.username || '',
      nickname: user.nickname || '',
      email: user.email || '',
      avatarUrl: user.avatarUrl || '',
      description: user.description || '',
      role: user.role || 'USER',
      state: user.rowStatus === 'NORMAL' ? 'ACTIVE' : 'ARCHIVED',
      createTime: user.createdTs ? new Date(user.createdTs * 1000) : new Date(),
      updateTime: user.updatedTs ? new Date(user.updatedTs * 1000) : new Date(),
    };
  }

  async getUser(id: number) {
    const user = await this.request<any>(`/api/user/${id}`);
    // 转换为前端期望的protobuf格式
    return {
      name: `users/${user.id}`,
      username: user.username || '',
      nickname: user.nickname || '',
      email: user.email || '',
      avatarUrl: user.avatarUrl || '',
      description: user.description || '',
      role: user.role || 'USER',
      state: user.rowStatus === 'NORMAL' ? 'ACTIVE' : 'ARCHIVED',
      createTime: user.createdTs ? new Date(user.createdTs * 1000) : new Date(),
      updateTime: user.updatedTs ? new Date(user.updatedTs * 1000) : new Date(),
    };
  }

  async getUserByUsername(username: string) {
    return this.request(`/api/user/username/${username}`);
  }

  async listUsers() {
    return this.request('/api/user');
  }

  async updateUser(id: number, data: any) {
    const user = await this.request<any>(`/api/user/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    // 转换为前端期望的protobuf格式
    return {
      name: `users/${user.id}`,
      username: user.username || '',
      nickname: user.nickname || '',
      email: user.email || '',
      avatarUrl: user.avatarUrl || '',
      description: user.description || '',
      role: user.role || 'USER',
      state: user.rowStatus === 'NORMAL' ? 'ACTIVE' : 'ARCHIVED',
      createTime: user.createdTs ? new Date(user.createdTs * 1000) : new Date(),
      updateTime: user.updatedTs ? new Date(user.updatedTs * 1000) : new Date(),
    };
  }

  async deleteUser(id: number) {
    return this.request(`/api/user/${id}`, {
      method: 'DELETE',
    });
  }

  // Helper function to convert plain text to nodes structure
  private convertContentToNodes(content: string) {
    if (!content || content.trim() === '') {
      return [];
    }

    // Split content by paragraphs (double newlines)
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim());
    
    const nodes = [];
    
    for (const paragraph of paragraphs) {
      const children = [];

      // Split paragraph by single newlines for line breaks
      const lines = paragraph.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
          // Add text node
          children.push({
            type: NodeType.TEXT,
            textNode: {
              content: line
            }
          });
        }
        
        // Add line break if not the last line
        if (i < lines.length - 1) {
          children.push({
            type: NodeType.LINE_BREAK,
            lineBreakNode: {}
          });
        }
      }

      // Create a paragraph node
      if (children.length > 0) {
        nodes.push({
          type: NodeType.PARAGRAPH,
          paragraphNode: {
            children: children
          }
        });
      }
    }

    return nodes;
  }

  // Memo Services
  async getMemos(params: any = {}) {
	// params.state 是 State.ARCHIVED 时，转换为 rowStatus: 'ARCHIVED'
	if (params.state === 'ARCHIVED') {
		params.rowStatus = 'ARCHIVED';
	}

    const searchParams = new URLSearchParams(params);
    const memos = await this.request<any[]>(`/api/memo?${searchParams}`);

    
    // 转换为前端期望的protobuf格式
    const formattedMemos = Array.isArray(memos) ? memos.map(memo => ({
      name: `memos/${memo.id}`,
      uid: memo.uid || `memo-uid-${memo.id}`,
      creator: `users/${memo.creatorId}`,
      content: memo.content || '',
      nodes: this.convertContentToNodes(memo.content || ''),
      visibility: memo.visibility || 'PRIVATE',
      tags: memo.tags || [],
      pinned: memo.pinned || false,
      resources: memo.resources || [], // 使用后端返回的完整资源对象数组
      relations: memo.relations || [],
      reactions: memo.reactions || [],
      snippet: memo.content ? memo.content.slice(0, 100) : '',
      parent: memo.parent || '',
      createTime: memo.createdTs ? new Date(memo.createdTs * 1000) : new Date(),
      updateTime: memo.updatedTs ? new Date(memo.updatedTs * 1000) : new Date(),
      displayTime: memo.createdTs ? new Date(memo.createdTs * 1000) : new Date(),
      state: memo.rowStatus === 'ARCHIVED' ? 'ARCHIVED' : 'NORMAL',
      location: memo.location || undefined,
    })) : [];
    
    const result = { 
      memos: formattedMemos, 
      nextPageToken: '' // 暂时返回空字符串，表示没有更多页面
    };
    
    console.log('🔄 Transformed memo response:', result);
    return result;
  }

  async getMemo(id: number) {
    const memo = await this.request<any>(`/api/memo/${id}`);
    
    // 转换为前端期望的protobuf格式
    return {
      name: `memos/${memo.id}`,
      uid: memo.uid || `memo-uid-${memo.id}`,
      creator: `users/${memo.creatorId}`,
      content: memo.content || '',
      nodes: this.convertContentToNodes(memo.content || ''),
      visibility: memo.visibility || 'PRIVATE',
      tags: memo.tags || [],
      pinned: memo.pinned || false,
      resources: memo.resources || [], // 使用后端返回的完整资源对象数组
      relations: memo.relations || [],
      reactions: memo.reactions || [],
      snippet: memo.content ? memo.content.slice(0, 100) : '',
      parent: memo.parent || '',
      createTime: memo.createdTs ? new Date(memo.createdTs * 1000) : new Date(),
      updateTime: memo.updatedTs ? new Date(memo.updatedTs * 1000) : new Date(),
      displayTime: memo.createdTs ? new Date(memo.createdTs * 1000) : new Date(),
      state: memo.rowStatus === 'ARCHIVED' ? 'ARCHIVED' : 'NORMAL',
      location: memo.location || undefined,
    };
  }

  async createMemo(data: any) {
    const memo = await this.request<any>('/api/memo', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    
    // 转换为前端期望的protobuf格式
    return {
      name: `memos/${memo.id}`,
      uid: memo.uid || `memo-uid-${memo.id}`,
      creator: `users/${memo.creatorId}`,
      content: memo.content || '',
      nodes: this.convertContentToNodes(memo.content || ''),
      visibility: memo.visibility || 'PRIVATE',
      tags: memo.tags || [],
      pinned: memo.pinned || false,
      resources: memo.resources || [], // 使用后端返回的完整资源对象数组
      relations: memo.relations || [],
      reactions: memo.reactions || [],
      snippet: memo.content ? memo.content.slice(0, 100) : '',
      parent: memo.parent || '',
      createTime: memo.createdTs ? new Date(memo.createdTs * 1000) : new Date(),
      updateTime: memo.updatedTs ? new Date(memo.updatedTs * 1000) : new Date(),
      displayTime: memo.createdTs ? new Date(memo.createdTs * 1000) : new Date(),
      state: memo.rowStatus === 'ARCHIVED' ? 'ARCHIVED' : 'NORMAL',
      location: memo.location || undefined,
    };
  }

  async updateMemo(id: number, data: any) {
    const memo = await this.request<any>(`/api/memo/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    
    // 转换为前端期望的protobuf格式
    return {
      name: `memos/${memo.id}`,
      uid: memo.uid || `memo-uid-${memo.id}`,
      creator: `users/${memo.creatorId}`,
      content: memo.content || '',
      nodes: this.convertContentToNodes(memo.content || ''),
      visibility: memo.visibility || 'PRIVATE',
      tags: memo.tags || [],
      pinned: memo.pinned || false,
      resources: memo.resources || [], // 使用后端返回的完整资源对象数组
      relations: memo.relations || [],
      reactions: memo.reactions || [],
      snippet: memo.content ? memo.content.slice(0, 100) : '',
      parent: memo.parent || '',
      createTime: memo.createdTs ? new Date(memo.createdTs * 1000) : new Date(),
      updateTime: memo.updatedTs ? new Date(memo.updatedTs * 1000) : new Date(),
      displayTime: memo.createdTs ? new Date(memo.createdTs * 1000) : new Date(),
      state: memo.rowStatus === 'ARCHIVED' ? 'ARCHIVED' : 'NORMAL',
      location: memo.location || undefined,
    };
  }

  async deleteMemo(id: number) {
    return this.request(`/api/memo/${id}`, {
      method: 'DELETE',
    });
  }

  // Tag Services
  async getTags() {
    return this.request('/api/tag');
  }

  async createTag(name: string) {
    return this.request('/api/tag', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async deleteTag(id: number) {
    return this.request(`/api/tag/${id}`, {
      method: 'DELETE',
    });
  }

  // Resource Services
  async uploadResource(file: File) {
    const formData = new FormData();
    formData.append('file', file);

    return this.request('/api/resource/blob', {
      method: 'POST',
      body: formData,
    });
  }

  // Workspace Services
  async getWorkspaceProfile() {
    return this.request('/api/workspace/profile');
  }

  async getWorkspaceSetting(name: string) {
    return this.request(`/api/workspace/setting?name=${encodeURIComponent(name)}`);
  }

  async setWorkspaceSetting(setting: any) {
    return this.request('/api/workspace/setting', {
      method: 'POST',
      body: JSON.stringify({ setting }),
    });
  }

  private getDefaultSetting(key: string) {
    const defaults: Record<string, any> = {
      'GENERAL': {
        disallowUserRegistration: false,
        disallowPasswordAuth: false,
        additionalScript: '',
        additionalStyle: '',
        customProfile: {
          title: 'Memos',
          description: 'A privacy-first, lightweight note-taking service',
          logoUrl: '',
          locale: 'en',
          appearance: 'auto',
        },
        weekStartDayOffset: 0,
        disallowChangeUsername: false,
        disallowChangeNickname: false,
      },
      'STORAGE': {
        storageType: 'DATABASE',
        filepathTemplate: '{{filename}}',
        uploadSizeLimitMb: 32,
        s3Config: undefined,
      },
      'MEMO_RELATED': {
        disallowPublicVisibility: false,
        displayWithUpdateTime: false,
        contentLengthLimit: 1000,
        autoCollapse: false,
        defaultVisibility: 'PRIVATE',
      },
    };
    return defaults[key] || {};
  }

  // Health check
  async getHealth() {
    return this.request('/health');
  }

  // User Settings
  async getUserSetting(userId: number) {
    const setting = await this.request<any>(`/api/user/${userId}/setting`);
    return {
      name: setting.name,
      locale: setting.locale || 'zh',
      appearance: setting.appearance || 'system',
      memoVisibility: setting.memoVisibility || 'PRIVATE',
    };
  }

  async updateUserSetting(userId: number, data: any) {
    const setting = await this.request<any>(`/api/user/${userId}/setting`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return {
      name: setting.name,
      locale: setting.locale,
      appearance: setting.appearance,
      memoVisibility: setting.memoVisibility,
    };
  }

  // User Stats Services
  async getUserStats(userId: number) {
    const stats = await this.request<any>(`/api/user/${userId}/stats`);
    return {
      name: stats.name,
      memoDisplayTimestamps: stats.memoDisplayTimestamps || [],
      memoTypeStats: stats.memoTypeStats || {
        totalMemoCount: 0,
        dailyMemoCount: 0,
        weeklyMemoCount: 0,
        monthlyMemoCount: 0,
      },
      tagCount: stats.tagCount || {},
      pinnedMemos: stats.pinnedMemos || [],
      totalMemoCount: stats.totalMemoCount || 0,
    };
  }

  async getAllUserStats() {
    const response = await this.request<{ userStats: any[] }>('/api/user/stats');
    return {
      userStats: response.userStats || []
    };
  }
}

export const apiClient = new ApiClient();
export default apiClient; 