import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://openlogos.ai',
  integrations: [
    starlight({
      title: {
        en: 'OpenLogos',
        'zh-CN': 'OpenLogos',
      },
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        zh: { label: '简体中文', lang: 'zh-CN' },
      },
      logo: {
        src: './src/assets/logo.svg',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/miniidealab/openlogos' },
      ],
      editLink: {
        baseUrl: 'https://github.com/miniidealab/openlogos/edit/main/website/',
      },
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://openlogos.ai/og-image.png' } },
        { tag: 'meta', attrs: { property: 'og:site_name', content: 'OpenLogos' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://openlogos.ai/og-image.png' } },
      ],
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Getting Started',
          translations: { 'zh-CN': '快速开始' },
          items: [
            { label: 'Introduction', translations: { 'zh-CN': '简介' }, slug: 'getting-started' },
            { label: 'Quick Start', translations: { 'zh-CN': '快速上手' }, slug: 'getting-started/quick-start' },
            { label: 'Adopt Existing Project', translations: { 'zh-CN': '接入已有项目' }, slug: 'getting-started/adopt-existing-project' },
            { label: 'First AI Collaboration', translations: { 'zh-CN': '首次 AI 协作' }, slug: 'getting-started/first-collaboration' },
          ],
        },
        {
          label: 'Core Concepts',
          translations: { 'zh-CN': '核心概念' },
          items: [
            { label: 'Three-Layer Model', translations: { 'zh-CN': '三层模型' }, slug: 'concepts/three-layer-model' },
            { label: 'Scenario-Driven + Test-First', translations: { 'zh-CN': '场景驱动 + 测试先行' }, slug: 'concepts/scenario-driven' },
            { label: 'Documents as Context', translations: { 'zh-CN': '文档即上下文' }, slug: 'concepts/documents-as-context' },
            { label: 'Engineering Foundation', translations: { 'zh-CN': '工程理论根基' }, slug: 'concepts/engineering-foundation' },
            { label: 'AI Skills', translations: { 'zh-CN': 'AI 技能' }, slug: 'concepts/ai-skills' },
          ],
        },
        {
          label: 'CLI Reference',
          translations: { 'zh-CN': 'CLI 参考' },
          items: [
            { label: 'Overview', translations: { 'zh-CN': '概览' }, slug: 'cli' },
            { label: 'init', slug: 'cli/init' },
            { label: 'adopt', slug: 'cli/adopt' },
            { label: 'sync', slug: 'cli/sync' },
            { label: 'status', slug: 'cli/status' },
            { label: 'next', slug: 'cli/next' },
            { label: 'verify', slug: 'cli/verify' },
            { label: 'smoke', slug: 'cli/smoke' },
            { label: 'launch', slug: 'cli/launch' },
            { label: 'change', slug: 'cli/change' },
            { label: 'merge', slug: 'cli/merge' },
            { label: 'archive', slug: 'cli/archive' },
            { label: 'detect', slug: 'cli/detect' },
            { label: 'index', slug: 'cli/index-command' },
            { label: 'module', slug: 'cli/module' },
          ],
        },
        {
          label: 'Skills Reference',
          translations: { 'zh-CN': '技能参考' },
          items: [
            { label: 'Overview', translations: { 'zh-CN': '概览' }, slug: 'skills' },
            { label: 'project-init', slug: 'skills/project-init' },
            { label: 'prd-writer', slug: 'skills/prd-writer' },
            { label: 'product-designer', slug: 'skills/product-designer' },
            { label: 'architecture-designer', slug: 'skills/architecture-designer' },
            { label: 'scenario-architect', slug: 'skills/scenario-architect' },
            { label: 'api-designer', slug: 'skills/api-designer' },
            { label: 'db-designer', slug: 'skills/db-designer' },
            { label: 'deployment-designer', slug: 'skills/deployment-designer' },
            { label: 'test-writer', slug: 'skills/test-writer' },
            { label: 'test-orchestrator', slug: 'skills/test-orchestrator' },
            { label: 'code-implementor', slug: 'skills/code-implementor' },
            { label: 'code-reviewer', slug: 'skills/code-reviewer' },
            { label: 'deployment-executor', slug: 'skills/deployment-executor' },
            { label: 'change-writer', slug: 'skills/change-writer' },
            { label: 'merge-executor', slug: 'skills/merge-executor' },
            { label: 'ui-ux-pro-max', slug: 'skills/ui-ux-pro-max' },
          ],
        },
        {
          label: 'Specifications',
          translations: { 'zh-CN': '规格说明' },
          items: [
            { label: 'Overview', translations: { 'zh-CN': '概览' }, slug: 'specs' },
            { label: 'Workflow', translations: { 'zh-CN': '工作流' }, slug: 'specs/workflow' },
            { label: 'Change Management', translations: { 'zh-CN': '变更管理' }, slug: 'specs/change-management' },
            { label: 'Project Structure', translations: { 'zh-CN': '项目结构' }, slug: 'specs/project-structure' },
            { label: 'Directory Convention', translations: { 'zh-CN': '目录约定' }, slug: 'specs/directory-convention' },
            { label: 'Module Naming', translations: { 'zh-CN': '模块命名' }, slug: 'specs/module-naming-convention' },
            { label: 'logos-project.yaml', slug: 'specs/logos-project' },
            { label: 'AGENTS.md', slug: 'specs/agents-md' },
            { label: 'Test Results Format', translations: { 'zh-CN': '测试结果格式' }, slug: 'specs/test-results' },
            { label: 'tasks.md Format', translations: { 'zh-CN': 'tasks.md 格式' }, slug: 'specs/tasks-spec' },
            { label: 'CLI JSON Output', translations: { 'zh-CN': 'CLI JSON 输出' }, slug: 'specs/cli-json-output' },
            { label: 'SQL Comment Convention', translations: { 'zh-CN': 'SQL 注释约定' }, slug: 'specs/sql-comment-convention' },
            { label: 'OpenCode Plugin', translations: { 'zh-CN': 'OpenCode 插件' }, slug: 'specs/opencode-plugin' },
            { label: 'Codex Plugin', translations: { 'zh-CN': 'Codex 插件' }, slug: 'specs/codex-plugin' },
          ],
        },
      ],
    }),
  ],
});
