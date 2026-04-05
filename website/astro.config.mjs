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
            { label: 'Three-Layer Model', link: '/concepts/three-layer-model' },
            { label: 'Scenario-Driven + Test-First', slug: 'concepts/scenario-driven' },
            { label: 'Documents as Context', link: '/concepts/documents-as-context' },
            { label: 'Engineering Foundation', link: '/concepts/engineering-foundation' },
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
            { label: 'change', slug: 'cli/change' },
            { label: 'merge', slug: 'cli/merge' },
            { label: 'archive', slug: 'cli/archive' },
            { label: 'verify', slug: 'cli/verify' },
          ],
        },
        {
          label: 'Skills Reference',
          items: [
            { label: 'Overview', slug: 'skills' },
            { label: 'project-init', slug: 'skills/project-init' },
            { label: 'prd-writer', slug: 'skills/prd-writer' },
            { label: 'product-designer', slug: 'skills/product-designer' },
            { label: 'tech-architect', slug: 'skills/tech-architect' },
            { label: 'scenario-modeler', slug: 'skills/scenario-modeler' },
            { label: 'api-designer', slug: 'skills/api-designer' },
            { label: 'db-designer', slug: 'skills/db-designer' },
            { label: 'test-writer', slug: 'skills/test-writer' },
            { label: 'code-generator', slug: 'skills/code-generator' },
            { label: 'change-manager', slug: 'skills/change-manager' },
            { label: 'sync-writer', slug: 'skills/sync-writer' },
            { label: 'status-reporter', slug: 'skills/status-reporter' },
          ],
        },
        {
          label: 'Specifications',
          items: [
            { label: 'Overview', slug: 'specs' },
            { label: 'Workflow', slug: 'specs/workflow' },
            { label: 'Project Structure', slug: 'specs/project-structure' },
            { label: 'Test Results Format', slug: 'specs/test-results' },
          ],
        },
      ],
    }),
  ],
});
