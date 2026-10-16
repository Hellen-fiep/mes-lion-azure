#!/usr/bin/env python3
"""
Monta o pacote MES LION 1.0 JSON (sem PostgreSQL):
  frontend ORIGINAL (index.html, style.css, js/, assets/ — conferido byte a byte contra o MANIFESTO_FRONTEND.txt)
  + server/*.ps1 (UTF-8 com BOM, exigido pelo Windows PowerShell 5.1) + lançadores .bat (CRLF) + LEIA-ME
  + Dados/ (opcional: arquivo de dados inicial).

Uso:
  python montar_pacote.py --frontend <pasta_frontend_original> --saida <pasta_destino>
                          [--dados MES_LION_DATA.json] [--desembrulhar] [--leiames <pasta_com_LEIA-ME_antigos>] [--zip arquivo.zip]

--desembrulhar: grava Dados/MES_LION_DATA.json já no formato de trabalho (sem o envelope MES_LION_JSON_DATABASE) e
                Dados/app_storage.json; sem ela o servidor faz a conversão na primeira vez que abre.
"""
import argparse, hashlib, json, os, re, shutil, sys, zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
FRONTEND = ['index.html', 'style.css', 'js', 'assets']


def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frontend', required=True)
    ap.add_argument('--saida', required=True)
    ap.add_argument('--dados')
    ap.add_argument('--desembrulhar', action='store_true')
    ap.add_argument('--leiames')
    ap.add_argument('--zip')
    a = ap.parse_args()

    saida = os.path.abspath(a.saida)
    if os.path.exists(saida):
        shutil.rmtree(saida)
    os.makedirs(saida)

    # 1) frontend original, conferido contra o manifesto (hash "original=" de cada arquivo)
    esperados = {}
    for linha in open(os.path.join(RAIZ, 'MANIFESTO_FRONTEND.txt'), encoding='utf-8'):
        m = re.match(r'^(IDENTICO|ALTERADO)\s+(\S+)\s+original=([0-9a-f]{64})', linha)
        if m:
            esperados[m.group(2)] = m.group(3)
    for item in FRONTEND:
        origem = os.path.join(a.frontend, item)
        if os.path.isdir(origem):
            shutil.copytree(origem, os.path.join(saida, item))
        else:
            shutil.copy2(origem, os.path.join(saida, item))
    encontrados = {}
    for base, _, arquivos in os.walk(saida):
        for n in arquivos:
            p = os.path.join(base, n)
            encontrados[os.path.relpath(p, saida).replace(os.sep, '/')] = sha(p)
    diferentes = [k for k, h in esperados.items() if encontrados.get(k) != h]
    extras = sorted(set(encontrados) - set(esperados))
    if diferentes or extras:
        print('Frontend diferente do original:', diferentes, 'arquivos a mais:', extras)
        sys.exit(1)
    print(f'frontend: {len(encontrados)} arquivos idênticos ao pacote original (MANIFESTO_FRONTEND.txt)')

    # 2) servidor, lançadores e LEIA-ME
    os.makedirs(os.path.join(saida, 'server'))
    for n in sorted(os.listdir(os.path.join(AQUI, 'server'))):
        if n.endswith('.ps1'):
            b = open(os.path.join(AQUI, 'server', n), 'rb').read()
            if not b.startswith(b'\xef\xbb\xbf'):
                b = b'\xef\xbb\xbf' + b
            open(os.path.join(saida, 'server', n), 'wb').write(b)
    for n in sorted(os.listdir(AQUI)):
        if n.endswith('.bat'):
            b = open(os.path.join(AQUI, n), 'rb').read()
            b.decode('ascii')
            open(os.path.join(saida, n), 'wb').write(b.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))
    shutil.copy2(os.path.join(AQUI, 'LEIA-ME_VERSAO_JSON.txt'), saida)
    if a.leiames:
        destino = os.path.join(saida, 'LEIA-ME_versoes_anteriores')
        os.makedirs(destino)
        for n in sorted(os.listdir(a.leiames)):
            if re.match(r'^LEIA[-_]ME.*\.txt$', n, re.I):
                shutil.copy2(os.path.join(a.leiames, n), destino)

    # 3) dados
    dados = os.path.join(saida, 'Dados')
    os.makedirs(dados)
    if a.dados:
        bruto = open(a.dados, 'rb').read()
        if a.desembrulhar:
            doc = json.loads(bruto.decode('utf-8-sig'))
            if isinstance(doc, dict) and doc.get('format') == 'MES_LION_JSON_DATABASE':
                estado = doc['data']
                kv = {k: (v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, separators=(',', ':'))) for k, v in (doc.get('appStorage') or {}).items()}
                open(os.path.join(dados, 'MES_LION_DATA.json'), 'wb').write(json.dumps(estado, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
                open(os.path.join(dados, 'app_storage.json'), 'wb').write(json.dumps(kv, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
                print(f'dados: envelope MES_LION_JSON_DATABASE desembrulhado ({len(estado)} coleções, {len(kv)} chaves de appStorage)')
            else:
                open(os.path.join(dados, 'MES_LION_DATA.json'), 'wb').write(bruto)
        else:
            open(os.path.join(dados, 'MES_LION_DATA.json'), 'wb').write(bruto)

    if a.zip:
        nome_pasta = os.path.basename(saida)
        with zipfile.ZipFile(a.zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for base, pastas, arquivos in os.walk(saida):
                pastas.sort()
                rel_base = os.path.relpath(base, saida)
                if not arquivos and not pastas:
                    z.writestr(zipfile.ZipInfo(nome_pasta + '/' + rel_base.replace(os.sep, '/') + '/'), b'')
                for n in sorted(arquivos):
                    p = os.path.join(base, n)
                    z.write(p, nome_pasta + '/' + os.path.relpath(p, saida).replace(os.sep, '/'))
        print(f'zip: {a.zip} ({os.path.getsize(a.zip) / 1e6:.1f} MB)')
    print('pacote:', saida)


if __name__ == '__main__':
    main()
