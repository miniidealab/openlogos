import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://openlogos.ai',
  integrations: [
    starlight({
      title: 'OpenLogos',
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
          items: [
            { label: 'Introduction', slug: 'getting-started' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
            { label: 'First AI Collaboration', slug: 'getting-started/first-collaboration' },
          ],
        },
        {
          label: 'Core Concepts',
          items: [
            { label: 'Three-Layer Model', slug: 'concepts/three-layer-model' },
            { label: 'Scenario-Driven + Test-First', slug: 'concepts/scenario-driven' },
            { label: 'Documents as Context', slug: 'concepts/documents-as-context' },
            { label: 'Engineering Foundation', slug: 'concepts/engineering-foundation' },
            { label: 'AI Skills', slug: 'concepts/ai-skills' },
          ],
        },
        {
          label: 'CLI Reference',
          items: [
            { label: 'Overview', slug: 'cli' },
            { label: 'init', slug: 'cli/init' },
            { label: 'sync', slug: 'cli/sync' },
            { label: 'status', slug: 'cli/status' },
            { label: 'verify', slug: 'cli/verify' },
            { label: 'launch', slug: 'cli/launch' },
            { label: 'change', slug: 'cli/change' },
            { label: 'merge', slug: 'cli/merge' },
            { label: 'archive', slug: 'cli/archive' },
          ],
        },
        {
          label: 'Skills Reference',
          items: [
            { label: 'Overview', slug: 'skills' },
            { label: 'project-init', slug: 'skills/project-init' },
            { label: 'prd-writer', slug: 'skills/prd-writer' },
            { label: 'product-designer', slug: 'skills/product-designer' },
            { label: 'architecture-designer', slug: 'skills/architecture-designer' },
            { label: 'scenario-architect', slug: 'skills/scenario-architect' },
            { label: 'api-designer', slug: 'skills/api-designer' },
            { label: 'db-designer', slug: 'skills/db-designer' },
            { label: 'test-writer', slug: 'skills/test-writer' },
            { label: 'test-orchestrator', slug: 'skills/test-orchestrator' },
            { label: 'code-implementor', slug: 'skills/code-implementor' },
            { label: 'code-reviewer', slug: 'skills/code-reviewer' },
            { label: 'change-writer', slug: 'skills/change-writer' },
            { label: 'merge-executor', slug: 'skills/merge-executor' },
          ],
        },
        {
          label: 'Specifications',
          items: [
            { label: 'Overview', slug: 'specs' },
            { label: 'Workflow', slug: 'specs/workflow' },
            { label: 'Change Management', slug: 'specs/change-management' },
            { label: 'Project Structure', slug: 'specs/project-structure' },
            { label: 'logos-project.yaml', slug: 'specs/logos-project' },
            { label: 'AGENTS.md', slug: 'specs/agents-md' },
            { label: 'Test Results Format', slug: 'specs/test-results' },
            { label: 'OpenCode Plugin', slug: 'specs/opencode-plugin' },
          ],
        },
      ],
    }),
  ],
});
