/**
 * Controller de UI: Vendas, comandas e mesas.
 * Extraído de App.js; acessa estado, serviços e o commit transacional via `this._app`.
 */
export class SalesController {
  _app;
  _editingmesaclient = null;
  _closingmesa = null;
  _cancellingitem = null;

  constructor(app) {
    this._app = app;
  }

  bind() {
    document.getElementById('abrir-nova-mesa')?.addEventListener('click', () => this._click_new_order());
    document.getElementById('abrir-venda-balcao')?.addEventListener('click', () => this._click_counter_order());
    document.getElementById('mesas-busca')?.addEventListener('input', () => this._renderTables());
    document.getElementById('mesa-numero')?.addEventListener('input', () => this._updateTableContext());
    document.getElementById('mesa-aberta-select')?.addEventListener('change', e => this._change_table_select(e));
    document.getElementById('mesa-nova')?.addEventListener('click', () => this._click_new_order());
    document.getElementById('qtd-menos')?.addEventListener('click', () => this._stepQuantity(-1));
    document.getElementById('qtd-mais')?.addEventListener('click', () => this._stepQuantity(1));
    document.getElementById('venda-qtd')?.addEventListener('input', () => this._updateOrderPrice());
    document.getElementById('venda-busca')?.addEventListener('input', () => this._renderProductSelects());
    document.getElementById('venda-categoria')?.addEventListener('change', () => this._renderProductSelects());
    document.getElementById('form-item')?.addEventListener('submit', e => this._submit_add_item(e));
    document.getElementById('form-editar-cliente')?.addEventListener('submit', e => this._submit_edit_client(e));
    document.getElementById('form-fechar-mesa')?.addEventListener('submit', e => this._submit_close_table(e));
    document.getElementById('form-cancelar-item')?.addEventListener('submit', e => this._submit_cancel_item(e));
    document.getElementById('fechamento-valor-final')?.addEventListener('input', () => this._syncTroco());
    document.getElementById('fechamento-valor-recebido')?.addEventListener('input', () => this._syncTroco());
    document.getElementById('fechamento-pagamento')?.addEventListener('change', () => this._syncTroco());
    document.getElementById('imprimir-comanda-fiscal')?.addEventListener('click', () => this._printOrderReceipt());
  }

  async _printOrderReceipt() {
    const mesa = this._closingmesa;
    if (!mesa || !this._app._data?.mesas?.[mesa]) {
      this._app._renderer.toast('Nenhuma comanda ativa selecionada para impressão.');
      return;
    }
    const items = this._app._data.mesas[mesa] || [];
    const total = this._app._order.calculateOrderTotal(items);
    const cliente = document.getElementById('fechamento-cliente')?.textContent || 'Cliente';
    const estabelecimento = this._app._governance?.getRecord()?.nomeEstabelecimento || 'BarGestão';
    const finalVal = Number(document.getElementById('fechamento-valor-final')?.value || total);
    const recebidoVal = Number(document.getElementById('fechamento-valor-recebido')?.value || finalVal);
    const trocoVal = Math.max(0, recebidoVal - finalVal);

    const pedidoData = {
      mesa,
      clienteNome: cliente,
      abertoEm: Date.now(),
      garcom: this._app._auth.getSession()?.usuario || 'Operador',
      itens: items,
      total: finalVal,
      valorPago: recebidoVal,
      troco: trocoVal
    };

    try {
      await this._app._printer.printOrderReceipt(pedidoData, estabelecimento);
      this._app._renderer.toast('Comprovante enviado para a impressora térmica.');
    } catch (err) {
      this._app._renderer.toast(`Impressão térmica: ${err.message}`);
    }
  }

  // Mesas e comandas no BarGestão: operação sempre liberada para atendimento
  _ensureTablesAllowed(tableName = null) {
    return true;
  }

  // Seleção de mesa já aberta no modal de pedido (antes apontava para um método inexistente)
  _change_table_select(event) {
    const name = event.target.value;
    if (!name) {
      this._click_new_order();
      return;
    }
    this._chooseTable(name);
  }

