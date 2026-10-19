// Payloads de fixtures são conferidos pelas asserções dos testes de API.
// O runtime Workers tipa Response.json() como unknown; esta é a fronteira
// explícita de desserialização apenas para testes, sem mudar o código de produção.
export async function jsonBody(response: { json(): Promise<unknown> }): Promise<any> {
  return response.json();
}
