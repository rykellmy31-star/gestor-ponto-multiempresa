import { describe, expect, it } from 'vitest';
import {
  demoCompanies, demoCompanyCounts, normalizeDemoSlug,
  validateDemoCompany
} from '../web/src/platform-demo-data';

describe('CR JORNADA - demonstracao visual isolada do superadmin', () => {
  it('inicia somente com registros ficticios, sem dados da farmacia', () => {
    expect(demoCompanies).toHaveLength(3);
    expect(demoCompanies.every(company => company.document === 'FICTÍCIO')).toBe(true);
    expect(JSON.stringify(demoCompanies).toLowerCase()).not.toContain('pague pouco');
  });
  it('calcula indicadores usando apenas os dados em memoria', () => {
    expect(demoCompanyCounts(demoCompanies)).toEqual({
      total: 3, active: 2, suspended: 1, archived: 0
    });
    const next = demoCompanies.map(company => ({ ...company }));
    next[0].status = 'archived';
    expect(demoCompanyCounts(next)).toEqual({
      total: 3, active: 1, suspended: 1, archived: 1
    });
    expect(demoCompanyCounts(demoCompanies).archived).toBe(0);
  });
  it('normaliza slug com acentos e evita colisoes', () => {
    expect(normalizeDemoSlug('  Farmácia Éxemplo – Testes!! '))
      .toBe('farmacia-exemplo-testes');
    expect(validateDemoCompany({
      name: 'Outra Empresa',
      slug: 'empresa-exemplo-norte',
      document: 'FICTÍCIO',
      timezone: 'America/Bahia'
    }, demoCompanies)).toMatch(/já está em uso/);
  });
  it('permite editar o mesmo identificador e impede insercao invalida', () => {
    expect(validateDemoCompany({
      name: 'Empresa Exemplo Norte',
      slug: 'empresa-exemplo-norte',
      document: 'FICTÍCIO',
      timezone: 'America/Bahia'
    }, demoCompanies, 'demo-1')).toBeNull();
    expect(validateDemoCompany({
      name: 'AB',
      slug: 'a',
      document: '',
      timezone: 'America/Bahia'
    }, demoCompanies)).toMatch(/nome/);
  });
});
