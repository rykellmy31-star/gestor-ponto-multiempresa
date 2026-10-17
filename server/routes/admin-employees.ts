
import { Hono } from 'hono';
import { z } from 'zod';
import type { App } from '../types';
import { auditStatement, requireRecent } from '../core/security';
import {
  body, date, employeeSchema, login, parse,
  password, scheduleSchema, uuid
} from '../core/validation';
import { ensure } from '../core/errors';
import {
  encryptPersonal, hashPassword, randomToken, sha256
} from '../core/crypto';
import { localDate, scheduleMinutes } from '../core/time';

export const adminEmployees = new Hono<App>();

const notCancelled = (alias: string) =>
  `NOT EXISTS (
    SELECT 1 FROM schedule_assignment_cancellations cac
    WHERE cac.assignment_id=${alias}.id
  )`;

adminEmployees.get('/employees', async c => {
  const db = c.get('db');
  const settings = await db.prepare(
    'SELECT timezone FROM settings WHERE id=1'
  ).first<{timezone:string}>();

  const today = localDate(Date.now(), settings!.timezone);

  const rows = await db.prepare(`
    SELECT e.*,u.id user_id,u.login,u.email,
           u.active user_active,u.must_change_password,
      (
        SELECT s.name
        FROM schedule_assignments a
        JOIN schedules s ON s.id=a.schedule_id
        WHERE a.employee_id=e.id
          AND a.effective_from<=?
          AND ${notCancelled('a')}
        ORDER BY a.effective_from DESC
        LIMIT 1
      ) schedule_name
    FROM employees e
    JOIN users u ON u.employee_id=e.id
    WHERE e.deleted_at IS NULL
    ORDER BY e.full_name
  `).bind(today).all<any>();

  return c.json(
    rows.results.map(({cpf_encrypted,...r})=>r)
  );
});

