import { describe,it,expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomBytes,createCipheriv,createPublicKey,publicEncrypt } from 'node:crypto';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import server from '../server/index';
import { hashPassword } from '../server/core/crypto';

describe('Superadmin: convite cifrado e troca obrigatória no D1 real local',()=>{
  it('ativa uma vez, bloqueia painel antes da troca e revoga sessões ao alterar',async()=>{
    const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'test',modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']}]}));
    try{
      const binding=await mf.getD1Database('DB'),db=binding.withSession();
      const files=JSON.parse(execFileSync('python3',['-c',`
import json,sqlite3,re
from pathlib import Path
files=[]
for p in sorted(Path('migrations').glob('*.sql')):
 statements=[];pending=''
 for c in p.read_text():
  pending+=c
  if c==';' and sqlite3.complete_statement(pending):
   clean=re.sub(r'^\\s*(?:--[^\\n]*\\n\\s*)*','',pending)
   if not re.match(r'^(PRAGMA|BEGIN|COMMIT)\\b',clean,re.I): statements.append(pending)
   pending=''
 files.append(statements)
print(json.dumps(files))`],{encoding:'utf8'})) as string[][];
      expect(files).toHaveLength(42);
      for(const statements of files)if(statements.length)await db.batch(statements.map(s=>db.prepare(s)));
      const env={DB:binding,AUTH_PEPPER:'qa-platform-owner-pepper-2026-local',DATA_KEY:'a'.repeat(64),ENVIRONMENT:'development',ENABLE_COMPANY_SCHEDULES:'true'} as any;
      const rootPassword='QaRoot-Only-Testing!2026',initialPassword='QaTemporary-Only!2026',newPassword='QaChanged-Only!2026';
      await db.prepare("INSERT INTO platform_admins(id,login,display_name,password_hash,created_at,updated_at) VALUES('qa','qa','QA',?,?,?)").bind(await hashPassword(rootPassword,env.AUTH_PEPPER),Date.now(),Date.now()).run();
      const call=(path:string,body?:object,cookie='',csrf='')=>server.request('/api/platform/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'http://localhost',Cookie:cookie,'X-CSRF-Token':csrf},...(body?{body:JSON.stringify(body)}:{})},env);
      const cookie=(r:Response)=>r.headers.get('set-cookie')!.split(';')[0];
      const rootLogin=await call('auth/login',{login:'qa',password:rootPassword});expect(rootLogin.status).toBe(200);
      const rootCookie=cookie(rootLogin),rootSession=await (await call('auth/session',undefined,rootCookie)).json() as any;
      const requestId=crypto.randomUUID(),request={login:'proprietario-qa',request_id:requestId};
      expect((await call('auth/invitations',request,rootCookie,'bad')).status).toBe(403);
      const invitationResponse=await call('auth/invitations',request,rootCookie,rootSession.csrf_token);expect(invitationResponse.status).toBe(201);
      const invitation=await invitationResponse.json() as any;
      const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(requestId));
      const data=Buffer.concat([cipher.update(JSON.stringify({login:request.login,password:initialPassword})),cipher.final(),cipher.getAuthTag()]);
      const encryptedKey=publicEncrypt({key:createPublicKey({key:invitation.public_jwk,format:'jwk'}),oaepHash:'sha256',oaepLabel:Buffer.from(requestId)},key);
      const ciphertext=Buffer.from(JSON.stringify({key:encryptedKey.toString('base64'),iv:iv.toString('base64'),data:data.toString('base64')})).toString('base64');
      expect((await call('auth/activate',{request_id:requestId,ciphertext:'A'.repeat(150)},rootCookie,rootSession.csrf_token)).status).toBe(400);
      const activated=await call('auth/activate',{request_id:requestId,ciphertext},rootCookie,rootSession.csrf_token);expect(activated.status).toBe(201);
      expect((await call('auth/activate',{request_id:requestId,ciphertext},rootCookie,rootSession.csrf_token)).status).toBe(410);
      const ownerLogin=await call('auth/login',{login:request.login,password:initialPassword});expect(ownerLogin.status).toBe(200);
      const ownerCookie=cookie(ownerLogin),session=await (await call('auth/session',undefined,ownerCookie)).json() as any;
      expect(session.user.must_change_password).toBe(true);
      expect((await call('companies',undefined,ownerCookie)).status).toBe(401);
      const change={current_password:initialPassword,new_password:newPassword};
      expect((await call('auth/change-password',change,ownerCookie,'bad')).status).toBe(403);
      expect((await call('auth/change-password',{...change,new_password:initialPassword},ownerCookie,session.csrf_token)).status).toBe(400);
      expect((await call('auth/change-password',change,ownerCookie,session.csrf_token)).status).toBe(200);
      expect((await call('auth/session',undefined,ownerCookie)).status).toBe(401);
      expect((await call('auth/login',{login:request.login,password:initialPassword})).status).toBe(401);
      const changed=await call('auth/login',{login:request.login,password:newPassword});expect(changed.status).toBe(200);
      expect((await call('companies',undefined,cookie(changed))).status).toBe(200);
      const stored=await db.prepare('SELECT private_key_wrapped,used_at FROM platform_admin_invitations WHERE id=?').bind(requestId).first<any>();
      expect(stored.private_key_wrapped).toBeNull();expect(stored.used_at).toBeGreaterThan(0);
      expect((await db.prepare('SELECT COUNT(*) n FROM company_admin_write_guards').first<any>()).n).toBe(0);
    }finally{await mf.dispose();}
  },120000);
});
