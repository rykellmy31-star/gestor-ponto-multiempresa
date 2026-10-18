
import { describe, expect, it } from 'vitest';

import {
  normalizeEmployeeCpf,
  employeeCpfLookupKey
} from '../server/core/employee-cpf';

// CR JORNADA - Passo 57.9.2
// Testes da identificacao segura por CPF.
//
// Sem acesso ao banco de dados.
// Sem deploy.
// Sem CPF real de funcionarios.

const SECRET_A =
  'cr-jornada-test-secret-a-2026-very-secure';

const SECRET_B =
  'cr-jornada-test-secret-b-2026-very-secure';

describe('CR JORNADA - identificacao por CPF', () => {
  it('normaliza CPF com ou sem pontuacao', () => {
    const formatted = normalizeEmployeeCpf(
      '529.982.247-25'
    );

    const unformatted = normalizeEmployeeCpf(
      '52998224725'
    );

    expect(formatted).toBe('52998224725');
    expect(unformatted).toBe(formatted);
  });

  it('rejeita CPF com digitos verificadores invalidos', () => {
    expect(() => {
      normalizeEmployeeCpf('529.982.247-26');
    }).toThrow('invalid_cpf');

    expect(() => {
      normalizeEmployeeCpf('123.456.789-00');
    }).toThrow('invalid_cpf');
  });

  it('rejeita CPFs repetidos ou incompletos', () => {
    const invalid = [
      '000.000.000-00',
      '111.111.111-11',
      '999.999.999-99',
      '123456789',
      '',
      'abc'
    ];

    for (const cpf of invalid) {
      expect(() => {
        normalizeEmployeeCpf(cpf);
      }).toThrow('invalid_cpf');
    }
  });

  it('gera o mesmo identificador para o mesmo CPF', () => {
    const first = employeeCpfLookupKey(
      '529.982.247-25',
      SECRET_A
    );

    const second = employeeCpfLookupKey(
      '52998224725',
      SECRET_A
    );

    expect(first).toBe(second);

    // HMAC-SHA256 produz 64 caracteres hexadecimais.
    expect(first).toMatch(/^[a-f0-9]{64}$/);

    // Nao armazena o CPF diretamente no identificador.
    expect(first).not.toContain('52998224725');
  });

  it('produz identificadores diferentes com chaves diferentes', () => {
    const first = employeeCpfLookupKey(
      '52998224725',
      SECRET_A
    );

    const second = employeeCpfLookupKey(
      '52998224725',
      SECRET_B
    );

    expect(first).not.toBe(second);
  });

  it('rejeita chave secreta ausente ou curta', () => {
    expect(() => {
      employeeCpfLookupKey(
        '52998224725',
        ''
      );
    }).toThrow('invalid_cpf_lookup_secret');

    expect(() => {
      employeeCpfLookupKey(
        '52998224725',
        'senha-curta'
      );
    }).toThrow('invalid_cpf_lookup_secret');
  });
});
