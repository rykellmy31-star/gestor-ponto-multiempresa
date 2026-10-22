import {Building2} from 'lucide-react';
type CompanyBrandData={name?:string;slug?:string;logo_url?:string|null;primary_color?:string};
export function CompanyOriginalBrand({company}:{company:CompanyBrandData}){
  const title=company.name||company.slug||'CR JORNADA';
  // Logomarca configurada pelo superadmin da empresa, nunca identidade de outra empresa.
  const logo=company.logo_url||'';
  const permitted=/^https:\/\//.test(logo)||/^data:image\/(png|webp);base64,/.test(logo);
  return <div className="cr-original-brand" aria-label={'Empresa: '+title}>
    {permitted?<img src={logo} alt={'Logomarca de '+title} referrerPolicy="no-referrer"/>:
      <span className="cr-original-brand-icon"><Building2 size={23}/></span>}
    <span className="cr-original-brand-label">
      <strong>{title}</strong><small>Gestão de jornada · CR JORNADA</small>
    </span>
  </div>;
}