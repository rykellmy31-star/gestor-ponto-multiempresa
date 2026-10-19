import { defineConfig } from 'vitest/config';

// D1 local inicia subprocessos Wrangler; limitar paralelismo evita
// exaustao de recursos e timeouts dos workers no GitHub Actions.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    maxWorkers: 2
  }
});