  // Confirmação do cancelamento de item (antes apontava para um método inexistente)
  async _submit_cancel_item(event) {
    event.preventDefault();
    const pending = this._cancellingitem;
    const reason = document.getElementById('cancel-reason')?.value?.trim() || '';
    if (!pending) {
      this._app._renderer._closeModal('modal-cancelamento');
      return;
    }
    const session = this._app._auth.getSession();
    const ok = await this._app._commit(draft => {
      this._app._order.cancelOrderItemWithRole(draft, pending.table, pending.itemId, reason, session.usuario, session.perfil);
    }, 'Cancelamento de item de comanda');
    if (ok) {
      this._cancellingitem = null;
      this._app._renderer._closeModal('modal-cancelamento');
      this._app._renderer.toast('Item cancelado e devolvido ao estoque.');
    }
  }

  _renderTables() {
    const root = document.getElementById('lista-mesas');
    if (!root || !this._app._data) return;
    root.replaceChildren();

    const search = document.getElementById('mesas-busca')?.value.toLowerCase().trim() || '';
    const entries = Object.entries(this._app._data.mesas || {});

    const counterCount = entries.filter(([n]) => this._app._order.isCounterTable(n)).length;
    const regularCount = entries.length - counterCount;
    this._app.setText('stat-mesas', String(entries.length));
    this._app.setText('mesas-count', counterCount > 0 ? `${regularCount} mesa(s) • ${counterCount} balcão` : `${entries.length} mesa(s)`);

    let total = 0;
    for (const [name, items] of entries) {
      const sum = this._app._order.calculateOrderTotal(items);
      total += sum;
      const isCounter = this._app._order.isCounterTable(name);
      const cliente = this._app._data.mesaClientes?.[name] || (isCounter ? 'Cliente Balcão' : 'Cliente não informado');

      if (search && !`${name} ${cliente}`.toLowerCase().includes(search)) continue;

      const card = this._app._renderer.make('div', `entry mesa-entry ${isCounter ? 'counter-entry' : ''}`);
      if (isCounter) {
        card.style.cssText = 'border-left: 3px solid var(--accent); background: rgba(111,207,151,0.04);';
      }
      const head = this._app._renderer.make('div', 'entry-head');
      const left = this._app._renderer.make('div', 'entry-left');
      const titleSpan = this._app._renderer.make('strong', '', isCounter ? `[Balcão] ${name}` : name);
      left.append(
        titleSpan,
        this._app._renderer.make('div', 'meta', cliente)
      );
      head.append(left, this._app._renderer.make('strong', 'entry-strong', this._app._renderer.money(sum)));
      card.append(head);

      for (const item of items) {
        const line = this._app._renderer.make('div', 'itemline');
        line.append(
          this._app._renderer.make('span', '', `${item.qtd} × ${item.nome}`),
          this._app._renderer.make('span', '', this._app._renderer.money(item.total))
        );
        card.append(line);
      }

      const actions = this._app._renderer.make('div', 'actions');
      actions.append(
        this._app._renderer.btn('Adicionar pedido', () => this._chooseTable(name), 'btn'),
        this._app._renderer.btn('Corrigir pedidos', () => this._openEditOrderModal(name), 'btn outline'),
        this._app._renderer.btn('Cliente', () => this._editTableClient(name), 'btn ghost'),
        this._app._renderer.btn('Receber', () => this._closeTable(name), 'btn ghost')
      );
      card.append(actions);
      root.append(card);
    }
    this._app.setText('stat-valor', this._app._renderer.money(total));
    if (!entries.length) root.append(this._app._renderer.empty('Nenhuma mesa aberta.'));
  }

