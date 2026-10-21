import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const CLOUDFLARE_AUDIT_WORKER = 'gestor-ponto-multiempresa';
const accountRegex = /^[0-9a-f]{32}$/i;
const d1Regex = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function auditTargets(config, accountId, workerName = CLOUDFLARE_AUDIT_WORKER) {
  if (!accountRegex.test(accountId ?? '')) throw new Error('Identificador de conta invalido.');
  if (!/^[a-z0-9-]{3,80}$/.test(workerName)) throw new Error('Nome de Worker invalido.');
  const db = config?.d1_databases?.find(x => x.binding === 'DB');
  if (!db || !d1Regex.test(db.database_id ?? '')) throw new Error('Binding D1 DB invalida.');
  return {
    accountId,
    workerName,
    databaseId: db.database_id,
    databaseName: db.database_name,
    apiBase: 'https://api.cloudflare.com/client/v4/accounts/' + accountId
  };
}

export function summarizeReadOnlyResults(targets, responses) {
  const [database, workerSubdomain, workerDeployments] = responses;
  const rawDeployments = workerDeployments?.result?.deployments ??
    (Array.isArray(workerDeployments?.result) ? workerDeployments.result : []);
  return {
    worker_encontrado: Boolean(workerSubdomain?.success),
    worker_url_publica_ativa: workerSubdomain?.result?.enabled === true,
    worker_tem_implantacao: Array.isArray(rawDeployments) && rawDeployments.length > 0,
    d1_encontrado: Boolean(database?.success),
    d1_nome_corresponde_ao_configurado: database?.result?.name === targets.databaseName
  };
}

export async function cloudflareReadOnlyInventory({ token, targets, fetchImpl = fetch }) {
  if (typeof token !== 'string' || token.length < 10) {
    throw new Error('Token de auditoria ausente ou invalido.');
  }
  const request = async path => {
    const response = await fetchImpl(targets.apiBase + path, {
      method: 'GET', redirect: 'error',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(25000)
    });
    // Nao incluir o corpo bruto no CI: bindings e metadados nao precisam
    // ser reproduzidos em logs de repositorio publico.
    if (!response.ok) throw new Error('Consulta Cloudflare GET falhou: HTTP ' + response.status);
    const data = await response.json();
    if (!data?.success) {
      const code = data?.errors?.[0]?.code;
      throw new Error('Cloudflare recusou consulta GET (codigo ' +
        (Number.isSafeInteger(code) ? String(code) : 'desconhecido') + ').');
    }
    return data;
  };
  const [db, subdomain, deployments] = await Promise.all([
    request('/d1/database/' + encodeURIComponent(targets.databaseId)),
    request('/workers/scripts/' + encodeURIComponent(targets.workerName) + '/subdomain'),
    request('/workers/scripts/' + encodeURIComponent(targets.workerName) + '/deployments?per_page=1')
  ]);
  return summarizeReadOnlyResults(targets, [db, subdomain, deployments]);
}


const SCHEMA_NAMES_SQL = "SELECT name FROM sqlite_master WHERE type='table' " +
  "AND name IN ('rate_limits','platform_admins','platform_sessions','platform_audit_log','d1_migrations')";
const ADMIN_COUNT_SQL = 'SELECT COUNT(*) AS total FROM platform_admins';
const MIGRATIONS_COUNT_SQL = 'SELECT COUNT(*) AS total FROM d1_migrations';

// SQL fixo, unicamente SELECT: o token D1 Read nao autoriza DDL/DML.
// O relatorio publica somente presenca do esquema e contagens agregadas.
export async function cloudflareReadOnlySchema({ token, targets, fetchImpl = fetch }) {
  if (typeof token !== 'string' || token.length < 10) {
    throw new Error('Token de auditoria ausente ou invalido.');
  }
  const query = async sql => {
    if (![SCHEMA_NAMES_SQL, ADMIN_COUNT_SQL, MIGRATIONS_COUNT_SQL].includes(sql)) {
      throw new Error('SQL de auditoria nao autorizado.');
    }
    const response = await fetchImpl(
      targets.apiBase + '/d1/database/' + encodeURIComponent(targets.databaseId) + '/query',
      {
        method: 'POST', redirect: 'error',
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql }),
        signal: AbortSignal.timeout(25000)
      }
    );
    if (!response.ok) throw new Error('Leitura SQL D1 recusada: HTTP ' + response.status);
    const data = await response.json();
    const first = data?.result?.[0];
    if (!data?.success || !first?.success || !Array.isArray(first.results)) {
      throw new Error('Resposta de leitura SQL D1 invalida.');
    }
    if (first.meta?.changed_db === true || Number(first.meta?.rows_written || 0) > 0) {
      throw new Error('Operacao SQL D1 declarou alteracao inesperada.');
    }
    return first.results;
  };
  const names = new Set((await query(SCHEMA_NAMES_SQL))
    .map(row => row.name).filter(name => typeof name === 'string'));
  const required = ['rate_limits','platform_admins','platform_sessions','platform_audit_log'];
  const admins = names.has('platform_admins')
    ? Number((await query(ADMIN_COUNT_SQL))[0]?.total) : null;
  const migrations = names.has('d1_migrations')
    ? Number((await query(MIGRATIONS_COUNT_SQL))[0]?.total) : null;
  if ((admins !== null && (!Number.isSafeInteger(admins) || admins < 0)) ||
      (migrations !== null && (!Number.isSafeInteger(migrations) || migrations < 0))) {
    throw new Error('Contagem SQL D1 inesperada.');
  }
  return {
    tabelas_basicas_superadmin_presentes: required.every(name => names.has(name)),
    tabela_rate_limits: names.has('rate_limits'),
    tabela_platform_admins: names.has('platform_admins'),
    tabela_platform_sessions: names.has('platform_sessions'),
    tabela_platform_audit_log: names.has('platform_audit_log'),
    migracoes_registradas: migrations,
    quantidade_superadmins: admins
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_AUDIT_TOKEN;
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    const targets = auditTargets(config, accountId);
    const report = await cloudflareReadOnlyInventory({ token, targets });
    console.log('Inventario de recursos Cloudflare (somente leitura):');
    for (const [name, value] of Object.entries(report)) console.log(name + ': ' + value);
    if (!Object.values(report).every(Boolean)) process.exitCode = 1;
    const schema = await cloudflareReadOnlySchema({ token, targets });
    console.log('Verificacao restrita do esquema D1 (sem dados pessoais):');
    for (const [name, value] of Object.entries(schema)) console.log(name + ': ' + value);
  } catch (error) {
    console.error('Auditoria abortada: ' + (error instanceof Error ? error.message : 'Erro desconhecido.'));
    process.exitCode = 1;
  }
}
