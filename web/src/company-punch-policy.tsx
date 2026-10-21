import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Rules } from '../../server/types';
import { isExpiredCompanySession, jsonRequest } from './company-schedules-network';

type Policy={company_id:string;enabled:boolean;rules:Rules;revision:number};
export function CompanyPunchPolicy({companyId,csrf,onSessionExpired}:{
  companyId:string;csrf:string;onSessionExpired:()=>void
}) {
  const id=useId(),active=useRef(true);
  const [policy,setPolicy]=useState<Policy|null>(null);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError('');setNotice('');
    try {
      const data=await jsonRequest<Policy>('/company/punch-policy',{signal});
      if(signal?.aborted||!active.current)return;
      if(data.company_id!==companyId)throw new Error('A sessão empresarial mudou. Entre novamente.');
      setPolicy(data);
    } catch(err){
      if(signal?.aborted||!active.current)return;
      setPolicy(null);
      if(isExpiredCompanySession(err))onSessionExpired();
      else setError(err instanceof Error?err.message:'Falha ao consultar regras.');
    } finally {if(!signal?.aborted&&active.current)setLoading(false);}
  },[companyId,onSessionExpired]);
  useEffect(()=>{
    active.current=true;const controller=new AbortController();void load(controller.signal);
    return ()=>{active.current=false;controller.abort();};
  },[load]);
  function change<K extends keyof Rules>(key:K,value:Rules[K]) {
    setNotice('');setPolicy(p=>p?{...p,rules:{...p.rules,[key]:value}}:p);
  }
  async function save(event:FormEvent) {
    event.preventDefault();if(!policy||busy)return;
    setBusy(true);setError('');setNotice('');
    try {
      const result=await jsonRequest<{company_id:string;revision:number}>('/company/punch-policy',{
        method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
        body:JSON.stringify({enabled:policy.enabled,rules:policy.rules,expected_revision:policy.revision})
      });
      if(!active.current)return;
      if(result.company_id!==companyId||result.revision!==policy.revision+1)
        throw new Error('Resposta não confirmada. Recarregue as regras antes de salvar novamente.');
      setPolicy({...policy,revision:result.revision});
      setNotice('Regras salvas. Os registros e as regras dos dias já iniciados foram preservados.');
    }catch(err){
      if(!active.current)return;
      // A lost response may have committed. Require a fresh read before any retry.
      setPolicy(null);
      if(isExpiredCompanySession(err))onSessionExpired();
      else setError(err instanceof Error?err.message:'Não foi possível confirmar. Recarregue as regras.');
    }finally{if(active.current)setBusy(false);}
  }
  return <section className="company-schedules-card">
    <h2>Regras de ponto da empresa</h2>
    <p>Alterações valem para os próximos dias iniciados. Horários e regras dos dias já iniciados são preservados.</p>
    <button type="button" className="company-schedules-secondary" disabled={busy||loading}
      onClick={()=>void load()}>Recarregar regras</button>
    {loading&&<p role="status">Consultando regras…</p>}
    {error&&<p role="alert" className="company-schedules-error">{error}</p>}
    {notice&&<p role="status" className="company-schedules-notice">{notice}</p>}
    {policy&&!loading&&<form onSubmit={event=>void save(event)}>
      <fieldset disabled={busy}>
        <legend>Configuração da empresa</legend>
        <label><input type="checkbox" checked={policy.enabled}
          onChange={e=>{setNotice('');setPolicy({...policy,enabled:e.target.checked});}}/> Permitir registro de ponto</label>
        <p>Desativar bloqueia novas marcações, inclusive em jornadas em andamento, sem apagar o histórico.</p>
        {([['mark_tolerance','Tolerância por marcação (minutos)',0,30],
          ['daily_tolerance','Tolerância diária (minutos)',0,60],
          ['max_shift_hours','Duração máxima da jornada (horas)',12,24]] as const).map(([key,label,min,max])=>
          <div key={key}><label htmlFor={id+'-'+key}>{label}</label>{' '}
            <input id={id+'-'+key} type="number" required min={min} max={max} step={1}
              value={policy.rules[key]} onChange={e=>change(key,Number(e.target.value))}/></div>)}
        <div><label htmlFor={id+'-step'}>Intervalo de arredondamento (minutos)</label>{' '}
          <select id={id+'-step'} value={policy.rules.rounding_step} onChange={e=>change('rounding_step',Number(e.target.value))}>
            {[1,5,10,15].map(n=><option key={n} value={n}>{n}</option>)}</select></div>
        <div><label htmlFor={id+'-rounding'}>Arredondamento</label>{' '}
          <select id={id+'-rounding'} value={policy.rules.rounding_mode}
            onChange={e=>change('rounding_mode',e.target.value as Rules['rounding_mode'])}>
            <option value="floor">Para baixo</option><option value="nearest">Mais próximo</option><option value="ceil">Para cima</option></select></div>
        <div><label htmlFor={id+'-compensation'}>Tratamento do saldo</label>{' '}
          <select id={id+'-compensation'} value={policy.rules.compensation}
            onChange={e=>change('compensation',e.target.value as Rules['compensation'])}>
            <option value="review">Conferência</option><option value="bank">Banco de horas</option></select></div>
        <label><input type="checkbox" checked={policy.rules.auto_approve_overtime}
          onChange={e=>change('auto_approve_overtime',e.target.checked)}/> Aprovar horas extras automaticamente</label>
        <div><button className="company-schedules-secondary" disabled={busy}>{busy?'Salvando…':'Salvar regras de ponto'}</button></div>
      </fieldset>
    </form>}
  </section>;
}
