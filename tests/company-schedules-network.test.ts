import {afterEach, describe, expect, it, vi} from 'vitest';
import {jsonRequest,CompanyRequestError,isExpiredCompanySession} from '../web/src/company-schedules-network';

afterEach(()=>vi.unstubAllGlobals());

describe('CR JORNADA — estado incerto de operações empresariais',()=>{
  it('não afirma rollback quando o POST perde a resposta',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('network')));
    await expect(jsonRequest('/company/schedules',{method:'POST'}))
      .rejects.toThrow(/pode ter sido registrada.*antes de tentar novamente/);
  });
  it('não trata perda de conexão no GET como escrita',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('network')));
    await expect(jsonRequest('/company/schedules'))
      .rejects.toThrow(/Sem conexão.*atualizar novamente/);
  });
  it('POST 200 sem JSON continua incerto',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:200})));
    await expect(jsonRequest('/company/schedules',{method:'POST'}))
      .rejects.toThrow(/Resposta inesperada.*pode ter sido registrada/);
  });
  it('erro 500 sem mensagem não inventa que a gravação foi desfeita',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:500})));
    await expect(jsonRequest('/company/schedules',{method:'POST'}))
      .rejects.toThrow(/Não foi possível confirmar.*Atualize os dados/);
  });
  it('preserva erro do backend quando ele é explícito',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(
      JSON.stringify({error:{message:'Escala inválida'}}),{status:422}
    )));
    await expect(jsonRequest('/company/schedules',{method:'POST'}))
      .rejects.toThrow('Escala inválida');
  });
  it('mantém resposta explícita de sessão encerrada',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:401})));
    await expect(jsonRequest('/company/schedules'))
      .rejects.toThrow('Sessão encerrada. Entre novamente.');
  });
  it('401 e logout obrigatório, mas 403 ou rede não revogam a sessão visual',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:401})));
    let error:unknown;
    try {await jsonRequest('/company/employees');}catch(e){error=e;}
    expect(error).toBeInstanceOf(CompanyRequestError);
    expect((error as CompanyRequestError).status).toBe(401);
    expect(isExpiredCompanySession(error)).toBe(true);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(
      JSON.stringify({error:{message:'Sem permissão'}}),{status:403}
    )));
    try {await jsonRequest('/company/schedules',{method:'POST'});}catch(e){error=e;}
    expect(error).toMatchObject({status:403,message:'Sem permissão'});
    expect(isExpiredCompanySession(error)).toBe(false);
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('network')));
    try {await jsonRequest('/company/schedules');}catch(e){error=e;}
    expect(isExpiredCompanySession(error)).toBe(false);
  });
  it('não afirma que uma solicitação 503 não alterou dados',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:503})));
    await expect(jsonRequest('/company/schedules',{method:'POST'}))
      .rejects.toThrow(/estão indisponíveis ou ainda em homologação/);
  });
  it('retorna somente respostas JSON bem-sucedidas',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(
      JSON.stringify({success:true,id:'schedule-1'}),{status:201}
    )));
    const value=await jsonRequest<{success:boolean,id:string}>(
      '/company/schedules',{method:'POST'}
    );
    expect(value).toEqual({success:true,id:'schedule-1'});
    expect(fetch).toHaveBeenCalledWith('/api/company/schedules',
      expect.objectContaining({credentials:'same-origin',cache:'no-store',method:'POST'}));
  });
});
