# Memos Cloudflare 部署版本

基于 [Memos](https://github.com/usememos/memos) 的 Cloudflare 部署方案，使用 Cloudflare Workers + D1 + R2 技术栈。

## 📖 关于项目来源

本项目基于 [Allhuo/memos-cloudflare](https://github.com/Allhuo/memos-cloudflare) 的版本进行开发，其又是基于 [vividmuse/memos-cloudflare](https://github.com/vividmuse/memos-cloudflare) 的早期版本进行开发。

原项目经测试，存在大量bug和功能缺失，在cursor帮助下，修复了已发现的bug，修补了官方memos提供的一些功能，尽量和memos原有功能对齐。

**本人不懂编程，在使用本程序过程中发现的问题请自行解决。**

原作者 [Allhuo](https://github.com/Allhuo) 和 [@vividmuse](https://github.com/vividmuse) ，一并致谢。

## ✨ 特性

- 🚀 **无服务器架构**: Cloudflare Workers 全球边缘部署
- 🗄️ **D1 数据库**: 基于 SQLite 的分布式数据库  
- 📁 **R2 存储**: 文件上传和存储支持
- 🔐 **安全认证**: JWT 身份验证系统
- 🌍 **CORS 支持**: 灵活的跨域配置
- 🎯 **API 兼容**: 与原版 Memos v0.24.x 兼容

## 🚀 快速部署

### 1. 克隆项目

```bash
git clone https://github.com/haitai/memos-cloudflare.git
cd memos-cloudflare
```

### 2. 后端部署

```bash
cd backend

# 安装依赖
npm install

# 创建 D1 数据库
npx wrangler d1 create memos

# 创建 R2 存储桶
npx wrangler r2 bucket create memos-resources

# 复制配置文件并更新数据库 ID
cp wrangler.toml.example wrangler.toml
# 编辑 wrangler.toml，替换 YOUR_D1_DATABASE_ID 为实际的数据库 ID

# 初始化数据库
npx wrangler d1 execute memos --remote --file schema.sql

# 设置环境变量
npx wrangler secret put JWT_SECRET
# 输入: 随机生成的 JWT 密钥

npx wrangler secret put ALLOWED_ORIGINS  
# 输入: https://your-frontend-domain.pages.dev,https://your-custom-domain.com

# 部署 Worker
npx wrangler deploy
```

### 3. 前端部署

1. **连接 GitHub 到 Cloudflare Pages**
   - 在 Cloudflare Dashboard 中创建 Pages 项目
   - 连接你的 GitHub 仓库

2. **配置构建设置**
   ```
   Framework preset: Vite
   Root directory: frontend  
   Build command: pnpm install && pnpm build
   Build output directory: dist
   Node.js version: 18
   ```

3. **设置环境变量**
   ```
   VITE_API_BASE_URL=https://your-worker-name.your-subdomain.workers.dev
   ```

## 🔑 默认登录

- **用户名**: `admin`
- **密码**: `123456`

## ⚠️ 重要安全配置

### 环境变量说明

| 变量 | 位置 | 说明 |
|------|------|------|
| `JWT_SECRET` | Worker Secrets | JWT 签名密钥，必须设置 |
| `ALLOWED_ORIGINS` | Worker Secrets | 允许的前端域名，逗号分隔 |
| `VITE_API_BASE_URL` | Pages Environment | 前端 API 地址 |

### 🔒 安全检查清单

- [ ] 修改默认管理员密码
- [ ] 设置强 JWT_SECRET
- [ ] 配置正确的 ALLOWED_ORIGINS
- [ ] 将 `wrangler.toml` 添加到 `.gitignore`（如果包含敏感信息）

## 🛠️ 故障排除

### 前端显示 "Failed to fetch"

**原因**: CORS 配置问题

**解决方案**:
1. 检查 `ALLOWED_ORIGINS` 是否包含前端域名
2. 确保域名格式正确（不包含末尾斜杠）
3. 重新部署 Worker

```bash
# 重新设置 ALLOWED_ORIGINS
npx wrangler secret put ALLOWED_ORIGINS
# 输入正确的域名列表

# 重新部署
npx wrangler deploy
```

### 数据库连接错误

**解决方案**:
```bash
# 检查数据库列表
npx wrangler d1 list

# 重新执行数据库迁移
npx wrangler d1 execute memos --remote --file schema.sql
```

### 认证失败

**解决方案**:
```bash
# 重新设置 JWT 密钥
npx wrangler secret put JWT_SECRET

# 使用 SHA-256 格式的密码哈希
npx wrangler d1 execute memos --remote --command "UPDATE user SET password = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92' WHERE username = 'admin'"
```

## 📁 项目结构

```
memos-cloudflare/
├── backend/                 # Cloudflare Worker 后端
│   ├── src/                # 源代码
│   ├── schema.sql          # 数据库结构
│   ├── wrangler.toml       # Worker 配置
│   └── wrangler.toml.example # 配置模板
├── frontend/               # React 前端
│   ├── src/               # 源代码
│   └── dist/              # 构建输出
└── .gitignore             # Git 忽略规则
```

## 🔄 本地开发

### 后端开发

```bash
cd backend
npm install
npm run dev
```

### 前端开发

```bash
cd frontend  
pnpm install
pnpm dev
```

## 📊 API 端点

### 认证
- `POST /api/auth/signin` - 用户登录
- `POST /api/auth/signup` - 用户注册（仅 HOST）

### 笔记管理
- `GET /api/memo` - 获取笔记列表
- `POST /api/memo` - 创建笔记
- `PATCH /api/memo/:id` - 更新笔记
- `DELETE /api/memo/:id` - 删除笔记

### 用户管理
- `GET /api/user/me` - 获取当前用户
- `PATCH /api/user/:id` - 更新用户

### 工作区
- `GET /api/workspace/profile` - 获取工作区配置
- `GET /api/workspace/setting` - 获取设置


## 📄 许可证

基于原 [Memos](https://github.com/usememos/memos) 项目，遵循 MIT 许可证。

## 🔗 相关链接

- [Memos 官方项目](https://github.com/usememos/memos)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 文档](https://developers.cloudflare.com/d1/)
- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/) 

