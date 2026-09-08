# Take over existing Workers with GitHub Actions

This fork uses `.github/workflows/takeover.yaml` for the existing API, Web and Telegram Workers. The three legacy deployment workflows have been removed to close the alternative publishing path.

## Build and rehearse

Committing and pushing require separate authorization. After the complete change is authorized and pushed, run **Prepare or publish existing Workers** with `publish=false`. No Cloudflare credentials are required; all three Workers are built and checked.

See repository `deploy/README.md` for local commands and the complete runbook. Use Node 24.15.0, pnpm 10.10.0 and the existing lockfiles. Configuration lives in `deploy/`; bundles and reports live in `ai-agent-takeover/`. Builds reject local frontend `.env` overrides. Bundles exclude source maps, environment files and unknown types, and check common credential patterns. Pattern scanning cannot detect every opaque secret; changes still require review.

## Publish after separate authorization

1. Create `production` under **Settings → Environments**. Configure required reviewers, main-only deployment branches and applicable bypass restrictions; verify protection first.
2. Add `CLOUDFLARE_ACCOUNT_ID` and a least-privilege `CLOUDFLARE_API_TOKEN` only to that Environment's Secrets. Do not set matching repository/organization publishing secrets or legacy `BACKEND_TOML`, `FRONTEND_ENV`, `PAGE_TOML` secrets.
3. Set repository variable `TAKEOVER_RELEASE_ENABLED=true` under **Settings → Secrets and variables → Actions → Variables**. The switch does not replace environment approval; all external configuration needs prior authorization.
4. During the release window, compare complete live configuration, record old versions, verify backup/recovery prerequisites and approve the exact commit SHA and actions.
5. Run from main with one `target` and `publish=true`. Build and verify first, then publish the same run's artifact after production approval. Publish and validate the backend first, then each frontend.

The backend uses `keep_vars` to preserve remote variables and initially disables compression and read status. Database migration is separately authorized and executed. Local rehearsal cannot validate real mail delivery, Telegram, production recovery or live configuration equivalence.

## Update policy

The separate `Deploy Docs` workflow uses `DOCS_CLOUDFLARE_ACCOUNT_ID` and `DOCS_CLOUDFLARE_API_TOKEN`. If needed, configure dedicated docs credentials separately; never reuse the mailbox production token. Mailbox takeover does not require docs publishing.

Keep Upstream Sync disabled initially. Syncing code does not trigger this workflow. Do not restore legacy publishing paths. Design a separately reviewed PR-based update flow later if needed.
