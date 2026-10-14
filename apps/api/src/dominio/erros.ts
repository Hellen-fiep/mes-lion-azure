/** Estado do MES (ou arquivo de banco) inválido: vira HTTP 400 com a mensagem. */
export class EstadoInvalidoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'EstadoInvalidoError';
  }
}

/** Erro de configuração ou de preparação do ambiente (banco, pastas, credenciais). */
export class ConfiguracaoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ConfiguracaoError';
  }
}
