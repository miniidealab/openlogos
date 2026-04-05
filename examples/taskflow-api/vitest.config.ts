import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
