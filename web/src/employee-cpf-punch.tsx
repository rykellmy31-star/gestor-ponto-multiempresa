import { useCallback, useRef, useState } from 'react';
import { Clock3, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import './employee-cpf-punch.css';

type PunchType = 'entry'|'break_start'|'break_end'|'exit';
type Today = {
  company_id:string; employee_id:string; work_date:string;
  next_seq:number; next_type:PunchType|null; completed:boolean;
  server_now:number;
};
const descriptions:Record<PunchType,string> = {
  entry:'Registrar entrada',
  break_start:'Iniciar intervalo',
  break_end:'Terminar intervalo',
  exit:'Registrar saída'
};

export function EmployeeCpfPunch({
  companyId, csrfToken, onConfirmed
}: {
  companyId:string;
  csrfToken:string;
  onConfirmed?:()=>void;
}) {
  const [today,setToday]=useState<Today|null>(null);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [disabled,setDisabled]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  // Enquanto a confirmacao nao vier, reutiliza a MESMA chave no retry.
  const pendingKey=useRef<{type:PunchType;key:string}|null>(null);

  const load=useCallback(async()=>{
    setLoading(true);setError('');setNotice('');
    try{
      const response=await fetch('/api/employee/cpf-work/today',{
        credentials:'same-origin',cache:'no-store'
      });
      if(response.status===503){
        setToday(null);setDisabled(true);return;
      }
      if(!response.ok){
        throw new Error(response.status===401
          ? 'Sua sessão expirou. Entre novamente.'
          : 'Não foi possível consultar o próximo horário. Atualize a tela.');
      }
      const data=await response.json() as Today;
      if(data.company_id!==companyId){
        throw new Error('A empresa da sessão mudou. Entre novamente.');
      }
      setToday(data);setDisabled(false);
    }catch(e){
      setToday(null);
      setError(e instanceof Error?e.message:'Falha ao consultar.');
    }finally{setLoading(false);}
  },[companyId]);

  // Renderiza o modulo mesmo que ainda esteja desligado. A requisicao
  // so acontece depois da autenticacao confirmada do funcionario.
  useState(()=>{void load();});

  async function punch(){
    const type=today?.next_type;
    if(!type||busy||disabled)return;
    if(pendingKey.current?.type!==type) {
      pendingKey.current={type,key:crypto.randomUUID()};
    }
    const key=pendingKey.current.key;
    setBusy(true);setError('');setNotice('');
    try{
      const response=await fetch('/api/employee/cpf-work/punch',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{
          'Content-Type':'application/json','X-CSRF-Token':csrfToken
        },
        body:JSON.stringify({type,idempotency_key:key})
      });
      const data=await response.json().catch(()=>null) as
        {success?:boolean;replayed?:boolean;error?:{message?:string}}|null;
      if(!response.ok||!data?.success){
        throw new Error(data?.error?.message||
          'Não foi possível confirmar o ponto. Confira e tente novamente.');
      }
      pendingKey.current=null;
      setNotice(data.replayed
        ? 'Registro anteriormente confirmado. Nenhuma marcação duplicada.'
        : 'Ponto registrado com sucesso.');
      onConfirmed?.();
      await load();
      setNotice(data.replayed
        ? 'Registro anteriormente confirmado. Nenhuma marcação duplicada.'
        : 'Ponto registrado com sucesso.');
    }catch(e){
      // Nao trocar a chave: se houve falha de rede apos a gravacao,
      // a proxima tentativa deve obter a confirmacao anterior.
      setError(e instanceof Error?e.message:'Erro ao confirmar.');
    }finally{setBusy(false);}
  }
  return <section className="cpf-punch-panel" aria-label="Registro de ponto">
    <header><Clock3 size={21}/><h3>Meu ponto de hoje</h3></header>
    <p>Os horários são registrados pelo servidor e vinculados à empresa da sua sessão.</p>
    {disabled ? <div className="cpf-punch-warning">
      <ShieldCheck size={19}/>
      Marcação ainda em homologação. Nenhuma batida real está habilitada.
    </div> : null}
    {!today&&!loading&&!disabled&&!error &&
      <p className="cpf-punch-muted">Consulte o próximo registro para começar.</p>}
    {today&&<div className="cpf-punch-info">
      <strong>{today.work_date.split('-').reverse().join('/')}</strong>
      <span>{today.completed ? 'Jornada do dia finalizada' :
        'Próximo registro: '+descriptions[today.next_type as PunchType]}</span>
    </div>}
    {loading&&<p role="status" className="cpf-punch-muted">Consultando registro…</p>}
    {error&&<p role="alert" className="cpf-punch-error">{error}</p>}
    {notice&&<p role="status" className="cpf-punch-success">
      <CheckCircle2 size={16}/>{notice}</p>}
    <div className="cpf-punch-actions">
      <button type="button" onClick={()=>void load()} disabled={loading||busy}>
        <RefreshCw size={16}/> Atualizar
      </button>
      <button type="button" className="cpf-punch-confirm"
        onClick={()=>void punch()}
        disabled={!today?.next_type||busy||loading||disabled}>
        <Clock3 size={16}/>{busy?'Confirmando…':
          today?.next_type ? descriptions[today.next_type] : 'Aguardando liberação'}
      </button>
    </div>
    <small>Se sua confirmação apresentar erro de rede, tente novamente sem mudar o tipo de registro. Não registre pontos de terceiros.</small>
  </section>;
}
