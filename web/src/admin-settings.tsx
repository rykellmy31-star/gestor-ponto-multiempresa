
import {useState} from 'react';
import {Link} from 'react-router-dom';
import {
  Plus,CalendarClock,Copy,Pencil,ShieldCheck,Building2,
  Settings2,CalendarDays,Trash2,KeyRound,UserPlus,
  LockKeyhole,UnlockKeyhole,Search,ScrollText,History,
  ArrowLeft,Archive,ArchiveRestore
} from 'lucide-react';
import {api,brDate,errorMessage,hm,localInput,weekdayNames} from './api';
import {useData,useSession} from './layout';
import {
  Badge,Button,Empty,ErrorScreen,Field,Initials,InlineError,
  Modal,Notice,PageHeader,Select,Spinner,useSecurity,useToast
} from './ui';
import {ResetLinkModal} from './admin-team';

export function SchedulesPage(){
  const state=useData('/admin/schedules');
  const [edit,setEdit]=useState<any|false>(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [showArchived,setShowArchived]=useState(false);
  const {reauth}=useSecurity();
  const toast=useToast();

  const schedules=(state.data||[]).filter(
    (s:any)=>showArchived?!!s.archived:!s.archived
  );

  const remove=async(s:any)=>{
    if(!window.confirm(
      `Excluir definitivamente a escala "${s.name}"?\n\n`+
      'Somente escalas nunca atribuídas podem ser excluídas. Esta ação não pode ser desfeita.'
    ))return;

    setBusy(s.id);
    try{
      await reauth();
      await api(`/admin/schedules/${s.id}`,'DELETE',{});
      toast('Escala excluída com sucesso.');
      state.reload();
    }catch(e){
      if(errorMessage(e)!=='Operação cancelada.')
        toast(errorMessage(e),'error');
    }finally{
      setBusy(null);
    }
  };

  const toggleArchive=async(s:any)=>{
    const archive=!s.archived;

    if(!window.confirm(
      archive
        ?`Arquivar a escala "${s.name}"?\n\nEla deixará de aparecer nas novas atribuições. O histórico será preservado.`
        :`Restaurar a escala "${s.name}"?\n\nEla voltará a aparecer nas opções de jornada.`
    ))return;

    setBusy(s.id);
    try{
      await reauth();
      const result=await api(
        `/admin/schedules/${s.id}/archive`,
        'PATCH',
        {archived:archive}
      );
      toast(result.message);
      state.reload();
    }catch(e){
      if(errorMessage(e)!=='Operação cancelada.')
        toast(errorMessage(e),'error');
    }finally{
      setBusy(null);
    }
  };

  return <>
    <PageHeader
      eyebrow="JORNADA CONTRATUAL"
      title="Jornadas e escalas"
      description="Edite as jornadas existentes e gerencie escalas arquivadas."
      actions={
        <Button icon={Plus} onClick={()=>setEdit({})}>
          Nova jornada
        </Button>
      }
    />

    <Notice>
      Você pode editar os horários de uma jornada mesmo depois de atribuí-la.
      As alterações passam a valer no dia seguinte, preservando os dias anteriores.
      A exclusão de jornadas já utilizadas permanece restrita.
    </Notice>

    <div className="action-row">
      <Button
        variant="secondary"
        icon={CalendarClock}
        onClick={()=>setShowArchived(false)}
      >
        Escalas ativas
      </Button>
      <Button
        variant="secondary"
        icon={Archive}
        onClick={()=>setShowArchived(true)}
      >
        Arquivadas ({(state.data||[]).filter((s:any)=>s.archived).length})
      </Button>
    </div>

    {state.loading?<Spinner/>:
     state.error?<ErrorScreen error={state.error} retry={state.reload}/>:
     !schedules.length?
       <section className="panel">
         <Empty
           title={showArchived?'Nenhuma escala arquivada':'Nenhuma escala ativa'}
           text={showArchived
             ?'As escalas arquivadas aparecerão aqui.'
             :'Crie uma jornada ou restaure uma escala arquivada.'}
           icon={CalendarClock}
         />
       </section>:
       <div className="schedule-grid">
         {schedules.map((s:any)=>
           <section className="panel schedule-card" key={s.id}>
             <div className="schedule-card-top">
               <div className="schedule-icon">
                 <CalendarClock size={23}/>
               </div>
               <Badge>
                 {s.archived?'Arquivada':'Jornada ativa'}
               </Badge>
             </div>

             <h3>{s.name}</h3>

             <div className="schedule-main-hours">
               {s.config.start}
               <span>→</span>
               {s.config.end}
               {s.overnight&&<small>+1 dia</small>}
             </div>

             <p>
               Intervalo {s.config.break_start} — {s.config.break_end}
               <small>
                 {s.config.paid_break?'Remunerado':'Não remunerado'}
               </small>
             </p>

             <div className="weekday-pills">
               {weekdayNames.map((w,i)=>
                 <span
                   key={w}
                   className={s.config.weekdays.includes(i)?'selected':''}
                 >
                   {w}
                 </span>
               )}
             </div>

             <div className="schedule-load">
               <span><strong>{hm(s.daily)}</strong> h/dia</span>
               <span><strong>{hm(s.weekly)}</strong> h/semana</span>
             </div>

             <div className="action-row">
               {!s.archived&&<>
                 <Button
                   variant="secondary"
                   icon={Pencil}
                   onClick={()=>setEdit({
                     sourceId:s.id,
                     name:s.name,
                     config:s.config
                   })}
                 >
                   Editar escala
                 </Button>

                 <Button
                   variant="secondary"
                   icon={Copy}
                   onClick={()=>setEdit({
                     name:s.name+' · nova versão',
                     config:s.config
                   })}
                 >
                   Criar versão
                 </Button>
               </>}

               <Button
                 variant="secondary"
                 icon={s.archived?ArchiveRestore:Archive}
                 busy={busy===s.id}
                 onClick={()=>toggleArchive(s)}
               >
                 {s.archived?'Restaurar escala':'Arquivar escala'}
               </Button>

               <Button
                 variant="secondary"
                 icon={Trash2}
                 busy={busy===s.id}
                 onClick={()=>remove(s)}
               >
                 Excluir escala
               </Button>
             </div>
           </section>
         )}
       </div>
    }

    {edit!==false&&
      <ScheduleModal
        initial={edit}
        onClose={()=>setEdit(false)}
        onSaved={()=>{
          setEdit(false);
          state.reload();
        }}
      />
    }
  </>;
}

function ScheduleModal({
  initial,onClose,onSaved
}:{
  initial:any;
  onClose:()=>void;
  onSaved:()=>void;
}){
  const {reauth}=useSecurity();
  const toast=useToast();

  const [name,setName]=useState(initial.name||'');
  const [config,setConfig]=useState(initial.config||{
    start:'08:00',
    break_start:'12:00',
    break_end:'13:00',
    end:'17:00',
    weekdays:[1,2,3,4,5],
    paid_break:false
  });
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>(null);

  const set=(key:string,value:any)=>
    setConfig((v:any)=>({...v,[key]:value}));

  const min=(v:string)=>+v.slice(0,2)*60+ +v.slice(3);
  const offset=(v:string)=>
    min(v)<min(config.start)?min(v)+1440:min(v);

  const end=min(config.end)<=min(config.start)
    ?min(config.end)+1440
    :min(config.end);

  const daily=end-min(config.start)-
    (config.paid_break?0:
      offset(config.break_end)-offset(config.break_start));

  return <Modal
    title={initial.sourceId?'Editar jornada':'Nova jornada'}
    description={initial.sourceId
      ?'Atualiza esta jornada sem criar duplicatas. Os funcionários vinculados permanecem, e os novos horários valem a partir de amanhã. Os dias anteriores são preservados.'
      :'Cadastre uma nova jornada. Ela poderá ser atribuída aos funcionários depois de criada.'}
    onClose={onClose}
  >
    <form onSubmit={async e=>{
      e.preventDefault();
      setError(null);
      setBusy(true);

      try{
        if(initial.sourceId){
          await reauth();
          const result=await api(
            `/admin/schedules/${initial.sourceId}`,
            'PATCH',
            {name,config}
          );
          toast(result.message);
        }else{
          await api('/admin/schedules','POST',{name,config});
          toast('Jornada criada. Atribua-a aos funcionários.');
        }
        onSaved();
      }catch(e){
        setError(e);
      }finally{
        setBusy(false);
      }
    }}>
      <Field label="Nome da jornada">
        <input
          value={name}
          onChange={e=>setName(e.target.value)}
          minLength={2}
          maxLength={100}
          required
        />
      </Field>

      <div className="form-grid">
        {(['start','break_start','break_end','end'] as const).map((key,i)=>
          <Field
            key={key}
            label={[
              'Entrada prevista',
              'Saída para intervalo',
              'Retorno do intervalo',
              'Saída prevista'
            ][i]}
          >
            <input
              type="time"
              value={config[key]}
              onChange={e=>set(key,e.target.value)}
              required
            />
          </Field>
        )}
      </div>

      <Field label="Dias de trabalho">
        <div className="weekday-checkboxes">
          {weekdayNames.map((w,i)=>
            <label
              key={w}
              className={config.weekdays.includes(i)?'selected':''}
            >
              <input
                type="checkbox"
                checked={config.weekdays.includes(i)}
                onChange={e=>set(
                  'weekdays',
                  e.target.checked
                    ?[...config.weekdays,i].sort()
                    :config.weekdays.filter((d:number)=>d!==i)
                )}
              />
              {w}
            </label>
          )}
        </div>
      </Field>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={config.paid_break}
          onChange={e=>set('paid_break',e.target.checked)}
        />
        Intervalo remunerado
      </label>

      <div className="schedule-preview">
        <strong>
          Carga calculada: {daily>0?hm(daily):'—'} h/dia
        </strong>
        <span>
          {daily>0?hm(daily*config.weekdays.length):'—'} h/semana
        </span>
      </div>

      <p className="form-footnote">
        Se a saída for menor que a entrada, ela ocorre no dia
        seguinte. O turno deve ter menos de 24 horas.
      </p>

      <InlineError error={error}/>

      <div className="modal-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
        >
          Cancelar
        </Button>
        <Button busy={busy}>
          {initial.sourceId
            ?'Salvar alterações'
            :'Criar jornada'}
        </Button>
      </div>
    </form>
  </Modal>;
}

export function SettingsPage(){
  const state=useData('/admin/settings');

  return <>
    <PageHeader
      eyebrow="REGRAS DA EMPRESA"
      title="Configurações"
      description="Identificação, cálculos e calendário com histórico de alterações."
    />
    {state.loading?<Spinner/>:
     state.error?<ErrorScreen error={state.error} retry={state.reload}/>:
     state.data&&
       <SettingsContent
         data={state.data}
         reload={state.reload}
       />
    }
  </>;
}

function SettingsContent({
  data,reload
}:{
  data:any;
  reload:()=>void;
}){
  const {config:publicConfig}=useSession();
  const {reauth}=useSecurity();
  const toast=useToast();

  const [company,setCompany]=useState({
    company_name:data.company.company_name,
    company_document:data.company.company_document,
    timezone:data.company.timezone
  });
  const [rules,setRules]=useState({...data.rules});
  const [effective,setEffective]=useState(()=>{
    const d=new Date(publicConfig.server_now);
    d.setUTCDate(d.getUTCDate()+1);
    return localInput(d.getTime(),data.company.timezone).slice(0,10);
  });
  const [busy,setBusy]=useState('');
  const [error,setError]=useState<unknown>(null);
  const [holiday,setHoliday]=useState(false);
  const [versions,setVersions]=useState(false);
  const [reset,setReset]=useState<any>(null);

  const recovery=useData('/admin/recovery-requests');

  const updateRule=(key:string,value:any)=>
    setRules((v:any)=>({...v,[key]:value}));

  const save=async(type:string,payload:any)=>{
    setBusy(type);
    setError(null);

    try{
      await reauth();
      const result=await api(
        type==='company'?'/admin/settings':'/admin/rules',
        type==='company'?'PUT':'POST',
        payload
      );
      toast(result.message);
      if(type==='company')
        window.dispatchEvent(new Event('jornada:config-updated'));
      reload();
    }catch(e){
      if(errorMessage(e)!=='Operação cancelada.')
        setError(e);
    }finally{
      setBusy('');
    }
  };

  return <>
    <div className="settings-grid">
      <section className="panel settings-panel">
        <div className="panel-header">
          <div>
            <h3>Identificação da empresa</h3>
            <p>Usada no cabeçalho das folhas de ponto.</p>
          </div>
          <Building2 size={21}/>
        </div>

        <form onSubmit={e=>{
          e.preventDefault();
          save('company',company);
        }}>
          <Field label="Nome da empresa">
            <input
              value={company.company_name}
              onChange={e=>setCompany(v=>({
                ...v,company_name:e.target.value
              }))}
              minLength={2}
              maxLength={140}
              required
            />
          </Field>

          <Field label="CNPJ / identificação fiscal (opcional)">
            <input
              value={company.company_document}
              onChange={e=>setCompany(v=>({
                ...v,company_document:e.target.value
              }))}
              maxLength={30}
            />
          </Field>

          <Field label="Fuso horário oficial">
            <Select
              value={company.timezone}
              onChange={e=>setCompany(v=>({
                ...v,timezone:e.target.value
              }))}
            >
              <option value="America/Bahia">America/Bahia</option>
              <option value="America/Sao_Paulo">America/Sao_Paulo</option>
            </Select>
          </Field>

          <p className="form-footnote">
            Marcações são armazenadas em UTC. Dias já iniciados
            mantêm o fuso original; folhas fechadas preservam
            sua identificação.
          </p>

          <Button busy={busy==='company'} icon={ShieldCheck}>
            Salvar empresa
          </Button>
        </form>
      </section>

      <section className="panel settings-panel">
        <div className="panel-header">
          <div>
            <h3>Segurança e infraestrutura</h3>
            <p>Configurações que não são alteradas pelo navegador.</p>
          </div>
          <ShieldCheck size={21}/>
        </div>

        <div className="security-list">
          <div>
            <span>Persistência</span>
            <strong>
              Cloudflare D1
              {data.environment!=='production'?' · local':''}
            </strong>
          </div>
          <div>
            <span>Senhas</span>
            <strong>scrypt + salt + pepper</strong>
          </div>
          <div>
            <span>Sessões</span>
            <strong>HttpOnly · perfis separados</strong>
          </div>
          <div>
            <span>Recuperação por e-mail</span>
            <Badge status={
              data.email_recovery_enabled?'active':'neutral'
            }>
              {data.email_recovery_enabled
                ?'Configurada'
                :'Fluxo assistido pelo RH'}
            </Badge>
          </div>
          <div>
            <span>Auditoria</span>
            <strong>Histórico imutável</strong>
          </div>
        </div>

        <Notice type="warning">
          Este aplicativo gerencial não inclui registro REP-P,
          arquivos AFD/AEJ ou comprovantes assinados com
          certificado ICP-Brasil.
        </Notice>

        <p className="form-footnote">
          Secrets, domínio, publicação, backup e recuperação
          do D1 estão documentados nos arquivos de implantação.
          Não compartilhe chaves nesta interface.
        </p>

        <Link className="text-link" to="/admin/ajuda">
          Consultar guia de operação
        </Link>
      </section>
    </div>

    <section className="panel rules-panel">
      <div className="panel-header">
        <div>
          <h3>Regras de apuração</h3>
          <p>
            Novas regras criam uma versão, sem reescrever
            dias já iniciados.
          </p>
        </div>
        <Button
          variant="secondary"
          icon={History}
          onClick={()=>setVersions(true)}
        >
          Ver versões
        </Button>
      </div>

      <form onSubmit={e=>{
        e.preventDefault();
        save('rules',{
          effective_from:effective,
          config:rules
        });
      }}>
        <div className="form-grid four">
          <Field label="Tolerância por marcação (min)">
            <input
              type="number"
              value={rules.mark_tolerance}
              onChange={e=>updateRule(
                'mark_tolerance',+e.target.value
              )}
              min={0}
              max={30}
              required
            />
          </Field>

          <Field label="Tolerância diária (min)">
            <input
              type="number"
              value={rules.daily_tolerance}
              onChange={e=>updateRule(
                'daily_tolerance',+e.target.value
              )}
              min={0}
              max={60}
              required
            />
          </Field>

          <Field label="Passo de arredondamento">
            <Select
              value={rules.rounding_step}
              onChange={e=>updateRule(
                'rounding_step',+e.target.value
              )}
            >
              {[1,5,10,15].map(n=>
                <option value={n} key={n}>
                  {n} minuto{n>1?'s':''}
                </option>
              )}
            </Select>
          </Field>

          <Field label="Método de arredondamento">
            <Select
              value={rules.rounding_mode}
              onChange={e=>updateRule(
                'rounding_mode',e.target.value
              )}
            >
              <option value="floor">Para baixo</option>
              <option value="nearest">Mais próximo</option>
              <option value="ceil">Para cima</option>
            </Select>
          </Field>

          <Field label="Tratamento do saldo">
            <Select
              value={rules.compensation}
              onChange={e=>updateRule(
                'compensation',e.target.value
              )}
            >
              <option value="review">
                Saldo para conferência
              </option>
              <option value="bank">
                Banco aprovado (saldo do período)
              </option>
            </Select>
          </Field>

          <Field label="Limite de turno ativo (h)">
            <input
              type="number"
              min={12}
              max={36}
              value={rules.max_shift_hours}
              onChange={e=>updateRule(
                'max_shift_hours',+e.target.value
              )}
              required
            />
          </Field>

          <Field label="Vigência a partir de">
            <input
              type="date"
              min={localInput(
                publicConfig.server_now,
                data.company.timezone
              ).slice(0,10)}
              value={effective}
              onChange={e=>setEffective(e.target.value)}
              required
            />
          </Field>
        </div>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={rules.auto_approve_overtime}
            onChange={e=>updateRule(
              'auto_approve_overtime',e.target.checked
            )}
          />
          Aprovar automaticamente as horas positivas
          (somente se a política da empresa autorizar)
        </label>

        {rules.auto_approve_overtime&&
          <Notice type="warning">
            Esta configuração dispensa a revisão individual
            das horas positivas em novos dias de trabalho.
            Valide a política e os instrumentos coletivos
            antes de ativar.
          </Notice>
        }

        <p className="form-footnote">
          A tolerância diária elimina apenas diferenças pequenas
          em expedientes completos quando entrada e saída também
          estão dentro da tolerância por marcação. O arredondamento
          é aplicado ao total de tempo trabalhado, nunca ao registro
          original. Os dois modos de saldo utilizam somente horas
          positivas aprovadas; “banco” indica a destinação
          administrativa, não executa pagamento de folha nem
          transporte automático entre meses.
        </p>

        <Button busy={busy==='rules'} icon={Settings2}>
          Criar versão das regras
        </Button>
      </form>
    </section>

    <InlineError error={error}/>

    <div className="settings-grid">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Feriados e calendário</h3>
            <p>Sem jornada prevista nas datas cadastradas.</p>
          </div>
          <Button
            variant="secondary"
            icon={Plus}
            onClick={()=>setHoliday(true)}
          >
            Adicionar
          </Button>
        </div>

        {!data.holidays.length?
          <Empty
            title="Nenhum feriado configurado"
            text="Feriados não são importados automaticamente. Cadastre os aplicáveis à empresa."
            icon={CalendarDays}
          />:
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Feriado</th>
                  <th/>
                </tr>
              </thead>
              <tbody>
                {data.holidays.map((h:any)=>
                  <tr key={h.id}>
                    <td>{brDate(h.date)}</td>
                    <td>{h.name}</td>
                    <td>
                      <button
                        className="icon-btn danger-text"
                        aria-label={`Remover feriado ${h.name}`}
                        disabled={busy===h.id}
                        onClick={async()=>{
                          if(!window.confirm(
                            `Remover ${h.name} (${brDate(h.date)})? Períodos fechados devem ser reabertos antes.`
                          ))return;
                          setBusy(h.id);
                          try{
                            await reauth();
                            await api(
                              `/admin/holidays/${h.id}`,
                              'DELETE',
                              {}
                            );
                            toast('Feriado removido com auditoria.');
                            reload();
                          }catch(e){
                            if(errorMessage(e)!=='Operação cancelada.')
                              toast(errorMessage(e),'error');
                          }finally{
                            setBusy('');
                          }
                        }}
                      >
                        <Trash2 size={17}/>
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        }
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Solicitações de recuperação</h3>
            <p>Valide a identidade antes de emitir um link.</p>
          </div>
          <KeyRound size={21}/>
        </div>

        {recovery.loading?<Spinner/>:
         recovery.error?<InlineError error={recovery.error}/>:
         !recovery.data?.length?
           <Empty
             title="Nenhum pedido pendente"
             text="Solicitações feitas em 'Esqueceu a senha?' aparecerão aqui."
             icon={KeyRound}
           />:
           <div className="compact-list padded-list">
             {recovery.data.map((r:any)=>
               <div key={r.id}>
                 <span>
                   <strong>{r.display_name}</strong>
                   <small>@{r.login} · {r.role==='admin'?'Administrador':'Funcionário'}</small>
                 </span>
                 <Button
                   variant="secondary"
                   busy={busy===r.id}
                   onClick={async()=>{
                     setBusy(r.id);
                     try{
                       await reauth();
                       setReset(await api(
                         `/admin/users/${r.user_id}/reset`,
                         'POST',
                         {}
                       ));
                     }catch(e){
                       if(errorMessage(e)!=='Operação cancelada.')
                         toast(errorMessage(e),'error');
                     }finally{
                       setBusy('');
                     }
                   }}
                 >
                   Emitir link
                 </Button>
               </div>
             )}
           </div>
        }
      </section>
    </div>

    {holiday&&
      <HolidayModal
        onClose={()=>setHoliday(false)}
        onSaved={()=>{
          setHoliday(false);
          reload();
        }}
      />
    }

    {versions&&
      <Modal
        wide
        title="Versões das regras de apuração"
        onClose={()=>setVersions(false)}
      >
        <div className="compact-list">
          {data.rule_versions.map((r:any)=>{
            const cfg=JSON.parse(r.config_json);
            return <div key={r.id}>
              <span>
                <strong>Desde {brDate(r.effective_from)}</strong>
                <small>
                  Tolerâncias {cfg.mark_tolerance} min /
                  {cfg.daily_tolerance} min · Arredondamento
                  {cfg.rounding_step} min ({cfg.rounding_mode})
                </small>
                <small>
                  {cfg.auto_approve_overtime
                    ?'Horas positivas automáticas'
                    :'Horas positivas exigem revisão'}
                  {' · '}
                  {cfg.compensation==='bank'
                    ?'Banco de horas'
                    :'Conferência'}
                </small>
              </span>
            </div>;
          })}
        </div>
      </Modal>
    }

    {reset&&
      <ResetLinkModal
        result={reset}
        onClose={()=>setReset(null)}
      />
    }
  </>;
}

function HolidayModal({
  onClose,onSaved
}:{
  onClose:()=>void;
  onSaved:()=>void;
}){
  const {reauth}=useSecurity();
  const toast=useToast();
  const [date,setDate]=useState('');
  const [name,setName]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>(null);

  return <Modal title="Cadastrar feriado" onClose={onClose}>
    <form onSubmit={async e=>{
      e.preventDefault();
      setBusy(true);
      setError(null);
      try{
        await reauth();
        await api('/admin/holidays','POST',{date,name});
        toast('Feriado cadastrado.');
        onSaved();
      }catch(e){
        if(errorMessage(e)!=='Operação cancelada.')
          setError(e);
      }finally{
        setBusy(false);
      }
    }}>
      <Field label="Data">
        <input
          type="date"
          value={date}
          onChange={e=>setDate(e.target.value)}
          required
        />
      </Field>
      <Field label="Nome do feriado">
        <input
          value={name}
          onChange={e=>setName(e.target.value)}
          minLength={2}
          maxLength={120}
          required
        />
      </Field>
      <Notice>
        A data não se repete automaticamente nos anos seguintes.
        Nenhum mês fechado poderá ser modificado sem reabertura.
      </Notice>
      <InlineError error={error}/>
      <div className="modal-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
        >
          Cancelar
        </Button>
        <Button busy={busy}>Cadastrar feriado</Button>
      </div>
    </form>
  </Modal>;
}

export function AdminUsersPage(){
  const {session}=useSession();
  const state=useData('/admin/users');
  const {reauth}=useSecurity();
  const toast=useToast();
  const [create,setCreate]=useState(false);
  const [reset,setReset]=useState<any>(null);
  const [busy,setBusy]=useState('');

  return <>
    <PageHeader
      eyebrow="ACESSO PRIVILEGIADO"
      title="Administradores"
      description="Somente pessoas autorizadas podem gerenciar a empresa."
      actions={
        <Button
          icon={UserPlus}
          onClick={()=>setCreate(true)}
        >
          Autorizar administrador
        </Button>
      }
    />

    <Notice type="warning">
      Contas administrativas são separadas dos funcionários.
      Não há cadastro público nem promoção automática.
      Todas as alterações exigem confirmação de senha
      e são auditadas.
    </Notice>

    <section className="panel">
      {state.loading?<Spinner/>:
       state.error?<ErrorScreen error={state.error} retry={state.reload}/>:
       <div className="table-scroll">
         <table className="data-table">
           <thead>
             <tr>
               <th>Administrador</th>
               <th>Usuário / e-mail</th>
               <th>Situação</th>
               <th>Ações</th>
             </tr>
           </thead>
           <tbody>
             {state.data?.map((u:any)=>
               <tr key={u.id}>
                 <td>
                   <div className="person-cell">
                     <Initials name={u.display_name}/>
                     <div>
                       <strong>{u.display_name}</strong>
                       {u.id===session.user.id&&
                         <small>Sua conta</small>
                       }
                     </div>
                   </div>
                 </td>
                 <td>
                   @{u.login}
                   <small className="block">
                     {u.email||'Sem e-mail'}
                   </small>
                 </td>
                 <td>
                   <Badge status={u.active?'active':'blocked'}/>
                 </td>
                 <td>
                   <div className="action-row">
                     {u.active===1&&
                       <Button
                         variant="secondary"
                         icon={KeyRound}
                         busy={busy===u.id+'reset'}
                         onClick={async()=>{
                           setBusy(u.id+'reset');
                           try{
                             await reauth();
                             setReset(await api(
                               `/admin/users/${u.id}/reset`,
                               'POST',
                               {}
                             ));
                           }catch(e){
                             if(errorMessage(e)!=='Operação cancelada.')
                               toast(errorMessage(e),'error');
                           }finally{
                             setBusy('');
                           }
                         }}
                       >
                         Redefinir senha
                       </Button>
                     }

                     {u.id!==session.user.id&&
                       <Button
                         variant={u.active?'danger-light':'secondary'}
                         icon={u.active?LockKeyhole:UnlockKeyhole}
                         busy={busy===u.id}
                         onClick={async()=>{
                           setBusy(u.id);
                           try{
                             await reauth();
                             const result=await api(
                               `/admin/users/${u.id}`,
                               'PATCH',
                               {active:!u.active}
                             );
                             toast(result.message);
                             state.reload();
                           }catch(e){
                             if(errorMessage(e)!=='Operação cancelada.')
                               toast(errorMessage(e),'error');
                           }finally{
                             setBusy('');
                           }
                         }}
                       >
                         {u.active?'Bloquear':'Reativar'}
                       </Button>
                     }
                   </div>
                 </td>
               </tr>
             )}
           </tbody>
         </table>
       </div>
      }
    </section>

    {create&&
      <AdminUserModal
        onClose={()=>setCreate(false)}
        onSaved={()=>{
          setCreate(false);
          state.reload();
        }}
      />
    }

    {reset&&
      <ResetLinkModal
        result={reset}
        onClose={()=>setReset(null)}
      />
    }
  </>;
}

function AdminUserModal({
  onClose,onSaved
}:{
  onClose:()=>void;
  onSaved:()=>void;
}){
  const [form,setForm]=useState({
    name:'',
    login:'',
    email:'',
    initial_password:''
  });
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>(null);
  const {reauth}=useSecurity();
  const toast=useToast();

  const set=(key:string,value:string)=>
    setForm(v=>({...v,[key]:value}));

  return <Modal
    title="Autorizar novo administrador"
    description="Esta conta terá acesso aos dados de toda a empresa. Autorize com responsabilidade."
    onClose={onClose}
  >
    <form onSubmit={async e=>{
      e.preventDefault();
      setBusy(true);
      setError(null);
      try{
        await reauth();
        const result=await api('/admin/users','POST',form);
        toast(result.message);
        onSaved();
      }catch(e){
        if(errorMessage(e)!=='Operação cancelada.')
          setError(e);
      }finally{
        setBusy(false);
      }
    }}>
      <Field label="Nome completo">
        <input
          value={form.name}
          onChange={e=>set('name',e.target.value)}
          minLength={3}
          maxLength={140}
          required
        />
      </Field>

      <Field label="Usuário exclusivo">
        <input
          value={form.login}
          onChange={e=>set('login',e.target.value)}
          minLength={3}
          maxLength={120}
          required
          autoComplete="off"
        />
      </Field>

      <Field label="E-mail (opcional)">
        <input
          type="email"
          value={form.email}
          onChange={e=>set('email',e.target.value)}
          maxLength={200}
        />
      </Field>

      <Field label="Senha inicial">
        <input
          type="password"
          autoComplete="new-password"
          value={form.initial_password}
          onChange={e=>set('initial_password',e.target.value)}
          minLength={12}
          maxLength={128}
          required
        />
      </Field>

      <InlineError error={error}/>

      <div className="modal-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
        >
          Cancelar
        </Button>
        <Button busy={busy} icon={ShieldCheck}>
          Autorizar administrador
        </Button>
      </div>
    </form>
  </Modal>;
}

export function AuditPage(){
  const {config}=useSession();
  const [before,setBefore]=useState('');
  const [search,setSearch]=useState('');
  const state=useData(
    `/admin/audit${before?'?before='+before:''}`
  );

  const rows=state.data?.filter((a:any)=>
    `${a.action} ${a.actor_name||'Sistema'} ${a.entity_id||''}`
      .toLowerCase()
      .includes(search.toLowerCase())
  )||[];

  return <>
    <PageHeader
      eyebrow="INTEGRIDADE E RASTREABILIDADE"
      title="Histórico de auditoria"
      description="Ações privilegiadas e eventos de autenticação, sem senhas ou tokens nos registros."
      actions={before&&
        <Button
          variant="secondary"
          icon={ArrowLeft}
          onClick={()=>setBefore('')}
        >
          Mais recentes
        </Button>
      }
    />

    <div className="filter-bar">
      <div className="search-input">
        <Search size={17}/>
        <input
          value={search}
          onChange={e=>setSearch(e.target.value)}
          placeholder="Filtrar ação, responsável ou identificador…"
          aria-label="Filtrar auditoria"
        />
      </div>
      <span className="filter-hint">
        <ShieldCheck size={15}/>
        Histórico somente de leitura · até 200 eventos por página
      </span>
    </div>

    <section className="panel">
      {state.loading?<Spinner/>:
       state.error?<ErrorScreen error={state.error} retry={state.reload}/>:
       !rows.length?
         <Empty
           title="Nenhum evento encontrado"
           text="Revise a busca. Ações administrativas são registradas automaticamente."
           icon={ScrollText}
         />:
         <div className="table-scroll">
           <table className="data-table audit-table">
             <thead>
               <tr>
                 <th>Data / hora</th>
                 <th>Responsável</th>
                 <th>Ação</th>
                 <th>Registro</th>
                 <th>Detalhes</th>
               </tr>
             </thead>
             <tbody>
               {rows.map((a:any)=>
                 <tr key={a.id}>
                   <td className="nowrap">
                     {new Date(a.created_at).toLocaleString(
                       'pt-BR',
                       {timeZone:config.timezone}
                     )}
                   </td>
                   <td>{a.actor_name||'Sistema / não autenticado'}</td>
                   <td><code>{a.action}</code></td>
                   <td>
                     <small>{a.entity_type}</small>
                     <small className="block audit-id">
                       {a.entity_id||'—'}
                     </small>
                   </td>
                   <td>
                     <details>
                       <summary>Consultar</summary>
                       <pre>
                         {JSON.stringify(
                           JSON.parse(a.details_json),
                           null,
                           2
                         )}
                       </pre>
                     </details>
                   </td>
                 </tr>
               )}
             </tbody>
           </table>
         </div>
      }

      {state.data?.length===200&&
        <div className="panel-footer">
          <Button
            variant="secondary"
            onClick={()=>setBefore(
              String(state.data.at(-1).created_at)+
              '&before_id='+
              state.data.at(-1).id
            )}
          >
            Registros anteriores
          </Button>
        </div>
      }
    </section>
  </>;
}
