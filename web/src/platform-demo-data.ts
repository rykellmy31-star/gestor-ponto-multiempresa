export type DemoCompanyStatus = 'active' | 'suspended' | 'archived';
export type DemoCompany = {
  id: string;
  name: string;
  slug: string;
  document: string;
  status: DemoCompanyStatus;
  timezone: 'America/Bahia' | 'America/Sao_Paulo';
  created_at: number;
};
export type DemoCompanyDraft = {
  name: string;
  slug: string;
  document: string;
  timezone: DemoCompany['timezone'];
};
export const demoCompanies: DemoCompany[] = [
  { id: 'demo-1', name: 'Empresa Exemplo Norte', slug: 'empresa-exemplo-norte',
    document: 'FICTÍCIO', status: 'active',
    timezone: 'America/Bahia', created_at: 1770000000000 },
  { id: 'demo-2', name: 'Loja Modelo Centro', slug: 'loja-modelo-centro',
    document: 'FICTÍCIO', status: 'active',
    timezone: 'America/Sao_Paulo', created_at: 1770000000000 },
  { id: 'demo-3', name: 'Serviços Exemplo Sul', slug: 'servicos-exemplo-sul',
    document: 'FICTÍCIO', status: 'suspended',
    timezone: 'America/Bahia', created_at: 1770000000000 }
];

export function normalizeDemoSlug(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60);
}

export function validateDemoCompany(
  draft: DemoCompanyDraft,
  companies: DemoCompany[],
  existingId?: string
): string | null {
  if (draft.name.trim().length < 3 || draft.name.trim().length > 140) {
    return 'Informe um nome entre 3 e 140 caracteres.';
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug) ||
    draft.slug.length > 60) {
    return 'Escolha um identificador válido, com letras, números e hífens.';
  }
  if (companies.some(company =>
    company.slug.toLowerCase() === draft.slug.toLowerCase() &&
    company.id !== existingId
  )) {
    return 'Esse identificador já está em uso na demonstração.';
  }
  if (draft.document.length > 32) {
    return 'O documento deve ter no máximo 32 caracteres.';
  }
  if (!['America/Bahia','America/Sao_Paulo'].includes(draft.timezone)) {
    return 'Fuso horário não permitido.';
  }
  return null;
}

export function demoCompanyCounts(companies: DemoCompany[]) {
  return {
    total: companies.length,
    active: companies.filter(company => company.status === 'active').length,
    suspended: companies.filter(company => company.status === 'suspended').length,
    archived: companies.filter(company => company.status === 'archived').length
  };
}
