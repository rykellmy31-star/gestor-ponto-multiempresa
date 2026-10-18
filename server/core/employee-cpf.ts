
import { keyedHash } from './crypto';

// CR JORNADA - Passo 57.9.1
// Preparacao da autenticacao por CPF.
//
// Nao modifica rotas, sessoes ou banco de dados.
// Nao utiliza CPF como chave primaria.
// Nao armazena CPF em texto puro.
//
// O identificador de busca utiliza HMAC-SHA256
// com uma chave secreta fornecida pelo servidor.

export function normalizeEmployeeCpf(
  value: string
): string {
  const cpf = value.replace(/\D/g, '');

  if (!/^\d{11}$/.test(cpf)) {
    throw new Error('invalid_cpf');
  }

  if (/^(\d)\1{10}$/.test(cpf)) {
    throw new Error('invalid_cpf');
  }

  for (let length = 9; length < 11; length++) {
    let sum = 0;

    for (let index = 0; index < length; index++) {
      sum +=
        Number(cpf[index]) *
        (length + 1 - index);
    }

    let digit = (sum * 10) % 11;

    if (digit === 10) {
      digit = 0;
    }

    if (digit !== Number(cpf[length])) {
      throw new Error('invalid_cpf');
    }
  }

  return cpf;
}

export function employeeCpfLookupKey(
  cpfInput: string,
  secret: string
): string {
  if (!secret || secret.length < 32) {
    throw new Error('invalid_cpf_lookup_secret');
  }

  const cpf = normalizeEmployeeCpf(cpfInput);

  return keyedHash(
    `cr-jornada:employee-cpf:v1:${cpf}`,
    secret
  );
}
