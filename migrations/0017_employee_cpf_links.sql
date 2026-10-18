
-- =====================================================
-- CR JORNADA
-- Migracao 0017 - Vinculos seguros por CPF
-- =====================================================
--
-- Objetivo:
-- Preparar a identificacao de funcionarios por CPF
-- em um ambiente SaaS multiempresa.
--
-- CPF nunca sera armazenado em texto puro
-- nesta tabela.
--
-- cpf_lookup_key recebera um HMAC-SHA256
-- produzido pelo servidor com segredo dedicado.
--
-- NAO modifica employees, users ou sessions.
-- NAO remove a restricao global de matricula.
-- NAO ativa rotas antigas.
-- NAO modifica historicos existentes.
--
-- Aplicar primeiro apenas no D1 local.
-- =====================================================


-- 1. Chave candidata para permitir referencia
-- composta entre funcionario e empresa.
--
-- Mantem os identificadores existentes.
-- Nao exige company_id para funcionarios legados.

CREATE UNIQUE INDEX
  employees_id_company_reference
ON employees (
  id,
  company_id
);


-- 2. Tabela permanente de vinculos de CPF.
--
-- O mesmo CPF pode existir em empresas distintas.
-- Cada funcionario pode possuir um unico vinculo
-- nesta tabela.
--
-- A chave estrangeira composta garante que
-- funcionario e empresa correspondam ao
-- mesmo registro em employees.

CREATE TABLE employee_cpf_links (
  employee_id TEXT PRIMARY KEY,

  company_id TEXT NOT NULL,

  cpf_lookup_key TEXT NOT NULL
    CHECK (
      length(cpf_lookup_key) = 64
      AND cpf_lookup_key NOT GLOB '*[^0-9a-f]*'
    ),

  created_at INTEGER NOT NULL,

  updated_at INTEGER NOT NULL,

  FOREIGN KEY (
    employee_id,
    company_id
  )
  REFERENCES employees (
    id,
    company_id
  ),

  FOREIGN KEY (company_id)
  REFERENCES companies(id),

  UNIQUE (
    company_id,
    cpf_lookup_key
  )
);


-- 3. Indice para localizar vinculos pelo CPF
-- protegido sem depender da matricula.

CREATE INDEX employee_cpf_lookup
ON employee_cpf_links (
  cpf_lookup_key,
  company_id
);


-- 4. Impede alterar a identidade de um vinculo.
--
-- Caso seja necessaria uma correcao cadastral
-- futura, devera existir um procedimento
-- administrativo proprio, com auditoria.

CREATE TRIGGER employee_cpf_identity_immutable
BEFORE UPDATE OF
  employee_id,
  company_id,
  cpf_lookup_key
ON employee_cpf_links
BEGIN
  SELECT RAISE(
    ABORT,
    'employee_cpf_identity_immutable'
  );
END;


-- 5. Impede excluir diretamente um vinculo.
--
-- Preserva a rastreabilidade de identificadores.
-- A politica de retencao e exclusao de dados
-- pessoais devera ser implementada separadamente.

CREATE TRIGGER employee_cpf_no_delete
BEFORE DELETE ON employee_cpf_links
BEGIN
  SELECT RAISE(
    ABORT,
    'employee_cpf_no_delete'
  );
END;


-- =====================================================
-- FIM DA MIGRACAO 0017
-- =====================================================
--
-- Esta migracao apenas prepara a estrutura.
--
-- Nao realiza carga automatica de CPFs legados.
-- Nao cria contas ou sessoes.
-- Nao altera logins administrativos.
--
-- Etapas posteriores:
--
-- 1. Validar a estrutura no D1 local.
-- 2. Testar vinculos e restricoes reais.
-- 3. Preparar a carga segura dos CPFs existentes.
-- 4. Integrar autenticacao por CPF.
-- 5. Validar sessoes e autorizacao empresarial.
-- 6. Reconstruir employees em etapa separada.
--
-- Nao executar migracoes remotas sem
-- validacao e autorizacao explicita.
-- =====================================================
