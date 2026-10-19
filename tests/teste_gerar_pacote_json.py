#!/usr/bin/env python3
"""
Teste do GERAR_PACOTE_PARA_OUTROS_USUARIOS (versao_json/server/GERAR_PACOTE.ps1): o .zip leva o MES com os dados
(dados, usuários, histórico, documentos) e deixa de fora backups, logs, trava do servidor e temporários.

Uso: python teste_gerar_pacote_json.py <pasta_do_pacote_MES_LION_1_0_JSON>   (servidor já encerrado)
Variável: MES_POWERSHELL (padrão: powershell no Windows, pwsh nos demais)
"""
import os, sys, subprocess, zipfile, tempfile, json

PACOTE = os.path.abspath(sys.argv[1])
SHELL = os.environ.get('MES_POWERSHELL') or ('powershell' if os.name == 'nt' else 'pwsh')
falhas, total = [], 0


def ok(c, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if c else '  [FALHA] ') + nome + ('' if c else f' -> {det}'), flush=True)
    if not c: falhas.append(f'{nome}: {det}')


dados = os.path.join(PACOTE, 'Dados')
os.makedirs(os.path.join(dados, 'backups'), exist_ok=True)
os.makedirs(os.path.join(dados, 'logs'), exist_ok=True)
open(os.path.join(dados, 'backups', 'MES_LION_BACKUP_teste.zip'), 'wb').write(b'PK')
open(os.path.join(dados, 'logs', 'servidor_teste.log'), 'w').write('log')
open(os.path.join(dados, 'resto.tmp'), 'w').write('tmp')
destino = os.path.join(tempfile.mkdtemp(), 'pacote_teste.zip')
r = subprocess.run([SHELL, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', os.path.join(PACOTE, 'server', 'GERAR_PACOTE.ps1'), '-Destino', destino],
                   capture_output=True, text=True, encoding='utf-8', errors='replace')
print('\n'.join('   | ' + l for l in r.stdout.strip().splitlines()[-8:]))
ok(r.returncode == 0 and os.path.exists(destino), 'GERAR_PACOTE.ps1 executado', (r.stdout + r.stderr)[-800:])
nomes = zipfile.ZipFile(destino).namelist() if os.path.exists(destino) else []
pasta = os.path.basename(PACOTE)
ok(all(n.startswith(pasta + '/') for n in nomes), 'tudo dentro da pasta do MES no .zip', nomes[:3])
for obrig in ['INICIAR_MES.bat', 'index.html', 'js/app.js', 'js/mes_capacidade_carga_v1.js', 'server/MES_LION_SERVER_JSON.ps1', 'server/adaptador_frontend.js',
              'server/adaptador_passaporte.js', 'Dados/MES_LION_DATA.json', 'Dados/usuarios.json', 'Dados/auditoria.jsonl']:
    ok(f'{pasta}/{obrig}' in nomes, f'pacote contém {obrig}', '')
ok(not any('/Dados/backups/' in n or '/Dados/logs/' in n or n.endswith('.tmp') or n.endswith('servidor_em_execucao.json') for n in nomes),
   'sem backups, logs, temporários e trava do servidor', [n for n in nomes if 'backups' in n or 'logs' in n][:5])
if nomes:
    z = zipfile.ZipFile(destino)
    ok(z.read(f'{pasta}/Dados/MES_LION_DATA.json') == open(os.path.join(dados, 'MES_LION_DATA.json'), 'rb').read(), 'dados do MES idênticos no .zip', '')
    ok(json.loads(z.read(f'{pasta}/Dados/usuarios.json').decode('utf-8-sig')), 'usuários no .zip', '')
print(f'\n== {total - len(falhas)}/{total} verificações OK')
if falhas:
    print('FALHAS:'); [print(' - ' + f) for f in falhas]
    sys.exit(1)