  _renderProductSelects() {
    if (!this._app._data) return;
    const list = document.getElementById('venda-produtos-grid');
    if (!list) return;
    list.replaceChildren();

    const query = document.getElementById('venda-busca')?.value || '';
    const cat = document.getElementById('venda-categoria')?.value || '';
    const products = this._app._stock.findProducts(this._app._data.produtos || [], query, cat);

    // O <select required> oculto é o valor submetido pelo formulário: precisa conter os produtos
    // ativos (não só os filtrados), senão a escolha some ao trocar o filtro.
    const select = document.getElementById('venda-produto');
    if (select) {
      const current = select.value;
      select.replaceChildren(this._app._renderer.make('option', '', 'Selecione um produto', { value: '' }));
      for (const p of this._app._stock.getActiveProducts(this._app._data)) {
        select.append(this._app._renderer.make('option', '', p.nome, { value: String(p.id) }));
      }
      select.value = current;
    }

    for (const p of products) {
      const row = this._app._renderer.btn('', () => {
        if (select) select.value = String(p.id);
        list.querySelectorAll('.product-choice.selected').forEach(el => el.classList.remove('selected'));
        row.classList.add('selected');
        this._updateOrderPrice();
      }, 'product-choice');
      if (select && select.value === String(p.id)) row.classList.add('selected');

      const details = this._app._renderer.make('span', 'product-list-details');
      details.append(
        this._app._renderer.make('strong', '', p.nome),
        this._app._renderer.make('small', 'product-code', `Cód: ${p.codigo || p.id.slice(0, 8)} · ${p.categoria}`),
        this._app._renderer.make('small', 'product-stock', p.qtd > 0 ? `Estoque: ${p.qtd} un.` : 'Sem estoque')
      );
      const right = this._app._renderer.make('span', 'product-list-right');
      right.append(this._app._renderer.make('strong', 'product-list-price', this._app._renderer.money(p.venda)));
      row.append(details, right);
      if (p.qtd <= 0) row.disabled = true;
      list.append(row);
    }
  }

  _updateOrderPrice() {
    const prodId = document.getElementById('venda-produto')?.value;
    const prod = this._app._data?.produtos?.find(p => String(p.id) === String(prodId));
    const qty = Number(document.getElementById('venda-qtd')?.value) || 1;
    const sum = prod ? Math.round((prod.venda * qty + Number.EPSILON) * 100) / 100 : 0;
    const btnTotal = document.getElementById('venda-botao-total');
    if (btnTotal) btnTotal.textContent = this._app._renderer.money(sum);
  }

  _stepQuantity(delta) {
    const input = document.getElementById('venda-qtd');
    if (!input) return;
    const curr = Number(input.value) || 1;
    input.value = String(Math.max(1, curr + delta));
    this._updateOrderPrice();
  }

  _click_counter_order() {
    const mesaInput = document.getElementById('mesa-numero');
    const clientInput = document.getElementById('mesa-cliente');
    if (mesaInput) {
      mesaInput.value = 'Balcão';
      mesaInput.readOnly = true;
    }
    if (clientInput) {
      clientInput.value = this._app._data.mesaClientes?.['Balcão'] || 'Cliente Balcão';
      clientInput.readOnly = false;
    }
    this._app._renderer._openModal('modal-pedido', 'venda-busca');
  }

  _click_new_order() {
    if (!this._ensureTablesAllowed()) return;
    const mesaInput = document.getElementById('mesa-numero');
    const clientInput = document.getElementById('mesa-cliente');
    if (mesaInput) {
      mesaInput.value = '';
      mesaInput.readOnly = false;
    }
    if (clientInput) {
      clientInput.value = '';
      clientInput.readOnly = false;
    }
    this._app._renderer._openModal('modal-pedido', 'mesa-numero');
  }

  _chooseTable(name) {
    if (!this._ensureTablesAllowed(name)) return;
    const isCounter = this._app._order.isCounterTable(name);
    const mesaInput = document.getElementById('mesa-numero');
    if (mesaInput) {
      mesaInput.value = isCounter ? 'Balcão' : String(this._app._order.tableNumberFromKey(name));
      mesaInput.readOnly = isCounter;
    }
    this._updateTableContext();
    this._app._renderer._openModal('modal-pedido', 'venda-busca');
  }

