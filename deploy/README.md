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

## 获得发布授权后如何接管

以下是待执行步骤，本次未执行。没有新的技术资料需要用户补交；下一次需要的是针对明确发布对象和窗口的授权。

1. 审阅本地 diff，将完整改动提交为确定 SHA。获准后推送；首次仅运行 `Prepare or publish existing Workers`，保持 `publish=false`。三个旧部署 workflow 已从本地删除；确认完整删除随提交进入 main，不能恢复旧发布入口。
2. 检查该 SHA 的 CI 构建、演练及产物；任一失败都先修复，不进入生产阶段。
3. 在单独授权范围内创建 GitHub `production` Environment，设置审批人、仅 main 分支限制及适用的禁止绕过规则；只在该 Environment 中设置 `CLOUDFLARE_ACCOUNT_ID`、最小必要权限的 `CLOUDFLARE_API_TOKEN`，不向仓库/组织级 Secrets 放同名凭据。先验证环境限制，最后才设置仓库变量 `TAKEOVER_RELEASE_ENABLED=true`。文档站流程已改用独立 `DOCS_CLOUDFLARE_ACCOUNT_ID` / `DOCS_CLOUDFLARE_API_TOKEN` 名称，不为它配置或复用邮箱发布 Token。本地流程不会创建任何凭据。
4. 在切换窗口重新只读核验三个 Worker 的版本、域名、变量、D1/KV 绑定、Email Routing，以及 compatibility date/flags、workers.dev、预览 URL、observability/日志采样和其它触发器；逐项对照 `deploy/*.json`。当前文件是待发布候选配置，本地完全匹配检查不证明线上等价；有差异先停止并修订、重建、复审。记录完整旧版本 ID，导出 D1 备份，验证可读性和恢复办法，记录可用 Time Travel bookmark。合成演练不能替代这一步。
5. 明确批准此次 SHA、目标及动作后，手动选择 `target=backend`、`publish=true`；环境审批通过才发布。发布只消费该次构建并校验过的 bundle，不重建。暂不执行数据库迁移。
6. 在旧 schema 上验证后端健康、旧凭据、真实收发邮件及现有前端。确认通过后，分别发布 `web`、`telegram`，每个目标都单独验证。部署失败时按记录的旧版本回滚对应 Worker。
7. 数据库升级是另一个明确动作：先确认备份、恢复窗口和写入影响，再通过管理页面数据库迁移功能升到 v0.0.8。复查版本、行数和邮件原文。应用回滚不等于数据库回滚；涉及恢复数据库时应评估备份之后的新邮件，不能直接覆盖。
8. 完成实际验收前保持两个新邮件功能关闭。上游同步继续禁用，后续再单独设计待审 PR 更新流程。

流程不会自动迁移 D1，不会切换 DNS，不会把敏感普通变量自动改成 Secret。`publish=true` 仍需 main 分支、显式发布开关以及预先配置好的 production 审批；开关本身不能替代环境保护。
