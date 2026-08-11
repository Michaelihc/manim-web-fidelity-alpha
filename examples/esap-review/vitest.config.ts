import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'src'),
    },
  },
  test: {
    include: ['examples/esap-review/**/*.test.ts'],
    setupFiles: ['./src/test-setup/vitest-setup.ts'],
    environment: 'happy-dom',
  },
});
