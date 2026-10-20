import { IThermalPrinterPort } from '../../domain/interfaces/IThermalPrinterPort.js';

/**
 * WebSerialPrinterAdapter.js — Driver Web Serial ESC/POS para impressão térmica direta (115200 bps)
 * Elimina o diálogo nativo do navegador e envia comandos binários diretamente para a guilhotina e cabeça térmica.
 */
export class WebSerialPrinterAdapter extends IThermalPrinterPort {
  _port = null;
  _writer = null;
  _baudRate = 115200;

  // Comandos canônicos ESC/POS
  static CMD = {
    INIT: new Uint8Array([0x1B, 0x40]),                        // ESC @ (Inicializa impressora)
    ALIGN_LEFT: new Uint8Array([0x1B, 0x61, 0x00]),            // ESC a 0 (Alinha à esquerda)
    ALIGN_CENTER: new Uint8Array([0x1B, 0x61, 0x01]),          // ESC a 1 (Centraliza)
    ALIGN_RIGHT: new Uint8Array([0x1B, 0x61, 0x02]),           // ESC a 2 (Alinha à direita)
    BOLD_ON: new Uint8Array([0x1B, 0x45, 0x01]),               // ESC E 1 (Negrito ligado)
    BOLD_OFF: new Uint8Array([0x1B, 0x45, 0x00]),              // ESC E 0 (Negrito desligado)
    DOUBLE_SIZE: new Uint8Array([0x1D, 0x21, 0x11]),           // GS ! 0x11 (Largura e altura duplas)
    NORMAL_SIZE: new Uint8Array([0x1D, 0x21, 0x00]),           // GS ! 0x00 (Fonte normal)
    FEED_3_LINES: new Uint8Array([0x1B, 0x64, 0x03]),          // ESC d 3 (Avança 3 linhas)
    CUT_PAPER: new Uint8Array([0x1D, 0x56, 0x42, 0x00])        // GS V 66 0 (Corte completo / Guilhotina)
  };

  constructor(baudRate = 115200) {
    super();
    this._baudRate = baudRate;
  }

