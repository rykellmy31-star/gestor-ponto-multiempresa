import { scrypt, randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
// OWASP scrypt alternative: N=2^15, r=8, p=3 (~32 MiB). Use Workers Paid.
const N = 32768, R = 8, P = 3;
export const randomToken = () => randomBytes(32).toString('hex');
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export const keyedHash = (text: string, key: string) => createHmac('sha256', key).update(text).digest('hex');
export function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
async function derive(password: string, pepper: string, salt: string) {
  const secret = keyedHash(password, pepper);
  return new Promise<Buffer>((resolve, reject) => scrypt(secret, salt, 64, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (e, key) => e ? reject(e) : resolve(key)));
}
export async function hashPassword(password: string, pepper: string) {
  const salt = randomBytes(24).toString('hex');
  return `scrypt$v1$${N}$${R}$${P}$${salt}$${(await derive(password, pepper, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string, pepper: string) {
  const [alg, version, n, r, p, salt, expected] = stored.split('$');
  if (alg !== 'scrypt' || version !== 'v1' || +n !== N || +r !== R || +p !== P || !/^[a-f0-9]{48}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(expected || '')) return false;
  return safeEqual((await derive(password, pepper, salt)).toString('hex'), expected);
}
export async function encryptPersonal(text: string, keyHex: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', Buffer.from(keyHex, 'hex'), 'AES-GCM', false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('jornada:cpf:v1') }, key, new TextEncoder().encode(text));
  return `v1.${Buffer.from(iv).toString('base64')}.${Buffer.from(encrypted).toString('base64')}`;
}
