#!/usr/bin/env python3
"""
Gera uma cópia do arquivo de dados com as coleções vazias que os módulos originais do frontend
(V1.0.19–V1.1.3) criam ao carregar a página (mesma regra: data.X = data.X || []).
Usada como referência no teste A/B das telas corrigidas (ACV e LCC): o frontend ORIGINAL, servindo este
estado, desenha essas telas sem erro — e o servidor novo precisa desenhá-las exatamente igual.

Uso: python seed_com_colecoes.py <entrada.json> <saida.json>
"""
import json, sys

COLECOES = ['acv_estudos', 'acv_cenarios', 'acv_resultados', 'acv_fatores', 'lcc_estudos', 'lcc_cenarios',
            'lcc_resultados', 'acv_icv_salvos', 'apontamento_tempos', 'op_pi_consumos', 'pi_lotes']

doc = json.load(open(sys.argv[1], encoding='utf-8-sig'))
estado = doc['data'] if doc.get('format') == 'MES_LION_JSON_DATABASE' else doc
for k in COLECOES:
    estado[k] = estado.get(k) or []
json.dump(doc, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print(f'{sys.argv[2]}: {len(estado)} coleções')
