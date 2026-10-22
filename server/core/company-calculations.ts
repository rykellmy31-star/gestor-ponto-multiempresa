import { DateTime } from 'luxon';
import type { DayResult } from '../types';
import { calculateDay, sumDays } from './calculations';
import { ensure } from './errors';
import { rulesSchema, scheduleSchema } from './validation';
import { shiftBounds } from './time';
import { companyDayEventSchema,type CompanyDayEvent } from '../../shared/company-day-events';

export type CalculationWorkDay={id:string;company_id:string|null;work_date:string;
  timezone:string;schedule_json:string;rules_json:string;next_seq:number};
export type CalculationPunch={work_day_id:string;seq:number;type:string;recorded_at:number};
export type CalculationSchedule={work_date:string;config_json:string|null;assignment_created_at:number|null};
export type CalculationPolicy={enabled:number;rules_json:string;created_at:number;revision:number};
export type CalculatedDate={date:string;source:'snapshot'|'policy_history'|null;
  state:'calculated'|'future'|'outside_employment'|'needs_review';reason:string|null;result:DayResult|null};

function parse<T>(json:string, schema:{safeParse:(value:unknown)=>{success:boolean;data?:T}}):T {
  let value:unknown;
  try {value=JSON.parse(json);} catch {value=null;}
  const parsed=schema.safeParse(value);
  ensure(parsed.success,409,'invalid_report_snapshot','O histórico precisa de conferência antes da apuração.');
  return parsed.data!;
}
export function calculateCompanyMonth(input:{month:string;timezone:string;
  admission_date:string;employment_end:string|null;now:number;
  workDays:CalculationWorkDay[];punches:CalculationPunch[];
  schedules:CalculationSchedule[];policies:CalculationPolicy[];events?:CompanyDayEvent[]}) {
  ensure(['America/Bahia','America/Sao_Paulo'].includes(input.timezone),409,
    'invalid_report_timezone','Confira o fuso horário da empresa.');
  const from=DateTime.fromISO(input.month+'-01',{zone:'utc'});
  const today=DateTime.fromMillis(input.now,{zone:input.timezone}).toISODate()!;
  const days:CalculatedDate[]=Array.from({length:from.daysInMonth!},(_,index)=>{
    const date=from.plus({days:index}).toISODate()!;
    const row:CalculatedDate={date,source:null,state:'needs_review',reason:null,result:null};
    const day=input.workDays.find(d=>d.work_date===date);
    // A frozen day is evaluated even after the employment end or a later
    // timezone change: those changes must not erase recorded work.
    if(!day && (date<input.admission_date || (input.employment_end && date>input.employment_end)))
      return {...row,state:'outside_employment',reason:'Fora do vínculo nesta data.'};
    if(!day && date>today)return {...row,state:'future',reason:'Data futura.'};
    let schedule, rules,zone=input.timezone;
    const marks:Array<number|null>=[null,null,null,null];
    if(day) {
      if(day.company_id===null || day.next_seq<1 || day.next_seq>4)
        return {...row,reason:'Dia antigo ou não iniciado precisa de conciliação.'};
      ensure(['America/Bahia','America/Sao_Paulo'].includes(day.timezone),409,
        'invalid_report_timezone','Confira o fuso congelado do dia.');
      zone=day.timezone;
      schedule=parse(day.schedule_json,scheduleSchema);
      rules=parse(day.rules_json,rulesSchema);
      const punches=input.punches.filter(p=>p.work_day_id===day.id).sort((a,b)=>a.seq-b.seq);
      ensure(punches.length===day.next_seq && punches.every((p,index)=>
        p.seq===index && p.type===['entry','break_start','break_end','exit'][index] &&
        Number.isSafeInteger(p.recorded_at) && p.recorded_at>=0 &&
        (index===0 || p.recorded_at>=punches[index-1].recorded_at)),409,
        'invalid_report_marks','A sequência de marcações precisa de conferência.');
      for(const punch of punches)marks[punch.seq]=punch.recorded_at;
      row.source='snapshot';
    } else {
      const assigned=input.schedules.find(s=>s.work_date===date);
      if(!assigned?.config_json)return {...row,reason:'Sem jornada empresarial válida na data.'};
      schedule=parse(assigned.config_json,scheduleSchema);
      const bounds=shiftBounds(date,schedule,zone);
      if(assigned.assignment_created_at===null || assigned.assignment_created_at>bounds.start)
        return {...row,reason:'A atribuição foi criada após o início previsto; confira o histórico.'};
      const policy=input.policies.filter(p=>p.created_at<=bounds.start)
        .sort((a,b)=>b.created_at-a.created_at||b.revision-a.revision)[0];
      if(!policy || policy.enabled!==1)return {...row,reason:'Sem política habilitada comprovada no início previsto.'};
      if(input.policies.some(p=>p.enabled===0 && p.created_at>bounds.start && p.created_at<=Math.min(bounds.end,input.now)))
        return {...row,reason:'O ponto foi desativado durante o expediente; confira as marcações.'};
      rules=parse(policy.rules_json,rulesSchema);
      row.source='policy_history';
    }
    row.state='calculated';
    const events=(input.events??[]).filter(e=>e.work_date===date);
    ensure(new Set(events.map(e=>e.kind)).size===events.length,409,'invalid_day_events','Tratamentos duplicados exigem conferência.');
    const parsedEvents=events.map(e=>{
      let value;try{value=JSON.parse(e.value_json);}catch{value=undefined;}
      const parsed=companyDayEventSchema.safeParse({kind:e.kind,value,work_date:e.work_date,
        expected_revision:e.revision-1,reason:e.reason,...(e.employee_id?{employee_id:e.employee_id}:{})});
      ensure(parsed.success,409,'invalid_day_events','O histórico dos tratamentos precisa de conferência.');
      return {id:e.id,...parsed.data};
    });
    const holiday=parsedEvents.find(e=>e.kind==='holiday');
    const occurrence=parsedEvents.find(e=>e.kind==='occurrence');
    const adjustment=parsedEvents.find(e=>e.kind==='adjustment');
    const rawMarks=[...marks];
    if(adjustment?.kind==='adjustment'&&adjustment.value){
      const corrected=adjustment.value.marks;
      ensure(Boolean(day)&&corrected.every((m,i)=>m>=0&&m<=input.now&&(i===0||m>=corrected[i-1]))&&
        corrected[3]-corrected[0]<=24*3600000&&DateTime.fromMillis(corrected[0],{zone}).toISODate()===date,
        409,'invalid_adjustment','O ajuste precisa de conferência.');
      marks.splice(0,4,...corrected);
    }
    row.result=calculateDay({date,timezone:zone,schedule,rules,marks,
      rawMarks,adjusted:Boolean(adjustment?.value),adjustmentReason:adjustment?.reason,
      holiday:holiday?.kind==='holiday'&&holiday.value?holiday.value.name:undefined,
      occurrences:occurrence?.kind==='occurrence'&&occurrence.value?[{
        id:occurrence.id,work_date:date,kind:occurrence.value.kind,paid:occurrence.value.paid?1:0,
        reason:occurrence.reason,status:'approved'
      }]:[],now:input.now,employed:true});
    return row;
  });
  const calculated=days.flatMap(day=>day.result?[day.result]:[]);
  return {days,totals:sumDays(calculated),coverage:{
    calculated_days:calculated.length,
    review_days:days.filter(d=>d.state==='needs_review').length,
    future_days:days.filter(d=>d.state==='future').length,
    outside_employment_days:days.filter(d=>d.state==='outside_employment').length
  }};
}
