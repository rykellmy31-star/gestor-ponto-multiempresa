import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { App, Ctx, Principal, Realm } from '../types';
import { ApiError, ensure } from './errors';
import { keyedHash, randomToken, safeEqual, sha256, verifyPassword } from './crypto';
export const cookieName = (c:Ctx,realm:Realm) => c.env.ENVIRONMENT==='production'?`__Host-jornada_${realm}`:`jornada_${realm}_dev`;
export const ipHash = (c:Ctx) => keyedHash(c.req.header('CF-Connecting-IP')||'local', c.env.AUTH_PEPPER);
export async function limit(c:Ctx,key:string,max:number,windowMs:number) {
  const now=Date.now(), db=c.get('db');
  const id=keyedHash(key,c.env.AUTH_PEPPER);
  const bucket=await db.prepare(`INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING count,reset_at`).bind(id,now+windowMs,now,now).first<{count:number;reset_at:number}>();
  if(bucket&&bucket.count>max){c.header('Retry-After',String(Math.ceil((bucket.reset_at-now)/1000)));throw new ApiError(429,'rate_limited','Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');}
}
export const originGuard=createMiddleware<App>(async(c,next)=>{
  if(!['GET','HEAD','OPTIONS'].includes(c.req.method)){
    const origin=c.req.header('Origin');
    const expected=c.env.ENVIRONMENT==='production'?c.env.APP_ORIGIN:new URL(c.req.url).origin;
    let allowed=origin===expected;
    if(c.env.ENVIRONMENT!=='production'&&origin){
      // Somente para o proxy de desenvolvimento da Arena; nunca habilitado em produção.
      try{const host=new URL(origin).hostname;allowed=allowed||host==='localhost'||host==='127.0.0.1'||host.endsWith('.e2b.app');}catch{allowed=false;}
    }
    ensure(allowed&&c.req.header('Sec-Fetch-Site')!=='cross-site',403,'invalid_origin','Origem da solicitação não autorizada.');
  }
  await next();
});
export async function getPrincipal(c:Ctx,realm:Realm) {
  const token=getCookie(c,cookieName(c,realm));
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  const now=Date.now();
  const row=await c.get('db').prepare(`SELECT u.id,u.login,u.email,u.display_name,u.role,u.employee_id,u.active,u.must_change_password,s.token_hash,s.csrf_token,s.reauth_at,s.expires_at,s.last_seen_at,e.status employee_status FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN employees e ON e.id=u.employee_id WHERE s.token_hash=? AND s.realm=? AND s.auth_version=u.auth_version`).bind(sha256(token),realm).first<Principal&{last_seen_at:number;employee_status:string|null}>();
  const idle=realm==='admin'?30*60000:60*60000;
  if(!row||!row.active||row.role!==realm||row.expires_at<=now||row.last_seen_at<now-idle||(realm==='employee'&&row.employee_status!=='active')){
    if(row)await c.get('db').prepare('DELETE FROM sessions WHERE token_hash=?').bind(row.token_hash).run();
    return null;
  }
  if(now-row.last_seen_at>60000)await c.get('db').prepare('UPDATE sessions SET last_seen_at=? WHERE token_hash=?').bind(now,row.token_hash).run();
  return row;
}
export const auth=(realm:Realm,allowPasswordChange=false)=>createMiddleware<App>(async(c,next)=>{
  const user=await getPrincipal(c,realm);
  ensure(user,401,'unauthenticated','Sua sessão expirou ou você não está autenticado. Entre novamente.');
  c.set('principal',user);
  if(!['GET','HEAD'].includes(c.req.method))ensure(safeEqual(c.req.header('X-CSRF-Token')||'',user.csrf_token),403,'csrf','Solicitação de segurança inválida. Atualize a página.');
  if(!allowPasswordChange)ensure(!user.must_change_password,403,'password_change_required','Altere sua senha inicial antes de continuar.');
  await next();
});
export async function newSession(c:Ctx,userId:string,realm:Realm,authVersion:number){
  const token=randomToken(),now=Date.now(),hours=Math.min(12,Math.max(1,Number(c.env.SESSION_HOURS)||8));
  const expiresAt=now+hours*3600000;
  await c.get('db').prepare('INSERT INTO sessions(token_hash,user_id,realm,csrf_token,created_at,expires_at,last_seen_at,reauth_at,auth_version) VALUES(?,?,?,?,?,?,?,?,?)').bind(sha256(token),userId,realm,randomToken(),now,expiresAt,now,now,authVersion).run();
  setCookie(c,cookieName(c,realm),token,{httpOnly:true,secure:c.env.ENVIRONMENT==='production'||new URL(c.req.url).protocol==='https:',sameSite:'Strict',path:'/',maxAge:hours*3600});
}
export function clearSessionCookie(c:Ctx,realm:Realm){deleteCookie(c,cookieName(c,realm),{path:'/',secure:c.env.ENVIRONMENT==='production',httpOnly:true,sameSite:'Strict'});}
export function requireRecent(c:Ctx){ensure(Date.now()-c.get('principal').reauth_at<=10*60000,403,'reauth_required','Confirme sua senha novamente para executar esta operação.');}
export async function checkCurrentPassword(c:Ctx,password:string){
  const user=c.get('principal');await limit(c,`reauth:${user.id}`,8,15*60000);
  const stored=await c.get('db').prepare('SELECT password_hash FROM users WHERE id=?').bind(user.id).first<{password_hash:string}>();
  ensure(stored&&await verifyPassword(password,stored.password_hash,c.env.AUTH_PEPPER),401,'invalid_password','Senha atual incorreta.');
  await c.get('db').prepare('DELETE FROM rate_limits WHERE key=?').bind(keyedHash(`reauth:${user.id}`,c.env.AUTH_PEPPER)).run();
}
export function auditStatement(c:Ctx,action:string,entityType:string,entityId:string|null,details:unknown={},actorId?:string|null){
  return c.get('db').prepare('INSERT INTO audit_log(id,actor_id,action,entity_type,entity_id,details_json,ip_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),actorId===undefined?(c.get('principal')?.id||null):actorId,action,entityType,entityId,JSON.stringify(details),ipHash(c),Date.now());
}
export const audit = async(c:Ctx,action:string,type:string,id:string|null,details:unknown={},actorId?:string|null) => auditStatement(c,action,type,id,details,actorId).run();
export function revisionGuard(c:Ctx,revision:number){const id=crypto.randomUUID();return [c.get('db').prepare('INSERT INTO write_guards(id,expected_revision) VALUES(?,?)').bind(id,revision),c.get('db').prepare('DELETE FROM write_guards WHERE id=?').bind(id)];}
