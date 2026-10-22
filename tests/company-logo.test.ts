import { describe,it,expect } from 'vitest';
import { companyLogoSchema,decodeCompanyLogo } from '../shared/company-logo';
import { png,logoFixture } from './helpers/logo-fixture';
describe('logomarca raster limitada',()=>{
  it('aceita PNG pequeno, URL HTTPS e referência autenticada, sem SVG ou conteúdo ativo',()=>{
    expect(decodeCompanyLogo(logoFixture)?.type).toBe('image/png');
    expect(companyLogoSchema.safeParse(logoFixture).success).toBe(true);
    expect(companyLogoSchema.safeParse('https://exemplo.com/logo.png').success).toBe(true);
    expect(companyLogoSchema.safeParse('/api/platform/companies/'+'a'.repeat(36)+'/logo/'+'b'.repeat(64)).success).toBe(true);
    for(const v of ['data:image/svg+xml;base64,'+btoa('<svg/>'),'javascript:alert(1)','http://exemplo.com/logo.png','data:text/html;base64,PHNjcmlwdD4='])expect(companyLogoSchema.safeParse(v).success).toBe(false);
  });
  it('recusa dimensões, animação, checksum, tamanho e tipo falsificado',()=>{
    for(const v of [png(513),png(1,true),logoFixture.replace('png','webp'),'data:image/png;base64,'+'A'.repeat(40000),logoFixture.slice(0,-8)+'AAAAAAAA'])expect(decodeCompanyLogo(v)).toBeNull();
  });
});
