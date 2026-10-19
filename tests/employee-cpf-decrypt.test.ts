import { describe, expect, it } from 'vitest';
import { encryptPersonal } from '../server/core/crypto';
import { decryptEmployeeCpf } from '../server/core/employee-cpf-decrypt';

// Apenas CPF publico de teste e chave aleatoria ficticia.
const key = '3'.repeat(64);
const wrongKey = '4'.repeat(64);
const cpf = '52998224725';

describe('CR JORNADA - leitura segura de CPF criptografado', () => {
  it('recupera CPF cifrado pelo mecanismo original', async () => {
    const ciphertext = await encryptPersonal(cpf, key);
    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain(cpf);
    expect(await decryptEmployeeCpf(ciphertext, key)).toBe(cpf);
  });

  it('impede descriptografia usando chave incorreta', async () => {
    const ciphertext = await encryptPersonal(cpf, key);
    await expect(decryptEmployeeCpf(ciphertext, wrongKey))
      .rejects.toThrow('cpf_decryption_failed');
  });

  it('recusa dados malformados e chave inadequada', async () => {
    await expect(decryptEmployeeCpf('CPF em texto puro', key))
      .rejects.toThrow('cpf_decryption_failed');
    await expect(decryptEmployeeCpf('v1.abc.abc', key))
      .rejects.toThrow('cpf_decryption_failed');
    await expect(decryptEmployeeCpf('qualquer', 'senha-curta'))
      .rejects.toThrow('invalid_data_key');
  });

  it('detecta adulteracao de um byte na cifra', async () => {
    const ciphertext = await encryptPersonal(cpf, key);
    const [version, iv, encoded] = ciphertext.split('.');
    const altered = Buffer.from(encoded, 'base64');
    altered[0] ^= 1;
    await expect(decryptEmployeeCpf(
      [version, iv, altered.toString('base64')].join('.'), key
    )).rejects.toThrow('cpf_decryption_failed');
  });
});
