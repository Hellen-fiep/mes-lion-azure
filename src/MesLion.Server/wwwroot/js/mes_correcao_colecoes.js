/* =====================================================================
   MES LION 1.0 AZURE — CORREÇÃO: COLEÇÕES DOS MÓDULOS ACV / LCC / ICV,
   APONTAMENTO DE TEMPOS E LOTES DE PI NO MODO SERVIDOR (MULTIUSUÁRIO)

   Problema (herdado do MES LION 1.0 PGSQL): os módulos V1.0.19 a V1.1.3 criam
   suas coleções vazias quando a página carrega (ex.: data.acv_estudos =
   data.acv_estudos || []). No modo servidor, o estado vindo do banco substitui
   o objeto "data" logo depois (no login e também ao recarregar a página), e
   essas coleções deixam de existir quando o banco ainda não as possui.
   Consequência: erro ao abrir ACV e LCC, ao salvar ICV/estudos e ao iniciar um
   apontamento de tempo.

   Correção: recria apenas as coleções AUSENTES, vazias, com a mesma regra dos
   módulos originais. Não cria, altera nem remove registros e não muda cálculos
   nem telas. Os arquivos originais do frontend continuam sem alteração.
   ===================================================================== */
(function () {
  'use strict';

  // coleção -> módulo original que a cria ao carregar a página
  var COLECOES = {
    acv_estudos: 'patch_v1_1_0_acv_lcc.js',
    acv_cenarios: 'patch_v1_1_0_acv_lcc.js',
    acv_resultados: 'patch_v1_1_0_acv_lcc.js',
    acv_fatores: 'patch_v1_1_0_acv_lcc.js',
    lcc_estudos: 'patch_v1_1_0_acv_lcc.js',
    lcc_cenarios: 'patch_v1_1_0_acv_lcc.js',
    lcc_resultados: 'patch_v1_1_0_acv_lcc.js',
    acv_icv_salvos: 'patch_v1_1_3_icv_validacao.js',
    apontamento_tempos: 'patch_v1_0_19.js',
    op_pi_consumos: 'app.js / patch_v1_0_19.js',
    pi_lotes: 'app.js'
  };

  function garantirColecoes() {
    try {
      if (typeof data !== 'object' || data === null) return;
      for (var k in COLECOES) {
        if (Object.prototype.hasOwnProperty.call(COLECOES, k)) data[k] = data[k] || [];
      }
    } catch (e) {
      console.warn('MES LION: correção de coleções', e);
    }
  }

  window.mesGarantirColecoes = garantirColecoes;

  // Página recarregada com sessão: o estado do servidor já está em "data".
  garantirColecoes();

  // Login: o estado do servidor substitui "data" e o sistema é iniciado (boot).
  var bootAnterior = window.boot;
  if (typeof bootAnterior === 'function') {
    window.boot = function () {
      garantirColecoes();
      return bootAnterior.apply(this, arguments);
    };
  }

  // "Restaurar dados iniciais" e importações também substituem "data" e depois
  // desenham uma tela: a verificação roda antes de cada tela.
  var renderAnterior = window.render;
  if (typeof renderAnterior === 'function') {
    window.render = function () {
      garantirColecoes();
      return renderAnterior.apply(this, arguments);
    };
  }
})();
