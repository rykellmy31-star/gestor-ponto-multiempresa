import type { SalesPageConfig } from '../../shared/sales-page';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Metadados renderizados pelo Worker antes da entrega do React.
// A pagina comercial oficial publicada podera ser identificada por
// buscadores sem depender da execucao de JavaScript no navegador.
export function renderSalesHead(
  html: string,
  config: Pick<SalesPageConfig, 'headline' | 'description'> | null,
  canonicalUrl: string
): string {
  const published = config !== null;
  const title = published
    ? 'CR JORNADA | ' + config.headline
    : 'CR JORNADA — Página comercial em preparação';
  const description = published
    ? config.description
    : 'A página comercial do CR JORNADA está em preparação.';
  const safeCanonical = escapeHtml(canonicalUrl);
  const tags = [
    '<meta name="robots" content="' +
      (published ? 'index, follow' : 'noindex, nofollow') + '"/>',
    '<meta property="og:type" content="website"/>',
    '<meta property="og:title" content="' + escapeHtml(title) + '"/>',
    '<meta property="og:description" content="' + escapeHtml(description) + '"/>',
    '<link rel="canonical" href="' + safeCanonical + '"/>'
  ].join('');

  let result = html.replace(
    /<title>[^<]*<\/title>/i,
    '<title>' + escapeHtml(title) + '</title>'
  );
  result = result.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
    '<meta name="description" content="' + escapeHtml(description) + '"/>'
  );
  return result.replace(/<\/head>/i, tags + '</head>');
}