  isSupported() {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  isConnected() {
    return Boolean(this._port && this._port.writable);
  }

  async connect() {
    if (!this.isSupported()) {
      throw new Error('A API Web Serial não é suportada neste navegador.');
    }

    try {
      this._port = await navigator.serial.requestPort();
      await this._port.open({ baudRate: this._baudRate });
      this._writer = this._port.writable.getWriter();
      // Inicializa impressora
      await this._writer.write(WebSerialPrinterAdapter.CMD.INIT);
      return true;
    } catch (err) {
      this._port = null;
      this._writer = null;
      throw new Error(`Falha ao conectar à impressora serial: ${err.message}`);
    }
  }

  async disconnect() {
    try {
      if (this._writer) {
        await this._writer.close();
        this._writer = null;
      }
      if (this._port) {
        await this._port.close();
        this._port = null;
      }
    } catch (_) {}
  }

  async print(data) {
    if (!this.isConnected()) {
      await this.connect();
    }

    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    await this._writer.write(bytes);
    return true;
  }

  /**
   * Constrói e imprime comanda formatada com corte de guilhotina
   */
  async printOrderReceipt(pedido, estabelecimento = 'BarGestão') {
    const encoder = new TextEncoder();
    const chunks = [];

    const append = (cmd) => chunks.push(cmd);
    const appendText = (text) => chunks.push(encoder.encode(text));

    append(WebSerialPrinterAdapter.CMD.INIT);
    append(WebSerialPrinterAdapter.CMD.ALIGN_CENTER);
    append(WebSerialPrinterAdapter.CMD.DOUBLE_SIZE);
    append(WebSerialPrinterAdapter.CMD.BOLD_ON);
    appendText(`${estabelecimento.toUpperCase()}\n`);
    append(WebSerialPrinterAdapter.CMD.NORMAL_SIZE);
    append(WebSerialPrinterAdapter.CMD.BOLD_OFF);
    appendText(`Comprovante de Atendimento\n`);
    appendText(`------------------------------------------------\n`);

    append(WebSerialPrinterAdapter.CMD.ALIGN_LEFT);
    appendText(`Comanda / Mesa: ${pedido.mesa || 'Balcão'}\n`);
    appendText(`Cliente: ${pedido.clienteNome || 'Cliente'}\n`);
    appendText(`Data: ${new Date(pedido.abertoEm || Date.now()).toLocaleString('pt-BR')}\n`);
    appendText(`Garçom/Operador: ${pedido.garcom || 'Operador'}\n`);
    appendText(`------------------------------------------------\n`);
    appendText(`ITEM                    QTD     PRECO      TOTAL\n`);
    appendText(`------------------------------------------------\n`);

    const itens = pedido.itens || [];
    itens.forEach(item => {
      const nome = (item.nome || item.produtoId || 'Produto').padEnd(20).slice(0, 20);
      const qtd = String(item.quantidade || 1).padStart(4);
      const preco = `R$ ${(item.precoUnitario || 0).toFixed(2)}`.padStart(10);
      const totalItem = `R$ ${(item.subtotal || ((item.quantidade || 1) * (item.precoUnitario || 0))).toFixed(2)}`.padStart(11);
      appendText(`${nome} ${qtd} ${preco} ${totalItem}\n`);
    });

    appendText(`------------------------------------------------\n`);
    append(WebSerialPrinterAdapter.CMD.ALIGN_RIGHT);
    append(WebSerialPrinterAdapter.CMD.BOLD_ON);
    appendText(`TOTAL: R$ ${(pedido.total || 0).toFixed(2)}\n`);
    if (pedido.desconto) {
      appendText(`DESCONTO: R$ ${(pedido.desconto || 0).toFixed(2)}\n`);
    }
    if (pedido.valorPago) {
      appendText(`VALOR RECEBIDO: R$ ${(pedido.valorPago || 0).toFixed(2)}\n`);
    }
    if (pedido.troco) {
      appendText(`TROCO: R$ ${(pedido.troco || 0).toFixed(2)}\n`);
    }
    append(WebSerialPrinterAdapter.CMD.BOLD_OFF);

    append(WebSerialPrinterAdapter.CMD.ALIGN_CENTER);
    appendText(`\nObrigado pela preferência!\n`);
    append(WebSerialPrinterAdapter.CMD.FEED_3_LINES);
    append(WebSerialPrinterAdapter.CMD.CUT_PAPER);

    // Concatena todos os chunks binários
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    if (this.isSupported() && this.isConnected()) {
      await this._writer.write(merged);
    }
    return merged;
  }

  /**
   * Constrói e imprime comprovante de Fechamento de Caixa com corte guilhotina
   */
  async printCashClosingReceipt(fechamento, estabelecimento = 'BarGestão') {
    const encoder = new TextEncoder();
    const chunks = [];

    const append = (cmd) => chunks.push(cmd);
    const appendText = (text) => chunks.push(encoder.encode(text));

    append(WebSerialPrinterAdapter.CMD.INIT);
    append(WebSerialPrinterAdapter.CMD.ALIGN_CENTER);
    append(WebSerialPrinterAdapter.CMD.DOUBLE_SIZE);
    append(WebSerialPrinterAdapter.CMD.BOLD_ON);
    appendText(`${estabelecimento.toUpperCase()}\n`);
    append(WebSerialPrinterAdapter.CMD.NORMAL_SIZE);
    append(WebSerialPrinterAdapter.CMD.BOLD_OFF);
    appendText(`FECHAMENTO DE CAIXA (${(fechamento.tipo || 'DIARIO').toUpperCase()})\n`);
    appendText(`------------------------------------------------\n`);

    append(WebSerialPrinterAdapter.CMD.ALIGN_LEFT);
    appendText(`ID: ${fechamento.id}\n`);
    appendText(`Data: ${new Date(fechamento.data || Date.now()).toLocaleString('pt-BR')}\n`);
    appendText(`Responsável: ${fechamento.operador || 'Operador'}\n`);
    appendText(`------------------------------------------------\n`);
    appendText(`RESUMO FINANCEIRO\n`);
    appendText(`Total Vendas Faturadas:   R$ ${(fechamento.totalVendas || 0).toFixed(2)}\n`);
    appendText(`Total Retiradas/Sangrias: R$ ${(fechamento.totalRetiradas || 0).toFixed(2)}\n`);
    appendText(`Saldo Líquido Operado:    R$ ${((fechamento.totalVendas || 0) - (fechamento.totalRetiradas || 0)).toFixed(2)}\n`);
    appendText(`------------------------------------------------\n`);
    appendText(`DETALHAMENTO POR MODALIDADE\n`);
    if (fechamento.totaisPorForma) {
      appendText(`- Dinheiro:      R$ ${(fechamento.totaisPorForma.dinheiro || 0).toFixed(2)}\n`);
      appendText(`- PIX:           R$ ${(fechamento.totaisPorForma.pix || 0).toFixed(2)}\n`);
      appendText(`- Débito:        R$ ${(fechamento.totaisPorForma.cartao_debito || 0).toFixed(2)}\n`);
      appendText(`- Crédito:       R$ ${(fechamento.totaisPorForma.cartao_credito || 0).toFixed(2)}\n`);
    }
    appendText(`------------------------------------------------\n`);
    append(WebSerialPrinterAdapter.CMD.BOLD_ON);
    appendText(`Dinheiro Esperado na Gaveta: R$ ${(fechamento.dinheiroEsperado || 0).toFixed(2)}\n`);
    appendText(`Dinheiro Contado Fisicamente: R$ ${(fechamento.dinheiroContado || 0).toFixed(2)}\n`);
    const dif = fechamento.diferenca || 0;
    appendText(`DIFERENÇA APURADA:           R$ ${dif.toFixed(2)} ${dif === 0 ? '(EXATO)' : dif > 0 ? '(SOBRA)' : '(FALTA)'}\n`);
    append(WebSerialPrinterAdapter.CMD.BOLD_OFF);

    if (fechamento.observacoes) {
      appendText(`\nObservações: ${fechamento.observacoes}\n`);
    }

    append(WebSerialPrinterAdapter.CMD.FEED_3_LINES);
    append(WebSerialPrinterAdapter.CMD.CUT_PAPER);

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    if (this.isSupported() && this.isConnected()) {
      await this._writer.write(merged);
    }
    return merged;
  }
}
