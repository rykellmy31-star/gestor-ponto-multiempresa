import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync, appendFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createClient, validateStagingDatabase, provisionStaging } from './provision-cloudflare-staging.mjs';
import { STAGING_DATABASE, STAGING_ORIGIN, STAGING_WORKER } from './staging-guard.mjs';

// Credenciais de QA separadas por finalidade. A derivacao unidirecional permite
// repetir o teste sem revelar/persistir senha e sem trocar chaves do Worker.
const infrastructureToken = process.env.CLOUDFLARE_STAGING_TOKEN;
if (!infrastructureToken) throw new Error('Token staging ausente.');
const qaPassword = 'Qa!' + createHmac('sha256', infrastructureToken).update('cr-jornada/staging/qa-admin/v1').digest('hex');
const mask = value => { if (value) console.log('::add-mask::' + value); return value; };
mask(qaPassword);
const api = createClient({ token: infrastructureToken, accountId: process.env.CLOUDFLARE_ACCOUNT_ID });
let checks = 0;
const verify = (condition, label) => { assert.ok(condition, label); checks++; console.log('APROVADO: ' + label); };

class Client {
  cookies = new Map();
  csrf = '';
  async call(path, { method = 'GET', body, expected = 200, csrf = this.csrf, origin = STAGING_ORIGIN, headers = {}, text = false } = {}) {
    const response = await fetch(STAGING_ORIGIN + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Origin: origin, 'Content-Type': 'application/json',
        Cookie: [...this.cookies].map(([k,v]) => k + '=' + v).join('; '),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0], i = pair.indexOf('=');
      this.cookies.set(pair.slice(0,i), mask(pair.slice(i+1)));
      if (pair.slice(i+1)) verify(/HttpOnly/i.test(cookie) && /Secure/i.test(cookie) && /SameSite=Strict/i.test(cookie), 'cookie seguro');
    }
    const data = text ? await response.text() : await response.json().catch(() => ({}));
    mask(data.csrf_token); mask(data.temporary_password);
    assert.equal(response.status, expected, method + ' ' + path + ' (' + (data.error?.code || 'sem codigo') + ')');
    checks++;
    if (data.csrf_token) this.csrf = data.csrf_token;
    return data;
  }
}

