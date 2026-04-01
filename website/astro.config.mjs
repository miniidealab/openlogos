import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://openlogos.ai',
  output: 'static',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh'],
    routing: {
      prefixDefaultLocale: false
    }
  }
});
