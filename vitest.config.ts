import { defineConfig } from 'vitest/config';

// Processos Wrangler/D1 locais podem bloquear por dezenas de segundos.
// Mantemos threads e concorrência limitada para os processos D1 locais.
// Vitest 5.0.5 substitui a versão 3 após auditoria de dependências.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'threads',
    maxWorkers: 2
  }
});
