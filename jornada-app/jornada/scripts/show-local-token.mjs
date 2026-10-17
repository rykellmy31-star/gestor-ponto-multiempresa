import { readFileSync } from 'node:fs';
const token = readFileSync('.dev.vars','utf8').match(/^BOOTSTRAP_TOKEN="?([^"\r\n]+)"?/m)?.[1];
if (!token) throw new Error('Execute npm run secrets:local.');
console.log('Código de configuração LOCAL (não compartilhar):\n'+token+'\nAbra /setup e escolha seu próprio usuário e senha.');
