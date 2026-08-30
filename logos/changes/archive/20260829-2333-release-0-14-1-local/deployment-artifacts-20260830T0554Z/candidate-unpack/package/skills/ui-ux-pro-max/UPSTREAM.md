# Upstream Sync Record

**Source**: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
**License**: MIT
**Vendored Commit**: `b7e3af80f6e331f6fb456667b82b12cade7c9d35` (HEAD on `main` at vendor time)
**Vendored Date**: 2026-05-24
**Vendored By**: huangxianglong (via OpenLogos change proposal `builtin-ui-ux-pro-max-skill`)
**Vendor Method**: `npx -y uipro-cli init --ai claude` then copy `.claude/skills/ui-ux-pro-max/`

## How to Re-Sync

```bash
# 1. 在临时目录跑官方安装器
mkdir -p /tmp/uipro-vendor && cd /tmp/uipro-vendor
rm -rf .claude
npx -y uipro-cli init --ai claude

# 2. 对比 SKILL.md / data/ / scripts/ 是否有变化
diff -r /tmp/uipro-vendor/.claude/skills/ui-ux-pro-max \
        <openlogos-root>/skills/ui-ux-pro-max

# 3. 如有更新，覆盖并重新应用下方「OpenLogos-Side Modifications」段落中所有改动
# 4. 重新拉取 LICENSE: curl -sSL https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/LICENSE
# 5. 同步到 plugin/skills/ui-ux-pro-max/
# 6. 更新本文件中的 Vendored Commit / Vendored Date 字段
```

## OpenLogos-Side Modifications

vendor 后我们在上游 `SKILL.md` 之上做了如下本地化改动。重新同步时必须重新应用，否则会被覆盖丢失：

1. **顶部 OpenLogos vendor 标注**：在 `SKILL.md` 第一行 frontmatter 之后插入：
   ```markdown
   > 本 Skill 来自 [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)（MIT），由 OpenLogos vendor 内置。
   ```

2. **路径本地化**：全文替换
   - `skills/ui-ux-pro-max/scripts/` → `logos/skills/ui-ux-pro-max/scripts/`

   原因：上游脚本路径写死 `.claude/skills/ui-ux-pro-max/...`（相对 `.claude/`），但 OpenLogos 用户项目的 skill 部署路径是 `logos/skills/ui-ux-pro-max/`。

3. **未来其他改动**（按时间倒序追加）：
   - _无_
