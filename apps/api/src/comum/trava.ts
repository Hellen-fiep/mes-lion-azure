/** Exclusão mútua assíncrona (equivalente ao SemaphoreSlim(1, 1) do .NET): uma operação por vez, em ordem. */
export class Trava {
  private fila: Promise<void> = Promise.resolve();

  async executar<T>(acao: () => Promise<T>): Promise<T> {
    let liberar!: () => void;
    const anterior = this.fila;
    this.fila = new Promise<void>((r) => (liberar = r));
    await anterior;
    try {
      return await acao();
    } finally {
      liberar();
    }
  }
}

export const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Espera que não impede o processo de terminar (laços em segundo plano e limites de tempo no encerramento). */
export const esperarEmSegundoPlano = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());
