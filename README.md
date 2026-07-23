# Be Good One

一个基于 [Astro](https://astro.build/) 构建的个人网站，用于记录生活中的片段。

## ✨ 特性

- 📝 **类型安全的 Markdown** - 完全的 TypeScript 支持
- ⚡ **超快性能** - 基于 Astro 的静态站点生成
- ♿ **无障碍访问** - 支持键盘导航和屏幕阅读器
- 📱 **响应式设计** - 从移动设备到桌面的完美适配
- 🔍 **SEO 友好** - 优化的搜索引擎表现
- 🌓 **明暗主题** - 支持亮色和暗色模式切换
- 🔎 **模糊搜索** - 基于 Pagefind 的快速搜索功能
- 📄 **草稿和分页** - 支持草稿文章和分页显示
- 🗺️ **站点地图和 RSS** - 自动生成站点地图和 RSS 订阅
- 🎨 **高度可定制** - 灵活的配置和样式定制
- 🖼️ **动态 OG 图片** - 自动生成博客文章的 OG 图片
- 📔 **时间线功能** - 首页默认展示日常时间线
- 📚 **媒体卡片** - 支持电影、书籍等媒体信息展示
- 💬 **评论功能** - 支持用户评论文章
- 🥳 **表情功能** - 支持在日常时间线点击使用表情互动（无需登录）

## 🚀 项目结构

```
/
├── public/
│   ├── favicon.png
│   ├── app-controls.js
│   └── og.jpg
├── src/
│   ├── assets/          # 静态资源（图标、图片等）
│   ├── components/      # Astro 和 React 组件
│   ├── data/
│   │   ├── blog/        # 博客文章
│   │   ├── diary/       # 日常时间线
│   │   ├── footprints/  # 照片足迹
│   │   └── attachment/  # 媒体附件
│   ├── layouts/         # 页面布局
│   ├── pages/           # 页面路由
│   │   ├── diary/       # 日记相关页面
│   │   ├── posts/       # 博客文章页面
│   │   └── api/         # API 路由
│   ├── styles/          # 样式文件
│   ├── utils/           # 工具函数
│   ├── config.ts        # 网站配置
│   └── constants.ts     # 常量定义
├── astro.config.ts      # Astro 配置
└── package.json
```

## 🛠️ 技术栈

- **主框架**: [Astro](https://astro.build/)
- **类型检查**: [TypeScript](https://www.typescriptlang.org/)
- **样式**: [TailwindCSS](https://tailwindcss.com/)
- **UI 组件**: [React](https://react.dev/)
- **搜索**: [Pagefind](https://pagefind.app/)
- **图标**: [Lucide React](https://lucide.dev/)
- **代码格式化**: [Prettier](https://prettier.io/)
- **代码检查**: [ESLint](https://eslint.org/)
- **部署**: [Vercel](https://vercel.com/)
- **留言** [Giscus](https://giscus.app/)
- **数据库**: [Supabase](https://supabase.com/)

## 📦 安装和使用

### 环境要求

- Node.js 18+
- pnpm (推荐)

### 本地开发

```bash
# 克隆项目
git clone https://github.com/vsme/astro-obsidian-blog.git
cd astro-obsidian-blog

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

访问 `http://localhost:4321` 查看网站。

### 构建和部署

```bash
# 构建生产版本
pnpm build

# 预览构建结果
pnpm preview
```

## ⚙️ 配置

网站的主要配置位于 `src/config.ts` 文件中，你可以修改以下设置：

- 网站基本信息（标题、描述、作者等）
- 社交媒体链接
- 主题设置
- 分页设置
- 功能开关
- 表情功能配置参考 [EMOJI_REACTIONS_SETUP](./EMOJI_REACTIONS_SETUP.md)

## 📝 添加内容

### 博客文章

在 `src/data/blog/` 目录下创建 Markdown 或 MDX 文件，文件需要包含以下 frontmatter：

```markdown
---
title: "文章标题"
author: "作者名称"
pubDatetime: 2025-01-01T12:00:00+08:00
modDatetime: # 可选，修改时间
featured: false
draft: false
tags:
  - "标签1"
  - "标签2"
description: "文章描述"
ogImage: "../attachment/og/image.png" # 可选，OG图片
slug: "article-slug" # 可选，自定义URL
---

文章内容...
```

支持的文件格式：

- `.md` - 标准 Markdown 文件
- `.mdx` - 支持 React 组件的 MDX 文件

### 日记

在 `src/data/diary/` 目录下创建以日期命名的 Markdown 文件（如 `2025-01-30.md`），记录日常。

日记文件格式：

````markdown
## 21:02

记录内容...

```card-movie
source: douban
id: 电影ID
title: 电影标题
```
````

支持卡片组件：

- `card-movie` - 电影卡片，支持豆瓣/IMDB数据
- `card-book` - 书籍卡片，支持豆瓣数据
- 其他媒体卡片组件，具体查看[obsidian-card-viewer](https://github.com/vsme/obsidian-card-viewer)。

卡片建议搭配 Obsidian 使用（PS:需要自己写抓取脚本）：

https://github.com/user-attachments/assets/fab12904-d1db-41c2-83bf-fd26013910f1

### 足迹

足迹内容建议搭配 Obsidian 插件
[Footprint Studio](https://github.com/vsme/obsidian-footprint-studio) 使用。插件面向本项目的足迹格式，可辅助整理照片和地点信息、生成足迹 Markdown，减少手动维护 frontmatter 的工作。

在 `src/data/footprints/` 目录下创建 Markdown 或 MDX 文件，例如 `2026-07-04-daruyishengjing.md`。

每条足迹至少需要包含访问日期、地点、经纬度和一张照片：

```markdown
---
visitedAt: 2026-07-04
country: "中国"
region: "江苏省"
city: "苏州市"
district: "吴中区" # 可选
town: "金庭镇" # 可选
street: "西洞庭山路" # 可选
place: "大如意圣境"
coordinates:
  lat: 31.101812
  lng: 120.234868
draft: false # 可选，设为 true 时不公开
relatedPosts: # 可选，填写博客文章的内容 ID
  - "相关文章"
photos:
  - src: "../attachment/footprints/2026-07-04-daruyishengjing/photo.jpg"
    alt: "大如意圣境"
    caption: "摸摸佛脚" # 可选
    position: "center top" # 可选，对应 CSS object-position
  - src: "../attachment/footprints/2026-07-04-daruyishengjing/other.jpg"
    alt: "大如意圣境"
    hidden: true # 可选，不在足迹相册中展示
---

这里可以补充当时的见闻和感受，正文会作为足迹备注展示。
```

注意：

- `coordinates.lat` 和 `coordinates.lng` 分别使用十进制度格式的纬度和经度。
- `photos.src` 使用相对于当前 Markdown 文件的路径，图片建议统一放在
  `src/data/attachment/footprints/日期-地点/` 中。
- `alt` 应描述照片内容，既方便无障碍访问，也能在图片无法加载时提供信息。
- 同一地点可以创建多条不同日期的记录，地图会按位置聚合展示。

## 🎨 自定义样式

项目使用 TailwindCSS 进行样式管理，你可以：

1. 修改 `src/styles/global.css` 中的全局样式
2. 在组件中使用 TailwindCSS 类名
3. 通过 CSS 变量自定义主题颜色

## 📄 许可证

本项目基于 MIT 许可证开源。

## 🙏 致谢

本项目基于 [satnaing/astro-paper](https://github.com/satnaing/astro-paper) 开发，感谢原作者 [Sat Naing](https://github.com/satnaing) 创建了这个优秀的 Astro 博客主题，为本项目提供了坚实的基础。

特别感谢：

- [Astro](https://astro.build/) - 现代化的静态站点生成器
- [TailwindCSS](https://tailwindcss.com/) - 实用优先的 CSS 框架
- [Pagefind](https://pagefind.app/) - 静态搜索解决方案

---

💝 用心记录生活中的每一个温暖瞬间