adminEmployees.post('/employees', async c => {
  const input = await body(
    c,
    employeeSchema.extend({
      initial_password:password,
      schedule_id:uuid
    }).strict()
  );

  const db=c.get('db');
  const now=Date.now();
  const employeeId=crypto.randomUUID();
  const userId=crypto.randomUUID();

  const exists=await db.prepare(
    'SELECT id FROM schedules WHERE id=? AND archived=0 AND deleted_at IS NULL'
  ).bind(input.schedule_id).first();

  ensure(
    exists,422,'invalid_schedule',
    'Selecione uma jornada válida.'
  );

  const end=input.employment_end||null;

  ensure(
    input.status!=='terminated'||end,
    422,'employment_end_required',
    'Informe a data de desligamento.'
  );

  ensure(
    !end||end>=input.admission_date,
    422,'invalid_employment_end',
    'O desligamento deve ser posterior à admissão.'
  );

  const hash=await hashPassword(
    input.initial_password,c.env.AUTH_PEPPER
  );

  const cpf=input.cpf
    ?await encryptPersonal(input.cpf,c.env.DATA_KEY)
    :null;

  await db.batch([
    db.prepare(`
      INSERT INTO employees(
        id,full_name,registration,cpf_encrypted,cpf_last4,
        job_title,admission_date,employment_end,status,
        notes,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      employeeId,input.full_name,input.registration,
      cpf,input.cpf?.slice(-4)||null,input.job_title,
      input.admission_date,end,input.status,
      input.notes,now,now
    ),

    db.prepare(`
      INSERT INTO users(
        id,login,email,display_name,password_hash,
        role,employee_id,active,must_change_password,
        created_at,updated_at
      ) VALUES(?,?,?,?,?,'employee',?,?,1,?,?)
    `).bind(
      userId,input.login,input.email||null,
      input.full_name,hash,employeeId,
      input.status==='active'?1:0,now,now
    ),

    db.prepare(`
      INSERT INTO schedule_assignments(
        id,employee_id,schedule_id,effective_from,created_at
      ) VALUES(?,?,?,?,?)
    `).bind(
      crypto.randomUUID(),employeeId,
      input.schedule_id,input.admission_date,now
    ),

    auditStatement(
      c,'employee.created','employee',employeeId,
      {
        registration:input.registration,
        schedule_id:input.schedule_id,
        status:input.status
      }
    )
  ]);

  return c.json({
    id:employeeId,
    message:'Funcionário e acesso criados. A senha inicial deverá ser alterada no primeiro acesso.'
  },201);
});

adminEmployees.get('/employees/:id',async c=>{
  const id=parse(uuid,c.req.param('id'));
  const db=c.get('db');

  const employee=await db.prepare(`
    SELECT e.*,u.id user_id,u.login,u.email,
           u.must_change_password
    FROM employees e
    JOIN users u ON u.employee_id=e.id
    WHERE e.id=? AND e.deleted_at IS NULL
  `).bind(id).first<any>();

  ensure(
    employee,404,'employee_not_found',
    'Funcionário não encontrado.'
  );

  delete employee.cpf_encrypted;

  const assignments=await db.prepare(`
    SELECT a.id,a.schedule_id,a.effective_from,
           s.name,s.config_json
    FROM schedule_assignments a
    JOIN schedules s ON s.id=a.schedule_id
    WHERE a.employee_id=?
      AND ${notCancelled('a')}
    ORDER BY a.effective_from DESC
  `).bind(id).all<any>();

  const history=await db.prepare(`
    SELECT a.id,a.action,a.details_json,a.created_at,
           u.display_name actor_name
    FROM audit_log a
    LEFT JOIN users u ON u.id=a.actor_id
    WHERE
      (a.entity_type='employee' AND a.entity_id=?)
      OR
      (a.entity_type='user' AND a.entity_id=?)
    ORDER BY a.created_at DESC
    LIMIT 100
  `).bind(id,employee.user_id).all();

  return c.json({
    employee,
    assignments:assignments.results.map(a=>({
      ...a,
      config:JSON.parse(a.config_json)
    })),
    history:history.results
  });
});

adminEmployees.put('/employees/:id',async c=>{
  requireRecent(c);

  const id=parse(uuid,c.req.param('id'));
  const input=await body(c,employeeSchema.strict());
  const db=c.get('db');
  const now=Date.now();

  const old=await db.prepare(`
    SELECT e.*,u.id user_id,u.login,u.email
    FROM employees e
    JOIN users u ON u.employee_id=e.id
    WHERE e.id=? AND e.deleted_at IS NULL
  `).bind(id).first<any>();

  ensure(
    old,404,'employee_not_found',
    'Funcionário não encontrado.'
  );

  const end=input.employment_end||null;

  ensure(
    input.status!=='terminated'||end,
    422,'employment_end_required',
    'Informe a data de desligamento.'
  );

  ensure(
    !end||end>=input.admission_date,
    422,'invalid_employment_end',
    'O desligamento deve ser posterior à admissão.'
  );

  if(
    old.admission_date!==input.admission_date||
    old.employment_end!==end
  ){
    const closed=await db.prepare(`
      SELECT 1 ok FROM monthly_closures
      WHERE employee_id=? AND status='closed'
      LIMIT 1
    `).bind(id).first();

    ensure(
      !closed,409,'period_closed',
      'Reabra os períodos fechados antes de alterar datas do vínculo.'
    );
  }

  const cpf=input.cpf
    ?await encryptPersonal(input.cpf,c.env.DATA_KEY)
    :null;

  const statements=[
    db.prepare(`
      UPDATE employees
      SET full_name=?,registration=?,job_title=?,
          admission_date=?,employment_end=?,status=?,
          notes=?,updated_at=?
      WHERE id=?
    `).bind(
      input.full_name,input.registration,input.job_title,
      input.admission_date,end,input.status,input.notes,now,id
    ),

    db.prepare(`
      UPDATE users
      SET login=?,email=?,display_name=?,active=?,updated_at=?
      WHERE id=?
    `).bind(
      input.login,input.email||null,input.full_name,
      input.status==='active'?1:0,now,old.user_id
    )
  ];

  if(input.cpf!==undefined){
    statements.push(
      db.prepare(`
        UPDATE employees
        SET cpf_encrypted=?,cpf_last4=?
        WHERE id=?
      `).bind(cpf,input.cpf?.slice(-4)||null,id)
    );
  }

  if(input.status!=='active'){
    statements.push(
      db.prepare(
        'DELETE FROM sessions WHERE user_id=?'
      ).bind(old.user_id)
    );
  }

  const after={
    ...input,
    employment_end:end,
    email:input.email||null
  };

  const changed=[
    'full_name','registration','job_title',
    'admission_date','employment_end','status',
    'login','email'
  ] as const;

  const changes=Object.fromEntries(
    changed
      .filter(k=>(old[k]??null)!==(after[k]??null))
      .map(k=>[
        k,
        {before:old[k]??null,after:after[k]??null}
      ])
  );

  statements.push(
    auditStatement(
      c,'employee.updated','employee',id,
      {
        changes,
        notes_changed:old.notes!==input.notes,
        status_from:old.status,
        status_to:input.status,
        cpf_changed:input.cpf!==undefined
      }
    )
  );

  await db.batch(statements);

  return c.json({message:'Cadastro atualizado.'});
});


// Remocao administrativa segura. O funcionario deixa a lista e perde acesso,
// mas marcacoes, historico, atribuicoes e auditoria sao preservados.
adminEmployees.delete('/employees/:id', async c => {
  requireRecent(c);
  const id = parse(uuid, c.req.param('id'));
  await body(c, z.object({confirmation:z.literal('EXCLUIR')}).strict());

  const db = c.get('db');
  const employee = await db.prepare(`
    SELECT e.id,e.full_name,e.registration,e.status,
           e.admission_date,e.employment_end,
           u.id AS user_id
    FROM employees e
    JOIN users u ON u.employee_id=e.id AND u.role='employee'
    WHERE e.id=? AND e.deleted_at IS NULL
  `).bind(id).first<{
    id:string;
    full_name:string;
    registration:string;
    status:string;
    admission_date:string;
    employment_end:string|null;
    user_id:string;
  }>();

  ensure(employee,404,'employee_not_found',
    'Funcionario nao encontrado ou ja excluido.');

  const settings = await db.prepare(
    'SELECT timezone FROM settings WHERE id=1'
  ).first<{timezone:string}>();
  ensure(settings,503,'settings_unavailable','Configuracoes indisponiveis.');

  const now = Date.now();
  const today = localDate(now, settings.timezone);
  const employmentEnd = employee.employment_end ??
    (employee.admission_date > today ? employee.admission_date : today);

  await db.batch([
    db.prepare(`
      UPDATE employees
      SET status='terminated',employment_end=?,
          deleted_at=?,deleted_by=?,updated_at=?
      WHERE id=? AND deleted_at IS NULL
    `).bind(employmentEnd,now,c.get('principal').id,now,id),

    db.prepare(`
      UPDATE users SET active=0,updated_at=? WHERE id=?
    `).bind(now,employee.user_id),

    db.prepare('DELETE FROM sessions WHERE user_id=?')
      .bind(employee.user_id),

    db.prepare('DELETE FROM password_reset_tokens WHERE user_id=?')
      .bind(employee.user_id),

    auditStatement(c,'employee.deleted','employee',id,{
      full_name:employee.full_name,
      registration:employee.registration,
      previous_status:employee.status,
      archived_at:now,
      history_preserved:true
    })
  ]);

  return c.json({
    message:'Funcionario excluido da lista. Acesso bloqueado e historico preservado.'
  });
});

adminEmployees.post('/employees/:id/schedule',async c=>{
  requireRecent(c);

  const id=parse(uuid,c.req.param('id'));
  const input=await body(
    c,
    z.object({
      schedule_id:uuid,
      effective_from:date
    }).strict()
  );

  const db=c.get('db');

  const settings=await db.prepare(
    'SELECT timezone FROM settings WHERE id=1'
  ).first<{timezone:string}>();

  const today=localDate(Date.now(),settings!.timezone);

  ensure(
    input.effective_from>=today,
    422,'schedule_effective_date',
    'Uma alteração de jornada só pode valer a partir de hoje. O histórico anterior é preservado.'
  );

  const employee=await db.prepare(
    'SELECT id FROM employees WHERE id=? AND deleted_at IS NULL'
  ).bind(id).first();

  const schedule=await db.prepare(
    'SELECT id FROM schedules WHERE id=? AND archived=0 AND deleted_at IS NULL'
  ).bind(input.schedule_id).first();

  ensure(
    employee&&schedule,
    404,'not_found',
    'Funcionário ou jornada não encontrado.'
  );

  // Considera conflito apenas quando ja existe atribuicao ativa.
  // A atribuicao cancelada permanece no historico.
  const conflict=await db.prepare(`
    SELECT a.id FROM schedule_assignments a
    WHERE a.employee_id=? AND a.effective_from=?
      AND ${notCancelled('a')}
    LIMIT 1
  `).bind(id,input.effective_from).first();

  ensure(
    !conflict,409,'schedule_date_conflict',
    'Este funcionario ja possui uma jornada ativa nesta data.'
  );

  await db.batch([
    db.prepare(`
      INSERT INTO schedule_assignments(
        id,employee_id,schedule_id,effective_from,created_at
      ) VALUES(?,?,?,?,?)
    `).bind(
      crypto.randomUUID(),id,input.schedule_id,
      input.effective_from,Date.now()
    ),

    auditStatement(
      c,'employee.schedule_assigned',
      'employee',id,input
    )
  ]);

  return c.json({
    message:'Nova vigência atribuída. Dias já iniciados mantêm a jornada registrada no início do expediente.'
  },201);
});

// CANCELAMENTO DE ATRIBUIÇÃO FUTURA
// O registro original permanece no banco de dados.
adminEmployees.post(
  '/employees/:id/schedule/:assignmentId/cancel',
  async c=>{
    requireRecent(c);

    const employeeId=parse(uuid,c.req.param('id'));
    const assignmentId=parse(
      uuid,c.req.param('assignmentId')
    );

    await body(c,z.object({}).strict());

    const db=c.get('db');

    const settings=await db.prepare(
      'SELECT timezone FROM settings WHERE id=1'
    ).first<{timezone:string}>();

    const today=localDate(
      Date.now(),settings!.timezone
    );

    const assignment=await db.prepare(`
      SELECT a.id,a.employee_id,a.schedule_id,
             a.effective_from
      FROM schedule_assignments a
      WHERE a.id=? AND a.employee_id=?
        AND ${notCancelled('a')}
    `).bind(
      assignmentId,employeeId
    ).first<{
      id:string;
      employee_id:string;
      schedule_id:string;
      effective_from:string;
    }>();

    ensure(
      assignment,
      404,'assignment_not_found',
      'Atribuição não encontrada ou já cancelada.'
    );

    ensure(
      assignment.effective_from>today,
      409,'assignment_already_effective',
      'Somente jornadas com início futuro podem ser canceladas.'
    );

    await db.batch([
      db.prepare(`
        INSERT INTO schedule_assignment_cancellations(
          assignment_id,cancelled_at,cancelled_by,reason
        )
        SELECT a.id,?,?,?
        FROM schedule_assignments a
        WHERE a.id=?
          AND a.employee_id=?
          AND a.effective_from>?
          AND ${notCancelled('a')}
      `).bind(
        Date.now(),
        c.get('principal').id,
        'Cancelamento administrativo',
        assignmentId,employeeId,today
      ),

      auditStatement(
        c,
        'employee.schedule_assignment_cancelled',
        'employee',
        employeeId,
        {
          assignment_id:assignmentId,
          schedule_id:assignment.schedule_id,
          effective_from:assignment.effective_from
        }
      )
    ]);

    return c.json({
      message:'Atribuição futura cancelada. Histórico preservado.'
    });
  }
);

adminEmployees.get('/schedules',async c=>{
  const rows=await c.get('db').prepare(
    'SELECT * FROM schedules WHERE deleted_at IS NULL ORDER BY created_at DESC'
  ).all<any>();

  return c.json(rows.results.map(v=>{
    const config=JSON.parse(v.config_json);

    return {
      id:v.id,
      name:v.name,
      created_at:v.created_at,
      archived:!!v.archived,
      config,
      ...scheduleMinutes(config)
    };
  }));
});

adminEmployees.post('/schedules',async c=>{
  const input=await body(
    c,
    z.object({
      name:z.string().trim().min(2).max(100),
      config:scheduleSchema
    }).strict()
  );

  const id=crypto.randomUUID();
  const db=c.get('db');

  await db.batch([
    db.prepare(`
      INSERT INTO schedules(
        id,name,config_json,created_by,created_at
      ) VALUES(?,?,?,?,?)
    `).bind(
      id,input.name,JSON.stringify(input.config),
      c.get('principal').id,Date.now()
    ),

    auditStatement(
      c,'schedule.created','schedule',id,
      {name:input.name,config:input.config}
    )
  ]);

  return c.json({
    id,
    message:'Jornada criada com sucesso.'
  },201);
});

// Atualiza uma jornada existente mantendo seu ID e atribuicoes.
// O historico e registrado para vigorar a partir do dia seguinte.
adminEmployees.patch('/schedules/:id', async c => {
  requireRecent(c);

  const id = parse(uuid, c.req.param('id'));
  const input = await body(
    c,
    z.object({
      name: z.string().trim().min(2).max(100),
      config: scheduleSchema
    }).strict()
  );

  const db = c.get('db');
  const current = await db.prepare(`
    SELECT id, name, config_json, archived, deleted_at
    FROM schedules
    WHERE id = ?
  `).bind(id).first<{
    id: string;
    name: string;
    config_json: string;
    archived: number;
    deleted_at: number | null;
  }>();

  ensure(
    current, 404, 'schedule_not_found',
    'Jornada nao encontrada.'
  );
  ensure(
    current.deleted_at === null, 404, 'schedule_not_found',
    'Jornada excluida nao pode ser editada.'
  );
  ensure(
    !current.archived, 409, 'schedule_archived',
    'Restaure a jornada antes de edita-la.'
  );

  const settings = await db.prepare(
    'SELECT timezone FROM settings WHERE id=1'
  ).first<{timezone:string}>();

  const now = Date.now();
  // Soma um dia civil a data local, sem depender do fuso horario UTC.
  const today = localDate(now, settings!.timezone);
  const tomorrow = new Date(`${today}T12:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const effectiveFrom = tomorrow.toISOString().slice(0, 10);

  const nextConfig = JSON.stringify(input.config);
  const oldConfig = JSON.parse(current.config_json);

  if (
    current.name === input.name &&
    JSON.stringify(oldConfig) === nextConfig
  ) {
    return c.json({
      id,
      message: 'Nenhuma alteracao necessaria.'
    });
  }

  await db.batch([
    db.prepare(`
      UPDATE schedules
      SET name=?, config_json=?
      WHERE id=?
    `).bind(input.name, nextConfig, id),

    db.prepare(`
      INSERT INTO schedule_history(
        schedule_id, effective_from, name, config_json,
        changed_by, created_at
      ) VALUES(?,?,?,?,?,?)
    `).bind(
      id, effectiveFrom, input.name, nextConfig,
      c.get('principal').id, now
    ),

    auditStatement(
      c, 'schedule.updated', 'schedule', id,
      {
        effective_from: effectiveFrom,
        old_name: current.name,
        new_name: input.name,
        old_config: oldConfig,
        new_config: input.config
      }
    )
  ]);

  return c.json({
    id,
    effective_from: effectiveFrom,
    message: 'Jornada atualizada. Os novos horarios valem a partir de amanha.'
  });
});

adminEmployees.post('/schedules/:id/replace',async c=>{
  requireRecent(c);

  const oldId=parse(uuid,c.req.param('id'));

  const input=await body(
    c,
    z.object({
      name:z.string().trim().min(2).max(100),
      config:scheduleSchema,
      effective_from:date
    }).strict()
  );

  const db=c.get('db');

  const settings=await db.prepare(
    'SELECT timezone FROM settings WHERE id=1'
  ).first<{timezone:string}>();

  const today=localDate(Date.now(),settings!.timezone);

  ensure(
    input.effective_from>today,
    422,'invalid_effective_date',
    'Escolha uma data futura para preservar expedientes já iniciados.'
  );

  const original=await db.prepare(
    'SELECT id,archived,deleted_at FROM schedules WHERE id=?'
  ).bind(oldId).first<{
    id:string;
    archived:number;
    deleted_at:number|null;
  }>();

  ensure(
    original,404,'schedule_not_found',
    'Escala original não encontrada.'
  );

  ensure(
    original.deleted_at === null,
    404,'schedule_not_found',
    'Jornada excluida nao pode ser substituida.'
  );

  ensure(
    !original.archived,
    409,'schedule_archived',
    'Restaure esta escala antes de criar uma substituição automática.'
  );

  const current=await db.prepare(`
    SELECT e.id employee_id
    FROM employees e
    JOIN schedule_assignments a ON a.id=(
      SELECT x.id
      FROM schedule_assignments x
      WHERE x.employee_id=e.id
        AND x.effective_from<=?
        AND ${notCancelled('x')}
      ORDER BY x.effective_from DESC,x.created_at DESC
      LIMIT 1
    )
    WHERE e.status='active'
      AND a.schedule_id=?
  `).bind(
    input.effective_from,oldId
  ).all<{employee_id:string}>();

  const employees=current.results;

  for(const employee of employees){
    const conflict=await db.prepare(`
      SELECT a.id FROM schedule_assignments a
      WHERE a.employee_id=?
        AND a.effective_from=?
        AND ${notCancelled('a')}
      LIMIT 1
    `).bind(
      employee.employee_id,input.effective_from
    ).first();

    ensure(
      !conflict,
      409,'schedule_date_conflict',
      'Este funcionario ja possui uma jornada ativa nesta data.'
    );
  }

  const id=crypto.randomUUID();
  const now=Date.now();

  const statements=[
    db.prepare(`
      INSERT INTO schedules(
        id,name,config_json,created_by,created_at
      ) VALUES(?,?,?,?,?)
    `).bind(
      id,input.name,JSON.stringify(input.config),
      c.get('principal').id,now
    ),

    ...employees.map(employee=>
      db.prepare(`
        INSERT INTO schedule_assignments(
          id,employee_id,schedule_id,effective_from,created_at
        ) VALUES(?,?,?,?,?)
      `).bind(
        crypto.randomUUID(),
        employee.employee_id,
        id,input.effective_from,now
      )
    ),

    auditStatement(
      c,'schedule.replaced','schedule',id,
      {
        previous_schedule_id:oldId,
        effective_from:input.effective_from,
        assigned_employees:employees.length,
        name:input.name,
        config:input.config
      }
    )
  ];

  await db.batch(statements);

  return c.json({
    id,
    assigned_employees:employees.length,
    message:`Nova versão criada e atribuída automaticamente a ${employees.length} funcionário(s) a partir de ${input.effective_from}.`
  },201);
});

adminEmployees.patch('/schedules/:id/archive',async c=>{
  requireRecent(c);

  const id=parse(uuid,c.req.param('id'));

  const input=await body(
    c,z.object({archived:z.boolean()}).strict()
  );

  const db=c.get('db');

  const schedule=await db.prepare(
    'SELECT id,name,archived,deleted_at FROM schedules WHERE id=?'
  ).bind(id).first<{
    id:string;
    name:string;
    archived:number;
    deleted_at:number|null;
  }>();

  ensure(
    schedule,404,'schedule_not_found',
    'Escala não encontrada.'
  );
  ensure(
    schedule.deleted_at === null,404,'schedule_not_found',
    'Jornada excluida nao pode ser arquivada ou restaurada.'
  );

  if(input.archived){
    const settings=await db.prepare(
      'SELECT timezone FROM settings WHERE id=1'
    ).first<{timezone:string}>();

    const today=localDate(
      Date.now(),settings!.timezone
    );

    const current=await db.prepare(`
      SELECT 1 AS used
      FROM employees e
      JOIN schedule_assignments a ON a.id=(
        SELECT x.id
        FROM schedule_assignments x
        WHERE x.employee_id=e.id
          AND x.effective_from<=?
          AND ${notCancelled('x')}
        ORDER BY x.effective_from DESC,x.created_at DESC
        LIMIT 1
      )
      WHERE e.status='active'
        AND a.schedule_id=?
      LIMIT 1
    `).bind(today,id).first();

    ensure(
      !current,
      409,'schedule_currently_used',
      'Esta escala ainda está vigente para um funcionário ativo. Atribua outra escala antes de arquivar.'
    );

    const future=await db.prepare(`
      SELECT 1 AS used
      FROM schedule_assignments a
      WHERE a.schedule_id=?
        AND a.effective_from>?
        AND ${notCancelled('a')}
      LIMIT 1
    `).bind(id,today).first();

    ensure(
      !future,
      409,'schedule_future_assignment',
      'Esta escala possui uma atribuição futura. Revise a atribuição antes de arquivar.'
    );
  }

  await db.batch([
    db.prepare(
      'UPDATE schedules SET archived=? WHERE id=?'
    ).bind(input.archived?1:0,id),

    auditStatement(
      c,
      input.archived
        ?'schedule.archived'
        :'schedule.restored',
      'schedule',id,{name:schedule.name}
    )
  ]);

  return c.json({
    message:input.archived
      ?'Escala arquivada. Histórico preservado.'
      :'Escala restaurada.'
  });
});

adminEmployees.delete('/schedules/:id',async c=>{
  requireRecent(c);

  const id=parse(uuid,c.req.param('id'));
  const db=c.get('db');

  const existing=await db.prepare(
    'SELECT id,name,deleted_at FROM schedules WHERE id=?'
  ).bind(id).first<{
    id:string;
    name:string;
    deleted_at:number|null;
  }>();

  ensure(
    existing && existing.deleted_at === null,
    404,'schedule_not_found',
    'Jornada nao encontrada ou ja excluida.'
  );

  const assigned=await db.prepare(`
    SELECT 1 AS used
    FROM schedule_assignments
    WHERE schedule_id=?
    LIMIT 1
  `).bind(id).first();

  ensure(
    !assigned,
    409,'schedule_in_use',
    'Esta jornada ja foi atribuida a um funcionario e nao pode ser excluida, pois faz parte do historico.'
  );

  // Exclusao logica: nunca apaga o historico nem a linha de schedules.
  // O gatilho do banco rejeita a exclusao se houver atribuicoes.
  const now=Date.now();
  await db.batch([
    db.prepare(`
      UPDATE schedules
      SET deleted_at=?, archived=1
      WHERE id=?
        AND deleted_at IS NULL
        AND NOT EXISTS(
          SELECT 1 FROM schedule_assignments
          WHERE schedule_id=?
        )
    `).bind(now,id,id),

    auditStatement(
      c,'schedule.deleted','schedule',id,
      {name:existing.name,deleted_at:now,mode:'soft_delete'}
    )
  ]);

  return c.json({
    message:'Jornada removida do painel. Historico preservado.'
  });
});

adminEmployees.get('/users',async c=>{
  const rows=await c.get('db').prepare(`
    SELECT id,login,email,display_name,active,created_at
    FROM users
    WHERE role='admin'
    ORDER BY display_name
  `).all();

  return c.json(rows.results);
});

adminEmployees.post('/users',async c=>{
  requireRecent(c);

  const input=await body(
    c,
    z.object({
      name:z.string().trim().min(3).max(140),
      login,
      email:z.union([z.email(),z.literal('')]),
      initial_password:password
    }).strict()
  );

  const id=crypto.randomUUID();
  const now=Date.now();

  const hash=await hashPassword(
    input.initial_password,c.env.AUTH_PEPPER
  );

  await c.get('db').batch([
    c.get('db').prepare(`
      INSERT INTO users(
        id,login,email,display_name,password_hash,
        role,employee_id,active,must_change_password,
        created_at,updated_at
      ) VALUES(?,?,?,?,?,'admin',NULL,1,1,?,?)
    `).bind(
      id,input.login,input.email.toLowerCase()||null,
      input.name,hash,now,now
    ),

    auditStatement(
      c,'admin.created','user',id,
      {login:input.login}
    )
  ]);

  return c.json({
    id,
    message:'Administrador autorizado cadastrado. Deve alterar a senha inicial.'
  },201);
});

adminEmployees.patch('/users/:id',async c=>{
  requireRecent(c);

  const id=parse(uuid,c.req.param('id'));

  const input=await body(
    c,z.object({active:z.boolean()}).strict()
  );

  ensure(
    id!==c.get('principal').id,
    409,'cannot_block_self',
    'Não é permitido bloquear o próprio acesso.'
  );

  const db=c.get('db');

  const exists=await db.prepare(`
    SELECT id FROM users
    WHERE id=? AND role='admin'
  `).bind(id).first();

  ensure(
    exists,404,'user_not_found',
    'Administrador não encontrado.'
  );

  await db.batch([
    db.prepare(`
      UPDATE users
      SET active=?,updated_at=?
      WHERE id=? AND role='admin'
    `).bind(+input.active,Date.now(),id),

    db.prepare(
      'DELETE FROM sessions WHERE user_id=?'
    ).bind(id),

    auditStatement(
      c,'admin.status_changed','user',id,
      {active:input.active}
    )
  ]);

  return c.json({
    message:'Permissão administrativa atualizada. Sessões anteriores foram revogadas.'
  });
});

adminEmployees.post('/users/:id/reset',async c=>{
  requireRecent(c);

  const id=parse(uuid,c.req.param('id'));
  await body(c,z.object({}).strict());

  const db=c.get('db');

  const user=await db.prepare(`
    SELECT id,active FROM users WHERE id=?
  `).bind(id).first<{
    id:string;
    active:number;
  }>();

  ensure(
    user?.active,
    404,'user_not_found',
    'Usuário ativo não encontrado.'
  );

  const token=randomToken();
  const now=Date.now();

  await db.batch([
    db.prepare(`
      DELETE FROM password_reset_tokens
      WHERE user_id=?
    `).bind(id),

    db.prepare(`
      INSERT INTO password_reset_tokens(
        token_hash,user_id,expires_at,created_at
      ) VALUES(?,?,?,?)
    `).bind(
      sha256(token),id,now+30*60000,now
    ),

    auditStatement(
      c,'auth.reset_issued','user',id,
      {expires_at:now+30*60000}
    )
  ]);

  return c.json({
    message:'Valide a identidade e entregue o link por um canal de confiança. O token é exibido somente agora.',
    reset_path:`/redefinir-senha#token=${token}`,
    expires_at:now+30*60000
  });
});

adminEmployees.get('/recovery-requests',async c=>{
  const rows=await c.get('db').prepare(`
    SELECT r.id,r.user_id,r.created_at,
           u.display_name,u.login,u.role
    FROM recovery_requests r
    JOIN users u ON u.id=r.user_id
    WHERE r.status='pending'
    ORDER BY r.created_at
  `).all();

  return c.json(rows.results);
});
