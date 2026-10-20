/**
 * IThermalPrinterPort.js — Interface canônica do driver de impressão térmica ESC/POS
 * Padrão Hexagonal / Clean Architecture para BarGestão.
 */
export class IThermalPrinterPort {
  /**
   * Conecta à porta serial do dispositivo (ex.: USB-Serial a 115200 bps)
   * @returns {Promise<boolean>}
   */
  async connect() {
    throw new Error('Método connect() não implementado');
  }

  /**
   * Desconecta e libera a porta
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error('Método disconnect() não implementado');
  }

  /**
   * Verifica se a impressora está conectada e pronta para transmissão
   * @returns {boolean}
   */
  isConnected() {
    throw new Error('Método isConnected() não implementado');
  }

  /**
   * Imprime buffer binário bruto ou comanda formatada
   * @param {Uint8Array|string} data
   * @returns {Promise<boolean>}
   */
  async print(data) {
    throw new Error('Método print() não implementado');
  }

  /**
   * Imprime cupom de pedido/comanda com comandos ESC/POS e corte de guilhotina
   * @param {object} dadosComanda
   * @returns {Promise<boolean>}
   */
  async printOrderReceipt(dadosComanda) {
    throw new Error('Método printOrderReceipt() não implementado');
  }

  /**
   * Imprime cupom de fechamento de caixa diário ou mensal com corte de guilhotina
   * @param {object} dadosFechamento
   * @returns {Promise<boolean>}
   */
  async printCashClosingReceipt(dadosFechamento) {
    throw new Error('Método printCashClosingReceipt() não implementado');
  }
}
