import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
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
  const cpf = mask(cpfBase.join(''));
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
        await page.goto(STAGING_ORIGIN + '/admin/entrar');
        await page.getByLabel('Identificador da empresa',{exact:true}).fill(company.slug);
        await page.getByLabel('Usuário ou e-mail',{exact:true}).fill('gestor');
        await page.getByLabel('Senha',{exact:true}).fill(finalPassword);
        await page.getByRole('button',{name:'Entrar no painel',exact:true}).click();
        await page.getByRole('button',{name:'Configurações',exact:true}).click();
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
        await page.goto(STAGING_ORIGIN + '/admin/entrar');
        await page.getByLabel('Identificador da empresa',{exact:true}).fill(company.slug);
        await page.getByLabel('Usuário ou e-mail',{exact:true}).fill('gestor');
        await page.getByLabel('Senha',{exact:true}).fill(finalPassword);
        await page.getByRole('button',{name:'Entrar no painel',exact:true}).click();
        await page.getByRole('heading',{name:'Visão geral',exact:true}).waitFor();
        await page.getByRole('button',{name:'Funcionários',exact:true}).click();
        verify(true,'login empresarial realizado pelo formulario real');
        await page.getByRole('button',{name:'Funcionários',exact:true}).click();
      const access=page.locator('section').filter({has:page.getByRole('heading',{name:'Acesso dos funcionários',exact:true})});
        await access.getByText('Janela QA de ponto',{exact:false}).first().waitFor();
        await access.getByRole('button',{name:'Ver e alterar escala',exact:true}).click();
        await access.getByText('Alterar escala deste funcionário',{exact:true}).waitFor();
        await access.getByRole('button',{name:'Fechar escala',exact:true}).click();
        verify(true,'funcionario no painel mostra escala atribuida e permite consultar sete dias');
        await access.getByRole('button',{name:'Editar nome e cargo',exact:true}).click();
        const editor=access.locator('form').filter({has:page.getByRole('heading',{name:'Editar nome e cargo',exact:true})});
        const editedName='Funcionario QA '+company.slug;
        await editor.getByLabel('Nome completo',{exact:true}).fill(editedName);
        await editor.getByLabel('Cargo',{exact:true}).fill('Supervisor QA');
        await editor.getByRole('button',{name:'Salvar nome e cargo',exact:true}).click();
        await access.getByText(editedName,{exact:true}).waitFor();
        const editedList=await company.client.call('/api/company/employees');
        const editedEmployee=editedList.employees.find(e=>e.id===company.employee.id);
        verify(editedEmployee.full_name===editedName&&editedEmployee.job_title==='Supervisor QA',
          'edicao de nome e cargo pelo painel confirmada na API');
        await companies.find(c=>c.id!==company.id).client.call('/api/company/employees/'+company.employee.id,{
          method:'PATCH',body:{full_name:'Invasao QA',job_title:'Teste',expected_updated_at:editedEmployee.updated_at},expected:404});
        const audit=await query("SELECT details_json FROM audit_log WHERE action='company.employee.profile_updated' AND entity_id=?",[company.employee.id]);
        verify(audit.length===1&&JSON.parse(audit[0].details_json).company_id===company.id,
          'D1 registra auditoria da edicao empresarial');
        await page.getByRole('button',{name:'Registros de ponto',exact:true}).click();
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
        await page.getByRole('button',{name:'Folhas e relatórios',exact:true}).click();
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
  const profilesBrowser=await chromium.launch({headless:true});
  try {
    const platformContext=await profilesBrowser.newContext();
    try {
      const page=await platformContext.newPage();
      await page.goto(STAGING_ORIGIN+'/superadmin');
      await page.getByLabel('Usuário',{exact:true}).fill('qa-staging');
      await page.getByLabel('Senha',{exact:true}).fill(qaPassword);
      await page.getByRole('button',{name:'Entrar no painel',exact:true}).click();
      await page.getByRole('link',{name:'Página de vendas',exact:true}).waitFor();
      for(const company of companies)await page.getByText('Código: '+company.slug,{exact:true}).waitFor();
      verify(true,'Superadmin autentica pelo formulario e visualiza as duas empresas reais de QA');
      const logoSlug='qa-logo-'+tag,logoName='Empresa Ficticia Logo QA '+tag;
      const imageFile=async color=>({name:'qa-logo.png',mimeType:'image/png',buffer:Buffer.from(await page.evaluate(color=>{
        const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
        const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,32,32);return canvas.toDataURL('image/png').split(',')[1];
      },color),'base64')});
      await page.getByRole('button',{name:'Nova empresa',exact:true}).click();
      await page.getByLabel('Nome da empresa',{exact:true}).fill(logoName);
      await page.getByLabel('Identificador da empresa',{exact:true}).fill(logoSlug);
      await page.getByLabel('Enviar logomarca do dispositivo (opcional)',{exact:true}).setInputFiles(await imageFile('#17424a'));
      const preview=page.getByRole('img',{name:'Prévia da logomarca',exact:true});await preview.waitFor();
      verify(await preview.evaluate(async img=>{await img.decode();return img.naturalWidth>0;}),'arquivo selecionado no navegador produz previa da logomarca');
      await page.getByRole('button',{name:'Cadastrar empresa',exact:true}).click();
      await page.getByText('Código: '+logoSlug,{exact:true}).waitFor();
      let logoCompany=(await root.call('/api/platform/companies')).companies.find(c=>c.slug===logoSlug);
      verify(logoCompany&&logoCompany.logo_url.startsWith('/api/platform/companies/'),'cadastro pelo painel salva referencia autenticada da imagem');
      const storedLogo=(await query('SELECT logo_url FROM companies WHERE id=?',[logoCompany.id]))[0].logo_url;
      verify(/^data:image\/(webp|png);base64,/.test(storedLogo)&&storedLogo.length<33000,'D1 conserva logomarca otimizada com tamanho limitado');
      const served=await page.request.get(STAGING_ORIGIN+logoCompany.logo_url);
      verify(served.status()===200&&/^image\/(png|webp)$/.test(served.headers()['content-type'])&&
        (await served.body()).equals(Buffer.from(storedLogo.split(',')[1],'base64')),'imagem gravada e servida com bytes e tipo corretos');
      verify((await fetch(STAGING_ORIGIN+logoCompany.logo_url,{redirect:'error'})).status===401,'imagem administrativa exige sessao Superadmin');
      const row=page.locator('article').filter({has:page.getByText('Código: '+logoSlug,{exact:true})});
      async function editLogo(){await row.getByRole('button',{name:'Editar',exact:true}).click();await page.getByRole('heading',{name:'Editar empresa',exact:true}).waitFor();}
      async function saveLogo(){await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();await page.getByRole('heading',{name:'Editar empresa',exact:true}).waitFor({state:'hidden'});}
      await editLogo();await preview.waitFor();
      await page.getByLabel('Nome da empresa',{exact:true}).fill(logoName+' Editada');await saveLogo();
      logoCompany=(await root.call('/api/platform/companies/'+logoCompany.id)).company;
      verify(logoCompany.logo_url===served.url().slice(STAGING_ORIGIN.length),'editar dados preserva a imagem existente sem novo envio');
      await editLogo();await page.getByLabel('Enviar logomarca do dispositivo (opcional)',{exact:true}).setInputFiles(await imageFile('#0f766e'));
      await page.getByText('Preparando imagem…',{exact:true}).waitFor({state:'hidden'});await saveLogo();
      const changed=(await root.call('/api/platform/companies/'+logoCompany.id)).company;
      verify(changed.logo_url!==logoCompany.logo_url,'novo arquivo substitui a logomarca na edicao');
      await editLogo();await page.getByRole('button',{name:'Remover logomarca',exact:true}).click();await saveLogo();
      verify((await root.call('/api/platform/companies/'+logoCompany.id)).company.logo_url===null,'remocao da logomarca pelo painel e persistida');
      // Retain a fictitious uploaded logo so the encrypted recovery also checks its bytes.
      await root.call('/api/platform/companies/'+logoCompany.id,{method:'PUT',body:{name:changed.name,document:changed.document,slug:changed.slug,
        primary_color:changed.primary_color,timezone:changed.timezone,logo_url:storedLogo}});
      verify((await query('SELECT logo_url FROM companies WHERE id=?',[logoCompany.id]))[0].logo_url===storedLogo,'fixture de imagem preservada para validacao de recuperacao');

    } finally {await platformContext.close();}
    for(const company of companies) {
      const context=await profilesBrowser.newContext({acceptDownloads:true});
      try {
        const page=await context.newPage();
        await page.goto(STAGING_ORIGIN+'/funcionario');
        await page.getByRole('link',{name:'Acessar área da empresa',exact:true}).click();
        await page.getByRole('heading',{name:'Gestão em boas mãos.',exact:true}).waitFor();
        await page.getByLabel('Identificador da empresa',{exact:true}).waitFor();
        await page.getByLabel('Usuário ou e-mail',{exact:true}).waitFor();
        verify(new URL(page.url()).pathname==='/admin/entrar',
          'link da tela do funcionario abre o login administrativo seguro no mesmo sistema');
        await page.goto(STAGING_ORIGIN+'/funcionario');
        await page.getByLabel('CPF',{exact:true}).fill(cpf);
        await page.getByLabel('Senha',{exact:true}).fill(employeePassword);
        await page.getByRole('button',{name:'Entrar com segurança',exact:true}).click();
        await page.getByRole('heading',{name:'Escolha sua empresa',exact:true}).waitFor();
        await page.getByRole('button',{name:company.name,exact:true}).click();
        await page.getByText('Jornada concluída. Os registros foram confirmados pelo servidor.',{exact:true}).waitFor();
        verify(true,'funcionario autentica, escolhe empresa e visualiza jornada concluida no navegador');
        await page.getByRole('button',{name:'Minha folha de ponto',exact:true}).click();
        const history=page.locator('section').filter({has:page.getByRole('heading',{
          name:'Meu histórico de ponto',exact:true
        })}).last();
        await history.getByLabel('Mês de referência',{exact:true}).fill(today.slice(0,7));
        const downloaded=page.waitForEvent('download');
        await history.getByRole('button',{name:'Baixar extrato CSV',exact:true}).click();
        const download=await downloaded;
        verify(await download.failure()===null && download.suggestedFilename()===
          'cr-jornada-meu-ponto-'+today.slice(0,7)+'.csv','funcionario baixa extrato pelo navegador real');
        verify(await history.locator('details').count()===4,
          'historico visual do funcionario mostra quatro identificacoes de registro');
        await page.getByRole('button',{name:'Minhas solicitações',exact:true}).click();
        await page.getByLabel('Data da solicitação',{exact:true}).fill(today);
        await page.getByLabel('Justificativa',{exact:true}).fill('Solicitacao ficticia QA '+tag);
        await page.getByRole('button',{name:'Enviar solicitação',exact:true}).click();
        await page.getByText('Solicitação enviada.',{exact:true}).waitFor();
        verify((await query('SELECT id FROM company_employee_requests WHERE company_id=? AND employee_id=? AND message=?',
          [company.id,company.employee.id,'Solicitacao ficticia QA '+tag])).length===1,'solicitacao enviada pelo funcionario e persistida somente no vinculo correto');
        await page.getByRole('button',{name:'Registrar ponto',exact:true}).click();
        await page.getByRole('button',{name:'Bem',exact:true}).click();
        await page.getByText('Sua resposta de hoje foi registrada: Bem.',{exact:true}).waitFor();
        verify((await query('SELECT mood FROM company_employee_moods WHERE company_id=? AND employee_id=? AND work_date=?',
          [company.id,company.employee.id,today]))[0]?.mood==='good','pesquisa de humor respondida na interface e confirmada no D1');
      } finally {await context.close();}
    }
  } finally {await profilesBrowser.close();}
  const workspaceBrowser=await chromium.launch({headless:true});
  try {
    const context=await workspaceBrowser.newContext();
    try {
      const page=await context.newPage();await page.goto(STAGING_ORIGIN+'/admin/entrar');
      await page.getByLabel('Identificador da empresa',{exact:true}).fill(b.slug);
      await page.getByLabel('Usuário ou e-mail',{exact:true}).fill('gestor');
      await page.getByLabel('Senha',{exact:true}).fill(finalPassword);
      await page.getByRole('button',{name:'Entrar no painel',exact:true}).click();
      await page.getByRole('heading',{name:'Visão geral',exact:true}).waitFor();
      const currentPolicy=await b.client.call('/api/company/punch-policy');
      await b.client.call('/api/company/punch-policy',{method:'PUT',body:{enabled:false,rules:currentPolicy.rules,expected_revision:currentPolicy.revision}});
      const blockedClock=await employeeClients[1].call('/api/employee/cpf-work/today');
      verify(blockedClock.can_punch===false&&blockedClock.blocked.code==='company_punch_disabled'&&blockedClock.schedule&&blockedClock.next_seq===4,
        'consulta de ponto bloqueado conserva horario do servidor, escala e sequencia real');
      await page.reload();
      await page.getByRole('button',{name:'Liberar registro de ponto',exact:true}).click();
      await page.getByText('Registro de ponto liberado para funcionários com jornada atribuída.',{exact:true}).waitFor();
      verify((await b.client.call('/api/company/punch-policy')).enabled,'gestor libera o ponto pelo botao da visao geral com auditoria');
      await page.getByRole('heading',{name:'Jornada da equipe',exact:true}).waitFor();
      verify(true,'visao geral consulta API real sem bloqueio de homologacao');
      await page.getByRole('button',{name:'Ocorrências',exact:true}).click();
      await page.getByRole('button',{name:'Responder solicitação',exact:true}).click();
      await page.getByLabel('Resposta ao funcionário',{exact:true}).fill('Justificativa recebida na homologacao QA.');
      await page.getByRole('button',{name:'Confirmar resposta',exact:true}).click();
      await page.getByText('Resposta registrada.',{exact:true}).waitFor();
      const requests=await b.client.call('/api/company/workspace/requests');
      verify(requests.requests.length===1&&requests.requests[0].decision==='accepted','administrador responde somente a solicitacao da propria empresa');
      await a.client.call('/api/company/workspace/requests/'+requests.requests[0].id+'/decision',{
        method:'POST',body:{decision:'rejected',response:'Tentativa ficticia de outra empresa'},expected:409});
      await page.getByRole('button',{name:'Humor da Equipe',exact:true}).click();
      await page.getByText('Aguardando pelo menos três participantes para proteger as respostas individuais.',{exact:true}).waitFor();
      verify((await b.client.call('/api/company/workspace/mood')).results.length===0,'pesquisa protege respostas individuais de equipe pequena');
      const archived=await b.client.call('/api/company/schedules',{method:'POST',body:{...morning,name:'Modelo QA para excluir'},expected:201});
      await page.getByRole('button',{name:'Jornadas e escalas',exact:true}).click();
      const card=page.locator('article').filter({has:page.getByRole('heading',{name:'Modelo QA para excluir',exact:true})});
      page.once('dialog',dialog=>dialog.accept());
      await card.getByRole('button',{name:'Excluir escala',exact:true}).click();
      await page.getByText('Escala excluída dos modelos. Vínculos e histórico preservados.',{exact:true}).waitFor();
      verify((await query('SELECT id FROM company_workspace_audit WHERE company_id=? AND target_id=?',[b.id,archived.id])).length===1,
        'botao excluir escala registra arquivo imutavel no D1');
      verify((await query('SELECT COUNT(*) total FROM punches p JOIN work_days d ON d.id=p.work_day_id WHERE d.company_id=? AND p.employee_id=?',[b.id,b.employee.id]))[0].total===4,
        'exclusao de modelo preserva as quatro marcacoes originais');
    }finally{await context.close();}
  }finally{await workspaceBrowser.close();}
  const statusBrowser=await chromium.launch({headless:true});
  try {
    const context=await statusBrowser.newContext();
    try {
      const page=await context.newPage();
      await page.goto(STAGING_ORIGIN+'/admin/entrar');
      await page.getByLabel('Identificador da empresa',{exact:true}).fill(a.slug);
      await page.getByLabel('Usuário ou e-mail',{exact:true}).fill('gestor');
      await page.getByLabel('Senha',{exact:true}).fill(finalPassword);
      await page.getByRole('button',{name:'Entrar no painel',exact:true}).click();
      await page.getByRole('button',{name:'Funcionários',exact:true}).click();
      const access=page.locator('section').filter({has:page.getByRole('heading',{name:'Acesso dos funcionários',exact:true})});
      const initial=(await a.client.call('/api/company/employees')).employees.find(e=>e.id===a.employee.id);
      const request={status:'blocked',reason:'Teste ficticio de bloqueio do vinculo',current_password:finalPassword,expected_updated_at:initial.updated_at};
      await b.client.call('/api/company/employees/'+a.employee.id+'/status',{method:'POST',body:request,expected:404});
      await a.client.call('/api/company/employees/'+a.employee.id+'/status',{method:'POST',csrf:'invalid',body:request,expected:403});
      async function changeStatus(status,label){
        await access.getByRole('button',{name:'Gerenciar vínculo',exact:true}).click();
        const form=access.locator('form').filter({has:page.getByRole('heading',{name:'Situação do vínculo',exact:true})});
        await form.getByLabel('Nova situação',{exact:true}).selectOption(status);
        if(status==='terminated'){
          await form.getByLabel('Data de desligamento',{exact:true}).fill(today);
          await form.getByLabel('Confirmo o desligamento deste vínculo.',{exact:true}).check();
        }
        await form.getByLabel('Motivo da alteração',{exact:true}).fill('Homologacao ficticia do ciclo do vinculo');
        await form.getByLabel('Sua senha de administrador',{exact:true}).fill(finalPassword);
        await form.getByRole('button',{name:'Confirmar alteração de vínculo',exact:true}).click();
        await access.getByText(label,{exact:true}).waitFor();
        verify(true,'painel confirma situacao do vinculo: '+status);
      }
      await changeStatus('blocked','Bloqueado');
      await employeeClients[0].call('/api/employee/cpf-auth/session',{expected:401});
      await employeeClients[1].call('/api/employee/cpf-auth/session');
      await a.client.call('/api/company/employees/'+a.employee.id+'/status',{method:'POST',body:request,expected:409});
      await changeStatus('active','Ativo');
      await employeeClients[0].call('/api/employee/cpf-auth/session',{expected:401});
      const freshEmployee=new Client();
      const choices=await freshEmployee.call('/api/employee/cpf-auth/login',{method:'POST',body:{cpf,password:employeePassword}});
      verify(choices.selection_required,'reativacao permite novo login CPF com dois vinculos');
      await freshEmployee.call('/api/employee/cpf-auth/select',{method:'POST',body:{company_id:a.id}});
      await freshEmployee.call('/api/employee/cpf-auth/session');
      await changeStatus('terminated','Desligado');
      await freshEmployee.call('/api/employee/cpf-auth/session',{expected:401});
      await employeeClients[1].call('/api/employee/cpf-auth/session');
      const finalEmployee=(await a.client.call('/api/company/employees')).employees.find(e=>e.id===a.employee.id);
      verify(finalEmployee.status==='terminated'&&finalEmployee.employment_end===today,'API confirma desligamento com data da empresa');
      await a.client.call('/api/company/employees/'+a.employee.id+'/status',{method:'POST',body:{...request,status:'active',expected_updated_at:finalEmployee.updated_at},expected:409});
      const events=await query("SELECT details_json FROM audit_log WHERE action='company.employee.status_changed' AND entity_id=?",[a.employee.id]);
      verify(events.length===3&&events.every(e=>JSON.parse(e.details_json).company_id===a.id),'D1 confirma tres auditorias de situacao do vinculo');
      const retained=await query('SELECT COUNT(*) AS total FROM punches p JOIN work_days d ON d.id=p.work_day_id WHERE d.company_id=? AND p.employee_id=?',[a.id,a.employee.id]);
      verify(retained[0].total===4,'desligamento preserva os quatro pontos e historico da empresa');
    } finally {await context.close();}
  } finally {await statusBrowser.close();}
  // Calendar treatments use only the two fictitious tenants created in this run.
  const treatmentPath='/api/company/day-events';
  const treatmentMonth=today.slice(0,7);
  const eventRequest={kind:'holiday',work_date:today,expected_revision:0,
    reason:'Homologacao ficticia do calendario empresarial',value:{name:'Feriado ficticio QA'}};
  await b.client.call(treatmentPath,{method:'POST',body:eventRequest,csrf:'invalid',expected:403});
  await b.client.call(treatmentPath,{method:'POST',body:eventRequest,expected:201});
  await b.client.call(treatmentPath,{method:'POST',body:eventRequest,expected:409});
  const calculationFor=async company=>(await company.client.call('/api/company/reports/calculations?employee_id='+company.employee.id+'&month='+treatmentMonth)).days.find(d=>d.date===today).result;
  verify((await calculationFor(b)).expected_minutes===0,'feriado empresarial altera somente apuracao da empresa B');
  verify((await calculationFor(a)).expected_minutes===1320,'feriado da empresa B nao modifica empresa A');
  await b.client.call(treatmentPath,{method:'POST',body:{...eventRequest,expected_revision:1,value:null},expected:201});
  verify((await calculationFor(b)).expected_minutes===1320,'cancelamento versionado restaura jornada prevista');
  const occurrence={kind:'occurrence',employee_id:b.employee.id,work_date:today,expected_revision:0,
    reason:'Atestado ficticio aprovado na homologacao',value:{kind:'medical',paid:true}};
  await a.client.call(treatmentPath,{method:'POST',body:occurrence,expected:404});
  await b.client.call(treatmentPath,{method:'POST',body:occurrence,expected:201});
  verify((await calculationFor(b)).credited_minutes>0,'ocorrencia remunerada credita horas sem alterar marcacoes');
  const originals=await query('SELECT p.recorded_at FROM punches p JOIN work_days d ON d.id=p.work_day_id WHERE d.company_id=? AND p.employee_id=? ORDER BY p.seq',[b.id,b.employee.id]);
  const adjusted=originals.map(p=>Math.floor(p.recorded_at/60000)*60000);
  const treatmentBrowser=await chromium.launch({headless:true});
  try {
    const context=await treatmentBrowser.newContext();
    try {
      const page=await context.newPage();
      await page.goto(STAGING_ORIGIN+'/admin/entrar');
      await page.getByLabel('Identificador da empresa',{exact:true}).fill(b.slug);
      await page.getByLabel('Usuário ou e-mail',{exact:true}).fill('gestor');
      await page.getByLabel('Senha',{exact:true}).fill(finalPassword);
      await page.getByRole('button',{name:'Entrar no painel',exact:true}).click();
      await page.getByRole('button',{name:'Ocorrências',exact:true}).click();
      const treatments=page.locator('section').filter({has:page.getByRole('heading',{name:'Calendário e tratamentos do ponto',exact:true})});
      await treatments.getByLabel('Funcionário dos tratamentos',{exact:true}).selectOption(b.employee.id);
      await treatments.getByLabel('Mês dos tratamentos',{exact:true}).fill(treatmentMonth);
      await treatments.getByRole('button',{name:'Consultar tratamentos',exact:true}).click();
      await treatments.getByLabel('Data do tratamento',{exact:true}).fill(today);
      await treatments.getByLabel('Tipo de tratamento',{exact:true}).selectOption('adjustment');
      const labels=['Entrada ajustada','Início do intervalo ajustado','Retorno ajustado','Saída ajustada'];
      for(let i=0;i<4;i++)await treatments.getByLabel(labels[i],{exact:true}).fill(DateTime.fromMillis(adjusted[i],{zone:'America/Bahia'}).toFormat("yyyy-MM-dd'T'HH:mm"));
      await treatments.getByLabel('Justificativa do tratamento',{exact:true}).fill('Ajuste ficticio pelo painel real de homologacao');
      await treatments.getByRole('button',{name:'Salvar tratamento',exact:true}).click();
      await treatments.getByText('Versão atual nesta data: 1. Salvar registra uma nova versão com o administrador responsável.',{exact:true}).waitFor();
      verify(true,'administrador salva ajuste pelo painel real com controle de versao');
    } finally {await context.close();}
  } finally {await treatmentBrowser.close();}
  const calculatedAdjustment=await calculationFor(b);
  verify(calculatedAdjustment.adjusted===true,'apuracao real identifica ajuste aprovado');
  const retainedOriginals=await query('SELECT p.recorded_at FROM punches p JOIN work_days d ON d.id=p.work_day_id WHERE d.company_id=? AND p.employee_id=? ORDER BY p.seq',[b.id,b.employee.id]);
  verify(JSON.stringify(retainedOriginals)===JSON.stringify(originals),'ajuste preserva todos os horarios originais no D1');
  const journal=await query('SELECT kind,revision,admin_id FROM company_day_events WHERE company_id=? ORDER BY kind,revision',[b.id]);
  verify(journal.length===4&&journal.every(e=>Boolean(e.admin_id)),'D1 confirma quatro versoes auditadas de tratamentos');
  await a.client.call(treatmentPath+'?employee_id='+b.employee.id+'&month='+treatmentMonth,{expected:404});
  const isolated=await a.client.call(treatmentPath+'?employee_id='+a.employee.id+'&month='+treatmentMonth);
  verify(isolated.events.length===0,'empresa A nao consulta tratamentos da empresa B');
  // Past-month source fixture: synthetic historical marks, not server-time punches.
  // Only staging's new fictitious company B is touched; close/reopen uses real UI/API.
  const closureEmployee=randomUUID(),closureDay=randomUUID();
  const historicalDate=DateTime.fromISO(today,{zone:'America/Bahia'}).minus({months:1}).startOf('month').toISODate();
  const historicalMonth=historicalDate.slice(0,7);
  const historicalMarks=['07:00','11:00','12:00','16:00'].map(t=>DateTime.fromISO(historicalDate+'T'+t,{zone:'America/Bahia'}).toMillis());
  await query(`INSERT INTO employees(id,company_id,full_name,registration,company_registration,status,admission_date,employment_end,created_at,updated_at)
    VALUES(?,?,'Funcionario ficticio de fechamento',?,?,'active',?,NULL,?,?)`,[closureEmployee,b.id,'qa-closure-'+tag,'FECH-'+tag,historicalDate,Date.now(),Date.now()]);
  const baseRules=(await query('SELECT rules_json FROM work_days WHERE company_id=? AND employee_id=?',[b.id,b.employee.id]))[0].rules_json;
  await query(`INSERT INTO work_days(id,employee_id,work_date,timezone,schedule_json,rules_json,company_id,created_at)
    VALUES(?,?,?,'America/Bahia',?,?,?,?)`,[closureDay,closureEmployee,historicalDate,JSON.stringify({start:'07:00',break_start:'11:00',break_end:'12:00',end:'16:00',weekdays:[0,1,2,3,4,5,6],paid_break:false}),baseRules,b.id,historicalMarks[0]]);
  for(let seq=0;seq<4;seq++)await query(`INSERT INTO punches(id,work_day_id,employee_id,seq,type,recorded_at,idempotency_key,ip_hash,receipt_hash)
    VALUES(?,?,?,?,?,?,?,'qa-historical-fixture','qa-historical-fixture')`,[randomUUID(),closureDay,closureEmployee,seq,['entry','break_start','break_end','exit'][seq],historicalMarks[seq],randomUUID()]);
  await query("UPDATE employees SET status='terminated',employment_end=?,updated_at=? WHERE id=? AND company_id=?",[historicalDate,Date.now(),closureEmployee,b.id]);
  const closurePath='/api/company/closures?employee_id='+closureEmployee+'&month='+historicalMonth;
  await a.client.call(closurePath,{expected:404});
  const closurePreview=await b.client.call(closurePath);
  verify(closurePreview.problems.length===0&&closurePreview.report.totals.worked_minutes===480,'mes historico ficticio tem cobertura completa para fechamento');
  const closureRequest={employee_id:closureEmployee,month:historicalMonth,state:'closed',expected_revision:0,expected_source_version:closurePreview.report.source_version,
    reason:'Conferencia ficticia de fechamento pelo gestor',current_password:finalPassword};
  await b.client.call('/api/company/closures',{method:'POST',csrf:'invalid',body:closureRequest,expected:403});
  await b.client.call('/api/company/closures',{method:'POST',body:{...closureRequest,current_password:'senha-incorreta'},expected:403});
  const closureBrowser=await chromium.launch({headless:true});
  try {
    const context=await closureBrowser.newContext();
    try {
      const page=await context.newPage();await page.goto(STAGING_ORIGIN+'/admin/entrar');
      await page.getByLabel('Identificador da empresa',{exact:true}).fill(b.slug);
      await page.getByLabel('Usuário ou e-mail',{exact:true}).fill('gestor');
      await page.getByLabel('Senha',{exact:true}).fill(finalPassword);
      await page.getByRole('button',{name:'Entrar no painel',exact:true}).click();
      await page.getByRole('button',{name:'Folhas e relatórios',exact:true}).click();
      const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'Fechamento mensal',exact:true})});
      await panel.getByLabel('Funcionário do fechamento',{exact:true}).selectOption(closureEmployee);
      await panel.getByLabel('Mês do fechamento',{exact:true}).fill(historicalMonth);
      await panel.getByRole('button',{name:'Consultar fechamento',exact:true}).click();
      await panel.getByText('Período aberto · revisão 0',{exact:true}).waitFor();
      async function confirmPeriod(button,expected){
        await panel.getByLabel('Justificativa do fechamento ou reabertura',{exact:true}).fill('Conferencia e reabertura ficticias na homologacao');
        await panel.getByLabel('Senha para confirmar o período',{exact:true}).fill(finalPassword);
        await panel.getByLabel('Conferi os dados e confirmo esta operação no período selecionado.',{exact:true}).check();
        await panel.getByRole('button',{name:button,exact:true}).click();
        await panel.getByText(expected,{exact:true}).waitFor();
      }
      await confirmPeriod('Confirmar fechamento do mês','Período fechado · revisão 1');
      const frozen=await b.client.call(closurePath);
      verify(frozen.report.provisional===false&&frozen.snapshot_hash.length===64,'snapshot real fechado possui identificacao SHA256');
      await b.client.call('/api/company/closures',{method:'POST',body:closureRequest,expected:409});
      const frozenEvent={kind:'occurrence',employee_id:closureEmployee,work_date:historicalDate,expected_revision:0,
        reason:'Ocorrencia ficticia apos conferencia do periodo',value:{kind:'medical',paid:false}};
      await b.client.call('/api/company/day-events',{method:'POST',body:frozenEvent,expected:409});
      await confirmPeriod('Reabrir mês com auditoria','Período aberto · revisão 2');
      await b.client.call('/api/company/day-events',{method:'POST',body:frozenEvent,expected:201});
      // A new consultation is required because the source version changed.
      await panel.getByRole('button',{name:'Consultar fechamento',exact:true}).click();
      await panel.getByText('Período aberto · revisão 2',{exact:true}).waitFor();
      await confirmPeriod('Confirmar fechamento do mês','Período fechado · revisão 3');
      const history=await query('SELECT revision,state,snapshot_hash FROM company_monthly_closures WHERE company_id=? AND employee_id=? ORDER BY revision',[b.id,closureEmployee]);
      verify(history.length===3&&history[0].snapshot_hash===frozen.snapshot_hash&&history[1].state==='open'&&history[2].state==='closed','D1 conserva fechamento original, reabertura e novo fechamento auditados');
      verify((await query('SELECT COUNT(*) total FROM punches WHERE work_day_id=?',[closureDay]))[0].total===4,'fechamento e reabertura preservam quatro marcacoes historicas ficticias');
      verify(true,'ciclo de fechamento e reabertura aprovado pelo navegador real');
    } finally {await context.close();}
  } finally {await closureBrowser.close();}
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
  verify(count[0].total === 3, 'D1 confirma dois funcionarios CPF e um vinculo historico ficticio');
  const assignments = await query('SELECT COUNT(*) AS total FROM schedule_assignments WHERE employee_id=?', [a.employee.id]);
  verify(assignments[0].total === 3, 'D1 confirma historico de atribuicoes');
  const report = 'Homologacao HTTP real: ' + checks + ' verificacoes aprovadas. Duas empresas ficticias; autenticacao, CSRF, origem, CPF, jornadas, ponto, relatorios JSON/CSV, painel real de relatorios, apuracao provisoria com snapshots, login visual Superadmin/funcionario e suspensao. Politicas de ponto configuradas pelo painel real, auditoria versionada e preservacao de snapshots confirmadas no D1.\n';
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
} catch (error) {
  // Assertions nao incluem respostas completas, senhas, cookies ou CPF.
  console.error('Homologacao interrompida: ' + error.message);
  process.exitCode = 1;
}
