import { DateTime } from 'luxon';
import type { DayResult, Occurrence, Rules, Schedule, Totals } from '../types';
import { scheduleMinutes, shiftBounds } from './time';
export const DEFAULT_RULES: Rules = { mark_tolerance:5, daily_tolerance:10, rounding_step:1, rounding_mode:'floor', auto_approve_overtime:false, compensation:'review', max_shift_hours:24 };
export interface DayInput {
  date:string; timezone:string; schedule:Schedule|null; rules:Rules;
  marks:(number|null)[]; rawMarks?:(number|null)[]; adjusted?:boolean; adjustmentReason?:string;
  holiday?:string; occurrences:Occurrence[];
  overtime?:{status:string;approved_minutes:number}; now:number; live?:boolean;
  employed:boolean;
}
const roundMinutes=(ms:number,r:Rules)=>{
  const value=ms/60000/r.rounding_step;
  return (r.rounding_mode==='ceil'?Math.ceil(value):r.rounding_mode==='nearest'?Math.round(value):Math.floor(value))*r.rounding_step;
};
export function calculateDay(input: DayInput): DayResult {
  const {date,schedule:s,rules:r,now,marks:m,occurrences:occ,timezone:zone}=input;
  const weekday=DateTime.fromISO(date).weekday%7;
  const approved=occ.filter(o=>o.status==='approved');
  const scheduled=Boolean(input.employed&&s&&s.weekdays.includes(weekday));
  const dayOff=Boolean(input.holiday||approved.some(o=>o.kind==='day_off'));
  const expected=scheduled&&!dayOff?scheduleMinutes(s!).daily:0;
  const bounds=s?shiftBounds(date,s,zone):null;
  const present=m.filter(v=>v!==null).length;
  const complete=present===4;
  const due=complete||(bounds?now>=bounds.end:date<DateTime.fromMillis(now,{zone}).toISODate()!);
  const today=DateTime.fromMillis(now,{zone}).toISODate()!;
  const stale=present>0&&!complete&&Boolean(bounds?((date<today&&now>=bounds.end)||now>=(m[0]??bounds.start)+r.max_shift_hours*3600000):true);
  let workedMs=0;
  if(m[0]!==null&&m[1]!==null)workedMs+=Math.max(0,m[1]-m[0]);
  if(m[2]!==null&&m[3]!==null)workedMs+=Math.max(0,m[3]-m[2]);
  if(input.live&&!stale){
    if(m[0]!==null&&m[1]===null)workedMs+=Math.max(0,now-m[0]);
    if(m[2]!==null&&m[3]===null)workedMs+=Math.max(0,now-m[2]);
  }
  const breakMs=m[1]!==null&&m[2]!==null?Math.max(0,m[2]-m[1]):0;
  if(s?.paid_break)workedMs+=breakMs;
  const worked=roundMinutes(workedMs,r);
  const credited=approved.some(o=>o.paid&&['medical','justified_absence'].includes(o.kind))?Math.max(0,expected-worked):0;
  const lateRaw=expected&&bounds&&m[0]!==null?Math.max(0,Math.floor((m[0]-bounds.start)/60000)):0;
  const earlyRaw=expected&&bounds&&m[3]!==null?Math.max(0,Math.floor((bounds.end-m[3])/60000)):0;
  const late=lateRaw>r.mark_tolerance?lateRaw:0, early=earlyRaw>r.mark_tolerance?earlyRaw:0;
  let rawBalance=due?worked+credited-expected:0;
  // Tolerância só elimina diferença pequena quando entrada e saída também estão dentro da margem.
  if(expected>0&&Math.abs(rawBalance)<=r.daily_tolerance&&lateRaw<=r.mark_tolerance&&earlyRaw<=r.mark_tolerance&&complete)rawBalance=0;
  const positive=complete?Math.max(0,rawBalance):0;
  const decision=input.overtime;
  const approvedExtra=r.auto_approve_overtime?positive:decision?.status==='approved'?Math.min(positive,decision.approved_minutes):0;
  const pendingExtra=r.auto_approve_overtime||decision?0:positive;
  const rejectedExtra=decision?Math.max(0,positive-approvedExtra):0;
  const missing=due?Math.max(0,-rawBalance):0;
  const absence=due&&expected>0&&present===0&&credited<expected;
  const pending=occ.filter(o=>o.status==='pending').length;
  const notes:string[]=[];
  if(input.holiday)notes.push(`Feriado: ${input.holiday}`);
  if(dayOff&&!input.holiday)notes.push('Folga autorizada');
  if(!input.employed)notes.push('Fora do vínculo');
  else if(!s)notes.push('Sem jornada atribuída');
  else if(!scheduled&&!dayOff)notes.push('Sem expediente');
  if(input.adjusted)notes.push(`Ajuste: ${input.adjustmentReason||'administrativo'}`);
  for(const o of occ)notes.push(`${o.status==='pending'?'Pendente':o.status==='rejected'?'Recusada':'Aprovada'}: ${o.reason}`);
  if(stale)notes.push('Marcações incompletas — conferir');
  if(absence)notes.push('Ausência sem abono');
  if(pendingExtra>0)notes.push('Horas positivas aguardando aprovação');
  if(r.compensation==='bank'&&(approvedExtra>0||missing>0))notes.push('Saldo aprovado destinado ao banco de horas — sem transporte automático entre meses');
  const status=!input.employed&&present===0?'outside_employment':complete?'completed':stale?'incomplete':present===1?'working':present===2?'on_break':present===3?'working':absence?'absent':credited>0?'justified':dayOff?'day_off':!expected?'off':'not_started';
  return {
    date,timezone:zone,weekday:DateTime.fromISO(date).setLocale('pt-BR').toFormat('ccc'), marks:m,raw_marks:input.rawMarks||m,
    expected_minutes:expected,worked_minutes:worked,break_minutes:Math.floor(breakMs/60000),credited_minutes:credited,
    late_minutes:late,early_minutes:early,overtime_minutes:approvedExtra,overtime_pending_minutes:pendingExtra,overtime_rejected_minutes:rejectedExtra,
    missing_minutes:missing,raw_balance_minutes:rawBalance,balance_minutes:approvedExtra-missing,positive_minutes:positive,
    status,worked_day:present>0,absence,incomplete:stale,pending_occurrences:pending,notes,adjusted:!!input.adjusted,schedule:s,rules:r,
  };
}
export function sumDays(days:DayResult[]):Totals {
  const total:Totals={expected_minutes:0,worked_minutes:0,break_minutes:0,credited_minutes:0,late_minutes:0,early_minutes:0,overtime_minutes:0,overtime_pending_minutes:0,missing_minutes:0,balance_minutes:0,raw_balance_minutes:0,worked_days:0,absences:0,incomplete_days:0,pending_occurrences:0};
  for(const day of days){
    for(const key of ['expected_minutes','worked_minutes','break_minutes','credited_minutes','late_minutes','early_minutes','overtime_minutes','overtime_pending_minutes','missing_minutes','balance_minutes','raw_balance_minutes','pending_occurrences'] as const)total[key]+=day[key];
    total.worked_days+=+day.worked_day;total.absences+=+day.absence;total.incomplete_days+=+day.incomplete;
  }return total;
}
