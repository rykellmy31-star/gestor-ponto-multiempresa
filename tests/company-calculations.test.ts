import { describe,expect,it } from 'vitest';
import { DateTime } from 'luxon';
import { calculateCompanyMonth,type CalculationWorkDay } from '../server/core/company-calculations';
import { DEFAULT_RULES } from '../server/core/calculations';
const at=(date:string,time:string)=>DateTime.fromISO(date+'T'+time,{zone:'America/Bahia'}).toMillis();
const morning={start:'07:00',break_start:'11:00',break_end:'12:00',end:'16:00',weekdays:[1,2,3,4,5],paid_break:false};
function input(){return {month:'2026-10',timezone:'America/Bahia',admission_date:'2026-10-26',employment_end:null,
  now:at('2026-10-31','23:00'),workDays:[] as CalculationWorkDay[],punches:[] as any[],
  schedules:Array.from({length:31},(_,i)=>({work_date:'2026-10-'+String(i+1).padStart(2,'0'),config_json:JSON.stringify(morning),assignment_created_at:at('2026-09-01','00:00')})),
  policies:[{enabled:1,rules_json:JSON.stringify(DEFAULT_RULES),revision:1,created_at:at('2026-09-01','00:00')}]};}
function recorded(marks=['07:12','11:00','12:00','16:00']){
  const x=input();x.workDays=[{id:'day',company_id:'a',work_date:'2026-10-26',timezone:'America/Bahia',
    schedule_json:JSON.stringify(morning),rules_json:JSON.stringify(DEFAULT_RULES),next_seq:marks.length}];
  x.punches=marks.map((time,seq)=>({work_day_id:'day',seq,type:['entry','break_start','break_end','exit'][seq],recorded_at:at('2026-10-26',time)}));
  return x;
}
describe('apuracao empresarial historica',()=>{
  it('congela jornada e regras, calcula atraso e intervalo sem aplicar politica nova',()=>{
    const x=recorded();x.schedules.forEach(s=>s.config_json=JSON.stringify({...morning,start:'13:00',break_start:'17:00',break_end:'18:00',end:'22:00'}));
    x.policies.push({enabled:1,rules_json:JSON.stringify({...DEFAULT_RULES,mark_tolerance:30}),revision:2,created_at:at('2026-10-26','08:00')});
    const day=calculateCompanyMonth(x).days[25];
    expect(day.source).toBe('snapshot');
    expect(day.result).toMatchObject({expected_minutes:480,worked_minutes:468,break_minutes:60,late_minutes:12,missing_minutes:12,status:'completed'});
  });
  it('respeita horarios por data, folgas e ausencia a conferir com historico valido',()=>{
    const x=input();x.schedules[26].config_json=JSON.stringify({...morning,start:'13:00',break_start:'17:00',break_end:'18:00',end:'22:00'});
    const result=calculateCompanyMonth(x);
    expect(result.days[25].result).toMatchObject({absence:true,expected_minutes:480});
    expect(result.days[26].result?.schedule?.start).toBe('13:00');
    expect(result.days[30].result).toMatchObject({status:'off',expected_minutes:0,absence:false});
    expect(result.days[0].state).toBe('outside_employment');
  });
  it('nao presume falta sem politica, com atribuicao retroativa ou bloqueio durante expediente',()=>{
    const x=input();x.policies=[];
    expect(calculateCompanyMonth(x).days[25]).toMatchObject({state:'needs_review',result:null});
    const y=input();y.schedules[25].assignment_created_at=at('2026-10-26','09:00');
    expect(calculateCompanyMonth(y).days[25].state).toBe('needs_review');
    const z=input();z.policies.push({...z.policies[0],enabled:0,revision:2,created_at:at('2026-10-26','10:00')});
    expect(calculateCompanyMonth(z).days[25].state).toBe('needs_review');
  });
  it('exclui futuro, dia legado e dia nao iniciado dos totais',()=>{
    const x=recorded();x.workDays[0].company_id=null;
    expect(calculateCompanyMonth(x).days[25].state).toBe('needs_review');
    x.workDays[0].company_id='a';x.workDays[0].next_seq=0;x.punches=[];
    expect(calculateCompanyMonth(x).days[25].state).toBe('needs_review');
    const y=input();y.now=at('2026-10-26','12:00');
    const report=calculateCompanyMonth(y);
    expect(report.days[26].state).toBe('future');
    expect(report.totals.absences).toBe(0);
  });
  it('calcula intervalo remunerado e extras pendentes sem aprovar automaticamente',()=>{
    const x=recorded(['07:00','11:00','12:00','17:00']);
    expect(calculateCompanyMonth(x).days[25].result).toMatchObject({overtime_pending_minutes:60,overtime_minutes:0,balance_minutes:0});
    x.workDays[0].schedule_json=JSON.stringify({...morning,paid_break:true});
    expect(calculateCompanyMonth(x).days[25].result).toMatchObject({worked_minutes:600,expected_minutes:540,break_minutes:60});
  });
  it('recusa snapshot corrompido e sequencia divergente em vez de apurar parcialmente',()=>{
    const x=recorded();x.workDays[0].rules_json='{}';
    expect(()=>calculateCompanyMonth(x)).toThrow();
    const y=recorded();y.punches[2].recorded_at=at('2026-10-26','10:00');
    expect(()=>calculateCompanyMonth(y)).toThrow();
  });
});
