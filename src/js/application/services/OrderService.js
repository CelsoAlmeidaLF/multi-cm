import { OrderItem } from '../../domain/entities/OrderItem.js';
import { StockMovement } from '../../domain/entities/StockMovement.js';

/**
 * Serviço de Aplicação: Gestão de Comandas, Pedidos e Mesas
 */
export class OrderService {
  _pad(n) {
    return String(n).padStart(2, '0');
  }

  isCounterTable(tablename) {
    return /^Balc[aã]o/i.test(String(tablename || '').trim());
  }

  nameForTable(num) {
    if (typeof num === 'string' && this.isCounterTable(num)) return 'Balcão';
    return `Mesa ${this._pad(num)}`;
  }

  resolveTableName(database, num) {
    if (typeof num === 'string' && this.isCounterTable(num)) {
      return 'Balcão';
    }
    const regex = /^Mesa\s*0*(\d+)$/i;
    const match = Object.keys(database.mesas || {}).find(s => {
      const m = s.match(regex);
      return m && Number(m[1]) === num;
    });
    return match || this.nameForTable(num);
  }

  tableNumberFromKey(name) {
    if (this.isCounterTable(name)) return 'Balcão';
    const match = String(name).match(/^Mesa\s*0*(\d+)$/i);
    return match ? Number(match[1]) : NaN;
  }

  calculateOrderTotal(items) {
    const sum = (items || []).reduce((acc, i) => acc + Number(i.total || 0), 0);
    return Math.round((sum + Number.EPSILON) * 100) / 100;
  }

  addOrderItem(database, tablename, clientname, productid, qtd, username) {
    const prod = (database.produtos || []).find(p => String(p.id) === String(productid) && p.ativo !== false);
    if (!prod) throw new Error('Produto indisponível.');
    if (!Number.isSafeInteger(qtd) || qtd <= 0) throw new Error('Quantidade inválida.');
    if (prod.qtd < qtd) throw new Error(`Estoque insuficiente. Saldo disponível: ${prod.qtd} un.`);

    const antes = prod.qtd;
    prod.qtd -= qtd;

    if (!Object.hasOwn(database.mesas, tablename)) {
      database.mesas[tablename] = [];
    }
    const defaultClient = this.isCounterTable(tablename) ? 'Cliente Balcão' : 'Cliente não informado';
    database.mesaClientes[tablename] = database.mesaClientes[tablename] || clientname || defaultClient;

    const item = new OrderItem({
      produtoId: prod.id,
      nome: prod.nome,
      precoUnit: prod.venda,
      custoUnit: prod.compra,
      qtd,
      total: Math.round((prod.venda * qtd + Number.EPSILON) * 100) / 100,
      data: new Date().toISOString()
    });
    database.mesas[tablename].push(item.toJSON());

    const mov = new StockMovement({
      produtoId: prod.id,
      produtoNome: prod.nome,
      tipo: 'Venda',
      delta: -qtd,
      antes,
      depois: prod.qtd,
      motivo: this.isCounterTable(tablename) ? 'Venda Balcão' : `Comanda ${tablename}`,
      usuario: username || 'Sistema'
    });
    (database.movimentacoesEstoque ||= []).unshift(mov.toJSON());
    return item.toJSON();
  }

  createCounterSale(database, itemsList, formapagamento, username, shiftid = null, options = {}) {
    if (!Array.isArray(itemsList) || itemsList.length === 0) {
      throw new Error('Lista de itens de venda balcão está vazia.');
    }
    const tablename = 'Balcão';
    const client = options.cliente || 'Cliente Balcão';
    const addedItems = [];

    for (const it of itemsList) {
      const added = this.addOrderItem(database, tablename, client, it.produtoId, it.qtd, username);
      addedItems.push(added);
    }

    return this.receiveTable(database, tablename, formapagamento, username, shiftid, options);
  }

  cancelOrderItemWithRole(database, tablename, itemid, reason, username, role = 'gerente') {
    if (role !== 'gerente') {
      throw new Error('Acesso negado: cancelamento de item exige perfil de gerente.');
    }
    return this.cancelOrderItem(database, tablename, itemid, reason, username);
  }

  cancelOrderItem(database, tablename, itemid, reason, username) {
    const items = database.mesas[tablename];
    if (!items?.length) throw new Error('Comanda não possui itens.');

    const idx = items.findIndex(i => String(i.id) === String(itemid));
    if (idx < 0) throw new Error('Item não encontrado na comanda.');

    const [item] = items.splice(idx, 1);
    const prod = database.produtos.find(p => String(p.id) === String(item.produtoId));
    if (prod) {
      const antes = prod.qtd;
      prod.qtd += Number(item.qtd);
      prod.ultimoMovimentoEm = new Date().toISOString();
      const mov = new StockMovement({
        produtoId: prod.id,
        produtoNome: prod.nome,
        tipo: 'Cancelamento',
        delta: Number(item.qtd),
        antes,
        depois: prod.qtd,
        motivo: `Comanda ${tablename} · ${reason}`,
        usuario: username || 'Sistema'
      });
      (database.movimentacoesEstoque ||= []).unshift(mov.toJSON());
    }

    (database.cancelamentos ||= []).unshift({
      id: crypto.randomUUID(),
      mesa: tablename,
      cliente: database.mesaClientes[tablename],
      item: structuredClone(item),
      motivo: reason,
      data: new Date().toISOString(),
      usuario: username
    });

    if (!items.length) {
      delete database.mesas[tablename];
      delete database.mesaClientes[tablename];
    }
  }

