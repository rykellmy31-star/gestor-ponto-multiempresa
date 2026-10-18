
-- =====================================================
-- CR JORNADA
-- Migracao 0016 - Preparacao das matriculas empresariais
-- =====================================================
--
-- Objetivo:
-- Preparar a estrutura para matriculas independentes
-- entre empresas.
--
-- Esta etapa NAO remove a restricao UNIQUE antiga.
-- A liberacao de matriculas repetidas entre empresas
-- dependera da reconstrucao segura da tabela employees.
--
-- Nenhuma rota antiga deve ser desbloqueada aqui.
-- =====================================================

-- Impede matriculas duplicadas dentro da mesma empresa.
-- O indice considera apenas funcionarios nao excluidos.
CREATE UNIQUE INDEX IF NOT EXISTS
  employees_company_registration_unique
ON employees (
  company_id,
  registration COLLATE NOCASE
)
WHERE deleted_at IS NULL
  AND company_id IS NOT NULL;

-- Acelera a busca de funcionarios por empresa e matricula.
CREATE INDEX IF NOT EXISTS
  employees_company_registration_lookup
ON employees (
  company_id,
  registration COLLATE NOCASE
);

-- =====================================================
-- IMPORTANTE
-- =====================================================
--
-- A tabela original ainda possui:
--
-- registration TEXT NOT NULL UNIQUE COLLATE NOCASE
--
-- Essa restricao global permanece ativa.
--
-- Antes de remove-la, precisamos verificar:
-- 1. Todas as referencias a employees.
-- 2. Triggers e indices existentes.
-- 3. Integridade do historico de ponto.
-- 4. Tratamento dos funcionarios antigos.
-- 5. Testes de migracao no D1 local.
--
-- Nao executar esta migracao no banco remoto
-- ate concluir essas verificacoes.
-- =====================================================
