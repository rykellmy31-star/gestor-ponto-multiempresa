import { defineConfig } from 'vitest/config';

// Processos Wrangler/D1 locais podem bloquear por dezenas de segundos.
// O pool threads reduz falhas de RPC "onTaskUpdate" observadas no CI
// com o pool padrao forks (Vitest 3), sem ignorar nenhum teste.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'threads',
    maxWorkers: 2
  }
});
