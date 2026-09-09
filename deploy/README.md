# 三个既有 Worker 的接管准备

2026-09-08：本地准备及演练已通过。用户已接受首次从 v1.4.0 升级到 v1.12.0；本次没有发布、运行 GitHub Actions 或创建、更改外部配置。

GPT-5.6-Terra 第二轮独立复审：**通过（限本地接管准备）**。第一轮提出的旧发布旁路、文档冲突、产物检查和迁移索引缺口已验证并修正；完整本地候选配置检查已补充，线上等价性明确保留为发布窗口前置条件。复审未发现新的本地准备阻断项，结论不构成生产发布授权。

2026-09-09 实施前核验已确认：后端预览 URL 开启、两个前端关闭，三者 workers.dev 开启；后端日志采样为 1。候选配置和断言已显式固定这些值并通过增量复审、重建和演练。生产应用数据已在仓库外完成私有逻辑备份与本地 SQLite 全记录/索引恢复校验；不将备份、恢复书签或实际数据放入 Git。用户已授权按方案配置 GitHub，生产发布和数据库迁移仍单独确认；实施进度单独记录。

## 已准备的内容

| 目标 | 既有 Worker | 域名 |
| --- | --- | --- |
| backend | paloexiz-s-email-api | apimail.paloexiz.me |
| web | paloexiz-s-email | mail.paloexiz.me |
| telegram | paloexiz-s-email-telegrambot | miniapp-mail.paloexiz.me |

`backend.json` 复用已有 D1、KV，启用 `keep_vars` 保留线上变量；首次显式关闭 `ENABLE_MAIL_GZIP` 和 `ENABLE_MAIL_READ_STATUS`，使新后端可先运行在旧 v0.0.6 schema 上。未复制任何生产密码或 Token。两个前端均部署为静态资源 Worker，保留 SPA 路由；普通版和 Telegram 版分别构建。

Node 固定为 24.15.0，pnpm 固定为 10.10.0，使用仓库已有锁文件；当前后端锁定 Wrangler 4.124.0。前端 API 为 `https://apimail.paloexiz.me`，默认语言 zh，应用分析 Token 为空。不要通过浏览本地构建页面对生产 API 进行写入测试。

## 重新执行本地检查

在仓库根目录用 PowerShell 或 Bash 执行：

```sh
node --version
npx --yes pnpm@10.10.0 --dir worker install --frozen-lockfile
npx --yes pnpm@10.10.0 --dir frontend install --frozen-lockfile
node deploy/prepare.mjs
node deploy/rehearse.mjs
node deploy/verify.mjs
```

`prepare.mjs` 会替换本任务专用的 `ai-agent-takeover/` 输出目录；发现前端 `.env`、`.env.local`、`.env.prod` 或 `.env.prod.local` 时拒绝构建，避免混入本地设置。构建过程只运行 Wrangler `--dry-run`，不需要 Cloudflare 凭据。演练使用 Wrangler 自带 Miniflare、本地临时 D1/KV 和合成数据；外部请求被拦截，Resend 使用模拟响应。

最终可审阅文件是 `ai-agent-takeover/bundle/` 和 `ai-agent-takeover/rehearsal.json`。bundle 含三个目标配置、编译后的代码/静态资源，以及文件 SHA-256 清单。当前本地文件尚未提交，manifest 的 `sourceCommit` 只是基础提交；正式发布必须使用包含全部改动的新提交及其 CI 产物。

## 本次实际验证结果

