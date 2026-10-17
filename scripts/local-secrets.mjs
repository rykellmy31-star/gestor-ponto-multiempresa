import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.dev.vars')) { console.log('.dev.vars já existe; nenhum segredo foi alterado.'); process.exit(0); }
writeFileSync('.dev.vars', ['AUTH_PEPPER','DATA_KEY','BOOTSTRAP_TOKEN'].map(k=>`${k}="${randomBytes(32).toString('hex')}"`).join('\n')+'\n',{mode:0o600});
console.log('Segredos locais independentes gerados em .dev.vars (não versionar). Use npm run setup:token somente em terminal privado.');
