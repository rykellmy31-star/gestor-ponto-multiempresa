import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { provisionStaging } from './provision-cloudflare-staging.mjs';
import { STAGING_ORIGIN } from './staging-guard.mjs';

// Request contains only a username/request ID or an encrypted envelope.
// No plaintext credential is accepted from tracked files or workflow inputs.
const request=JSON.parse(readFileSync('staging-owner-request.json','utf8'));
if(request.origin!==STAGING_ORIGIN||!/^[a-z0-9._@+-]{3,120}$/.test(request.login)||!/^[-a-f0-9]{36}$/.test(request.request_id))throw new Error('Pedido de acesso staging inválido.');
await provisionStaging({exerciseFeatures:true});
const post=async(path,body,headers={})=>{
  const response=await fetch(STAGING_ORIGIN+path,{method:'POST',redirect:'error',headers:{Origin:STAGING_ORIGIN,'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error('Acesso proprietário: HTTP '+response.status+' ('+(data.error?.code??'indisponivel')+').');
  return {response,data};
};
const password='Qa!'+createHmac('sha256',process.env.CLOUDFLARE_STAGING_TOKEN).update('cr-jornada/staging/qa-admin/v1').digest('hex');
console.log('::add-mask::'+password);
const login=await post('/api/platform/auth/login',{login:'qa-staging',password});
const cookie=login.response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
console.log('::add-mask::'+cookie);
const session=await fetch(STAGING_ORIGIN+'/api/platform/auth/session',{headers:{Cookie:cookie},redirect:'error'});
if(!session.ok)throw new Error('Sessão QA não confirmada.');
const {csrf_token}=await session.json();console.log('::add-mask::'+csrf_token);
const headers={Cookie:cookie,'X-CSRF-Token':csrf_token};
try{
  if(request.phase==='invite'){
    const invitation=await post('/api/platform/auth/invitations',{login:request.login,request_id:request.request_id},headers);
    // Public encryption material is safe in a public build log; activation still requires this privileged session.
    console.log('OWNER_INVITATION_PUBLIC='+JSON.stringify(invitation.data));
  }else if(request.phase==='activate'){
    if(typeof request.ciphertext!=='string'||request.ciphertext.length>2048)throw new Error('Envelope cifrado inválido.');
    const {data}=await post('/api/platform/auth/activate',{request_id:request.request_id,ciphertext:request.ciphertext},headers);
    if(!data.success||data.must_change_password!==true)throw new Error('Ativação não confirmada.');
    console.log('OWNER_ACCESS_ACTIVATED: login='+request.login+'; troca de senha obrigatoria; somente staging.');
  }else throw new Error('Fase desconhecida.');
}finally{await post('/api/platform/auth/logout',{},headers);}
