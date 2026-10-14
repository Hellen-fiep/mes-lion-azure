// Senhas: mesmos vetores dos testes de unidade do servidor .NET (hashes bcrypt gerados pelo PostgreSQL/pgcrypto e
// vetores públicos do OpenBSD/jBCrypt) + hashes PBKDF2 no formato ASP.NET Core Identity V3 gerados por outra
// implementação (Python hashlib), provando que os dois servidores aceitam as mesmas senhas no mesmo banco.
import bcrypt from 'bcryptjs';
import { SEM_SENHA_LOCAL, ehHashBcrypt, gerarHashSenha, verificarSenha } from './senha-hasher';

const PGCRYPTO: [string, string][] = [
  ['meslion2026', '$2a$06$jrNrOzhcuEgHDuHkVvNZAuVmylJKYxUezTn3L3eNP7m6bhuFdvPtu'],
  ['Senh@ ção 🙂', '$2a$06$wB1xma/VF56ar.374fJrLOt8LEBtSitzQjZiT2dp2g/FIT1hWKPgu'],
  ['a', '$2a$04$6r0.gnc5dluRIJETGILbcerUpIk5zxCXuU.fqzC9OmX9lbHZiewo.'],
  ['x'.repeat(80), '$2a$05$TO9kkRl7RptOVypPo3Xuu.CsSF9E59WemKYqf884iJnM6gm/KV6p.'],
  ['', '$2a$06$Zs3IFINUqiuFeDGfdPkwaejNZlD5hKb7FmQiy29J2rPN1HDIxl18W'],
];

describe("bcrypt herdado do PostgreSQL (pgcrypto: crypt(senha, gen_salt('bf')))", () => {
  it.each(PGCRYPTO)('aceita a senha correta (%j) e pede conversão para PBKDF2', async (senha, hash) => {
    expect(ehHashBcrypt(hash)).toBe(true);
    expect(await verificarSenha(senha, hash)).toBe('sucesso-requer-atualizacao');
    if (senha.length < 72) expect(await verificarSenha(senha + 'x', hash)).toBe('falhou');
  });

  it('usa só os 72 primeiros bytes, como o pgcrypto', async () => {
    const hash = PGCRYPTO[3][1];
    expect(await verificarSenha('x'.repeat(81), hash)).toBe('sucesso-requer-atualizacao');
    expect(await verificarSenha('x'.repeat(71) + 'y', hash)).toBe('falhou');
  });

  it.each([
    ['U*U', '$2a$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW'],
    ['', '$2a$06$DCq7YPn5Rq63x1Lad4cll.TV4S6ytwfsfvkgY8jIucDrjc8deX1s.'],
    ['abcdefghijklmnopqrstuvwxyz', '$2a$06$.rCVZVOThsIa97pEDOxvGuRRgzG64bvtJ0938xuqzv18d3ZpQhstC'],
    ['~!@#$%^&*()      ~!@#$%^&*()PNBFRD', '$2a$06$fPIsBO8qRqkjj273rfaOI.HtSV9jLDpTbZn782DC6/t7qT67P6FfO'],
  ])('vetor público OpenBSD/jBCrypt (%j)', async (senha, hash) => {
    expect(await verificarSenha(senha, hash)).toBe('sucesso-requer-atualizacao');
  });

  it('aceita $2b$/$2y$ e recusa $2x$ (modo do bug antigo)', async () => {
    const h = bcrypt.hashSync('teste123', 5); // $2b$
    expect(await verificarSenha('teste123', h)).toBe('sucesso-requer-atualizacao');
    expect(await verificarSenha('teste123', '$2y$' + h.slice(4))).toBe('sucesso-requer-atualizacao');
    expect(await verificarSenha('teste123', '$2x$' + h.slice(4))).toBe('falhou');
  });
});

describe('PBKDF2 (formato ASP.NET Core Identity V3, o mesmo do servidor .NET)', () => {
  it('gera o formato V3: 0x01 | HMACSHA512 | 100.000 iterações | sal 16 | subchave 32 (61 bytes)', async () => {
    const h = await gerarHashSenha('Senha Forte ç');
    const bytes = Buffer.from(h, 'base64');
    expect(bytes).toHaveLength(61);
    expect(bytes[0]).toBe(1);
    expect(bytes.readUInt32BE(1)).toBe(2);
    expect(bytes.readUInt32BE(5)).toBe(100_000);
    expect(bytes.readUInt32BE(9)).toBe(16);
    expect(h.startsWith('AQAAAAIAAYagAAAAE')).toBe(true); // prefixo conferido no SQL Server pelo verificar_sqlserver.py
    expect(await verificarSenha('Senha Forte ç', h)).toBe('sucesso');
    expect(await verificarSenha('senha forte ç', h)).toBe('falhou');
  });

  it('sal aleatório: o mesmo texto gera hashes diferentes', async () => {
    expect(await gerarHashSenha('x')).not.toBe(await gerarHashSenha('x'));
  });

  it('verifica hashes gerados por outra implementação (Python hashlib.pbkdf2_hmac)', async () => {
    const sha512 = 'AQAAAAIAAYagAAAAEAABAgMEBQYHCAkKCwwNDg/tR9qrxXs2G78Gey+xCNxmGxN9ldARyl1x/KenEMGW2w==';
    expect(await verificarSenha('Senha ASP.NET ção 🙂', sha512)).toBe('sucesso');
    expect(await verificarSenha('Senha ASP.NET ção', sha512)).toBe('falhou');
    const sha256 = 'AQAAAAEAACcQAAAAEBAREhMUFRYXGBkaGxwdHh+1yr8ax8lI3NtFK6+4ao0oj3V5jnpJzoEK3QxFsH5Crg==';
    expect(await verificarSenha('meslion2026', sha256)).toBe('sucesso');
  });

  it('usuário sem senha local, hash vazio ou corrompido: falha sem exceção', async () => {
    expect(await verificarSenha('x', SEM_SENHA_LOCAL)).toBe('falhou');
    expect(await verificarSenha('x', '')).toBe('falhou');
    expect(await verificarSenha('x', null)).toBe('falhou');
    expect(await verificarSenha('x', 'lixo-que-nao-e-base64')).toBe('falhou');
    expect(await verificarSenha('x', Buffer.from([1, 0, 0, 0, 9]).toString('base64'))).toBe('falhou');
  });
});