  _updateTableContext() {
    const rawVal = document.getElementById('mesa-numero')?.value.trim();
    const isCounter = this._app._order.isCounterTable(rawVal) || rawVal?.toLowerCase() === 'balcao';
    const table = isCounter ? 'Balcão' : this._app._order.resolveTableName(this._app._data, Number(rawVal));
    const isOpen = Object.hasOwn(this._app._data.mesas || {}, table);
    const clientInput = document.getElementById('mesa-cliente');
    const preview = document.getElementById('comanda-atual-preview');

    if (isOpen && clientInput) {
      clientInput.value = this._app._data.mesaClientes?.[table] || (isCounter ? 'Cliente Balcão' : '');
      clientInput.readOnly = false;
    } else if (clientInput) {
      if (isCounter && !clientInput.value) clientInput.value = 'Cliente Balcão';
      clientInput.readOnly = false;
    }

    if (isOpen && preview) {
      preview.classList.remove('hidden');
      preview.replaceChildren();
      const items = this._app._data.mesas[table] || [];
      const total = this._app._order.calculateOrderTotal(items);

      const header = this._app._renderer.make('div', '', '');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:0.85rem;';
      header.innerHTML = `<strong>Itens já nesta comanda (${items.length}):</strong><span class="pill good">${this._app._renderer.money(total)}</span>`;
      preview.append(header);

      for (const it of items) {
        const row = this._app._renderer.make('div', 'corrigir-item-row');
        row.style.cssText = 'padding:6px 10px;margin-bottom:4px;';
        const info = this._app._renderer.make('div', 'corrigir-item-info');
        info.innerHTML = `<strong style="font-size:13px">${it.nome}</strong> <small style="color:var(--muted);">${it.qtd} × ${this._app._renderer.money(it.precoUnit)} = ${this._app._renderer.money(it.total)}</small>`;

        const ctrl = this._app._renderer.make('div', 'corrigir-item-ctrl');
        const btnM = this._app._renderer.btn('−', async () => {
          await this._changeItemQuantity(table, it.id, Number(it.qtd) - 1);
          this._updateTableContext();
        }, 'btn ghost btn-item-qty');

        const qVal = this._app._renderer.make('span', 'pill', `${it.qtd}`);
        qVal.style.cssText = 'min-width:24px;text-align:center;padding:2px 6px;';

        const btnP = this._app._renderer.btn('+', async () => {
          await this._changeItemQuantity(table, it.id, Number(it.qtd) + 1);
          this._updateTableContext();
        }, 'btn ghost btn-item-qty');

        const btnD = this._app._renderer.btn('', async () => {
          await this._removeItem(table, it.id, it.nome);
          this._updateTableContext();
        }, 'btn ghost item-del-btn');
        btnD.title = 'Excluir este item';
        btnD.append(this._app._renderer.icon('i-trash'));

        ctrl.append(btnM, qVal, btnP, btnD);
        row.append(info, ctrl);
        preview.append(row);
      }
    } else if (preview) {
      preview.classList.add('hidden');
      preview.replaceChildren();
    }
  }

  async _submit_add_item(event) {
    event.preventDefault();
    const rawMesa = document.getElementById('mesa-numero')?.value.trim();
    const isCounter = this._app._order.isCounterTable(rawMesa) || rawMesa?.toLowerCase() === 'balcao';
    if (!isCounter && !this._ensureTablesAllowed(rawMesa)) return;

    const table = isCounter ? 'Balcão' : this._app._order.resolveTableName(this._app._data, Number(rawMesa));
    const client = document.getElementById('mesa-cliente')?.value.trim() || (isCounter ? 'Cliente Balcão' : '');
    const prodId = document.getElementById('venda-produto')?.value;
    const qty = Number(document.getElementById('venda-qtd')?.value) || 1;

    const isNew = !Object.hasOwn(this._app._data.mesas || {}, table);
    if (isNew && !client && !isCounter) {
      this._app._renderer.toast('Informe o nome do cliente para abrir a comanda.');
      return;
    }

    const ok = await this._app._commit(draft => {
      this._app._order.addOrderItem(draft, table, client, prodId, qty, this._app._auth.getSession().usuario);
    }, isCounter ? 'Inclusão de pedido no balcão' : `Inclusão de pedido em comanda`);

    if (ok) {
      this._app._renderer._closeModal('modal-pedido');
      this._app._renderer.toast(`Pedido lançado com sucesso (${table}).`);
    }
  }

