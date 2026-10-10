# 表情功能设置指南

当前版本的表情、短评论、HMAC 限流部署步骤统一维护在 [supabase/README.md](./supabase/README.md)。SQL 文件全部位于 `supabase/`。

- 新项目执行 [完整初始化 SQL](./supabase/initialize.sql)，再部署函数及前端。
- 已开通项目只执行尚未应用的升级，不重跑 [原表情 SQL](./supabase/legacy/supabase-schema.sql)，避免重新开放旧写入权限。
- 表情写入通过 `diary-comment` 的 `emoji` 操作，由服务端生成 IP 的 HMAC 摘要；表情不调用 TypeSafe 审核。
- 每个 IP 每分钟最多 60 次表情互动，选择和取消都计数。
- 用户标识为保存在浏览器中的随机 ID，不使用浏览器指纹。

前端继续使用 `SUPABASE_URL` 和公开的 `SUPABASE_KEY`。服务端密钥不得写入前端配置。

`EmojiReactions` 的内容 ID 应使用 `emoji-reactions-` 前缀；当前首页日志和足迹已按此规则生成。
