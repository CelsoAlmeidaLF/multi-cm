/**
 * Controller de UI: lista de mesas (aba Vendas).
 * A comanda (lançar, corrigir, receber) vive no ComandaController, em tela cheia.
 */
export class SalesController {
  _app;

  constructor(app) {
    this._app = app;
  }

  bind() {
    document.getElementById('abrir-nova-mesa')?.addEventListener('click', () => this._app._comandaCtl.openNew());
    document.getElementById('mesas-busca')?.addEventListener('input', () => this._renderTables());
  }

  /** Rótulo do botão principal e aviso das comandas ocultas conforme o módulo de mesas da Governança. */
  _syncTablesMode(tablesOn, hiddenCount) {
    this._app.setText('abrir-nova-mesa-label', tablesOn ? 'Abrir mesa' : 'Venda no balcão');
    const aviso = document.getElementById('mesas-ocultas-aviso');
    if (aviso) {
      aviso.classList.toggle('hidden', tablesOn || hiddenCount === 0);
      aviso.textContent = `${hiddenCount} comanda${hiddenCount === 1 ? '' : 's'} de mesa aberta${hiddenCount === 1 ? '' : 's'} oculta${hiddenCount === 1 ? '' : 's'}: o módulo de mesas está desabilitado pela Governança. Elas voltam quando for reativado.`;
    }
  }

  _renderTables() {
    const root = document.getElementById('lista-mesas');
    if (!root || !this._app._data) return;
    root.replaceChildren();

    const search = document.getElementById('mesas-busca')?.value.toLowerCase().trim() || '';
    // Mesas desabilitadas pela Governança: só o balcão aparece; comandas de mesa já abertas ficam ocultas (e avisadas)
    const allEntries = Object.entries(this._app._data.mesas || {});
    const tablesOn = this._app._governanceCtl?.allowsTables?.() !== false;
    const entries = tablesOn ? allEntries : allEntries.filter(([n]) => this._app._order.isCounterTable(n));
    this._syncTablesMode(tablesOn, allEntries.length - entries.length);

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
      actions.append(this._app._renderer.btn('Abrir comanda', () => this._app._comandaCtl.open(name), 'btn'));
      card.append(actions);
      root.append(card);
    }
    this._app.setText('stat-valor', this._app._renderer.money(total));
    if (!entries.length) root.append(this._app._renderer.empty('Nenhuma mesa aberta.'));
  }
}