  updateClientName(database, tablename, novocliente) {
    if (!Object.hasOwn(database.mesas, tablename)) throw new Error('Mesa não encontrada.');
    if (!novocliente || novocliente.trim().length > 90) throw new Error('Nome do cliente deve ter até 90 caracteres.');
    database.mesaClientes[tablename] = novocliente.trim();
  }

  updateOrderItemQuantity(database, tablename, itemid, novaQtd, username) {
    const items = database.mesas[tablename];
    if (!items?.length) throw new Error('Comanda não possui itens.');

    const item = items.find(i => String(i.id) === String(itemid));
    if (!item) throw new Error('Item não encontrado na comanda.');

    if (!Number.isSafeInteger(novaQtd) || novaQtd <= 0) {
      throw new Error('Quantidade inválida para atualização.');
    }

    const prod = (database.produtos || []).find(p => String(p.id) === String(item.produtoId));
    const delta = novaQtd - Number(item.qtd);

    if (delta > 0 && prod) {
      if (prod.qtd < delta) {
        throw new Error(`Estoque insuficiente para acréscimo. Disponível: ${prod.qtd} un.`);
      }
      const antes = prod.qtd;
      prod.qtd -= delta;
      (database.movimentacoesEstoque ||= []).unshift(new StockMovement({
        produtoId: prod.id,
        produtoNome: prod.nome,
        tipo: 'Venda',
        delta: -delta,
        antes,
        depois: prod.qtd,
        motivo: `Correção Comanda ${tablename} (Acréscimo)`,
        usuario: username || 'Sistema'
      }).toJSON());
    } else if (delta < 0 && prod) {
      const dev = Math.abs(delta);
      const antes = prod.qtd;
      prod.qtd += dev;
      (database.movimentacoesEstoque ||= []).unshift(new StockMovement({
        produtoId: prod.id,
        produtoNome: prod.nome,
        tipo: 'Cancelamento',
        delta: dev,
        antes,
        depois: prod.qtd,
        motivo: `Correção Comanda ${tablename} (Redução)`,
        usuario: username || 'Sistema'
      }).toJSON());
    }

    item.qtd = novaQtd;
    item.total = Math.round((Number(item.precoUnit) * novaQtd + Number.EPSILON) * 100) / 100;
    return item;
  }

  removeOrderItem(database, tablename, itemid, reason, username) {
    return this.cancelOrderItem(database, tablename, itemid, reason || 'Correção de pedido incorreto', username);
  }

  receiveTable(database, tablename, formapagamento, username, shiftid = null, options = {}) {
    const items = database.mesas[tablename];
    if (!items?.length) throw new Error('Mesa indisponível ou vazia.');

    const totalOriginal = this.calculateOrderTotal(items);
    const valorCobrado = (options.valorFinal !== undefined && Number(options.valorFinal) >= 0)
      ? Math.round((Number(options.valorFinal) + Number.EPSILON) * 100) / 100
      : totalOriginal;
    const valorRecebido = options.valorRecebido !== undefined
      ? Math.round((Number(options.valorRecebido) + Number.EPSILON) * 100) / 100
      : valorCobrado;
    const troco = Math.max(0, Math.round((valorRecebido - valorCobrado + Number.EPSILON) * 100) / 100);
    const desconto = Math.max(0, Math.round((totalOriginal - valorCobrado + Number.EPSILON) * 100) / 100);

    const cliente = database.mesaClientes[tablename] || 'Cliente não informado';
    const costKnown = items.every(i => Number.isFinite(i.custoUnit));
    const custoEstimado = costKnown ? Math.round((items.reduce((s, i) => s + (i.custoUnit || 0) * (i.qtd || 0), 0) + Number.EPSILON) * 100) / 100 : null;

    (database.caixa ||= []).unshift({
      id: crypto.randomUUID(),
      data: new Date().toISOString(),
      descricao: `Venda ${tablename} (${username})${desconto > 0 ? ` [Desc. R$ ${desconto.toFixed(2)}]` : ''}`,
      tipo: 'entrada',
      origem: 'venda',
      formaPagamento: formapagamento,
      valor: valorCobrado,
      totalOriginal,
      valorRecebido,
      troco,
      desconto,
      mesa: tablename,
      cliente,
      itens: structuredClone(items),
      custoEstimado,
      turnoId: shiftid
    });

    delete database.mesas[tablename];
    delete database.mesaClientes[tablename];
    delete (database.pagamentosParciais || {})[tablename];
    return { total: valorCobrado, totalOriginal, valorRecebido, troco, desconto, cliente };
  }

  closeTable(...args) {
    return this.receiveTable(...args);
  }

  closeOrder(...args) {
    return this.receiveTable(...args);
  }

  createDirectSale(...args) {
    return this.createCounterSale(...args);
  }

  processDirectSale(...args) {
    return this.createCounterSale(...args);
  }
}