- 三个目标分别完成构建、配置 dry-run，打包后的三份配置再次 dry-run 通过。
- 后端在旧 v0.0.6 schema 上可启动；旧邮箱 JWT、管理员认证头、用户 JWT、密码登录和主要邮件/地址列表接口通过。
- 实际 Email handler 在迁移前后均接收合成邮件；管理发信接口走模拟 Resend，创建邮箱通过。
- 通过应用自身 `/admin/db_migration` 从 v0.0.6 升到 v0.0.8，新增 `raw_blob` 和 `is_unread`；断言 17 个索引的表、列和唯一性，关键表行数、旧邮件原文保持不变。再次迁移返回无需迁移。合成旧库故意省略显式索引，验证初始化补齐能力，不将它声称为生产全量 schema 导出。
- 两个打包前端在本地 Workers 静态资源模拟器中，`/`、`/admin`、`/user` 均返回 SPA 页面。
- 产物文件集合、SHA-256、完整本地候选配置及 D1/KV 绑定通过校验；依赖 frozen-lockfile 校验和 workflow YAML 解析通过。
- 发布包仅保留运行文件和三个受审配置；拒绝 source map、环境文件、未知文件类型及常见凭据模式。校验自带合成负例，不输出命中的内容。模式检查不能保证发现任意格式的密钥；生产凭据从未作为构建输入，代码审阅仍必需。

这证明了所测接口与 schema 迁移的本地兼容性，未证明真实邮件投递、Telegram 客户端、完整浏览器交互、全部业务功能或真实 Token 发布权限。未恢复生产备份、未复现精确旧部署源码，也未在 GitHub Linux runner 上实际运行。Vite 提示现有前端包超过 500 kB；构建成功，该性能提示未在本任务中扩展处理。

上述是首轮合成演练的边界。后续已执行的私有备份验证由 `backup-verify.py` 完成：输入只读逻辑快照，在内存 SQLite 导入，逐行回读对比并检查索引、完整性和外键；SQL 备份和统计/哈希报告写在输入文件旁。它不连接 Cloudflare，不能冒充生产原位恢复或 Time Travel 实测。备份含敏感数据，只在获授权的私有目录运行：

```sh
uv run python deploy/backup-verify.py <private-snapshot.json>
```

## 日常构建与发布

GitHub Actions 现在提供两个独立入口，旧的 `Prepare or publish existing Workers` 已移除：

- **Prepare existing Workers**（`prepare.yaml`）：手动运行，构建、演练并校验三个 Worker，上传保留 7 天的产物；不接收发布密钥，不部署。
- **Publish existing Workers**（`publish.yaml`）：选择 `main`，`target` 默认 `all`，依次发布 `backend`、`web`、`telegram`；也可单独选择一个目标。无需再填写 `publish` 开关。任一目标失败即停止后续发布，已成功的目标不会自动回滚。自动调用同一提交的 Prepare，成功后等待 production 审批，再发布本次运行中的已校验产物；不用先手动运行 Prepare，也不用填写产物编号。

更新代码时，先将审阅过的改动合入 `main`，再启动 Publish。重新运行旧记录使用原提交，不会获取新的 `main`。发布仍要求 `TAKEOVER_RELEASE_ENABLED=true`、main 分支和 production 环境审批；发布队列沿用 `email-production`，不会取消正在进行的发布。

发布凭据只放在 production Environment 的 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN` 中。新生成 Token 后须同步更新 Secret，值为原文字符串，不加引号或数组。Prepare 不继承这些 Secrets。文档站使用独立的 `DOCS_CLOUDFLARE_*` 凭据。

首次接管已完成；上文的本地验证结论是历史记录。用户已确认 Worker 凭据及数据库密码更换并验证通过。2026-09-09，新发布 Token 已通过同版本前端发布复测；本次私有备份已按用户要求删除，原备份路径不能再用于恢复。

工作流不会自动迁移 D1 或切换 DNS。后续涉及数据库迁移时，仍需另行安排备份、恢复窗口与兼容性验证。上游自动同步保持禁用。

## Build and publish

- Run **Prepare existing Workers** for build, rehearsal and artifact validation only; it receives no deployment secrets.
- Run **Publish existing Workers** on `main` and approve the production deployment. The default target is `all`, publishing backend, web and telegram in order; individual targets remain available. A failure stops later targets without rolling back successful ones. It calls Prepare at the same commit and publishes the verified artifact from that run. There is no `publish` boolean or manual artifact selection.
- Merge new code into `main` before starting a new release. Re-running an old run uses its original commit. The release flag, production protection and shared deployment queue remain in place.
- Keep Cloudflare credentials only in the production environment. Replacing a token requires updating its Secret with the raw token. Database migrations and backups remain separate operations.
