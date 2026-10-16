#!/usr/bin/env python3
"""
Teste do REDEFINIR_SENHA.bat (MES_LION_SERVER_JSON.ps1 -RedefinirSenha) com entrada redirecionada: troca a senha,
reativa o usuário e grava hash PBKDF2 V3; senhas que não conferem não alteram nada.

Uso: python teste_redefinir_senha_json.py <pasta_do_pacote_MES_LION_1_0_JSON>   (servidor encerrado)
Variável: MES_POWERSHELL (padrão: powershell no Windows, pwsh nos demais)
"""
import os, sys, subprocess, json, base64, hashlib

PACOTE = os.path.abspath(sys.argv[1])
SHELL = os.environ.get('MES_POWERSHELL') or ('powershell' if os.name == 'nt' else 'pwsh')
ARQ = os.path.join(PACOTE, 'Dados', 'usuarios.json')
falhas, total = [], 0


def ok(c, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if c else '  [FALHA] ') + nome + ('' if c else f' -> {det}'), flush=True)
    if not c: falhas.append(f'{nome}: {det}')


def confere(senha, h):
    d = base64.b64decode(h)
    alg = {0: 'sha1', 1: 'sha256', 2: 'sha512'}[int.from_bytes(d[1:5], 'big')]
    it, ts = int.from_bytes(d[5:9], 'big'), int.from_bytes(d[9:13], 'big')
    return hashlib.pbkdf2_hmac(alg, senha.encode('utf-8'), d[13:13 + ts], it, len(d) - 13 - ts) == d[13 + ts:]


def redefinir(entrada):
    return subprocess.run([SHELL, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', os.path.join(PACOTE, 'server', 'MES_LION_SERVER_JSON.ps1'), '-RedefinirSenha'],
                          input=entrada.encode('utf-8'), capture_output=True)


usuarios = json.load(open(ARQ, encoding='utf-8-sig'))
alvo = usuarios[0]['username']
antes = usuarios[0]['password_hash']
r = redefinir(f'{alvo}\nUma senha\nOutra senha\n')
ok(r.returncode != 0 and json.load(open(ARQ, encoding='utf-8-sig'))[0]['password_hash'] == antes, 'senhas diferentes não alteram nada', r.returncode)
r = redefinir('usuario_que_nao_existe\nx\nx\n')
ok(r.returncode != 0, 'usuário inexistente -> erro', r.returncode)
nova = 'Nova Senha ç 2026!'
r = redefinir(f'{alvo}\n{nova}\n{nova}\n')
u = next(x for x in json.load(open(ARQ, encoding='utf-8-sig')) if x['username'] == alvo)
ok(r.returncode == 0 and confere(nova, u['password_hash']) and u['active'] is True, 'senha redefinida (PBKDF2) e usuário ativo', (r.returncode, r.stdout.decode('utf-8', 'replace')[-300:]))
print(f'\n== {total - len(falhas)}/{total} verificações OK')
if falhas:
    print('FALHAS:'); [print(' - ' + f) for f in falhas]
    sys.exit(1)
