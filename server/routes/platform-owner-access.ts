import { z } from 'zod';
import type { Ctx } from '../types';
import { body,login,password } from '../core/validation';
import { ensure } from '../core/errors';
import { hashPassword,safeEqual,verifyPassword } from '../core/crypto';
import { ipHash,limit } from '../core/security';
import { getPlatformSession } from './platform-auth';

const bytes=(s:string)=>Uint8Array.from(Buffer.from(s,'base64'));
const b64=(v:ArrayBuffer|Uint8Array)=>Buffer.from(v instanceof Uint8Array?v:new Uint8Array(v)).toString('base64');
async function wrappingKey(c:Ctx){return crypto.subtle.importKey('raw',Uint8Array.from(Buffer.from(c.env.DATA_KEY,'hex')),'AES-GCM',false,['encrypt','decrypt']);}
export async function platformInvite(c:Ctx){
  const session=await getPlatformSession(c);
  ensure(session,401,'unauthenticated','Entre novamente.');
  ensure(safeEqual(c.req.header('X-CSRF-Token')??'',session.csrf_token),403,'csrf','Atualize a página.');
  await limit(c,'platform-invite:'+session.id,5,3600000);
  const input=await body(c,z.object({login,request_id:z.string().uuid()}).strict());
  const db=c.get('db'),now=Date.now();
  const existing=await db.prepare('SELECT id FROM platform_admins WHERE login=?').bind(input.login).first();
  ensure(!existing,409,'platform_account_exists','Este usuário já existe. Nenhuma conta foi sobrescrita.');
  const key=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
  const publicJwk=await crypto.subtle.exportKey('jwk',key.publicKey),privateKey=await crypto.subtle.exportKey('pkcs8',key.privateKey);
  const iv=crypto.getRandomValues(new Uint8Array(12)),aad=new TextEncoder().encode('cr-jornada:platform-invite:'+input.request_id);
  const wrapped=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await wrappingKey(c),privateKey);
  const admin=crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO platform_admins(id,login,display_name,password_hash,active,auth_version,created_at,updated_at,must_change_password)
      SELECT ?,?,?,'pending-activation',0,0,?,?,1 WHERE EXISTS(SELECT 1 FROM platform_sessions s JOIN platform_admins a ON a.id=s.admin_id
        WHERE s.token_hash=? AND a.id=? AND a.active=1 AND a.must_change_password=0 AND s.auth_version=a.auth_version AND s.expires_at>? AND s.last_seen_at>?)`)
      .bind(admin,input.login,input.login,now,now,session.tokenHash,session.id,now,now-30*60000),
    db.prepare(`INSERT INTO platform_admin_invitations(id,admin_id,public_jwk,private_key_wrapped,expires_at,created_by,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind(input.request_id,admin,JSON.stringify(publicJwk),b64(iv)+'.'+b64(wrapped),now+3600000,session.id,now),
    db.prepare("INSERT INTO platform_audit_log(id,actor_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,'platform.admin_invited','platform_admin',?,'{}',?)").bind(crypto.randomUUID(),session.id,admin,now)
  ]);
  return c.json({success:true,request_id:input.request_id,login:input.login,public_jwk:publicJwk},201);
}
export async function activatePlatformInvite(c:Ctx){
  const session=await getPlatformSession(c);
  ensure(session,401,'unauthenticated','Entre novamente.');
  ensure(safeEqual(c.req.header('X-CSRF-Token')??'',session.csrf_token),403,'csrf','Atualize a página.');
  await limit(c,'platform-activate:'+ipHash(c),10,3600000);
  const input=await body(c,z.object({request_id:z.string().uuid(),ciphertext:z.string().min(100).max(2048)}).strict());
  const db=c.get('db'),now=Date.now();
  const invitation=await db.prepare(`SELECT i.admin_id,i.private_key_wrapped,a.login,a.auth_version FROM platform_admin_invitations i JOIN platform_admins a ON a.id=i.admin_id
    WHERE i.id=? AND i.used_at IS NULL AND i.expires_at>? AND i.created_by=? AND a.active=0`).bind(input.request_id,now,session.id).first<{admin_id:string;private_key_wrapped:string;login:string;auth_version:number}>();
  ensure(invitation,410,'invitation_unavailable','Convite expirado ou já utilizado.');
  let decoded:unknown;
  try{
    const [iv,data]=invitation.private_key_wrapped.split('.');
    const privateBytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:new TextEncoder().encode('cr-jornada:platform-invite:'+input.request_id)},await wrappingKey(c),bytes(data));
    const key=await crypto.subtle.importKey('pkcs8',privateBytes,{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
    const envelope=z.object({key:z.string().max(500),iv:z.string().max(40),data:z.string().max(1500)}).strict().parse(JSON.parse(Buffer.from(input.ciphertext,'base64').toString('utf8')));
    const aesBytes=await crypto.subtle.decrypt({name:'RSA-OAEP',label:new TextEncoder().encode(input.request_id)},key,bytes(envelope.key));
    const aes=await crypto.subtle.importKey('raw',aesBytes,'AES-GCM',false,['decrypt']);
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv),additionalData:new TextEncoder().encode(input.request_id)},aes,bytes(envelope.data));
    decoded=JSON.parse(new TextDecoder().decode(plaintext));
  }catch{ensure(false,400,'invalid_activation','Não foi possível validar a ativação.');}
  const parsed=z.object({login,password}).strict().safeParse(decoded);
  ensure(parsed.success&&parsed.data.login===invitation.login,400,'invalid_activation','Não foi possível validar a ativação.');
  const hash=await hashPassword(parsed.data.password,c.env.AUTH_PEPPER);
  const guard=crypto.randomUUID();
  await db.batch([
    db.prepare(`UPDATE platform_admins SET password_hash=?,active=1,must_change_password=1,temporary_password_expires_at=?,auth_version=auth_version+1,updated_at=?
      WHERE id=? AND active=0 AND auth_version=? AND EXISTS(SELECT 1 FROM platform_admin_invitations WHERE id=? AND used_at IS NULL AND expires_at>? AND created_by=?)
      AND EXISTS(SELECT 1 FROM platform_sessions s JOIN platform_admins a ON a.id=s.admin_id WHERE s.token_hash=? AND a.id=? AND a.active=1 AND a.must_change_password=0 AND s.auth_version=a.auth_version AND s.expires_at>? AND s.last_seen_at>?)`)
      .bind(hash,now+24*3600000,now,invitation.admin_id,invitation.auth_version,input.request_id,now,session.id,session.tokenHash,session.id,now,now-30*60000),
    db.prepare('INSERT INTO company_admin_write_guards(id,affected_rows) VALUES(?,changes())').bind(guard),
    db.prepare('DELETE FROM company_admin_write_guards WHERE id=?').bind(guard),
    db.prepare('UPDATE platform_admin_invitations SET private_key_wrapped=NULL,used_at=? WHERE id=? AND used_at IS NULL').bind(now,input.request_id),
    db.prepare("INSERT INTO platform_audit_log(id,actor_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,'platform.admin_activated','platform_admin',?,'{}',?)").bind(crypto.randomUUID(),invitation.admin_id,invitation.admin_id,now)
  ]);
  return c.json({success:true,must_change_password:true},201);
}
export async function changePlatformPassword(c:Ctx){
  const session=await getPlatformSession(c,true);
  ensure(session,401,'unauthenticated','Entre novamente.');
  ensure(safeEqual(c.req.header('X-CSRF-Token')??'',session.csrf_token),403,'csrf','Atualize a página.');
  await limit(c,'platform-change-password:'+session.id,10,3600000);
  const input=await body(c,z.object({current_password:z.string().min(1).max(128),new_password:password}).strict());
  ensure(input.current_password!==input.new_password,400,'password_reuse','Escolha uma senha diferente da provisória.');
  const db=c.get('db'),admin=await db.prepare('SELECT password_hash,auth_version FROM platform_admins WHERE id=? AND active=1').bind(session.id).first<{password_hash:string;auth_version:number}>();
  ensure(admin&&await verifyPassword(input.current_password,admin.password_hash,c.env.AUTH_PEPPER),403,'invalid_password','Senha atual inválida.');
  const hash=await hashPassword(input.new_password,c.env.AUTH_PEPPER),now=Date.now(),guard=crypto.randomUUID();
  await db.batch([
    db.prepare(`UPDATE platform_admins SET password_hash=?,must_change_password=0,temporary_password_expires_at=NULL,auth_version=auth_version+1,updated_at=?
      WHERE id=? AND active=1 AND password_hash=? AND auth_version=? AND EXISTS(SELECT 1 FROM platform_sessions WHERE token_hash=? AND admin_id=? AND auth_version=? AND expires_at>? AND last_seen_at>?)`)
      .bind(hash,now,session.id,admin.password_hash,admin.auth_version,session.tokenHash,session.id,admin.auth_version,now,now-30*60000),
    db.prepare('INSERT INTO company_admin_write_guards(id,affected_rows) VALUES(?,changes())').bind(guard),
    db.prepare('DELETE FROM company_admin_write_guards WHERE id=?').bind(guard),
    db.prepare('DELETE FROM platform_sessions WHERE admin_id=?').bind(session.id),
    db.prepare("INSERT INTO platform_audit_log(id,actor_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,'platform.password_changed','platform_admin',?,'{}',?)").bind(crypto.randomUUID(),session.id,session.id,now)
  ]);
  return c.json({success:true,message:'Senha alterada. Entre novamente com a nova senha.'});
}
