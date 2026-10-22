import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {jsonRequest,isExpiredCompanySession} from './company-schedules-network';
const moods=[['very_happy','Muito bem'],['good','Bem'],['neutral','Neutro'],['sad','Triste'],['stressed','Estressado']] as const;
type Props={companyId:string;csrf:string;employeeId?:string;onSessionExpired?:()=>void};
type RequestRow={id:string;full_name?:string;work_date:string;message:string;decision:'accepted'|'rejected'|null;response:string|null};
export function WorkspaceRequests({companyId,csrf,employeeId,onSessionExpired}:Props){
 const [rows,setRows]=useState<RequestRow[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [date,setDate]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [selected,setSelected]=useState(''),[answer,setAnswer]=useState(''),[decision,setDecision]=useState('accepted');
 const path=employeeId?'/employee/cpf-work/requests':'/company/workspace/requests';
 const load=useCallback(async(signal?:AbortSignal)=>{
  try{const r=await jsonRequest<{company_id:string;employee_id?:string;requests:RequestRow[]}>(path,{signal});
   if(r.company_id!==companyId||(employeeId&&r.employee_id!==employeeId))throw new Error('A sessão mudou. Entre novamente.');
   if(!signal?.aborted){setRows(r.requests);setError('');}}
  catch(e){if(signal?.aborted)return;if(isExpiredCompanySession(e))onSessionExpired?.();else setError(e instanceof Error?e.message:'Falha ao consultar.');}
 },[path,companyId,employeeId,onSessionExpired]);
 useEffect(()=>{const c=new AbortController();void load(c.signal);return()=>c.abort();},[load]);
 async function save(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');setNotice('');
  try{const r=await jsonRequest<{company_id:string}>(employeeId?path:path+'/'+encodeURIComponent(selected)+'/decision',{
   method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
   body:JSON.stringify(employeeId?{work_date:date,message}:{decision,response:answer})});
   if(r.company_id!==companyId)throw new Error('A sessão mudou.');
   setMessage('');setSelected('');setAnswer('');await load();setNotice(employeeId?'Solicitação enviada.':'Resposta registrada.');
  }catch(e){if(isExpiredCompanySession(e))onSessionExpired?.();else setError(e instanceof Error?e.message:'Confira a lista antes de repetir.');}
  finally{setBusy(false);}}
 return <section className="panel company-schedules-card"><h2>{employeeId?'Enviar justificativa':'Solicitações dos funcionários'}</h2>
  <p>As respostas ficam registradas. Alterações de horários e abonos devem ser lançadas pelo administrador em Ocorrências; esta resposta não altera marcações.</p>
  {employeeId&&<form onSubmit={save}><fieldset disabled={busy}><label>Data da solicitação<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
   <label>Justificativa<textarea required minLength={3} maxLength={2000} value={message} onChange={e=>setMessage(e.target.value)}/></label><button>Enviar solicitação</button></fieldset></form>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <button type="button" disabled={busy} onClick={()=>void load()}>Atualizar solicitações</button>
  {rows.length===0&&<p>Nenhuma solicitação registrada.</p>}
  {rows.map(r=><article className="company-schedules-item" key={r.id}>
   <strong>{r.full_name||'Minha solicitação'} · {r.work_date.split('-').reverse().join('/')}</strong><p style={{whiteSpace:'pre-wrap'}}>{r.message}</p>
   <p>Situação: {r.decision==='accepted'?'Acolhida':r.decision==='rejected'?'Não acolhida':'Aguardando resposta'}</p>
   {r.response&&<p>Resposta: {r.response}</p>}
   {!employeeId&&!r.decision&&<button type="button" onClick={()=>{setSelected(r.id);setAnswer('');}}>Responder solicitação</button>}
   {selected===r.id&&<form onSubmit={save}><fieldset disabled={busy}>
    <label>Decisão<select value={decision} onChange={e=>setDecision(e.target.value)}><option value="accepted">Acolher justificativa</option><option value="rejected">Não acolher justificativa</option></select></label>
    <label>Resposta ao funcionário<textarea required minLength={3} maxLength={1000} value={answer} onChange={e=>setAnswer(e.target.value)}/></label><button>Confirmar resposta</button>
    <button type="button" onClick={()=>setSelected('')}>Cancelar</button></fieldset></form>}
  </article>)}
 </section>;
}
export function WorkspaceMood({companyId,csrf,employeeId,onSessionExpired}:Props){
 const [data,setData]=useState<{mood?:string|null;results?:Array<{mood:string;total:number}>}|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const path=employeeId?'/employee/cpf-work/mood':'/company/workspace/mood';
 const load=useCallback(async(signal?:AbortSignal)=>{
  try{const r=await jsonRequest<{company_id:string;employee_id?:string;mood?:string|null;results?:Array<{mood:string;total:number}>}>(path,{signal});
   if(r.company_id!==companyId||(employeeId&&r.employee_id!==employeeId))throw new Error('A sessão mudou.');
   if(!signal?.aborted){setData(r);setError('');}}
  catch(e){if(signal?.aborted)return;if(isExpiredCompanySession(e))onSessionExpired?.();else setError(e instanceof Error?e.message:'Falha ao consultar.');}
 },[path,companyId,employeeId,onSessionExpired]);
 useEffect(()=>{const c=new AbortController();void load(c.signal);return()=>c.abort();},[load]);
 async function answer(mood:string){if(busy)return;setBusy(true);try{
  await jsonRequest(path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({mood})});await load();
 }catch(e){if(isExpiredCompanySession(e))onSessionExpired?.();else setError(e instanceof Error?e.message:'Confira antes de repetir.');}finally{setBusy(false);}}
 return <section className="panel company-schedules-card"><h2>Humor da Equipe</h2>
  {employeeId&&<button type="button" disabled={busy} onClick={()=>void load()}>Atualizar minha resposta</button>}
  {employeeId?<><p>Como você está hoje? Uma resposta por dia. O gestor recebe apenas resultados agrupados quando há pelo menos três participantes nos últimos sete dias.</p>
   {data?.mood?<p role="status">Sua resposta de hoje foi registrada: {moods.find(m=>m[0]===data.mood)?.[1]}.</p>:
   <div>{moods.map(([key,label])=><button type="button" key={key} disabled={busy||!data} onClick={()=>void answer(key)}>{label}</button>)}</div>}</>:
   <><p>Últimos sete dias · resultados agrupados, sem identificação individual.</p>
    {data?.results?.length?<ul>{data.results.map(r=><li key={r.mood}>{moods.find(m=>m[0]===r.mood)?.[1]}: {r.total}</li>)}</ul>:
    <p>Aguardando pelo menos três participantes para proteger as respostas individuais.</p>}
    <button type="button" onClick={()=>void load()}>Atualizar pesquisa</button></>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