  _editTableClient(name) {
    this._editingmesaclient = name;
    document.getElementById('editar-cliente-input').value = this._app._data.mesaClientes?.[name] || '';
    this._app._renderer._openModal('modal-cliente', 'editar-cliente-input');
  }

  async _submit_edit_client(event) {
    event.preventDefault();
    const novonome = document.getElementById('editar-cliente-input').value.trim();
    const ok = await this._app._commit(draft => {
      this._app._order.updateClientName(draft, this._editingmesaclient, novonome);
    }, 'Edição do nome de cliente de comanda');
    if (ok) {
      this._app._renderer._closeModal('modal-cliente');
      this._app._renderer.toast('Nome do cliente atualizado.');
    }
  }

  async _changeItemQuantity(tablename, itemid, novaQtd) {
    const session = this._app._auth.getSession();
    if (novaQtd <= 0) {
      return this._removeItem(tablename, itemid);
    }
    const ok = await this._app._commit(draft => {
      this._app._order.updateOrderItemQuantity(draft, tablename, itemid, novaQtd, session.usuario);
    }, 'Ajuste de quantidade na comanda');
    if (ok) this._app._renderer.toast('Quantidade atualizada com sucesso.');
    return ok;
  }

  async _removeItem(tablename, itemid, itemnome = '') {
    const session = this._app._auth.getSession();
    const ok = await this._app._commit(draft => {
      this._app._order.removeOrderItem(draft, tablename, itemid, `Item ${itemnome || ''} estornado pelo funcionário`, session.usuario);
    }, 'Remoção de item da comanda');
    if (ok) {
      this._app._renderer.toast(`Item ${itemnome ? `"${itemnome}"` : ''} removido e devolvido ao estoque.`);
    }
    return ok;
  }

  _openEditOrderModal(tablename) {
    this._editingOrderTable = tablename;
    const items = this._app._data.mesas?.[tablename] || [];
    const cliente = this._app._data.mesaClientes?.[tablename] || 'Cliente não informado';
    const total = this._app._order.calculateOrderTotal(items);

    this._app.setText('corrigir-mesa-titulo', tablename);
    this._app.setText('corrigir-mesa-subtitulo', `Cliente: ${cliente}`);
    this._app.setText('corrigir-mesa-total', this._app._renderer.money(total));

    const root = document.getElementById('corrigir-itens-lista');
    if (!root) return;
    root.replaceChildren();

    if (!items.length) {
      root.append(this._app._renderer.empty('Nenhum item lançado nesta comanda.'));
      this._app._renderer._openModal('modal-corrigir-comanda');
      return;
    }

    for (const item of items) {
      const row = this._app._renderer.make('div', 'corrigir-item-row');

      const info = this._app._renderer.make('div', 'corrigir-item-info');
      const title = this._app._renderer.make('strong', 'corrigir-item-title', item.nome);
      const sub = this._app._renderer.make('span', 'corrigir-item-sub',
        `${this._app._renderer.money(item.precoUnit)} cada • Total: ${this._app._renderer.money(item.total)}`);
      info.append(title, sub);

      const ctrl = this._app._renderer.make('div', 'corrigir-item-ctrl');
      const btnMinus = this._app._renderer.btn('−', async () => {
        await this._changeItemQuantity(tablename, item.id, Number(item.qtd) - 1);
        if (this._app._data.mesas?.[tablename]?.length) {
          this._openEditOrderModal(tablename);
        } else {
          this._app._renderer._closeModal('modal-corrigir-comanda');
        }
      }, 'btn ghost btn-item-qty');

      const qtySpan = this._app._renderer.make('strong', 'num', `${item.qtd} un`);
      qtySpan.style.cssText = 'min-width:44px;text-align:center;font-size:13px;';

      const btnPlus = this._app._renderer.btn('+', async () => {
        await this._changeItemQuantity(tablename, item.id, Number(item.qtd) + 1);
        this._openEditOrderModal(tablename);
      }, 'btn ghost btn-item-qty');

      const btnDel = this._app._renderer.btn('', async () => {
        await this._removeItem(tablename, item.id, item.nome);
        if (this._app._data.mesas?.[tablename]?.length) {
          this._openEditOrderModal(tablename);
        } else {
          this._app._renderer._closeModal('modal-corrigir-comanda');
        }
      }, 'btn ghost item-del-btn');
      btnDel.title = 'Excluir item e devolver ao estoque';
      btnDel.append(this._app._renderer.icon('i-trash'));

      ctrl.append(btnMinus, qtySpan, btnPlus, btnDel);
      row.append(info, ctrl);
      root.append(row);
    }

    this._app._renderer._openModal('modal-corrigir-comanda');
  }


