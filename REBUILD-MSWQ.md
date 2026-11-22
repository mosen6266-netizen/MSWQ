# MSWQ 全站迁移：只上传 GitHub 一次，交给新 GPT 自动重建

本说明适用于全新 Google、GitHub、Cloudflare、ChatGPT 账号。完整备份 ZIP 包含源码、数据库、所有云存储文件；原账号保持不变。新的 GPT 需要连接新 GitHub 与 Cloudflare 并获得有权限的执行环境。

## 旧 MSWQ：下载一次

现有网站 /admin → 密码及 Google Authenticator 登录 →「导入与备份」→「下载完整迁移 ZIP」。

压缩包包含：
- manifest.json、READ-FIRST.txt、sources/MSWQ-github.zip（原始完整 GitHub 源码）；
- d1/main、d1/docx 两套 D1 的全部结构与记录；
- r2/index.json、r2/objects 中所有图片、图标、原版 HTML、上传工具包等原始字节及独立元数据；
- kv/index.json、kv/values 中全部 DOCX KV 数据、历史版本及设置。

每当内容、名片、剧本、流程、HTML 工具、图标、DOCX 等发生变化，再点击下载就获得新的完整快照。导出时不要同时编辑或发布，以防跨存储快照出现不一致。

R2 存在重复内容，因此完整 ZIP 通过相同 ETag 和大小识别重复字节，仅在 ZIP 中储存一次；但 index.json 记录每个原始 R2 key 和各自的 metadata，恢复时会全部还原。

## 新 GitHub：只上传一次 ZIP

1. 用新账号注册并登录 GitHub、Cloudflare、ChatGPT。创建一个带 README 的新 GitHub 仓库，例如 MSWQ，确保存在 main 分支。
2. 进入新仓库主页 → Releases → Draft a new release。新建 Tag：mswq-migration；标题：MSWQ Full Migration。
3. 将旧后台下载的 MSWQ-complete-....zip 拖到该 Release 的附件区域并发布。**只上传这一份 ZIP。无需额外上传单个文件，也不需要用户手动向 Cloudflare 上传 ZIP、D1 SQL 或 R2。**
4. 打开新的 ChatGPT，连接新 GitHub 与新 Cloudflare。建议使用 Work 模式，让它操作云端电脑、下载较大的 ZIP 和运行脚本。向新 GPT 发送新仓库链接以及 PROMPT-FOR-NEW-GPT.md 内完整指令。

GitHub 普通源码提交有单文件大小限制；完整迁移包可能超过 100 MB，必须放在 **Releases 附件**，不要放进源码的 git commit。Release 单附件必须小于 2 GiB。

## 新 GPT 的执行顺序

1. 从新 GitHub 仓库 Tag=mswq-migration 的 Release 读取唯一附件 MSWQ-complete-*.zip。校验 ZIP CRC 和 manifest.json。
2. 解开 sources/MSWQ-github.zip，读取本项目原版源码、配置模板、scripts/rebuild-from-release.py、scripts/restore-mswq.py、scripts/build-mswq.mjs。
3. 在新 Cloudflare 账号创建两个空 D1、一个空 R2 桶、一个空 Workers KV；恢复完整 D1、KV、R2 数据（特别保留 R2 customMetadata）；自动生成新 Workers 子域名。
4. 编译并部署主 Worker mswq 与独立 HTML 主机 Worker mswq-html，绑定名称必须为 DB、DOCX_DB、DOCX_KV、FILES。新资源 ID 不得复用旧账号 ID。
5. 重新生成管理员密码、Google Authenticator TOTP 密钥及会话密钥并设置为新 Worker Secret；不复制旧账号密码或身份认证信息。
6. 将 ZIP 内源码提交到新 GitHub main 分支（不提交备份 ZIP），实际验证管理后台、所有个人流程/群剧本/HTML 工具、DOCX、图片图标、名片、分类排序、按钮跳转及返回键。
7. 只有在新网站全部数据和功能验收通过后，**删除 GitHub Releases 中临时 MSWQ-complete-*.zip 附件**（可调用 GitHub 删除 Release asset API，或使用 scripts/cleanup-github-release.py --repo NEW_OWNER/NEW_REPO --verified），保留正常源码及新云端数据，旧系统一律不动。

### 可用的自动化脚本

新的 GPT 可以在其获得用户授权的云电脑中执行（Python 3.10+、Node.js 20+、boto3、Wrangler）：

~~~bash
python -m pip install boto3
python scripts/rebuild-from-release.py --repo NEW_OWNER/NEW_REPO --local-zip "/path/to/MSWQ-complete-....zip" --execute
~~~

脚本会创建新 Cloudflare 资源、导入、生成新配置、编译并部署两个 Worker，设置全新的管理员密码及 Google TOTP 密钥。如新 GPT 使用 GitHub/Cloudflare 连接器实施同等操作，也可以不直接运行脚本，但必须逐项核验。

脚本读取新账号提供的 CLOUDFLARE_ACCOUNT_ID、CLOUDFLARE_API_TOKEN、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY；要自动推送新 GitHub 源码，还需要新 GitHub 授权 GITHUB_TOKEN。不能假设连接器 OAuth 能直接作为 Python 环境变量，应由新 GPT 通过合规的授权渠道获取必要权限，或使用已连接的工具执行同等操作。绝不将 Token 写进仓库、备份或回复正文。账号注册、OAuth 同意、必要的身份验证依然需要用户本人完成。

### 效验与清理

请按 manifest.json 核对两套 D1 的各表、60 个左右的 DOCX KV（真实数量以新备份为准）、完整 R2 对象总数及字节数，逐项打开正式网页检验后才可清理 Release 附件。源码保留，原来的账号与网站不受影响。新账号产生的新 URL、数据库 ID、密码及验证码种子无法做到字节一致，这是必要例外。

Release 附件没有进入 Git commit 历史时删除附件无需重写源码 Git 历史，但对已经被别人下载的副本不能保证一同删除。如果恢复没有通过验收，不得删掉唯一备份。

完整执行指令在 PROMPT-FOR-NEW-GPT.md。禁止打开代码中的免密码测试模式。
