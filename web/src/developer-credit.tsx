// Assinatura solicitada pelo criador do CR JORNADA.
export const developerCredit = 'Sistema desenvolvido por Carlos Rykellmy Santos Correia';

export function DeveloperCredit() {
  return (
    <footer className="cr-site-credit" aria-label="Créditos de desenvolvimento">
      <span>{developerCredit}</span>
    </footer>
  );
}
