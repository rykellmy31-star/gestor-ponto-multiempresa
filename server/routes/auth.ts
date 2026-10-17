import { Hono } from 'hono';
import { z } from 'zod';
import type { App, Realm } from '../types';
import { body, login, password, parse } from '../core/validation';
import { ensure } from '../core/errors';
import { hashPassword, keyedHash, randomToken, safeEqual, sha256, verifyPassword } from '../core/crypto';
import { audit, auditStatement, auth, checkCurrentPassword, clearSessionCookie, ipHash, limit, newSession } from '../core/security';
export const authRoutes=new Hono<App>();
const realmOf=(v:string)=>parse(z.enum(['admin','employee']),v);

authRoutes.get('/public/config',async c=>{
  const config=await c.get('db').prepare('SELECT company_name,timezone FROM settings WHERE id=1').first();
  const exists=await c.get('db').prepare('SELECT 1 ok FROM setup_state WHERE id=1').first();
  return c.json({ ...config, setup_required:!exists, environment:c.env.ENVIRONMENT, server_now:Date.now(), email_recovery_enabled:!!(c.env.MAIL_API_KEY&&c.env.MAIL_FROM) });
});
authRoutes.post('/setup',async c=>{
  await limit(c,`setup:${ipHash(c)}`,5,3600000);
  const input=await body(c,z.object({token:z.string().min(32).max(128),name:z.string().trim().min(3).max(140),login,email:z.union([z.email(),z.literal('')]),password,company_name:z.string().trim().min(2).max(140),timezone:z.enum(['America/Bahia','America/Sao_Paulo'])}).strict());
  ensure(c.env.BOOTSTRAP_TOKEN&&safeEqual(input.token,c.env.BOOTSTRAP_TOKEN),403,'invalid_setup','Código de configuração inválido ou configuração desabilitada.');
  const existing=await c.get('db').prepare('SELECT 1 ok FROM setup_state WHERE id=1').first();
  ensure(!existing,410,'setup_completed','A configuração inicial já foi concluída.');
  const id=crypto.randomUUID(),now=Date.now(),hash=await hashPassword(input.password,c.env.AUTH_PEPPER);
  await c.get('db').batch([
    c.get('db').prepare('INSERT INTO setup_state(id,completed_at) VALUES(1,?)').bind(now),
    c.get('db').prepare('INSERT INTO users(id,login,email,display_name,password_hash,role,employee_id,active,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,\'admin\',NULL,1,0,?,?)').bind(id,input.login,input.email.toLowerCase()||null,input.name,hash,now,now),
    c.get('db').prepare('UPDATE settings SET company_name=?,timezone=?,updated_at=? WHERE id=1').bind(input.company_name,input.timezone,now),
    auditStatement(c,'setup.completed','user',id,{company_name:input.company_name},id),
  ]);
  return c.json({message:'Administrador criado. Entre com as credenciais que você definiu.'},201);
});