try {
  await provisionStaging({ exerciseFeatures: true });
  const config = JSON.parse(readFileSync('wrangler.staging.jsonc', 'utf8'));
  const databaseId = validateStagingDatabase({ name: STAGING_DATABASE, uuid: config.d1_databases[0].database_id });
  const query = async (sql, params = []) => {
    const data = await api('/d1/database/' + databaseId + '/query', {
      method: 'POST', body: { sql, params }, databaseId
    });
    const result = data.result?.[0];
    assert.ok(result?.success && Array.isArray(result.results), 'Consulta staging');
    return result.results;
  };
  const admins = await query('SELECT login FROM platform_admins');
  const root = new Client();
  if (!admins.length) {
    const secretPath = '/workers/scripts/' + STAGING_WORKER + '/secrets';
    const names = (await api(secretPath)).result.map(s => s.name);
    assert.ok(!names.includes('PLATFORM_BOOTSTRAP_TOKEN'), 'Nao sobrescrever bootstrap existente');
    const bootstrap = mask(randomBytes(32).toString('hex'));
    await api(secretPath, { method: 'PUT', body: { name: 'PLATFORM_BOOTSTRAP_TOKEN', text: bootstrap, type: 'secret_text' } });
    try {
      // Propagacao de secret pode levar alguns segundos; nenhuma tentativa muda
      // dados antes de a credencial chegar. Limite abaixo do rate limit da rota.
      let setup;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise(r => setTimeout(r, 5000));
        try {
          setup = await root.call('/api/platform/setup', { method: 'POST', expected: 201,
            body: { token: bootstrap, name: 'Superadmin Ficticio QA', login: 'qa-staging', email: '', password: qaPassword } });
          break;
        } catch (error) {
          if (!error.message.includes('invalid_platform_setup') || attempt === 2) throw error;
        }
      }
      assert.ok(setup?.success, 'Configuracao QA inicial');
    } finally {
      await api(secretPath + '/PLATFORM_BOOTSTRAP_TOKEN', { method: 'DELETE' });
    }
  } else assert.ok(admins.some(a => a.login === 'qa-staging'), 'Staging pertence a outra homologacao; nao modificar contas');
  await root.call('/api/platform/auth/login', { method: 'POST', body: { login: 'qa-staging', password: qaPassword } });
  await root.call('/api/platform/auth/session');
  const anonymous = new Client();
  // Conteudo ficticio publicado apenas no dominio staging; nenhum link de
  // compra externo e acionado e nenhum e-mail ou mensagem e enviado.
  const sales = await root.call('/api/platform/sales-page');
  const salesConfig = { ...sales.config, headline: 'CR JORNADA: pagina ficticia de homologacao',
    lead_form_enabled: false, whatsapp: '',
    plans: sales.config.plans.map(plan => ({ ...plan, checkout_url: STAGING_ORIGIN + '/funcionario' })) };
  const draft = await root.call('/api/platform/sales-page', { method: 'PUT',
    body: { config: salesConfig, published: false, expected_revision: sales.revision } });
  const visibleDraft = await anonymous.call('/api/public/sales-page');
  verify(!visibleDraft.published || visibleDraft.config?.headline !== salesConfig.headline, 'rascunho comercial nao vaza');
  const published = await root.call('/api/platform/sales-page', { method: 'PUT',
    body: { config: salesConfig, published: true, expected_revision: draft.revision } });
  const visible = await anonymous.call('/api/public/sales-page');
  verify(visible.published && visible.config.headline === salesConfig.headline, 'pagina comercial publicada no staging');
  const page = await fetch(STAGING_ORIGIN + '/vendas', { redirect: 'error', signal: AbortSignal.timeout(20000) });
  verify(page.ok && (await page.text()).includes(salesConfig.headline), 'HTML comercial renderiza conteudo publicado');
  await root.call('/api/platform/sales-page/unpublish', { method: 'POST', body: { expected_revision: published.revision } });
  verify(!(await anonymous.call('/api/public/sales-page')).published, 'retirada da pagina comercial confirmada');
  await anonymous.call('/api/platform/companies', { expected: 401 });
  await root.call('/api/platform/companies', { method: 'POST', body: {}, csrf: 'invalid', expected: 403 });
  await root.call('/api/platform/companies', { method: 'POST', body: {}, origin: 'https://example.invalid', expected: 403 });
  const tag = randomBytes(5).toString('hex');
  const initialPassword = mask('QaInicial!' + randomBytes(20).toString('hex'));
  const finalPassword = mask('QaFinal!' + randomBytes(20).toString('hex'));
  const companies = [];
  for (const letter of ['a', 'b']) {
    const body = { name: 'Empresa Ficticia QA ' + letter, document: '', slug: 'qa-' + tag + '-' + letter, timezone: 'America/Bahia' };
    const { company } = await root.call('/api/platform/companies', { method: 'POST', body, expected: 201 });
    await root.call('/api/platform/companies', { method: 'POST', body, expected: 409 });
    await root.call('/api/platform/companies/' + company.id + '/admins', { method: 'POST', expected: 201,
      body: { name: 'Gestor Ficticio ' + letter, login: 'gestor', email: '', password: initialPassword } });
    const client = new Client();
    await client.call('/api/company/auth/login', { method: 'POST', body: { company: company.slug, login: 'gestor', password: initialPassword } });
    const firstSession = await client.call('/api/company/auth/session');
    verify(firstSession.must_change_password === true, 'troca inicial obrigatoria');
    await client.call('/api/company/employees', { expected: 403 });
    await client.call('/api/company/auth/change-password', { method: 'POST', body: { current_password: initialPassword, new_password: finalPassword } });
    await client.call('/api/company/auth/session', { expected: 401 });
    await client.call('/api/company/auth/login', { method: 'POST', body: { company: company.slug, login: 'gestor', password: finalPassword } });
    const session = await client.call('/api/company/auth/session');
    verify(session.company.id === company.id && !session.must_change_password, 'gestor vinculado a empresa correta');
    companies.push({ ...company, client });
  }
  const [a,b] = companies;
  const cpfBase = Array.from(randomBytes(9), n => n % 10);
  for (const length of [9,10]) { const sum = cpfBase.reduce((s,n,i) => s+n*(length+1-i),0); cpfBase.push((sum*10)%11%10); }
  const cpf = cpfBase.join('');
  const employeePassword = mask('QaFuncionario!' + randomBytes(20).toString('hex'));
  for (const company of companies) {
    const payload = { full_name: 'Funcionario Ficticio QA', registration: 'QA001', cpf, job_title: 'Teste', admission_date: '2026-01-01' };
    const created = await company.client.call('/api/company/employees', { method: 'POST', body: payload, expected: 201 });
    company.employee = created.employee;
    await company.client.call('/api/company/employees', { method: 'POST', body: payload, expected: 409 });
    await company.client.call('/api/company/employees', { method: 'POST', body: { ...payload, company_id: company.id }, expected: 400 });
    const staff = new Client();
    await staff.call('/api/employee/cpf-auth/login', { method: 'POST', body: { cpf, password: created.temporary_password } });
    await staff.call('/api/employee/cpf-auth/session');
    await staff.call('/api/employee/cpf-auth/password', { method: 'POST', body: { current_password: created.temporary_password, new_password: employeePassword } });
    await staff.call('/api/employee/cpf-auth/session', { expected: 401 });
  }
  for (const [company,other] of [[a,b],[b,a]]) {
    const list = await company.client.call('/api/company/employees');
    verify(list.employees.length === 1 && list.employees[0].id === company.employee.id,
      'listagem de funcionarios isolada');
    await company.client.call('/api/platform/companies', { expected: 401 });
    await company.client.call('/api/company/employees/' + other.employee.id + '/reset-password', { method: 'POST', body: { current_password: finalPassword }, expected: 404 });
  }
  const morning = { name: 'Manha QA', start: '07:00', break_start: '11:00', break_end: '12:00', end: '16:00', weekdays: [1,2,3,4,5], paid_break: false };
  const afternoon = { ...morning, name: 'Tarde QA', start: '13:00', break_start: '16:00', break_end: '17:00', end: '22:00',
    day_overrides: { '3': { start: '07:00', break_start: '11:00', break_end: '12:00', end: '16:00', paid_break: false } } };
  const headers = { 'Idempotency-Key': randomUUID() };
  const shift = await a.client.call('/api/company/schedules', { method: 'POST', body: morning, headers, expected: 201 });
  const replay = await a.client.call('/api/company/schedules', { method: 'POST', body: morning, headers });
  verify(shift.id === replay.id && replay.reused === true, 'cadastro de jornada idempotente');
  const shift2 = await a.client.call('/api/company/schedules', { method: 'POST', body: afternoon, expected: 201 });
  await a.client.call('/api/company/schedules/' + shift.id + '/assign-all', { method: 'POST', body: { effective_from: '2026-10-26' }, expected: 201 });
  await a.client.call('/api/company/schedules/' + shift.id + '/assign-all', { method: 'POST', body: { effective_from: '2026-10-26' } });
  await a.client.call('/api/company/schedules/' + shift2.id + '/assign', { method: 'POST', body: { employee_id: a.employee.id, effective_from: '2026-10-27' }, expected: 201 });
  const week = await a.client.call('/api/company/schedules/employee/' + a.employee.id + '/week?from=2026-10-26');
  verify(week.days[0].shift.start === '07:00' && week.days[1].shift.start === '13:00' && week.days[2].shift.start === '07:00', 'horarios distintos por dia e historico preservado');
  await b.client.call('/api/company/schedules/employee/' + a.employee.id + '/week?from=2026-10-26', { expected: 404 });
  await b.client.call('/api/company/schedules/' + shift.id + '/assign-all', { method: 'POST', body: { effective_from: '2026-10-26' }, expected: 404 });
  const employeeClients = [];
  for (const company of companies) {
    const client = new Client();
    const decision = await client.call('/api/employee/cpf-auth/login', { method: 'POST', body: { cpf, password: employeePassword } });
    verify(decision.selection_required && decision.companies.length === 2, 'CPF com dois vinculos exige escolha');
    await client.call('/api/employee/cpf-auth/select', { method: 'POST', body: { company_id: company.id } });
    const session = await client.call('/api/employee/cpf-auth/session');
    verify(session.company.id === company.id && session.user.employee_id === company.employee.id, 'sessao funcionario isolada');
    const history = await client.call('/api/employee/cpf-work/history?month=2026-10');
    verify(history.company_id === company.id && history.employee_id === company.employee.id, 'historico vinculado a sessao');
    employeeClients.push(client);
  }
  // Configurar as politicas pelo painel real, sem fixtures SQL.
  // Usar somente as duas empresas ficticias criadas nesta rodada.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const rules = { mark_tolerance: 5, daily_tolerance: 10, rounding_step: 1,
    rounding_mode: 'floor', auto_approve_overtime: false, compensation: 'review', max_shift_hours: 24 };
  const policyBrowser = await chromium.launch({headless:true});
  try {
    for (const company of companies) {
      const initial = await company.client.call('/api/company/punch-policy');
      verify(!initial.enabled && initial.revision === 0, 'empresa nova inicia com ponto bloqueado');
      await company.client.call('/api/company/punch-policy?company_id=' + company.id, {expected:400});
      await company.client.call('/api/company/punch-policy', {method:'PUT',csrf:'invalid',
        body:{enabled:true,rules,expected_revision:0},expected:403});
      const context = await policyBrowser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(STAGING_ORIGIN + '/empresa/entrar');
        await page.getByLabel('Identificador da empresa',{exact:true}).fill(company.slug);
        await page.getByLabel('Usuário administrador',{exact:true}).fill('gestor');
        await page.getByLabel('Senha',{exact:true}).fill(finalPassword);
        await page.getByRole('button',{name:'Entrar na empresa',exact:true}).click();
        const panel = page.locator('section').filter({has:page.getByRole('heading',{
          name:'Regras de ponto da empresa',exact:true
        })});
        await panel.getByLabel('Permitir registro de ponto',{exact:true}).check();
        await panel.getByLabel('Tolerância por marcação (minutos)',{exact:true}).fill('5');
        await panel.getByRole('button',{name:'Salvar regras de ponto',exact:true}).click();
        await panel.getByText('Regras salvas. Os registros e as regras dos dias já iniciados foram preservados.',{exact:true}).waitFor();
        verify(true,'politica de ponto configurada pelo painel real');
      } finally {await context.close();}
      const saved = await company.client.call('/api/company/punch-policy');
      verify(saved.enabled && saved.revision === 1 &&
        JSON.stringify(saved.rules) === JSON.stringify(rules), 'API confirma regras salvas pelo painel');
      await company.client.call('/api/company/punch-policy', {method:'PUT',
        body:{enabled:false,rules,expected_revision:0},expected:409});
    }
  } finally {await policyBrowser.close();}
  const punchSchedule = { ...morning, name: 'Janela QA de ponto', start: '00:00', end: '23:00', weekdays: [0,1,2,3,4,5,6] };
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i], employee = employeeClients[i];
    const schedule = await company.client.call('/api/company/schedules', { method: 'POST', body: punchSchedule, expected: 201 });
    await company.client.call('/api/company/schedules/' + schedule.id + '/assign', { method: 'POST',
      body: { employee_id: company.employee.id, effective_from: today }, expected: 201 });
    for (const type of ['entry','break_start','break_end','exit']) {
      const current = await employee.call('/api/employee/cpf-work/today');
      verify(current.next_type === type && current.company_id === company.id, 'sequencia e empresa do ponto');
      const body = { type, idempotency_key: randomUUID() };
      const confirmed = await employee.call('/api/employee/cpf-work/punch', { method: 'POST', body, expected: 201 });
      const repeated = await employee.call('/api/employee/cpf-work/punch', { method: 'POST', body });
      verify(confirmed.punch.id === repeated.punch.id && repeated.replayed, 'ponto idempotente sem duplicacao');
      if(i === 0 && type === 'entry') {
        await company.client.call('/api/company/punch-policy', {method:'PUT',
          body:{enabled:true,rules:{...rules,mark_tolerance:7},expected_revision:1}});
        const other = await companies[1].client.call('/api/company/punch-policy');
        verify(other.rules.mark_tolerance === 5, 'alterar politica A preserva politica B');
      }

    }
    const finished = await employee.call('/api/employee/cpf-work/today');
    verify(finished.completed && finished.next_seq === 4, 'quatro batidas confirmadas');
    const saved = await query('SELECT COUNT(*) AS total FROM punches p JOIN work_days d ON d.id=p.work_day_id WHERE d.company_id=? AND p.employee_id=?',
      [company.id, company.employee.id]);
    verify(saved[0].total === 4, 'D1 confirma quatro batidas por empresa');
    const snapshot = await query('SELECT rules_json FROM work_days WHERE company_id=? AND employee_id=? AND work_date=?',
      [company.id,company.employee.id,today]);
    verify(JSON.parse(snapshot[0].rules_json).mark_tolerance === 5,
      'D1 preserva regras do dia iniciado apos alteracao da politica');
    const audit = await query('SELECT revision,enabled FROM company_punch_policy_audit WHERE company_id=? ORDER BY revision',[company.id]);
    verify(audit.length === (i===0?2:1) && audit.every((row,index)=>row.revision===index+1 && row.enabled===1),
      'D1 confirma auditoria versionada da politica por empresa');

  }
  for (const [index, company] of companies.entries()) {
    const other = companies[1-index];
    const path = '/api/company/reports/attendance?employee_id=' + company.employee.id + '&month=' + today.slice(0,7);
    const report = await company.client.call(path);
    verify(report.company_id === company.id && report.employee.id === company.employee.id &&
      report.rows.length === 4 && report.rows.every(row => row.receipt_hash && row.punch_id),
      'relatorio mensal confirma quatro comprovantes da propria empresa');
    await company.client.call('/api/company/reports/attendance?employee_id=' + other.employee.id + '&month=' + today.slice(0,7), {expected:404});
    await company.client.call(path + '&company_id=' + other.id, {expected:400});
    const csv = await company.client.call(path + '&format=csv', {text:true});
    verify(csv.includes('Comprovante') && report.rows.every(row => csv.includes(row.receipt_hash)),
      'CSV real preserva os quatro comprovantes');
  }
  for (const [index,company] of companies.entries()) {
    const path='/api/company/reports/calculations?employee_id='+company.employee.id+'&month='+today.slice(0,7);
    const calculation=await company.client.call(path);
    const day=calculation.days.find(row=>row.date===today);
    verify(calculation.company_id===company.id && calculation.employee.id===company.employee.id &&
      calculation.provisional && day.source==='snapshot' && day.result.rules.mark_tolerance===5 &&
      day.result.expected_minutes===1320 && day.result.status==='completed',
      'apuracao real usa horarios e regras congelados do dia');
    verify(calculation.days.filter(row=>row.state==='needs_review').every(row=>row.result===null),
      'apuracao nao presume faltas sem historico comprovado');
    await company.client.call('/api/company/reports/calculations?employee_id='+companies[1-index].employee.id+'&month='+today.slice(0,7),{expected:404});
    await company.client.call(path+'&company_id='+companies[1-index].id,{expected:400});
    const csv=await company.client.call(path+'&format=csv',{text:true});
    verify(csv.includes('provisória') && csv.includes('Saldo bruto (min)'),
      'CSV de apuracao identifica valores provisorios');
  }
  // Real browser against the deployed staging UI, including its login form.
  // Only masked fictitious QA credentials are used; no production credentials.
  const browser = await chromium.launch({headless:true});
  try {
    for (const company of companies) {
      const context = await browser.newContext({acceptDownloads:true});
      try {
        const page = await context.newPage();
        page.on('pageerror',()=>console.log('DIAGNOSTICO: erro JavaScript na interface de staging'));
        await page.goto(STAGING_ORIGIN + '/empresa/entrar');
        await page.getByLabel('Identificador da empresa',{exact:true}).fill(company.slug);
        await page.getByLabel('Usuário administrador',{exact:true}).fill('gestor');
        await page.getByLabel('Senha',{exact:true}).fill(finalPassword);
        await page.getByRole('button',{name:'Entrar na empresa',exact:true}).click();
        await page.getByRole('heading',{name:'Jornadas e escalas',exact:true}).waitFor();
        verify(true,'login empresarial realizado pelo formulario real');
        const panel = page.locator('section').filter({has:page.getByRole('heading',{
          name:'Relatório mensal de marcações',exact:true
        })});
        await panel.getByLabel('Funcionário', {exact:true}).selectOption(company.employee.id);
        await panel.getByLabel('Mês', {exact:true}).fill(today.slice(0,7));
        await panel.getByRole('button',{name:'Consultar marcações',exact:true}).click();
        await panel.getByRole('link',{name:'Exportar CSV',exact:true}).waitFor();
        verify(await panel.locator('tbody tr').count() === 4,
          'painel real apresenta quatro marcacoes da empresa autenticada');
        const downloaded = page.waitForEvent('download');
        await panel.getByRole('link',{name:'Exportar CSV',exact:true}).click();
        const download = await downloaded;
        verify(await download.failure() === null && download.suggestedFilename() ===
          'marcacoes-' + today.slice(0,7) + '.csv', 'painel real exporta CSV autenticado');
        const contents = readFileSync(await download.path(),'utf8');
        verify(contents.includes('Comprovante') && contents.split('\r\n').length === 6,
          'CSV baixado pelo navegador contem cabecalho e quatro registros');
        const calculation=page.locator('section').filter({has:page.getByRole('heading',{
          name:'Apuração de jornadas',exact:true
        })});
        await calculation.getByLabel('Funcionário',{exact:true}).selectOption(company.employee.id);
        await calculation.getByLabel('Mês',{exact:true}).fill(today.slice(0,7));
        await calculation.getByRole('button',{name:'Apurar jornadas',exact:true}).click();
        await calculation.getByRole('link',{name:'Exportar apuração CSV',exact:true}).waitFor();
        const parts=today.split('-').map(Number);
        verify(await calculation.locator('tbody tr').count()===new Date(Date.UTC(parts[0],parts[1],0)).getUTCDate(),
          'painel real apresenta apuracao para todos os dias do mes');
        const calculationDownloaded=page.waitForEvent('download');
        await calculation.getByRole('link',{name:'Exportar apuração CSV',exact:true}).click();
        const calculationDownload=await calculationDownloaded;
        verify(await calculationDownload.failure()===null && calculationDownload.suggestedFilename()===
          'apuracao-'+today.slice(0,7)+'.csv','painel real exporta apuracao autenticada');
        verify(readFileSync(await calculationDownload.path(),'utf8').includes('provisória'),
          'download de apuracao mantem identificacao de conferencia');

      } finally {await context.close();}
    }
  } finally {await browser.close();}
  await root.call('/api/platform/companies/' + a.id + '/status', { method: 'PATCH', body: { status: 'suspended' } });
  await a.client.call('/api/company/reports/attendance?employee_id=' + a.employee.id + '&month=' + today.slice(0,7), {expected:401});
  await a.client.call('/api/company/reports/calculations?employee_id='+a.employee.id+'&month='+today.slice(0,7),{expected:401});
  await a.client.call('/api/company/auth/session', { expected: 401 });
  await employeeClients[0].call('/api/employee/cpf-auth/session', { expected: 401 });
  await b.client.call('/api/company/auth/session');
  await employeeClients[1].call('/api/employee/cpf-auth/session');
  await root.call('/api/platform/companies/' + a.id + '/status', { method: 'PATCH', body: { status: 'active' } });
  await a.client.call('/api/company/auth/session', { expected: 401 });
  await employeeClients[0].call('/api/employee/cpf-auth/session', { expected: 401 });
  const count = await query('SELECT COUNT(*) AS total FROM employees WHERE company_id IN (?,?)', [a.id,b.id]);
  verify(count[0].total === 2, 'D1 confirma dois funcionarios ficticios');
  const assignments = await query('SELECT COUNT(*) AS total FROM schedule_assignments WHERE employee_id=?', [a.employee.id]);
  verify(assignments[0].total === 3, 'D1 confirma historico de atribuicoes');
  const report = 'Homologacao HTTP real: ' + checks + ' verificacoes aprovadas. Duas empresas ficticias; autenticacao, CSRF, origem, CPF, jornadas, ponto, relatorios JSON/CSV, painel real de relatorios, apuracao provisoria com snapshots e suspensao. Politicas de ponto configuradas pelo painel real, auditoria versionada e preservacao de snapshots confirmadas no D1.\n';
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
} catch (error) {
  // Assertions nao incluem respostas completas, senhas, cookies ou CPF.
  console.error('Homologacao interrompida: ' + error.message);
  process.exitCode = 1;
}
