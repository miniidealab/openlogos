# Deployment Report

> Generated after `mermaid-syntax-safety` deployment on 2026-06-15
> Target environment: Cloudflare Pages staging preview

## Summary

- Proposal: `mermaid-syntax-safety`
- Deployment task: 按 `website_release_sync` 链路部署官网文档到 staging，并确认 Cloudflare Pages 部署产物可访问
- Result: PASS
- Preview URL: `https://613a0909.openlogos.pages.dev`

## Commands

1. `cd website && npm run deploy`
   - Purpose: build the Astro documentation site, generate release data, generate Chinese font subsets, and deploy `website/dist/` to Cloudflare Pages.
   - Target environment: Cloudflare Pages staging preview for project `openlogos`.
   - Result: PASS.

## Command Output Summary

- `npm run generate:releases` generated `website/src/data/releases.json` from npm registry with 73 versions.
- `astro build` completed successfully and built 134 pages.
- Font fetch/subset steps completed; five Noto Sans SC subset weights were generated.
- Wrangler version: `4.100.0`.
- Wrangler uploaded 23 changed files and reused 335 existing files.
- Functions bundle uploaded successfully.
- Cloudflare Pages deployment completed at `https://613a0909.openlogos.pages.dev`.

## Warnings

- Astro reported existing route collision warnings for `/404` and related fallback routes. These warnings were already present during build validation and did not block deployment.
- Wrangler warned that the git working directory has uncommitted changes. The deployment proceeded with the current working tree, as this proposal is already verify PASS and the deploy task targets the current staging preview.

## Migration Result

No data migration was required.

## Service Startup Result

Cloudflare Pages accepted the deployment and returned a preview URL. Service startup is considered successful for the staging preview deployment.

## Rollback Point

Rollback uses Cloudflare Pages deployment history. If the Mermaid Skill documentation pages regress, roll back the `openlogos` Pages project to the previous successful deployment.

## Unresolved Risks

- Smoke validation has not been executed yet. Run `openlogos smoke --env staging` after explicit human authorization.
