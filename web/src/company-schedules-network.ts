/**
 * Fetch helper for enterprise schedule screens.
 * A lost HTTP response does NOT prove a mutation was rolled back: the server
 * may have committed the transaction before the network connection failed.
 * Never instruct an administrator to blindly retry a write.
 */
export async function jsonRequest<T>(path:string,options?:RequestInit):Promise<T> {
  const method=(options?.method||'GET').toUpperCase();
  const mutation=method!=='GET'&&method!=='HEAD';
  let response:Response;
  try {
    response=await fetch('/api'+path,{
      credentials:'same-origin',cache:'no-store',...options
    });
  } catch {
    throw new Error(mutation
      ? 'Conexão interrompida. A operação pode ter sido registrada. Atualize os dados antes de tentar novamente.'
      : 'Sem conexão com o servidor da empresa. Tente atualizar novamente.');
  }
  const data=await response.json().catch(()=>null) as
    ({error?:{message?:string}}&T)|null;
  if(!response.ok) {
    if(response.status===503)throw new Error(
      'As escalas da empresa estão indisponíveis ou ainda em homologação. Verifique antes de repetir a operação.'
    );
    throw new Error(data?.error?.message||
      (response.status===401?'Sessão encerrada. Entre novamente.':
      mutation
        ? 'Não foi possível confirmar a operação. Atualize os dados antes de tentar novamente.'
        : 'Não foi possível carregar os dados. Tente novamente.'));
  }
  if(!data)throw new Error(mutation
    ? 'Resposta inesperada do servidor. A operação pode ter sido registrada. Atualize os dados antes de tentar novamente.'
    : 'O servidor retornou uma resposta inesperada.');
  return data;
}
