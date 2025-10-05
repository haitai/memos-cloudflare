# 环境变量配置说明

## 前端配置 (frontend/.env.local)

创建 `frontend/.env.local` 文件，内容如下：

```bash
# 后端Workers URL (必需)
VITE_BACKEND_URL=https://your-worker-name.your-subdomain.workers.dev

# 可选：API基础URL (如果设置，优先级高于VITE_BACKEND_URL)
# VITE_API_BASE_URL=https://your-custom-api-domain.com
```

## 后端配置 (Cloudflare Workers环境变量)

在Cloudflare Dashboard中配置以下环境变量：

### 必需变量：
```bash
JWT_SECRET=your-super-secret-jwt-key-at-least-32-characters
```

### 可选变量：
```bash
# 允许的前端域名列表（逗号分隔）
ALLOWED_ORIGINS=https://your-frontend-domain.com,https://another-domain.com

# 基础URL
BASE_URL=https://your-worker-name.your-subdomain.workers.dev

# 日志级别
LOG_LEVEL=info
```

## 部署命令

### 设置环境变量：
```bash
# 切换到后端目录
cd backend

# 设置JWT密钥（使用随机生成的安全密钥）
echo "memos-cloudflare-jwt-secret-2025-$(openssl rand -hex 16)" | npx wrangler secret put JWT_SECRET

# 设置允许的前端域名（替换为您的实际域名）
echo "https://your-frontend-domain.com,https://memos-cloudflare.pages.dev" | npx wrangler secret put ALLOWED_ORIGINS
```

### 已配置的环境变量：
✅ **JWT_SECRET** - 已设置随机生成的安全密钥  
✅ **ALLOWED_ORIGINS** - 已设置允许的前端域名  
✅ **BASE_URL** - 已更新为正确的Worker URL  
✅ **R2 Bucket** - 已绑定 memos-assets 存储桶  
✅ **D1 Database** - 已绑定 memos 数据库

### 部署：
```bash
# 部署后端
cd backend && npm run deploy

# 构建前端
cd frontend && npm run build
```

## 安全注意事项

1. **不要**在代码中硬编码任何域名或密钥
2. **不要**将 .env.local 文件提交到Git
3. **确保**JWT_SECRET足够复杂和随机
4. **定期**更换JWT密钥 