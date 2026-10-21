// Segurança da interface: a tentativa de ponto pertence a uma unica
// empresa, funcionario, data e tipo. Uma resposta perdida pode ser
// recuperada com a MESMA chave somente no mesmo contexto.
export type EmployeePunchType='entry'|'break_start'|'break_end'|'exit';
export type EmployeePunchContext={
  companyId:string;employeeId:string;workDate:string;type:EmployeePunchType
};
export type PendingEmployeePunch=EmployeePunchContext & {key:string};

export function nextEmployeePunchAttempt(
  current:PendingEmployeePunch|null,
  context:EmployeePunchContext,
  generateKey:()=>string
):PendingEmployeePunch {
  if(current&&current.companyId===context.companyId&&
    current.employeeId===context.employeeId&&
    current.workDate===context.workDate&&current.type===context.type) return current;
  return {...context,key:generateKey()};
}

export function matchesEmployeePunchConfirmation(
  confirmed:{work_date:string;type:string;receipt_hash?:string},
  attempt:PendingEmployeePunch
):boolean {
  return confirmed.work_date===attempt.workDate&&
    confirmed.type===attempt.type&&
    typeof confirmed.receipt_hash==='string'&&
    confirmed.receipt_hash.length>0;
}

// Cloudflare Pages pode servir uma API conectada no mesmo dominio. O
// hostname pages.dev NUNCA e suficiente para desabilitar autenticacao.
export function employeeCpfSessionEndpointUnavailable(
  status:number, contentType:string|null
):boolean {
  return status===404 || (
    status>=200&&status<300&&
    !contentType?.toLowerCase().includes('application/json')
  );
}

// Uma tela aberta pode permanecer com a data/etapa antiga. Verificamos a
// etapa atual no servidor imediatamente antes de enviar a marcacao.
export type EmployeePunchPreflight={
  company_id:string;employee_id:string;work_date:string;
  next_type:EmployeePunchType|null
};
export function checkEmployeePunchPreflight(
  expected:EmployeePunchContext,
  current:EmployeePunchPreflight,
  pending:PendingEmployeePunch|null
):'ready'|'retry'|'changed'|'different_identity' {
  if(current.company_id!==expected.companyId||
    current.employee_id!==expected.employeeId)return 'different_identity';
  if(current.work_date!==expected.workDate)return 'changed';
  if(current.next_type===expected.type)return 'ready';
  // Se o POST anterior perdeu a resposta, a batida pode ter sido gravada
  // e a proxima sequencia ja mudou: repetir a mesma chave recupera o
  // comprovante sem criar outra batida; nunca aceitar replay de outro dia.
  if(pending&&pending.companyId===expected.companyId&&
    pending.employeeId===expected.employeeId&&
    pending.workDate===expected.workDate&&
    pending.type===expected.type)return 'retry';
  return 'changed';
}
