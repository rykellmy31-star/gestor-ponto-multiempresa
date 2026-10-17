import React,{createContext,useContext,useEffect,useRef,useState,useId,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {X,CheckCircle2,AlertCircle,Loader2,LockKeyhole,Inbox,ChevronDown,type LucideIcon} from 'lucide-react';
import {api,errorMessage,statusLabels,type Realm} from './api';
type ToastFn=(message:string,type?:'success'|'error'|'info')=>void;
const ToastContext=createContext<ToastFn>(()=>{});
export function ToastProvider({children}:{children:ReactNode}){
  const [items,setItems]=useState<{id:number;text:string;type:string}[]>([]);
  const notify:ToastFn=(text,type='success')=>{const id=Date.now()+Math.random();setItems(v=>[...v,{id,text,type}]);setTimeout(()=>setItems(v=>v.filter(t=>t.id!==id)),6500);};
  return <ToastContext.Provider value={notify}>{children}<div className="toast-stack" aria-live="polite">{items.map(t=><div key={t.id} className={'toast '+t.type} role={t.type==='error'?'alert':'status'}>{t.type==='error'?<AlertCircle size={19}/>:<CheckCircle2 size={19}/>}<span>{t.text}</span><button className="icon-btn" onClick={()=>setItems(v=>v.filter(a=>a.id!==t.id))} aria-label="Fechar mensagem"><X size={16}/></button></div>)}</div></ToastContext.Provider>;
}
export const useToast=()=>useContext(ToastContext);
export function Spinner({label='Carregando…'}:{label?:string}){return <div className="loading" role="status"><Loader2 size={25} className="spin"/><span>{label}</span></div>;}
export function Button({children,icon:Icon,busy=false,variant='primary',className='',...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{icon?:LucideIcon;busy?:boolean;variant?:string}){
  return <button {...props} disabled={busy||props.disabled} className={`btn btn-${variant} ${className}`}>{busy?<Loader2 size={17} className="spin"/>:Icon?<Icon size={17}/>:null}{children}</button>;
}
export function Badge({status,children}:{status?:string;children?:ReactNode}){return <span className={'badge badge-'+(status||'neutral')}><i/>{children||statusLabels[status||'']||status}</span>;}
export function PageHeader({eyebrow,title,description,actions}:{eyebrow?:string;title:string;description?:string;actions?:ReactNode}){return <div className="page-header"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description&&<p>{description}</p>}</div>{actions&&<div className="page-actions">{actions}</div>}</div>;}
export function Empty({title='Nenhum registro por aqui',text,action,icon:Icon=Inbox}:{title?:string;text?:string;action?:ReactNode;icon?:LucideIcon}){return <div className="empty-state"><div className="empty-icon"><Icon size={25}/></div><h3>{title}</h3>{text&&<p>{text}</p>}{action}</div>;}
export function InlineError({error}:{error:unknown}){return error?<div className="alert alert-error" role="alert"><AlertCircle size={18}/><span>{errorMessage(error)}</span></div>:null;}
export function Notice({children,type='info'}:{children:ReactNode;type?:string}){return <div className={'alert alert-'+type}><AlertCircle size={18}/><div>{children}</div></div>;}
export function Field({label,children,hint,className=''}:{label:string;children:ReactNode;hint?:string;className?:string}){const id=useId();const content=React.isValidElement(children)?React.cloneElement(children as React.ReactElement<any>,{id,'aria-describedby':hint?id+'-hint':undefined}):children;return <div className={'field '+className}><label className="field-label" htmlFor={id}>{label}</label>{content}{hint&&<small id={id+'-hint'}>{hint}</small>}</div>;}
export function Select(props:React.SelectHTMLAttributes<HTMLSelectElement>){return <div className="select-wrap"><select {...props}/><ChevronDown size={15}/></div>;}
export function Modal({title,description,children,onClose,wide=false}:{title:string;description?:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const last=document.activeElement as HTMLElement,previous=document.body.style.overflow;document.body.style.overflow='hidden';
    const timer=setTimeout(()=>ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus(),40);
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const items=ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]');if(!items?.length)return;const first=items[0],end=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();end.focus();}else if(!e.shiftKey&&document.activeElement===end){e.preventDefault();first.focus();}}};
    document.addEventListener('keydown',key);return()=>{clearTimeout(timer);document.body.style.overflow=previous;document.removeEventListener('keydown',key);last?.focus();};
  },[]);
  return createPortal(<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={'modal '+(wide?'modal-wide':'')}><div className="modal-header"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div><button className="icon-btn" onClick={onClose} aria-label="Fechar janela"><X size={20}/></button></div>{children}</div></div>,document.body);
}
const SecurityContext=createContext<{reauth:()=>Promise<void>}>({reauth:async()=>{}});
export function SecurityProvider({realm,children}:{realm:Realm;children:ReactNode}){
  const [open,setOpen]=useState(false),[password,setPassword]=useState(''),[error,setError]=useState<unknown>(null),[busy,setBusy]=useState(false);const resolve=useRef<{ok:()=>void;cancel:(e:Error)=>void}|null>(null);
  const close=()=>{setOpen(false);resolve.current?.cancel(new Error('Operação cancelada.'));resolve.current=null;};
  const reauth=()=>new Promise<void>((ok,cancel)=>{resolve.current={ok,cancel};setPassword('');setError(null);setOpen(true);});
  return <SecurityContext.Provider value={{reauth}}>{children}{open&&<Modal title="Confirme sua identidade" description="Esta operação exige uma confirmação de segurança." onClose={close}><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError(null);try{await api(`/auth/${realm}/reauth`,'POST',{password});setOpen(false);resolve.current?.ok();resolve.current=null;}catch(err){setError(err);}finally{setBusy(false);}}}><div className="security-symbol"><LockKeyhole size={26}/></div><Field label="Sua senha atual"><input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={128}/></Field><InlineError error={error}/><div className="modal-actions"><Button type="button" variant="secondary" onClick={close}>Cancelar</Button><Button busy={busy}>Confirmar identidade</Button></div></form></Modal>}</SecurityContext.Provider>;
}
export const useSecurity=()=>useContext(SecurityContext);
export function Stat({label,value,icon:Icon,detail,tone='blue'}:{label:string;value:ReactNode;icon:LucideIcon;detail?:ReactNode;tone?:string}){return <div className="stat-card"><div className="stat-top"><span>{label}</span><div className={'stat-icon '+tone}><Icon size={19}/></div></div><strong>{value}</strong>{detail&&<div className="stat-detail">{detail}</div>}</div>;}
export function Initials({name}:{name:string}){const initials=name.split(' ').filter(Boolean).slice(0,2).map(v=>v[0]).join('');return <span className="avatar">{initials||'RH'}</span>;}
export function ErrorScreen({error,retry}:{error:unknown;retry?:()=>void}){return <div className="panel"><Empty title="Não foi possível carregar os dados" text={errorMessage(error)} icon={AlertCircle} action={retry&&<Button onClick={retry}>Tentar novamente</Button>}/></div>;}
