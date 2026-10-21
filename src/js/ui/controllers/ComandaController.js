/**
 * Controller de UI: comanda da mesa em tela cheia (v3.1.0).
 * Lançar, corrigir e receber na mesma tela. Regras de negócio continuam no OrderService;
 * este controller só fala com o app por `this._app` (estado, serviços e commit transacional).
 *
 * Navegação: abrir empilha uma entrada no histórico; o botão voltar do Android (popstate)
 * e o botão da tela fecham a comanda e voltam à lista de mesas, sem fechar o app.
 */
export class ComandaController {
  _app;
  _table = null;          // chave da mesa aberta (ex.: "Mesa 05", "Balcão"); null = nova comanda sem mesa definida
  _visible = false;
  _pushed = false;        // entrada de histórico empilhada por open()
  _payOpen = false;
  _category = '';
  _cancelling = null;
  _editingClient = null;
  _total = 0;

  constructor(app) {
    this._app = app;
  }

  get isOpen() { return this._visible; }
  get currentTable() { return this._table; }

  bind() {
    const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);
    on('cmd-voltar', 'click', () => this.close());
    on('cmd-editar-cliente', 'click', () => this._editClient());
    on('cmd-busca', 'input', () => this._renderProducts());
    on('cmd-receber', 'click', () => this._onReceber());
    on('cmd-pagamento-voltar', 'click', () => this._togglePay(false));
    on('cmd-forma', 'change', () => this._syncTroco());
    on('cmd-valor-final', 'input', () => this._syncTroco());
    on('cmd-valor-recebido', 'input', () => this._syncTroco());
    on('cmd-imprimir', 'click', () => this._printReceipt());
    on('form-cancelar-item', 'submit', e => this._submitCancel(e));
    on('form-editar-cliente', 'submit', e => this._submitClient(e));
    window.addEventListener('popstate', () => this._onPopState());
  }

  // ---------------------------------------------------------------- abrir / fechar

  /** Abre a comanda de uma mesa já aberta. */
  open(tableName) {
    this._table = tableName;
    this._show();
  }

  /** Nova comanda: pede número da mesa e cliente na própria tela. */
  openNew() {
    // Mesas desabilitadas pela Governança: o atendimento vira venda no balcão
    if (this._app._governanceCtl?.allowsTables?.() === false) {
      this.openCounter();
      return;
    }
    this._table = null;
    const num = document.getElementById('cmd-numero');
    const cli = document.getElementById('cmd-cliente');
    if (num) num.value = '';
    if (cli) cli.value = '';
    this._show();
    document.getElementById('cmd-numero')?.focus({ preventScroll: true });
  }

  /** Venda de balcão (quando a governança não libera mesas). */
  openCounter() {
    this._table = 'Balcão';
    this._show();
  }

  _show() {
    this._payOpen = false;
    this._category = '';
    const search = document.getElementById('cmd-busca');
    if (search) search.value = '';
    if (!this._visible) {
      this._visible = true;
      try { history.pushState({ comanda: true }, ''); this._pushed = true; } catch (_) { this._pushed = false; }
    }
    document.getElementById('tab-comanda')?.classList.remove('hidden');
    this.render();
    const body = document.querySelector('#tab-comanda .cmd-body');
    if (body) body.scrollTop = 0;
  }

  /** Fecha pela UI: consome a entrada de histórico (o popstate esconde a tela). */
  close() {
    if (!this._visible) return;
    if (this._pushed) {
      this._pushed = false;
      try { history.back(); } catch (_) { this._hide(); }
    } else {
      this._hide();
    }
  }

  _onPopState() {
    if (!this._visible) return;
    this._pushed = false;
    this._hide();
  }

  _hide() {
    this._visible = false;
    this._payOpen = false;
    this._table = null;
    this._cancelling = null;
    document.getElementById('tab-comanda')?.classList.add('hidden');
    document.getElementById('cmd-pagamento')?.classList.add('hidden');
  }

  /** Sessão encerrada/bloqueada: some com a tela sem mexer no histórico. */
  reset() {
    this._hide();
    this._pushed = false;
  }

  // ---------------------------------------------------------------- render

  _items() {
    const data = this._app._data;
    return (this._table && data?.mesas?.[this._table]) || [];
  }

  render() {
    if (!this._visible || !this._app._data) return;
    const data = this._app._data;
    const items = this._items();
    const money = v => this._app._renderer.money(v);
    const exists = Boolean(this._table && Object.hasOwn(data.mesas || {}, this._table));
    const isCounter = Boolean(this._table && this._app._order.isCounterTable(this._table));

    // Cabeçalho
    const novo = document.getElementById('cmd-novo');
    novo?.classList.toggle('hidden', Boolean(this._table));
    document.getElementById('cmd-editar-cliente')?.classList.toggle('hidden', !exists);
    if (this._table) {
      const cliente = data.mesaClientes?.[this._table] || (isCounter ? 'Cliente Balcão' : 'Cliente não informado');
      this._app.setText('cmd-titulo', this._table);
      this._app.setText('cmd-subtitulo', `Cliente: ${cliente}`);
    } else {
      this._app.setText('cmd-titulo', 'Nova comanda');
      this._app.setText('cmd-subtitulo', 'Informe a mesa e o cliente para começar');
    }

    // Itens
    const total = this._app._order.calculateOrderTotal(items);
    this._app.setText('cmd-itens-count', `${items.length} ${items.length === 1 ? 'item' : 'itens'}`);
    this._app.setText('cmd-total', money(total));
    const list = document.getElementById('cmd-itens');
    if (list) {
      list.replaceChildren();
      if (!items.length) list.append(this._app._renderer.empty('Nenhum item lançado. Toque em um produto abaixo para adicionar.'));
      for (const item of items) list.append(this._itemRow(item));
    }

    const receber = document.getElementById('cmd-receber');
    if (receber) {
      receber.disabled = !items.length;
      receber.textContent = this._payOpen ? 'Confirmar recebimento' : 'Receber';
    }
    if (!items.length && this._payOpen) this._togglePay(false);

    this._renderChips();
    this._renderProducts();
  }

  _itemRow(item) {
    const r = this._app._renderer;
    const row = r.make('div', 'cmd-item');
    const info = r.make('div', 'cmd-item-info');
    info.append(
      r.make('strong', '', item.nome),
      r.make('span', '', `${r.money(item.precoUnit)} cada • Total: ${r.money(item.total)}`)
    );

    const minus = r.btn('', () => this._changeQty(item, -1), 'cmd-qty-btn');
    minus.setAttribute('aria-label', `Diminuir ${item.nome}`);
    minus.append(r.icon('i-minus'));
    const qty = r.make('span', 'cmd-qty', String(item.qtd));
    const plus = r.btn('', () => this._changeQty(item, 1), 'cmd-qty-btn');
    plus.setAttribute('aria-label', `Aumentar ${item.nome}`);
    plus.append(r.icon('i-plus'));
    const del = r.btn('', () => this._askCancel(item), 'cmd-qty-btn danger');
    del.setAttribute('aria-label', `Cancelar ${item.nome}`);
    del.append(r.icon('i-trash'));

    const ctrl = r.make('div', 'cmd-item-ctrl');
    ctrl.append(minus, qty, plus, del);
    row.append(info, ctrl);
    return row;
  }

  _renderChips() {
    const root = document.getElementById('cmd-chips');
    if (!root) return;
    root.replaceChildren();
    const cats = this._app._data?.categorias || [];
    const make = (label, value) => {
      const chip = this._app._renderer.btn(label, () => {
        this._category = value;
        this._renderChips();
        this._renderProducts();
      }, `category-chip${this._category === value ? ' selected' : ''}`);
      return chip;
    };
    root.append(make('Todas', ''));
    for (const c of cats) root.append(make(c, c));
  }

  _renderProducts() {
    const root = document.getElementById('cmd-produtos');
    if (!root || !this._app._data) return;
    root.replaceChildren();
    const r = this._app._renderer;
    const query = document.getElementById('cmd-busca')?.value || '';
    const products = this._app._stock.findProducts(this._app._data.produtos || [], query, this._category);
    this._app.setText('cmd-resultados', `${products.length} produto${products.length === 1 ? '' : 's'}`);

    const inOrder = new Map();
    for (const it of this._items()) inOrder.set(String(it.produtoId), (inOrder.get(String(it.produtoId)) || 0) + Number(it.qtd));

    if (!products.length) {
      root.append(r.empty('Nenhum produto encontrado.'));
      return;
    }
    for (const p of products) {
      const card = r.btn('', () => this._addProduct(p), 'product-choice');
      card.disabled = !(p.qtd > 0);
      card.setAttribute('aria-label', `Adicionar ${p.nome}`);
      card.append(
        r.make('strong', '', p.nome),
        r.make('small', '', p.qtd > 0 ? `Estoque: ${p.qtd} un.` : 'Sem estoque'),
        r.make('span', 'price', r.money(p.venda))
      );
      const n = inOrder.get(String(p.id));
      if (n) card.append(r.make('span', 'cmd-badge', `×${n}`));
      root.append(card);
    }
  }

  // ---------------------------------------------------------------- lançar / corrigir

  /** Descobre mesa e cliente de destino do lançamento. Retorna null (com aviso) se faltar dado. */
  _target() {
    const order = this._app._order;
    if (this._table) {
      const isOpen = Object.hasOwn(this._app._data.mesas || {}, this._table);
      const client = isOpen ? undefined : (order.isCounterTable(this._table) ? 'Cliente Balcão' : '');
      return { table: this._table, client, isNew: !isOpen };
    }
    const num = Number(document.getElementById('cmd-numero')?.value);
    if (!Number.isInteger(num) || num < 1 || num > 9999) {
      this._app._renderer.toast('Informe o número da mesa (1 a 9999).');
      return null;
    }
    const table = order.resolveTableName(this._app._data, num);
    const isOpen = Object.hasOwn(this._app._data.mesas || {}, table);
    const client = document.getElementById('cmd-cliente')?.value.trim() || '';
    if (!isOpen && !client) {
      this._app._renderer.toast('Informe o nome do cliente para abrir a comanda.');
      return null;
    }
    return { table, client: isOpen ? undefined : client, isNew: !isOpen };
  }

  async _addProduct(product) {
    const target = this._target();
    if (!target) return false;
    const user = this._app._auth.getSession().usuario;
    // Mesmo produto e mesmo preço já na comanda: soma 1 na linha existente (evita 5 linhas "× 1")
    const existing = target.isNew ? null : (this._app._data.mesas[target.table] || [])
      .find(i => String(i.produtoId) === String(product.id) && Number(i.precoUnit) === Number(product.venda));
    const ok = await this._app._commit(draft => {
      if (existing) {
        this._app._order.updateOrderItemQuantity(draft, target.table, existing.id, Number(existing.qtd) + 1, user);
      } else {
        this._app._order.addOrderItem(draft, target.table, target.client, product.id, 1, user);
      }
    }, 'Inclusão de pedido em comanda');
    if (ok) {
      this._table = target.table;
      this.render();
    }
    return ok;
  }

  async _changeQty(item, delta) {
    const next = Number(item.qtd) + delta;
    if (next <= 0) {
      this._askCancel(item);
      return false;
    }
    const user = this._app._auth.getSession().usuario;
    const table = this._table;
    return this._app._commit(draft => {
      this._app._order.updateOrderItemQuantity(draft, table, item.id, next, user);
    }, 'Ajuste de quantidade na comanda');
  }

  // ---------------------------------------------------------------- cancelar item (gerente e vendedor)

  _askCancel(item) {
    this._cancelling = { table: this._table, itemId: item.id };
    this._app.setText('cancel-item-label', `${item.qtd} × ${item.nome}`);
    this._app.setText('cancel-item-value', this._app._renderer.money(item.total));
    const reason = document.getElementById('cancel-reason');
    if (reason) reason.value = '';
    this._app._renderer._openModal('modal-cancelamento', 'cancel-reason');
  }

  async _submitCancel(event) {
    event.preventDefault();
    const pending = this._cancelling;
    if (!pending) {
      this._app._renderer._closeModal('modal-cancelamento');
      return false;
    }
    const reason = document.getElementById('cancel-reason')?.value?.trim() || '';
    const session = this._app._auth.getSession();
    const ok = await this._app._commit(draft => {
      this._app._order.cancelOrderItemWithRole(draft, pending.table, pending.itemId, reason, session.usuario, session.perfil);
    }, 'Cancelamento de item de comanda');
    if (ok) {
      this._cancelling = null;
      this._app._renderer._closeModal('modal-cancelamento');
      this._app._renderer.toast('Item cancelado e devolvido ao estoque.');
      // Última item cancelado: a mesa deixa de existir; volta para a lista de mesas
      if (this._table && !Object.hasOwn(this._app._data.mesas || {}, this._table)) this.close();
    }
    return ok;
  }

  // ---------------------------------------------------------------- cliente

  _editClient() {
    if (!this._table) return;
    this._editingClient = this._table;
    const input = document.getElementById('editar-cliente-input');
    if (input) input.value = this._app._data.mesaClientes?.[this._table] || '';
    this._app._renderer._openModal('modal-cliente', 'editar-cliente-input');
  }

  async _submitClient(event) {
    event.preventDefault();
    const nome = document.getElementById('editar-cliente-input')?.value.trim() || '';
    const table = this._editingClient;
    const ok = await this._app._commit(draft => {
      this._app._order.updateClientName(draft, table, nome);
    }, 'Edição do nome de cliente de comanda');
    if (ok) {
      this._app._renderer._closeModal('modal-cliente');
      this._app._renderer.toast('Nome do cliente atualizado.');
    }
    return ok;
  }

  // ---------------------------------------------------------------- receber

  _onReceber() {
    if (!this._items().length) return;
    if (!this._payOpen) {
      this._togglePay(true);
      return;
    }
    this._confirmPay();
  }

  _togglePay(open) {
    this._payOpen = open;
    document.getElementById('cmd-pagamento')?.classList.toggle('hidden', !open);
    const receber = document.getElementById('cmd-receber');
    if (receber) receber.textContent = open ? 'Confirmar recebimento' : 'Receber';
    if (open) {
      this._total = this._app._order.calculateOrderTotal(this._items());
      const final = document.getElementById('cmd-valor-final');
      const recebido = document.getElementById('cmd-valor-recebido');
      if (final) final.value = this._total.toFixed(2);
      if (recebido) recebido.value = this._total.toFixed(2);
      this._syncTroco();
    }
  }

  _amounts() {
    const total = this._total || this._app._order.calculateOrderTotal(this._items());
    const finalInput = document.getElementById('cmd-valor-final');
    const recInput = document.getElementById('cmd-valor-recebido');
    const cobrado = finalInput && finalInput.value !== '' ? Number(finalInput.value) : total;
    const recebido = recInput && recInput.value !== '' ? Number(recInput.value) : cobrado;
    const troco = Math.max(0, Math.round((recebido - cobrado + Number.EPSILON) * 100) / 100);
    const desconto = Math.max(0, Math.round((total - cobrado + Number.EPSILON) * 100) / 100);
    return { total, cobrado, recebido, troco, desconto };
  }

  _syncTroco() {
    const { troco, desconto } = this._amounts();
    const forma = document.getElementById('cmd-forma')?.value;
    const money = v => this._app._renderer.money(v);
    this._app.setText('cmd-troco', forma === 'dinheiro' || troco > 0 ? `Troco a devolver: ${money(troco)}` : `Troco: ${money(0)}`);
    this._app.setText('cmd-desconto', desconto > 0 ? `Desconto: ${money(desconto)}` : '');
  }

  async _confirmPay() {
    const table = this._table;
    const forma = document.getElementById('cmd-forma')?.value || 'pix';
    const { cobrado, recebido } = this._amounts();
    if (!Number.isFinite(cobrado) || cobrado < 0 || !Number.isFinite(recebido) || recebido < 0) {
      this._app._renderer.toast('Informe valores válidos para cobrar e receber.');
      return false;
    }
    const session = this._app._auth.getSession();
    const shift = this._app._shift.getActiveShift(this._app._data);
    const ok = await this._app._commit(draft => {
      this._app._order.receiveTable(draft, table, forma, session.usuario, shift?.id || null, { valorFinal: cobrado, valorRecebido: recebido });
    }, 'Fechamento e quitação de mesa');
    if (ok) {
      this._app._renderer.toast('Comanda recebida com sucesso e registrada no caixa.');
      this.close();
    }
    return ok;
  }

  async _printReceipt() {
    const mesa = this._table;
    const items = this._items();
    if (!mesa || !items.length) {
      this._app._renderer.toast('Nenhuma comanda ativa selecionada para impressão.');
      return;
    }
    const { cobrado, recebido, troco } = this._amounts();
    const estabelecimento = this._app._governance?.getRecord()?.nomeEstabelecimento || 'BarGestão';
    const pedido = {
      mesa,
      clienteNome: this._app._data.mesaClientes?.[mesa] || 'Cliente',
      abertoEm: Date.now(),
      garcom: this._app._auth.getSession()?.usuario || 'Operador',
      itens: items,
      total: cobrado,
      valorPago: recebido,
      troco
    };
    try {
      await this._app._printer.printOrderReceipt(pedido, estabelecimento);
      this._app._renderer.toast('Comprovante enviado para a impressora térmica.');
    } catch (err) {
      this._app._renderer.toast(`Impressão térmica: ${err.message}`);
    }
  }
}
