
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// CR JORNADA - Passo 54
// Verificacao estatica das regras de matricula.
//
// Nao modifica o banco D1.
// Nao instala dependencias adicionais.
// Nao executa migracoes remotas.

function readMigration(filename: string): string {
  return readFileSync(
    resolve(process.cwd(), 'migrations', filename),
    'utf8'
  );
}

const initial = readMigration('0001_initial.sql');

const foundation = readMigration(
  '0015_employee_company_foundation.sql'
);

const registration = readMigration(
  '0016_employee_registration_foundation.sql'
);

describe('CR JORNADA - seguranca das matriculas', () => {
  it('identifica a restricao global original', () => {
    expect(initial).toMatch(
      /registration\s+TEXT\s+NOT\s+NULL\s+UNIQUE\s+COLLATE\s+NOCASE/i
    );
  });

  it('confirma que funcionarios possuem company_id', () => {
    expect(foundation).toMatch(
      /ALTER\s+TABLE\s+employees\s+ADD\s+COLUMN\s+company_id/i
    );

    expect(foundation).toMatch(
      /REFERENCES\s+companies\s*\(\s*id\s*\)/i
    );
  });

  it('confirma a obrigatoriedade da empresa no cadastro', () => {
    expect(foundation).toMatch(
      /CREATE\s+TRIGGER\s+employees_require_company/i
    );

    expect(foundation).toMatch(
      /employee_company_required/i
    );
  });

  it('impede alterar a empresa de um funcionario', () => {
    expect(foundation).toMatch(
      /CREATE\s+TRIGGER\s+employees_company_immutable/i
    );

    expect(foundation).toMatch(
      /employee_company_immutable/i
    );
  });

  it('confirma o indice unico de matricula empresarial', () => {
    expect(registration).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+employees_company_registration_unique/i
    );

    expect(registration).toMatch(
      /ON\s+employees\s*\(\s*company_id\s*,\s*registration\s+COLLATE\s+NOCASE\s*\)/i
    );
  });

  it('confirma que o indice ignora funcionarios excluidos', () => {
    expect(registration).toMatch(
      /WHERE\s+deleted_at\s+IS\s+NULL\s+AND\s+company_id\s+IS\s+NOT\s+NULL/i
    );
  });

  it('identifica os logins globais do sistema antigo', () => {
    expect(initial).toMatch(
      /CREATE\s+TABLE\s+login_identifiers/i
    );

    expect(initial).toMatch(
      /identifier\s+TEXT\s+PRIMARY\s+KEY\s+COLLATE\s+NOCASE/i
    );
  });

  it('confirma que a matricula participa dos identificadores de login', () => {
    expect(initial).toMatch(
      /CREATE\s+TRIGGER\s+identifiers_registration/i
    );

    expect(initial).toMatch(
      /NEW\.registration/i
    );
  });

  it('confirma que historicos referenciam funcionarios', () => {
    const tables = [
      'schedule_assignments',
      'work_days',
      'punches',
      'occurrences',
      'overtime_decisions',
      'monthly_closures'
    ];

    for (const table of tables) {
      const escaped = table.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );

      const pattern = new RegExp(
        `CREATE\\s+TABLE\\s+${escaped}\\s*\\([\\s\\S]*?employee_id\\s+TEXT\\s+NOT\\s+NULL\\s+REFERENCES\\s+employees\\s*\\(\\s*id\\s*\\)`,
        'i'
      );

      expect(initial).toMatch(pattern);
    }
  });
});
