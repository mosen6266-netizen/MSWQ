# 发给全新 GPT 的 MSWQ 一键迁移指令

我已用新的 Google 账号注册并连接新的 GitHub、Cloudflare 和 ChatGPT 账号。旧 MSWQ 已通过后台「下载完整迁移 ZIP」生成了完整备份。我只会将这个 ZIP 上传一次到**新 GitHub 仓库的 Releases 附件**（Tag: mswq-migration；文件名 MSWQ-complete-*.zip）。不要让我再去 Cloudflare 手工上传数据。

## 你的任务

你必须作为迁移实施者，在**新账号**中把旧 MSWQ 原项目一丝不变地重建，不重写、不换前端、不删除内容、不改变流程与群剧本内部逻辑。旧账号 Cloudflare、GitHub 及现有正式服务保持不变。

### 执行流程（请逐步真正调用工具实施）

1. 读取我提供的新 GitHub 仓库 URL，找到 Tag=mswq-migration 的 Release 唯一附件 MSWQ-complete-*.zip。读取、下载并校验 ZIP 的 CRC、manifest.json 和 READ-FIRST.txt。
2. 从 ZIP 里的 sources/MSWQ-github.zip 提取**完整项目源码**，阅读 REBUILD-MSWQ.md、scripts/rebuild-from-release.py、scripts/restore-mswq.py、scripts/build-mswq.mjs、配置模板。将源码提交到新 GitHub 仓库 main 分支；不要把完整备份 ZIP 或旧凭据提交到源码历史。
3. 检查新 Cloudflare 连接的账号归属，利用已授权的 Cloudflare 连接/云端工作环境，在**新账号**创建两套全新 D1（DB / DOCX_DB）、一个全新 R2（FILES）、一个全新 KV（DOCX_KV），保留绑定名称，不复用旧账号 ID。部署两个独立 Worker：mswq、mswq-html。新 Workers URL 以实际返回为准。
4. 通过 ZIP 内的恢复工具，将主 D1 和 DOCX D1 的**完整表结构与全部记录**、DOCX KV 的每一个原始值（含历史版本、设置）、R2 的全部对象原始字节与每个 key 的 HTTP metadata/customMetadata 完整恢复。必须保持原版流程 HTML 的签名 customMetadata、所有图片视频、图标、HTML 工具资源及目录结构，不仅是公开显示内容。
5. 允许你使用可用的云端电脑运行 Python 3.10+、Node.js 20+ 和 Wrangler。可使用 scripts/rebuild-from-release.py --repo 新用户名/仓库名 --local-zip 已下载ZIP --execute。该脚本包含自动创建资源、导入、编译、部署、GitHub 源码提交、生成新管理员验证密钥的流程。若云端电脑无法得到连接器的凭据，先通过已连接的 Cloudflare/GitHub 工具或授权浏览器完成相同的 API 操作，不要因此让用户手动向 Cloudflare 上传文件。
6. 所有密码、Google Authenticator TOTP 密钥、SESSION_SECRET、GitHub/Cloudflare API Token 在新账号**重新生成**。不得读取、带走或复用旧账号的密钥。后台必须继续要求管理员密码 + Google Authenticator 六位验证码。使用安全的授权/密钥注入方式，不能把秘密保存进 GitHub 文件。
7. 逐项比对 manifest.json 与恢复端实际数量、总字节及元数据；检查原版个人流程、群剧本、名片、收藏、DOCX 编辑/保存/导出、HTML 工具与相对图片路径、图标、素材库、分类和排序、后台增删改发布、IP 白名单、跳转与返回键、移动端展示、双重验证。不要凭部署成功就认定功能全部正常，必须通过实际浏览器/HTTP/数据库验证。检验新账号链接与旧账号的功能一致；因为 Workers 域名和资源 ID 属于新账号，地址可不同。
8. 全部验收成功后，按我的授权**删除新 GitHub Releases 中作为临时迁移文件上传的 MSWQ-complete-*.zip 附件**（必要时清理仅用于迁移的 Release），保留新 GitHub 中的源码和新 Cloudflare 的正式数据库、文件及服务。Release 附件没有进入 git commit 历史时，不需要为了删除该附件重写正常源码历史。删除前必须确认备份已完整恢复；如果有任何失败，保留备份并报告。
9. 把最终新首页地址、后台地址、HTML 工具域名、GitHub 仓库、资源数量核对结果、管理员新密码/Google Authenticator 绑定方法、是否删除临时 GitHub 附件逐项向我报告。旧 MSWQ 始终保持运行，除非我明确要求切换。

## 硬性要求

- 不要只回复实施计划；有权限和工具就实际执行当前步骤。缺少必须由我完成的 OAuth 授权或账号绑定时，只请求那一个必要动作，其余步骤照常继续。
- 全程不需要我去 Cloudflare 手动上传 ZIP、R2 文件或 D1 SQL。你负责通过连接器、API、脚本或云端浏览器传输。
- 保持原项目 UI、语言、内容、功能、数据、版本、访问控制；不可擅自简化、替换或者创建另一个不兼容的新项目。
- 登录密码及 TOTP 密钥可以与旧站不同，这是新账号安全重建的必要例外。
- 如果 GitHub、Cloudflare 或执行环境的权限限制使“一键自动”无法继续，明确指出当前完成了什么、剩下需要哪项授权，不准谎称已经恢复。
