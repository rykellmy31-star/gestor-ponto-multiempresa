export type Realm='admin'|'employee';
const csrf:Partial<Record<Realm,string>>={};
export class ApiError extends Error {constructor(public status:number,public code:string,message:string,public fields?:any){super(message);}}
export function setCsrf(role:Realm,token:string){csrf[role]=token;}
function realmFor(path:string):Realm{return path.includes('/admin')?'admin':'employee';}
async function check(response:Response){
  if(response.ok)return;
  let payload:any;try{payload=await response.json();}catch{payload={};}
  const err=new ApiError(response.status,payload.error?.code||'request_failed',payload.error?.message||'Não foi possível confirmar a operação. Verifique a conexão e tente novamente.',payload.error?.fields);
  if(err.code==='unauthenticated')window.dispatchEvent(new CustomEvent('jornada:session-expired'));
  throw err;
}
export async function api<T=any>(path:string,method='GET',data?:unknown):Promise<T>{
  let response:Response;
  try {response=await fetch('/api'+path,{method,credentials:'same-origin',cache:'no-store',headers:{...(data!==undefined?{'Content-Type':'application/json'}:{}),...(csrf[realmFor(path)]?{'X-CSRF-Token':csrf[realmFor(path)]!}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})});}
  catch{throw new ApiError(0,'network_error','Sem conexão com o servidor. A operação não foi confirmada. Tente novamente com segurança.');}
  await check(response);return response.json();
}
export async function download(path:string,filename:string){
  const response=await fetch('/api'+path,{credentials:'same-origin',cache:'no-store'});await check(response);
  const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
export const hm=(minutes:number=0,signed=false)=>{
  const sign=minutes<0?'−':signed&&minutes>0?'+':'';const n=Math.abs(Math.trunc(minutes));return `${sign}${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
};
export const brDate=(value:string)=>value?value.slice(0,10).split('-').reverse().join('/'):'—';
export const clock=(ms:number|null,zone='America/Bahia',seconds=false)=>ms===null?'—':new Intl.DateTimeFormat('pt-BR',{timeZone:zone,hour:'2-digit',minute:'2-digit',...(seconds?{second:'2-digit'}:{})}).format(ms);
export const today=(zone='America/Bahia')=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const localInput=(ms:number|null,zone:string)=>{
  if(ms===null)return '';const p=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ms);const v=(s:string)=>p.find(i=>i.type===s)?.value;return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`;
};
export const statusLabels:Record<string,string>={active:'Ativo',blocked:'Bloqueado',terminated:'Desligado',completed:'Encerrado',working:'Em expediente',on_break:'Em intervalo',not_started:'Não iniciado',absent:'Ausência',incomplete:'Incompleto',justified:'Ausência abonada',day_off:'Folga / feriado',off:'Sem expediente',outside_employment:'Fora do vínculo',pending:'Em análise',approved:'Aprovado',rejected:'Recusado',closed:'Fechado',open:'Em conferência'};
export const kindLabels:Record<string,string>={justified_absence:'Falta justificada',medical:'Atestado',day_off:'Folga',unjustified_absence:'Falta sem abono',note:'Observação'};
export const markLabels=['Entrada','Saída para intervalo','Retorno do intervalo','Saída final'];
export const markTypes=['entry','break_start','break_end','exit'];
export const weekdayNames=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
export const errorMessage=(error:unknown)=>{
  if(error instanceof ApiError&&error.fields){const issues=Object.values(error.fields.fieldErrors||{}).flat().filter(Boolean);if(issues.length)return error.message+' '+issues.join(' ');const form=error.fields.formErrors||[];if(form.length)return form.join(' ');}
  return error instanceof Error?error.message:'Não foi possível concluir a operação.';
};
