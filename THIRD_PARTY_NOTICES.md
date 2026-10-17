# Componentes de terceiros

Esta é uma lista resumida dos componentes diretos. As licenças e avisos das dependências devem ser preservados nas respectivas distribuições; o pacote do projeto não substitui suas licenças originais.

| Componente | Licença declarada no pacote |
|---|---|
| Hono | MIT |
| React / React DOM | MIT |
| React Router | MIT |
| Lucide React | ISC |
| Luxon | MIT |
| pdf-lib / @pdf-lib/fontkit | MIT |
| Zod | MIT |
| Inter (distribuição Fontsource) | SIL Open Font License 1.1 |
| Noto Sans | SIL Open Font License 1.1 |

- Licença da fonte PDF Noto Sans: `server/assets/OFL.txt`, junto à fonte incluída.
- Licença Inter: `docs/fonts/Inter-OFL.txt`. Os arquivos de fonte do frontend são copiados pelo Vite a partir do pacote Fontsource instalado, sem CDN em tempo de execução.
- TypeScript, Vite, Vitest, Playwright, Wrangler, workerd e demais ferramentas mantêm as licenças dos seus pacotes instalados. As versões exatas resolvidas estão no `package-lock.json`.
- O backend gerado é enviado como Worker empacotado; os diretórios de dependências e binários de desenvolvimento não fazem parte do ZIP fonte da entrega.
