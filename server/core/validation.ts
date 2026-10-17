import { z } from 'zod';
import { DateTime } from 'luxon';
import { ApiError } from './errors';
import type { Ctx } from '../types';
export const uuid = z.string().uuid();
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => DateTime.fromISO(v).isValid && v >= '1900-01-01' && v <= '2100-12-31', 'Data inválida.');
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine(v => v >= '1900-01' && v <= '2100-12');
export const password = z.string().min(12, 'Use pelo menos 12 caracteres.').max(128, 'Use no máximo 128 caracteres.');
export const login = z.string().trim().min(3).max(120).regex(/^[a-zA-Z0-9._@+\-]+$/, 'Use letras sem acento, números, ponto, hífen ou @.').transform(v => v.toLowerCase());
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const tm = (v: string) => Number(v.slice(0,2))*60 + Number(v.slice(3));
export const scheduleSchema = z.object({
  start: time, break_start: time, break_end: time, end: time,
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v => new Set(v).size === v.length),
  paid_break: z.boolean(),
}).strict().superRefine((v,ctx) => {
  const s=tm(v.start); const at=(x:string)=>tm(x)<s ? tm(x)+1440:tm(x);
  const bs=at(v.break_start), be=at(v.break_end), end=tm(v.end)<=s?tm(v.end)+1440:tm(v.end);
  if (!(s<bs && bs<be && be<end && end-s<1440)) ctx.addIssue({code:'custom',message:'Os horários devem seguir entrada → intervalo → retorno → saída, em um turno menor que 24h.'});
});
export const rulesSchema = z.object({
  mark_tolerance:z.number().int().min(0).max(30), daily_tolerance:z.number().int().min(0).max(60),
  rounding_step:z.union([z.literal(1),z.literal(5),z.literal(10),z.literal(15)]),
  rounding_mode:z.enum(['floor','nearest','ceil']), auto_approve_overtime:z.boolean(),
  compensation:z.enum(['review','bank']), max_shift_hours:z.number().int().min(12).max(36),
}).strict();
export const employeeSchema = z.object({
  full_name:z.string().trim().min(3).max(140), registration:z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N}._\-]+$/u),
  cpf:z.string().optional().transform(v=>v===undefined?undefined:v.replace(/\D/g,'')).refine(v=>!v || validCpf(v),'CPF inválido.'),
  job_title:z.string().trim().max(100), admission_date:date,
  employment_end:date.nullable().optional(), status:z.enum(['active','blocked','terminated']), notes:z.string().max(2000),
  login, email:z.union([z.email().max(200).transform(v=>v.toLowerCase()),z.literal('')]).optional(),
});
function validCpf(v:string) {
  if (!/^\d{11}$/.test(v)||/^(\d)\1{10}$/.test(v)) return false;
  for(let len=9;len<11;len++){ let sum=0;for(let i=0;i<len;i++)sum+=+v[i]*(len+1-i);let digit=(sum*10)%11;if(digit===10)digit=0;if(digit!==+v[len])return false; }return true;
}
export async function body<T extends z.ZodType>(c:Ctx, schema:T):Promise<z.infer<T>> {
  if (!c.req.header('Content-Type')?.includes('application/json')) throw new ApiError(415,'content_type','Envie dados em JSON.');
  let value; try { value=await c.req.json(); } catch { throw new ApiError(400,'invalid_json','O conteúdo enviado não é um JSON válido.'); }
  const result=schema.safeParse(value);
  if (!result.success) throw new ApiError(422,'validation','Confira os campos informados.',result.error.flatten());
  return result.data;
}
export function parse<T extends z.ZodType>(schema:T,value:unknown):z.infer<T> {
  const result=schema.safeParse(value);
  if (!result.success) throw new ApiError(422,'validation','Parâmetro inválido.',result.error.flatten());
  return result.data;
}