authRoutes.post('/auth/:realm/login',async c=>{
  const realm=realmOf(c.req.param('realm'));
  const input=await body(c,z.object({identifier:z.string().trim().min(1).max(200),password:z.string().min(1).max(128)}).strict());
  const identifier=input.identifier.toLowerCase();
  await limit(c,`login-ip:${ipHash(c)}`,60,15*60000);
  await limit(c,`login-account:${realm}:${identifier}`,10,15*60000);
  const user=await c.get('db').prepare(`SELECT u.*,e.status employee_status FROM login_identifiers i JOIN users u ON u.id=i.user_id LEFT JOIN employees e ON e.id=u.employee_id WHERE i.identifier=? AND u.role=?`).bind(identifier,realm).first<{id:string;password_hash:string;active:number;employee_status:string;auth_version:number}>();
  const valid=user?await verifyPassword(input.password,user.password_hash,c.env.AUTH_PEPPER):(await hashPassword(input.password,c.env.AUTH_PEPPER),false);
  if(!valid||!user?.active||(realm==='employee'&&user.employee_status!=='active')){
    await audit(c,'auth.login_failed','auth',null,{realm});
    return c.json({error:{code:'invalid_credentials',message:'Usuário ou senha inválidos, ou acesso não autorizado.'}},401);
  }
  await newSession(c,user.id,realm,user.auth_version);
  await c.get('db').prepare('DELETE FROM rate_limits WHERE key=?').bind(keyedHash(`login-account:${realm}:${identifier}`,c.env.AUTH_PEPPER)).run();
  await audit(c,'auth.login','user',user.id,{realm},user.id);
  return c.json({message:'Acesso autorizado.'});
});
for(const realm of ['admin','employee'] as const){
  authRoutes.get(`/auth/${realm}/session`,auth(realm,true),c=>{
    const u=c.get('principal');return c.json({user:{id:u.id,login:u.login,email:u.email,name:u.display_name,role:u.role,employee_id:u.employee_id,must_change_password:!!u.must_change_password},csrf_token:u.csrf_token,expires_at:u.expires_at,server_now:Date.now()});
  });
  authRoutes.post(`/auth/${realm}/logout`,auth(realm,true),async c=>{
    const u=c.get('principal');await c.get('db').batch([c.get('db').prepare('DELETE FROM sessions WHERE token_hash=?').bind(u.token_hash),auditStatement(c,'auth.logout','user',u.id)]);clearSessionCookie(c,realm);return c.json({message:'Sessão encerrada.'});
  });
  authRoutes.post(`/auth/${realm}/reauth`,auth(realm),async c=>{
    const input=await body(c,z.object({password:z.string().max(128)}).strict());await checkCurrentPassword(c,input.password);
    await c.get('db').prepare('UPDATE sessions SET reauth_at=? WHERE token_hash=?').bind(Date.now(),c.get('principal').token_hash).run();return c.json({message:'Identidade confirmada por 10 minutos.'});
  });
  authRoutes.post(`/auth/${realm}/password`,auth(realm,true),async c=>{
    const input=await body(c,z.object({current_password:z.string().max(128),new_password:password}).strict());await checkCurrentPassword(c,input.current_password);
    ensure(input.current_password!==input.new_password,422,'same_password','Escolha uma senha diferente da atual.');
    const hash=await hashPassword(input.new_password,c.env.AUTH_PEPPER),u=c.get('principal');
    await c.get('db').batch([
      c.get('db').prepare('UPDATE users SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?').bind(hash,Date.now(),u.id),
      c.get('db').prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id),
      c.get('db').prepare('DELETE FROM password_reset_tokens WHERE user_id=?').bind(u.id),
      auditStatement(c,'auth.password_changed','user',u.id),
    ]);clearSessionCookie(c,realm);return c.json({message:'Senha alterada. Entre novamente em seus dispositivos.'});
  });
  authRoutes.post(`/auth/${realm}/revoke-all`,auth(realm),async c=>{
    const input=await body(c,z.object({password:z.string().max(128)}).strict());await checkCurrentPassword(c,input.password);
    const id=c.get('principal').id;await c.get('db').batch([c.get('db').prepare('UPDATE users SET auth_version=auth_version+1 WHERE id=?').bind(id),c.get('db').prepare('DELETE FROM sessions WHERE user_id=?').bind(id),auditStatement(c,'auth.sessions_revoked','user',id)]);clearSessionCookie(c,realm);return c.json({message:'Todas as suas sessões foram encerradas.'});
  });
}
authRoutes.post('/auth/:realm/forgot',async c=>{
  const realm=realmOf(c.req.param('realm'));
  const input=await body(c,z.object({identifier:z.string().trim().min(1).max(200)}).strict());
  await limit(c,`forgot-ip:${ipHash(c)}`,10,3600000);
  await limit(c,`forgot-user:${realm}:${input.identifier.toLowerCase()}`,3,3600000);
  const user=await c.get('db').prepare('SELECT u.id,u.email FROM login_identifiers i JOIN users u ON u.id=i.user_id WHERE i.identifier=? AND u.role=? AND u.active=1').bind(input.identifier.toLowerCase(),realm).first<{id:string;email:string|null}>();
  if(user){
    const now=Date.now();
    await c.get('db').prepare('INSERT INTO recovery_requests(id,user_id,status,created_at) VALUES(?,?,\'pending\',?) ON CONFLICT DO NOTHING').bind(crypto.randomUUID(),user.id,now).run();
    if(c.env.MAIL_API_KEY&&c.env.MAIL_FROM&&user.email){
      const token=randomToken();
      await c.get('db').prepare('INSERT INTO password_reset_tokens(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(sha256(token),user.id,now+30*60000,now).run();
      const link=`${c.env.APP_ORIGIN}/redefinir-senha#token=${token}`;
      try{
        const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${c.env.MAIL_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:c.env.MAIL_FROM,to:[user.email],subject:'Redefinição de senha · Jornada',text:`Foi solicitada uma redefinição de senha. O link é de uso único e expira em 30 minutos:\n\n${link}\n\nSe não foi você, ignore esta mensagem e avise seu RH.`})});
        if(!sent.ok)await audit(c,'auth.recovery_delivery_failed','user',user.id,{provider_status:sent.status});
      }catch{await audit(c,'auth.recovery_delivery_failed','user',user.id);}
    }
    await audit(c,'auth.recovery_requested','user',user.id);
  }
  return c.json({message:'Se a conta existir, a solicitação foi registrada. Consulte seu e-mail, se habilitado, ou contate o administrador por um canal de confiança para validar sua identidade.'});
});
authRoutes.post('/auth/reset',async c=>{
  await limit(c,`reset:${ipHash(c)}`,10,15*60000);
  const input=await body(c,z.object({token:z.string().regex(/^[a-f0-9]{64}$/),password}).strict());
  const now=Date.now(),tokenHash=sha256(input.token),nonce=randomToken();
  const row=await c.get('db').prepare('SELECT t.user_id FROM password_reset_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.used_at IS NULL AND t.expires_at>? AND u.active=1').bind(tokenHash,now).first<{user_id:string}>();
  ensure(row,400,'invalid_reset','Link inválido, expirado ou já utilizado. Solicite outro.');
  const hash=await hashPassword(input.password,c.env.AUTH_PEPPER);
  const result=await c.get('db').batch([
    c.get('db').prepare('UPDATE password_reset_tokens SET used_at=?,consumed_nonce=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?').bind(now,nonce,tokenHash,now),
    c.get('db').prepare('UPDATE users SET password_hash=?,must_change_password=0,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM password_reset_tokens WHERE token_hash=? AND consumed_nonce=?)').bind(hash,now,row.user_id,tokenHash,nonce),
    c.get('db').prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM password_reset_tokens WHERE token_hash=? AND consumed_nonce=?)').bind(row.user_id,tokenHash,nonce),
    c.get('db').prepare('UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND token_hash<>? AND used_at IS NULL AND EXISTS(SELECT 1 FROM password_reset_tokens WHERE token_hash=? AND consumed_nonce=?)').bind(now,row.user_id,tokenHash,tokenHash,nonce),
    c.get('db').prepare("UPDATE recovery_requests SET status='resolved',resolved_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM password_reset_tokens WHERE token_hash=? AND consumed_nonce=?)").bind(now,row.user_id,tokenHash,nonce),
  ]);
  ensure(result[0].meta.changes===1,400,'invalid_reset','Link já utilizado. Solicite outro.');
  await audit(c,'auth.password_reset','user',row.user_id,{},row.user_id);
  return c.json({message:'Senha redefinida. Todas as sessões anteriores foram revogadas.'});
});
