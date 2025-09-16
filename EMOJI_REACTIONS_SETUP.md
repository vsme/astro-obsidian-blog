# 表情功能设置指南

本指南将帮助你为博客添加基于 Supabase 的动态表情功能。

## 🚀 功能特性

- ✅ 实时表情统计
- ✅ 用户状态持久化（基于浏览器指纹）
- ✅ 响应式设计，支持移动端
- ✅ GitHub 风格的表情选择器
- ✅ 数据库级别的安全策略

## 📋 前置要求

一个 [Supabase](https://supabase.com) 账户

## 🛠️ 设置步骤

### 1. 创建 Supabase 项目

1. 访问 [Supabase Dashboard](https://app.supabase.com)
2. 点击 "New Project" 创建新项目
3. 记录下项目的 URL 和 anon key

### 2. 执行数据库脚本

1. 在 Supabase Dashboard 中，进入 "SQL Editor"
2. 复制 `supabase-schema.sql` 文件的内容
3. 粘贴并执行脚本，这将创建所需的表和函数

### 3. 配置环境变量

1. 复制 `.env.example` 文件为 `.env`：
   ```bash
   cp .env.example .env
   ```

2. 编辑 `.env` 文件，填入你的 Supabase 信息：
   ```env
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_KEY=your-anon-key
   ```

### 4. 安装依赖

```bash
pnpm install
```

### 5. EmojiReactions 组件介绍

在你的 Astro 页面或组件中导入并使用 `EmojiReactions` 组件：

```astro
---
// 在 .astro 文件中
import EmojiReactions from '@/components/EmojiReactions';
---

<div>
  <!-- 你的内容 -->
  <h1>我的博客文章</h1>
  <p>文章内容...</p>
  
  <!-- 表情组件 -->
  <EmojiReactions id="post-unique-id" client:load />
</div>
```

**重要提示：**
- `id` 属性必须是唯一的，建议使用文章的 slug 或 ID
- 必须添加 `client:load` 指令以启用客户端交互

## 🔧 配置选项

### 修改可用表情

在 `EmojiReactions.tsx` 中修改 `emojiReactions` 数组：

```typescript
const [emojiReactions, setEmojiReactions] = useState<EmojiReaction[]>([
  { emoji: "👍", label: "+1", count: 0, isActive: false, defaultShow: true },
  { emoji: "👎", label: "-1", count: 0, isActive: false, defaultShow: true },
  // 添加更多表情...
  { emoji: "🔥", label: "火", count: 0, isActive: false },
]);
```

- `defaultShow: true` 的表情会始终显示
- 其他表情只在被激活时显示，或在菜单中可选择

## 🛡️ 安全特性

1. **行级安全策略 (RLS)**：防止直接数据库访问
2. **用户指纹识别**：基于浏览器特征生成用户标识
3. **限流保护**：防止恶意刷表情，每个 IP 每分钟最多 60 次
4. **函数级权限控制**：只能通过预定义函数操作数据

## 🐛 故障排除

### 常见问题

1. **表情不显示或不更新**
   - 检查浏览器控制台是否有错误
   - 确认环境变量配置正确
   - 验证 Supabase 项目状态

2. **数据库连接失败**
   - 检查 SUPABASE_URL 和 SUPABASE_KEY 是否正确
   - 确认 Supabase 项目处于活跃状态

3. **函数执行错误**
   - 在 Supabase Dashboard 的 "Logs" 中查看详细错误信息
   - 确认数据库脚本已正确执行

### 调试模式

在开发环境中，组件会在浏览器控制台输出调试信息。检查控制台以获取详细的错误信息。

## 📊 数据库表结构

- `emoji_reactions`: 存储每个内容的表情统计
- `user_reactions`: 记录用户的表情状态
- `rate_limit_records`: 限流记录（每个IP每分钟最多 60 次）
