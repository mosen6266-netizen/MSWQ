# MSWQ · 统一内容管理与发布平台

MSWQ 使用 **Cloudflare Workers + 独立 D1 + 独立 R2**。后台编辑流程和文档，前台仅显示已发布内容。项目源代码在 \`main\` 分支。

## 地址

- 公开首页：\`https://mswq.mosen6266-ms007.workers.dev/\`
- MSWQ 后台：\`https://mswq.mosen6266-ms007.workers.dev/admin\`
- 原版话术流程编辑器（仅管理员）：\`/admin/legacy-editor\`
- DOCX 模板后台（仅管理员）：\`/admin/docx-editor\`
- DOCX 访客工作台（无管理员按钮）：\`/docx\`
- 已发布的 DOCX 模板卡片：\`/view/docx-workspace\`

## 已开发功能

### 网站后台
- 访问密码保护：HTTP-only Secure 会话 Cookie、HMAC 签名、同源写检查、登录失败暂时锁定。
- 内容创建、编辑、复制公开链接、草稿/发布/下架、删除、按数字排序。
- 内容类型：个人流程、群剧本、DOCX 模板、外部工具入口、自定义页面。
- 步骤管理：中文/英语话术、普通文本、绿色提示、等待倒计时、分段、按钮链接、图片和附件。
- 站点设置：标题、简介、公告、页脚、DOCX 入口和首页展示样式（标准卡片/紧凑卡片/列表）。
- 独立素材库：图片、PDF、DOCX、XLSX、PPTX、TXT、ZIP，单文件最大 12MB。
- 历史版本、冲突保护、从历史版本恢复、JSON 内容结构备份。

### 原版话术流程编辑器
- 上传的完整 \`话术剧本流程编辑器(6).html\` 已保存在 \`legacy/flow-editor.html\`。
- 在受保护的 \`/admin/legacy-editor\` 内使用。右下角 **“发布到 MSWQ”** 按钮可把个人流程和群剧本直接保存到云端草稿或发布为分享链接。
- 同一份本地流程重复发布会更新已有内容，而不是自动重复创建。
- 原版编辑器仍使用浏览器本地存储：**从原电脑的 \`file://\` 版本首次转移旧数据，先在原页面“导出编辑备份 JSON”，在 MSWQ 的“导入与备份”导入**。不同网页域名不会自动共享 localStorage/IndexedDB。
- 个人流程/群剧本的公开查看页使用 MSWQ 只读呈现。少数原版的导航/关键词/样式细节及部分附件可能需要检查迁移效果；并不保证原界面的像素级复制。
- 编辑器点击“发布到 MSWQ”会尽力同步本地附件；超过文件限制、旧浏览器无法访问的附件需要手动在素材库补充。

### DOCX 模板工作台
- 从原生产 \`ms-khmb\` 的 HTML 获取并保留文档模板编辑能力，不修改原有 Worker/KV/D1。
- **公开 \`/docx\` 页面**使用文档查看和填写引擎，隐藏旧管理员登录/上传/删除控件；MSWQ 的代理只允许 GET 模板列表、指定模板版本和 DOCX 下载，服务端拒绝公开写入。
- **受保护 \`/admin/docx-editor\`** 可继续使用原有 DOCX 管理工作台。由于原服务仍具有自己的管理员鉴权，进入后需原有的管理员密码；这比迁移原始数据更安全，不影响原线上工具。
- DOCX 模板文件和原版元数据仍存储在老 \`MS_KHMB\`，由 Cloudflare Service Binding 连接。MSWQ 不复制或覆盖模板数据。
- 此设计实现了统一后台入口和独立的无管理员控件的公开入口，但**尚未将 DOCX 的完整业务逻辑、模板数据和原有管理员认证完全迁移为 MSWQ 自有数据模型**。

## 云端资源

- Worker: \`mswq\`
- D1: \`mswq_db\`，ID \`d5cec61e-dc5a-4550-9b6f-25cc419c5ba0\`
- R2: \`mswq-files\`
- Service Binding: \`DOCX_SERVICE -> ms-khmb\`
- 密钥: \`ADMIN_PASSWORD\`（需要手动配置，可选增加独立 \`SESSION_SECRET\`）

**必须手工配置管理员密钥（不能提交仓库）：**

在 Cloudflare Dashboard → Workers & Pages → \`mswq\` → Settings → Variables and Secrets → Add，选择 **Secret**：

\`\`\`text
Name: ADMIN_PASSWORD
Value: <your own strong random password>
\`\`\`

保存/部署后打开 \`/admin\`，输入该密码登录。登录签名使用 \`SESSION_SECRET\`（若存在），否则采用独立的 \`ADMIN_PASSWORD\` 派生的密钥。公开前台不要求此密钥。建议另行配置 \`SESSION_SECRET\`，并按需要轮换密码。

## 源代码

- \`src/worker.js\`：Cloudflare Worker 服务、权限、数据库、上传和只读 DOCX 接口。
- \`public/index.html\`, \`public/app.js\`, \`public/app.css\`：公开网站、流程阅读器、管理员界面、样式。
- \`public/legacy-bridge.js\`：原编辑器到在线发布系统的同步桥接。
- \`legacy/flow-editor.html\`：完整原版流程编辑器（在服务器端要求管理员身份）。
- \`legacy/docx-public.html\`：文档访客版，隐藏管理员入口。
- \`legacy/docx-admin.html\`：独立保存的旧文档管理版源码参考。
- \`schema.sql\`：D1 schema 初始化。

部署器把 HTML、CSS 和 JS 编译为 \`src/worker.js\` 中的 \`__MSWQ_ASSETS__\` 常量；该 Worker 已通过 Cloudflare API 发布。仅更改 GitHub 代码不会自动部署到线上；需要重新打包和上传 Worker。后台的内容修改直接写 D1/R2，**不需 GitHub 发布**。

## 安全说明与后续扩展

- **公开内容/附件不要包含私人客户数据、密钥、内部文档等机密**；使用公开分享链接的人可以阅读。
- 目前未实现按用户的访问密码、角色权限、定时发布、审计日志、可视化拖拽网格、DOCX 后端整体迁移、原编辑器全部特性 1:1 复刻、文件回收站、全站访问日志；这些是后续规划，不能视为已完成。
- 不会修改或重启 Telegram、Signal、MS_KHMB、授权系统等其他 Worker/数据库。