  _syncTroco() {
    const totalOriginal = this._closingTotal || 0;
    const inputFinal = document.getElementById('fechamento-valor-final');
    const inputRecebido = document.getElementById('fechamento-valor-recebido');
    const forma = document.getElementById('fechamento-pagamento')?.value;

    const valorCobrado = inputFinal && inputFinal.value !== '' ? Number(inputFinal.value) : totalOriginal;
    const valorRecebido = inputRecebido && inputRecebido.value !== '' ? Number(inputRecebido.value) : valorCobrado;

    const troco = Math.max(0, Math.round((valorRecebido - valorCobrado + Number.EPSILON) * 100) / 100);
    const desconto = Math.max(0, Math.round((totalOriginal - valorCobrado + Number.EPSILON) * 100) / 100);

    const displayTroco = document.getElementById('fechamento-troco-display');
    if (displayTroco) {
      displayTroco.textContent = forma === 'dinheiro' || troco > 0
        ? `Troco a devolver: ${this._app._renderer.money(troco)}`
        : `Troco: ${this._app._renderer.money(0)}`;
    }

    const displayDesc = document.getElementById('fechamento-desconto-display');
    if (displayDesc) {
      displayDesc.textContent = desconto > 0 ? `Desconto: ${this._app._renderer.money(desconto)}` : '';
    }
  }

  _closeTable(name) {
    this._closingmesa = name;
    const items = this._app._data.mesas?.[name] || [];
    const total = this._app._order.calculateOrderTotal(items);
    this._closingTotal = total;

    document.getElementById('fechamento-mesa').textContent = name;
    document.getElementById('fechamento-cliente').textContent = `Cliente: ${this._app._data.mesaClientes?.[name] || ''}`;
    document.getElementById('fechamento-total').textContent = this._app._renderer.money(total);

    const inputFinal = document.getElementById('fechamento-valor-final');
    if (inputFinal) inputFinal.value = total.toFixed(2);

    const inputRecebido = document.getElementById('fechamento-valor-recebido');
    if (inputRecebido) inputRecebido.value = total.toFixed(2);

    this._syncTroco();
    this._app._renderer._openModal('modal-fechamento');
  }

  async _submit_close_table(event) {
    event.preventDefault();
    const formapagamento = document.getElementById('fechamento-pagamento').value;
    const shift = this._app._shift.getActiveShift(this._app._data);

    const valorFinalInput = document.getElementById('fechamento-valor-final');
    const valorRecebidoInput = document.getElementById('fechamento-valor-recebido');

    const valorFinal = valorFinalInput && valorFinalInput.value !== '' ? Number(valorFinalInput.value) : undefined;
    const valorRecebido = valorRecebidoInput && valorRecebidoInput.value !== '' ? Number(valorRecebidoInput.value) : valorFinal;

    const ok = await this._app._commit(draft => {
      this._app._order.receiveTable(
        draft,
        this._closingmesa,
        formapagamento,
        this._app._auth.getSession().usuario,
        shift?.id || null,
        { valorFinal, valorRecebido }
      );
    }, 'Fechamento e quitação de mesa');

    if (ok) {
      this._app._renderer._closeModal('modal-fechamento');
      this._app._renderer.toast('Comanda recebida com sucesso e registrada no caixa.');
    }
  }
}
