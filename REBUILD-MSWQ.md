# MSWQ — 完整迁移备份与新账号重建说明

本仓库对应原 MSWQ 正式网站，不要新建一个功能不一致的项目替代。迁移只复制数据，不会删除旧账号资源。

## 一、如何从现有后台下载完整数据

1. 打开站点 /admin，使用管理员密码 + Google Authenticator 六位动态码登录。
2. 左侧选择「导入与备份」。
3. 点击「检查完整备份范围」，确认 D1、R2、DOCX KV 都在列表中。
4. 点击「下载完整迁移 ZIP」。每次都会实时导出当前保存的数据库、全部文件及 GitHub 源码。内容增删修改后重新点击就会得到新快照。
5. ZIP 较大，备份期间不要在后台修改、发布或删除内容。下载后使用 Python zipfile 检验 CRC。

### ZIP 文件结构

| 路径 | 内容 |
|---|---|
| manifest.json | 格式、来源、文件数量、时间及整体清单 |
| sources/MSWQ-github.zip | GitHub main 源码快照 |
| d1/main/schema.json, d1/main/rows/*.jsonl | 主 D1 各表结构与全部行 |
| d1/docx/schema.json, d1/docx/rows/*.jsonl | DOCX 专用 D1 各表结构与全部行 |
| r2/index.json, r2/objects/*.bin | 全部 R2 原始字节、键名、HTTP 元数据、自定义元数据 |
| kv/index.json, kv/values/*.bin | DOCX KV 全部原始值和元信息（含历史版本） |
| READ-FIRST.txt | 离线概览 |

**绝不可把完整迁移 ZIP 上传到公开 GitHub 仓库。** ZIP 中含私人内容、历史版本、DOCX 模板及 IP 白名单。只将 sources/MSWQ-github.zip 解压后的源码上传新 GitHub 仓库。

## 二、全新账号重建顺序

1. 用新 Google 账号完成新 GitHub、新 Cloudflare、新 ChatGPT 的账号注册、登录及授权。身份验证必须由账号本人操作。
2. 将 sources/MSWQ-github.zip 解压到新 GitHub **私有仓库**，分支 main。仓库内有 scripts/build-mswq.mjs、scripts/restore-mswq.py 和两份 Wrangler 配置模板及完整应用源文件。
3. 新 Cloudflare 先创建两个空 D1 数据库（主站、DOCX）、一个空 R2 桶、一个空 Workers KV。Worker 绑定名称分别为 DB、DOCX_DB、FILES、DOCX_KV。新资源 ID 必须使用新账号生成的，不能复制旧 ID。
4. 从 wrangler.main.example.jsonc 填写所有新资源 ID、桶名和新 GitHub 仓库名，保存为 wrangler.jsonc；从 wrangler.html-host.example.jsonc 填写新桶名，保存为 wrangler.html-host.jsonc。
5. 恢复全部数据库、KV、R2；**必须保留 R2 customMetadata**，否则原版流程发布签名可能失效。
6. 部署两个 Worker：mswq 和隔离 HTML 主机 mswq-html。旧源码内 HTML_VIEW_ORIGIN 必须指向新 mswq-html Worker 的真实 URL。
7. 每次修改 GitHub 源码并重新部署时，都必须重新运行 build-mswq.mjs 并上传 dist/mswq-source-snapshot.json 到私有 R2；普通的后台内容变化不需要这个步骤。之后在新 Cloudflare 创建新的 ADMIN_PASSWORD 和 ADMIN_TOTP_SECRET 两个 Secret；推荐另设置 SESSION_SECRET。不要把密钥放到 GitHub 或备份 ZIP。
8. 如需同一自定义域名，重新绑定域名/DNS；检查网站 IP 白名单（它被恢复为旧站原名单，新登录地点可能被拒绝）。
9. 逐项验收后台双重验证、所有已发布/草稿个人流程、群剧本、名片、收藏、HTML 工具、DOCX 模板、历史版本、原版 HTML、图片视频、图标、分类、提示按钮、完整导入导出、返回键及流程切换。
10. **验收前保持旧系统运行**，确认完整后再切换域名访问。

### 构建与部署（新账号）

需要 Node.js 20+ 和 Python 3.10+。仅在新账号开发环境执行，与旧站运行无关。

~~~bash
npm install -D wrangler
python -m pip install boto3
~~~

配置新 HTML 主机的 URL（示例命令，替换真实地址）：

~~~bash
export MSWQ_HTML_ORIGIN="https://mswq-html.<NEW_SUBDOMAIN>.workers.dev"
node scripts/build-mswq.mjs
# 上传完整源码快照（私有 R2），确保以后每次备份都能脱离 GitHub 在线访问
npx wrangler r2 object put NEW_R2_BUCKET_NAME/mswq-private/source-snapshot-v1.json --file ./dist/mswq-source-snapshot.json --remote
npx wrangler deploy -c wrangler.html-host.jsonc
npx wrangler deploy -c wrangler.jsonc
~~~

### 完整数据的安全导入

从新 Cloudflare 生成最小权限 API Token 和新的 R2 S3 访问密钥，配置在本机环境变量（不要发到聊天或 GitHub）：

~~~bash
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ACCOUNT_ID="..."
export R2_ACCESS_KEY_ID="..."
export R2_SECRET_ACCESS_KEY="..."
~~~

先预检 ZIP，不会修改任何资源：

~~~bash
python scripts/restore-mswq.py "./MSWQ-complete-....zip" --main-db-id "NEW_MAIN_D1_UUID" --docx-db-id "NEW_DOCX_D1_UUID" --kv-id "NEW_DOCX_KV_ID" --bucket "NEW_R2_BUCKET"
~~~

在确认 D1、R2、KV 都是**全新空资源**后，在命令最后追加 --execute 进行恢复。导入器不会删除旧账号数据，也会拒绝覆盖已有表/键/对象的新资源；逐个检查上传到 R2 对象的大小及自定义元数据。

## 三、重要限制

- 新账号的 Cloudflare 资源 ID、workers.dev 地址、新 Google/GitHub/ChatGPT 身份、Google Authenticator 密钥和登录 Cookie 必定不同。旧账号凭据不能自动复制。
- 备份期间并行修改数据库会造成快照不一致，所以导出时不要增删修改后台数据。
- R2 对象业务字节、HTTP 元数据、自定义元数据可迁移，但对象上传时间、ETag 等底层存储属性由新云服务重新生成。
- 旧账号 Cloudflare/GitHub API Token、外部域名所有权、旧的账号权限及未在本项目内的外部服务设置需要由新账号重新配置。
- 旧站有独立的 mswq-html Worker，只部署主 Worker 将无法正确打开部分 HTML 工具。
- 主 Worker 的双重验证统一保护 /api/admin 路由。绝不能重新打开 MSWQ_TEST_OPEN_ADMIN。
- 后台打包采用 ZIP STORE 流式写入，输出 100 MB 以上是正常的。

## 四、可直接发给新 GPT 的重建指令

我已经把原 MSWQ 的完整迁移 ZIP 作为私有文件提供给你，并准备把 ZIP 内 sources/MSWQ-github.zip 的源码导入我的新 GitHub 仓库。请先阅读 REBUILD-MSWQ.md、manifest.json 和 READ-FIRST.txt，逐一核对全部 D1 数据表、R2 文件和元数据、DOCX KV 键和值以及两个 Worker。连接我授权的新 GitHub 与 Cloudflare 账号后，在新账号创建两个 D1、一个 R2、一个 KV，恢复完整数据和元数据，再按 scripts/build-mswq.mjs 部署两个 Worker。保留全部个人流程、群剧本、名片、HTML 工具、内容排序、原版 HTML、DOCX 模板、图标图片、浏览器返回及后台 Google 动态码登录，不得删改界面或重新设计。使用新账号重新创建密码和密钥，绝不读取、迁移旧账号认证凭据。逐项比对旧站数量、页面及功能；验收通过后再建议切换域名。逐步依据工具实际成功返回结果，不得声明未经验证的部署成功。请完成当前账号权限下全部可执行操作，并明确列出必须由我本人完成的授权步骤。
