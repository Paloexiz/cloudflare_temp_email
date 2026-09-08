# 通过 GitHub Actions 接管既有 Worker

本 fork 使用 `.github/workflows/takeover.yaml` 更新既有 API、Web、Telegram Worker。三个旧部署 workflow 已移除，避免绕过新的审批。

## 构建与演练

提交、推送需要另行授权。获准推送完整改动后，在 Actions 中运行 **Prepare or publish existing Workers**，保持 `publish=false`。无需 Cloudflare 凭据，三个 Worker 都会构建并检查。

本地命令和完整步骤见仓库 `deploy/README.md`。工具固定为 Node 24.15.0、pnpm 10.10.0，沿用已有锁文件。配置位于 `deploy/`，产物与报告位于 `ai-agent-takeover/`。构建拒绝本地前端 `.env` 覆盖；部署包排除 source map、环境文件和未知类型，并检查常见凭据格式。模式扫描不能识别任意格式的密钥，仍须审阅改动。

## 发布步骤（另行授权后执行）

1. 在 **Settings → Environments** 创建 `production`，设置必需审批人、仅 main 分支及适用的禁止绕过规则；先验证保护规则。
2. 仅在该 Environment 的 Secrets 中添加 `CLOUDFLARE_ACCOUNT_ID`、最小权限的 `CLOUDFLARE_API_TOKEN`。不要在仓库或组织级 Secrets 中设置同名发布凭据，也不要配置旧 `BACKEND_TOML`、`FRONTEND_ENV`、`PAGE_TOML`。
3. 在 **Settings → Secrets and variables → Actions → Variables** 设置仓库变量 `TAKEOVER_RELEASE_ENABLED=true`。开关不能替代环境审批；外部配置均需事先获准。
4. 在发布窗口复核完整线上配置、旧版本和备份恢复条件，确认具体提交 SHA 和动作。
5. 从 main 手动运行，选择一个 `target`、设置 `publish=true`。先构建验证，production 审批后发布同次产物；依次发布、验收后端和两个前端。

后端用 `keep_vars` 保留线上变量，首次关闭邮件压缩和已读状态。数据库迁移独立授权、独立执行。真实邮件、Telegram、备份恢复和线上配置等价性不能由本地演练代替。

## 更新策略

文档站 `Deploy Docs` 独立使用 `DOCS_CLOUDFLARE_ACCOUNT_ID` 和 `DOCS_CLOUDFLARE_API_TOKEN`。如需发布文档站，应另行配置专用凭据，不复用邮箱 production 的 Token；邮箱接管不要求启用文档站发布。

首次保持 Upstream Sync 禁用；代码同步不会触发本流程。不要恢复旧发布入口。后续自动更新另行设计为待审 PR 流程。
