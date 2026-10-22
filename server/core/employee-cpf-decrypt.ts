// CR JORNADA - leitura interna de CPF legado AES-256-GCM.
// O formato e o AAD devem corresponder a encryptPersonal() em crypto.ts.
// Nunca registrar nem devolver o CPF descriptografado por API.
export async function decryptEmployeeCpf(
  encrypted: string,
  dataKeyHex: string
): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(dataKeyHex || '')) {
    throw new Error('invalid_data_key');
  }

  if (typeof encrypted !== 'string') {
    throw new Error('cpf_decryption_failed');
  }

  const parts = encrypted.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('cpf_decryption_failed');
  }

  const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!base64.test(parts[1]) || !base64.test(parts[2])) {
    throw new Error('cpf_decryption_failed');
  }

  const iv = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');
  if (iv.length !== 12 || ciphertext.length < 16) {
    throw new Error('cpf_decryption_failed');
  }

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      Buffer.from(dataKeyHex, 'hex'),
      'AES-GCM',
      false,
      ['decrypt']
    );

    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: new TextEncoder().encode('jornada:cpf:v1')
      },
      key,
      ciphertext
    );

    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  } catch {
    // Erros de autenticacao AES-GCM devem ser genericos.
    throw new Error('cpf_decryption_failed');
  }
}
