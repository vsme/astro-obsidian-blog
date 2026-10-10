# 历史 SQL

这里保留原文件内容，用于迁移追溯和生成当前初始化脚本。新项目执行 [../initialize.sql](../initialize.sql)，不要逐个执行历史文件。

仅表情已开通、尚未建立评论基础结构的旧项目，按顺序执行尚未应用的历史评论文件：

1. `diary-comments.sql`
2. `diary-comment-ownership.sql`
3. `diary-comment-reactions.sql`

然后按 [../README.md](../README.md) 执行尚未应用的迁移。原表情 SQL 只用于旧结构重建或测试，不要在当前线上项目重跑，以免恢复旧接口和权限。
