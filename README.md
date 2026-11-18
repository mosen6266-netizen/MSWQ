# MSWQ · 内容与工具中心

独立的 Cloudflare Worker + D1 + R2 内容发布平台：管理员编辑，前台仅查看已发布内容。

## 已开发功能
- 密码保护管理后台：/admin；安全 Cookie、同源写请求、8次失败登录冷却
- 公开首页：标题和公告可编辑、分类筛选、搜索、排序、移动端适配
- 内容类型：个人流程、群剧本、DOCX文档入口、外链工具、自定义内容页面
- 步骤：双语话术、文本、绿色提示、等待倒计时、分段、链接按钮、图片、文件附件
- 云端存储：D1内容和版本记录；R2图片和文件（单文件12MB）
- 版本冲突检查、最近30次版本恢复、发布/下架、备份 JSON
- 兼容导入：原版个人流程与群剧本编辑备份 JSON
- 原版流程编辑器后台隔离入口（仅管理员可打开；原版编辑内容仍在浏览器本地，需要 JSON 导入同步）

## 架构和隔离
- src/worker.js：Cloudflare Worker API、认证、内容和上传服务
- public/index.html：公开端与后台公共入口
- public/app.js：前台阅读器和管理员编辑界面
- public/app.css：商务极简黑灰、绿色提示 UI
- schema.sql：独立 D1 初始化 SQL

绑定：
- DB：独立 D1 数据库 mswq_db
- FILES：独立 R2 存储桶 mswq-files
- ADMIN_PASSWORD：后台独立强随机密码（Worker secret，禁止写入仓库）
- SESSION_SECRET：独立 HMAC 密钥（Worker secret，禁止写入仓库）

src/worker.js 中的占位符 __MSWQ_ASSETS__ 需在构建上传时替换为 {html,js,css,legacy} 四个文本资源。云端部署可使用 Cloudflare Workers Scripts API。

## 旧编辑器迁移
1. 用原版编辑器导出「编辑备份 JSON」，个人流程可选择“备份全部”。
2. 在本站后台 → 导入与备份 → 上传 JSON，先进入草稿。
3. 检查成员、话术、按钮、等待、附件，并补传缺失素材。
4. 在编辑页保存并发布；复制 /view/<slug> 链接给别人。

## DOCX 模块现状
目前提供指向现有 MS_KHMB 文档服务的 iframe 入口。**这不是已完成的 DOCX 模板引擎完整迁移**。旧站的管理员模式由旧站自行控制，不能保证通过 iframe 消除。MSWQ 不修改、重启或共享旧站任何数据库/Worker。正式移植 DOCX 后端、取消旧站管理员入口、将文档管理改为 MSWQ 单一后台，还需要将原有文档处理代码和存储适配至独立服务。

## 后续扩展
角色权限、可视化拖拽布局、定时发布、密码分享、文件版本管理、访问日志、审计、回收站、DOCX 深度整合、分块上传、大规模团队协作等尚未完成；不要将这些视为已交付功能。

所有内容均在独立 MSWQ 资源中，不影响既有 MS_KHMB、Telegram、Signal 或其他在线 Worker。