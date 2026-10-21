import {describe,expect,it} from 'vitest';
import {employeeCpfSessionEndpointUnavailable,nextEmployeePunchAttempt,
  matchesEmployeePunchConfirmation,checkEmployeePunchPreflight} from '../web/src/employee-cpf-ui-safety';

describe('CR JORNADA — UI CPF: sessao real e idempotencia por dia',()=>{
  it('nao trata hostname pages.dev como prova de API ausente',()=>{
    expect(employeeCpfSessionEndpointUnavailable(401,'application/json')).toBe(false);
    expect(employeeCpfSessionEndpointUnavailable(200,'application/json; charset=utf-8')).toBe(false);
    expect(employeeCpfSessionEndpointUnavailable(200,'text/html')).toBe(true);
    expect(employeeCpfSessionEndpointUnavailable(404,'text/html')).toBe(true);
    expect(employeeCpfSessionEndpointUnavailable(503,'application/json')).toBe(false);
  });
  it('repete somente a mesma tentativa no mesmo dia, funcionario, empresa e tipo',()=>{
    let count=0;
    const key=()=>String(++count).padStart(36,'0');
    const day={companyId:'empresa-a',employeeId:'ana',workDate:'2026-10-26',
      type:'entry' as const};
    const first=nextEmployeePunchAttempt(null,day,key);
    expect(nextEmployeePunchAttempt(first,day,key)).toBe(first);
    expect(nextEmployeePunchAttempt(first,{...day,workDate:'2026-10-27'},key).key)
      .not.toBe(first.key);
    expect(nextEmployeePunchAttempt(first,{...day,type:'exit'},key).key)
      .not.toBe(first.key);
    expect(nextEmployeePunchAttempt(first,{...day,employeeId:'joao'},key).key)
      .not.toBe(first.key);
    expect(nextEmployeePunchAttempt(first,{...day,companyId:'empresa-b'},key).key)
      .not.toBe(first.key);
  });
  it('confere a etapa no servidor e evita ponto em data ou empresa antigas',()=>{
    const expected={companyId:'a',employeeId:'ana',workDate:'2026-10-26',
      type:'entry' as const};
    const current={company_id:'a',employee_id:'ana',
      work_date:'2026-10-26',next_type:'entry' as const};
    expect(checkEmployeePunchPreflight(expected,current,null)).toBe('ready');
    expect(checkEmployeePunchPreflight(expected,{
      ...current,work_date:'2026-10-27'
    },null)).toBe('changed');
    expect(checkEmployeePunchPreflight(expected,{
      ...current,company_id:'b'
    },null)).toBe('different_identity');
    expect(checkEmployeePunchPreflight(expected,{
      ...current,employee_id:'joao'
    },null)).toBe('different_identity');
    expect(checkEmployeePunchPreflight(expected,{
      ...current,next_type:'break_start'
    },null)).toBe('changed');
    const pending=nextEmployeePunchAttempt(null,expected,()=>'chave');
    expect(checkEmployeePunchPreflight(expected,{
      ...current,next_type:'break_start'
    },pending)).toBe('retry');
    expect(checkEmployeePunchPreflight(expected,{
      ...current,work_date:'2026-10-27',next_type:'break_start'
    },pending)).toBe('changed');
    expect(checkEmployeePunchPreflight(expected,{
      ...current,next_type:null
    },pending)).toBe('retry');
  });
  it('nao aceita replay de ontem ou de outra batida como confirmacao de hoje',()=>{
    const attempt=nextEmployeePunchAttempt(null,{
      companyId:'a',employeeId:'ana',workDate:'2026-10-27',type:'entry'
    },()=>'chave');
    expect(matchesEmployeePunchConfirmation({
      type:'entry',work_date:'2026-10-27',receipt_hash:'hash'
    },attempt)).toBe(true);
    expect(matchesEmployeePunchConfirmation({
      type:'entry',work_date:'2026-10-26',receipt_hash:'hash'
    },attempt)).toBe(false);
    expect(matchesEmployeePunchConfirmation({
      type:'exit',work_date:'2026-10-27',receipt_hash:'hash'
    },attempt)).toBe(false);
    expect(matchesEmployeePunchConfirmation({
      type:'entry',work_date:'2026-10-27',receipt_hash:''
    },attempt)).toBe(false);
  });
});
