/**
 * Controller de UI: Caixa, retiradas e relatórios exportados.
 * Extraído de App.js; acessa estado, serviços e o commit transacional via `this._app`.
 */
export class CashController {
  _app;

  constructor(app) {
    this._app = app;
  }

  bind() {
    document.getElementById('caixa-periodo')?.addEventListener('change', () => this._renderCash());
    document.getElementById('abrir-retirada')?.addEventListener('click', () => this._openWithdrawalModal());
    document.getElementById('form-despesa')?.addEventListener('submit', e => this._submit_withdrawal(e));

    // Exportação em Botão Único com Dropdown
    const exportTrigger = document.getElementById('cash-export-trigger');
    const exportMenu = document.getElementById('cash-export-menu');

    exportTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isClosed = exportMenu?.classList.contains('hidden');
      exportMenu?.classList.toggle('hidden', !isClosed);
      exportTrigger?.setAttribute('aria-expanded', String(isClosed));
    });

    document.addEventListener('click', (e) => {
      if (exportMenu && !exportMenu.classList.contains('hidden') && !exportMenu.contains(e.target) && e.target !== exportTrigger) {
        exportMenu.classList.add('hidden');
        exportTrigger?.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && exportMenu && !exportMenu.classList.contains('hidden')) {
        exportMenu.classList.add('hidden');
        exportTrigger?.setAttribute('aria-expanded', 'false');
        exportTrigger?.focus();
      }
    });

    document.getElementById('cash-export-xlsx')?.addEventListener('click', () => {
      exportMenu?.classList.add('hidden');
      exportTrigger?.setAttribute('aria-expanded', 'false');
      this._exportCashReport('xlsx');
    });

    document.getElementById('cash-export-pdf')?.addEventListener('click', () => {
      exportMenu?.classList.add('hidden');
      exportTrigger?.setAttribute('aria-expanded', 'false');
      this._exportCashReport('pdf');
    });

    // Exportação Rápida no Tab Mais
    document.getElementById('more-export-pdf')?.addEventListener('click', () => {
      const p = document.getElementById('quick-cash-period')?.value || 'hoje';
      this._exportCashReport('pdf', p);
    });
    document.getElementById('more-export-excel')?.addEventListener('click', () => {
      const p = document.getElementById('quick-cash-period')?.value || 'hoje';
      this._exportCashReport('xlsx', p);
    });

    // Fechamento de Caixa Diário e Mensal (TASK-318 / FDBK-318)
    document.getElementById('abrir-fechamento-caixa')?.addEventListener('click', () => this._openClosingModal());
    document.getElementById('form-fechamento-caixa')?.addEventListener('submit', e => this._submit_closing(e));
    document.getElementById('fechamento-tipo-select')?.addEventListener('change', () => this._updateClosingSummaryView());
    document.getElementById('fechamento-dinheiro-contado')?.addEventListener('input', () => this._syncClosingDiff());
    document.getElementById('imprimir-fechamento-fiscal')?.addEventListener('click', () => this._printClosingReceipt());
  }

  async _printClosingReceipt() {
    if (!this._app._data) return;
    const tipo = document.getElementById('fechamento-tipo-select')?.value || 'diario';
    const resumo = this._app._shift.getClosingSummary(this._app._data, tipo);
    const contado = Number(document.getElementById('fechamento-dinheiro-contado')?.value || 0);
    const obs = document.getElementById('fechamento-observacoes')?.value || '';
    const estabelecimento = this._app._governance?.getRecord()?.nomeEstabelecimento || 'BarGestão';

    const fechamentoData = {
      id: `FECH-${tipo === 'mensal' ? 'MES' : 'DIA'}-DEMO-${Date.now()}`,
      tipo,
      data: new Date().toISOString(),
      operador: this._app._auth.getSession()?.usuario || 'Operador',
      totalVendas: resumo.totalVendas,
      totalRetiradas: resumo.totalRetiradas,
      dinheiroEsperado: resumo.dinheiroEsperado,
      dinheiroContado: contado,
      diferenca: contado - resumo.dinheiroEsperado,
      totaisPorForma: resumo.totaisPorForma,
      observacoes: obs
    };

    try {
      await this._app._printer.printCashClosingReceipt(fechamentoData, estabelecimento);
      this._app._renderer.toast('Comprovante de fechamento impresso via ESC/POS.');
    } catch (err) {
      this._app._renderer.toast(`Impressão térmica: ${err.message}`);
    }
  }

  _renderCash() {
    if (!this._app._data) return;
    const period = document.getElementById('caixa-periodo')?.value || 'hoje';
    const metrics = this._app._cash.calculateMetrics(this._app._data, period);

    App.safeSetText('cash-vendas', String(metrics.salesCount));
    App.safeSetText('cash-faturamento', this._app._renderer.money(metrics.sold));
    App.safeSetText('cash-aberto', this._app._renderer.money(metrics.openValue));
    App.safeSetText('cash-ticket', this._app._renderer.money(metrics.ticket));
    App.safeSetText('cash-saidas', this._app._renderer.money(metrics.outgoing));
    App.safeSetText('cash-saldo', this._app._renderer.money(metrics.balance));

    // Renderização do Painel de Turno de Caixa
    this._renderShiftPanel();

    // Renderização do Gráfico de Vendas por Dia
    this._renderChart();

    // Renderização do Histórico de Fechamentos
    this._renderClosingHistory();

    const root = document.getElementById('livro-caixa');
    if (!root) return;
    root.replaceChildren();

    const entries = this._app._cash.getFilteredEntries(this._app._data, period);
    App.safeSetText('caixa-count', `${entries.length} registros`);

    for (const e of entries) {
      const el = this._app._renderer.make('div', 'entry');
      const head = this._app._renderer.make('div', 'entry-head');
      const left = this._app._renderer.make('div', 'entry-left');
      left.append(
        this._app._renderer.make('strong', '', e.descricao),
        this._app._renderer.make('div', 'meta', this._app._renderer.dateLabel(e.data))
      );
      const right = this._app._renderer.make('strong', e.tipo === 'entrada' ? 'text-good' : 'text-bad',
        `${e.tipo === 'entrada' ? '+' : '−'} ${this._app._renderer.money(e.valor)}`);
      head.append(left, right);
      el.append(head);
      root.append(el);
    }
  }

  _renderChart() {
    const root = document.getElementById('chart-caixa');
    if (!root || !this._app._data) return;
    root.replaceChildren();

    const data = this._app._cash.getChartData(this._app._data);
    const max = Math.max(...data.map(d => d.total), 1);

    for (const d of data) {
      const col = this._app._renderer.make('div', 'chart-col');
      const val = this._app._renderer.make(
        'span',
        'chart-value',
        d.total > 0 ? this._app._renderer.money(d.total) : 'R$ 0'
      );
      const pct = Math.round((d.total / max) * 100);
      const body = this._app._renderer.make('div', 'chart-body', '', {
        style: `--h: ${Math.max(4, pct)}%`
      });
      body.title = `${d.label}: ${this._app._renderer.money(d.total)}`;
      const label = this._app._renderer.make('span', 'chart-label', d.label);

      col.append(val, body, label);
      root.append(col);
    }
  }

  _renderClosingHistory() {
    const root = document.getElementById('lista-fechamentos-historico');
    const countEl = document.getElementById('fechamentos-count');
    if (!root || !this._app._data) return;
    root.replaceChildren();

    const fechamentos = (this._app._data.fechamentosCaixa || []).slice().reverse();
    if (countEl) countEl.textContent = `${fechamentos.length} fechamento${fechamentos.length === 1 ? '' : 's'}`;

    if (fechamentos.length === 0) {
      const empty = this._app._renderer.make('div', 'empty-state', 'Nenhum fechamento registrado até o momento.');
      empty.style.padding = '16px';
      empty.style.textAlign = 'center';
      empty.style.color = 'var(--text-muted)';
      root.append(empty);
      return;
    }

    for (const f of fechamentos) {
      const item = this._app._renderer.make('div', 'entry');
      const head = this._app._renderer.make('div', 'entry-head');
      const left = this._app._renderer.make('div', 'entry-left');

      const title = this._app._renderer.make('strong', '', `Fechamento ${f.tipo === 'mensal' ? 'Mensal' : 'Diário'} (${f.dataReferencia || '—'})`);
      const meta = this._app._renderer.make('div', 'meta', `${this._app._renderer.dateLabel(f.fechadoEm)} • Operador: ${f.operador || '—'}`);
      left.append(title, meta);

      const right = this._app._renderer.make('div', 'entry-right');
      right.style.textAlign = 'right';
      const val = this._app._renderer.make('strong', 'text-good', this._app._renderer.money(f.totalVendas));
      right.append(val);

      if (typeof f.diferenca === 'number') {
        const isOk = Math.abs(f.diferenca) < 0.01;
        const diffBadge = this._app._renderer.make(
          'span',
          `pill ${isOk ? 'good' : 'warn'}`,
          isOk ? 'Exato' : (f.diferenca > 0 ? `+${this._app._renderer.money(f.diferenca)}` : `${this._app._renderer.money(f.diferenca)}`)
        );
        diffBadge.style.marginLeft = '8px';
        right.append(diffBadge);
      }

      head.append(left, right);
      item.append(head);

      if (f.observacoes) {
        const obs = this._app._renderer.make('div', 'meta', `Obs: ${f.observacoes}`);
        obs.style.marginTop = '4px';
        obs.style.fontStyle = 'italic';
        item.append(obs);
      }
      root.append(item);
    }
  }

  _renderShiftPanel() {
    const shiftStatus = document.getElementById('v9-shift-status');
    const shiftBody = document.getElementById('v9-shift-body');
    if (!shiftBody) return;

    const active = this._app._shift.getActiveShift(this._app._data);
    if (!active) {
      if (shiftStatus) shiftStatus.textContent = 'Nenhum turno aberto';
      shiftBody.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:rgba(255,255,255,0.02);border-radius:8px;border:1px solid var(--line);">
          <div>
            <strong style="display:block;font-size:0.95rem;">Caixa livre / Turno fechado</strong>
            <small style="color:var(--text-muted);">Abra um novo turno com fundo de troco para iniciar a conciliação.</small>
          </div>
          <button type="button" class="btn btn-primary" id="v9-btn-novo-turno">Iniciar Turno</button>
        </div>
      `;
      document.getElementById('v9-btn-novo-turno')?.addEventListener('click', () => this._promptOpenShift());
    } else {
      const totals = this._app._shift.calculateShiftTotals(this._app._data, active);
      if (shiftStatus) shiftStatus.textContent = `Turno ativo • Operador: ${active.operador}`;
      shiftBody.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;padding:12px;background:rgba(111,207,151,0.03);border-radius:8px;border:1px solid rgba(111,207,151,0.2);margin-bottom:12px;">
          <div><small style="color:var(--text-muted);display:block;">Fundo Inicial</small><strong class="num">${this._app._renderer.money(active.fundoInicial)}</strong></div>
          <div><small style="color:var(--text-muted);display:block;">Entradas (Dinheiro)</small><strong class="num text-good">+ ${this._app._renderer.money(totals.cashIn)}</strong></div>
          <div><small style="color:var(--text-muted);display:block;">Retiradas / Sangrias</small><strong class="num text-bad">− ${this._app._renderer.money(totals.cashOut)}</strong></div>
          <div><small style="color:var(--text-muted);display:block;">Dinheiro Esperado</small><strong class="num text-good" style="font-size:1.05rem;">${this._app._renderer.money(totals.esperado)}</strong></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button type="button" class="btn ghost minor manager-only" id="v9-btn-sangria">Registrar Retirada</button>
          <button type="button" class="btn minor" id="v9-btn-fechar">Fechar Caixa do Dia</button>
        </div>
      `;
      document.getElementById('v9-btn-sangria')?.addEventListener('click', () => this._openWithdrawalModal());
      document.getElementById('v9-btn-fechar')?.addEventListener('click', () => this._openClosingModal());
    }
  }

  async _promptOpenShift() {
    const session = this._app._auth.getSession();
    const fundoStr = prompt('Informe o valor do Fundo de Caixa Inicial (R$):', '100.00');
    if (fundoStr === null) return;
    const fundo = parseFloat(fundoStr.replace(',', '.'));
    if (isNaN(fundo) || fundo < 0) {
      this._app._renderer.toast('Valor de fundo inicial inválido.');
      return;
    }
    const ok = await this._app._commit(draft => {
      this._app._shift.openShift(draft, fundo, session.usuario);
    }, 'Abertura de turno de caixa');
    if (ok) {
      this._app._renderer.toast(`Turno aberto com fundo de ${this._app._renderer.money(fundo)}.`);
    }
  }

  _openClosingModal() {
    const form = document.getElementById('form-fechamento-caixa');
    if (form) form.reset();
    this._updateClosingSummaryView();
    this._app._renderer._openModal('modal-fechamento-caixa', 'fechamento-dinheiro-contado');
  }

  _updateClosingSummaryView() {
    const tipo = document.getElementById('fechamento-tipo-select')?.value || 'diario';
    const summary = this._app._shift.getClosingSummary(this._app._data, tipo);

    App.safeSetText('fechamento-resumo-periodo', tipo === 'diario' ? `Hoje (${summary.referencia})` : `Mês (${summary.referencia})`);
    App.safeSetText('fechamento-total-vendas', this._app._renderer.money(summary.totalVendas));
    App.safeSetText('fechamento-total-saidas', this._app._renderer.money(summary.totalSaidas));
    App.safeSetText('fechamento-saldo-liquido', this._app._renderer.money(summary.saldoLiquido));
    App.safeSetText('fechamento-dinheiro', this._app._renderer.money(summary.pagamentos.dinheiro));
    App.safeSetText('fechamento-pix', this._app._renderer.money(summary.pagamentos.pix));
    App.safeSetText('fechamento-debito', this._app._renderer.money(summary.pagamentos.debito));
    App.safeSetText('fechamento-credito', this._app._renderer.money(summary.pagamentos.credito));
    App.safeSetText('fechamento-dinheiro-esperado', this._app._renderer.money(summary.dinheiroEsperado));

    const contadoInput = document.getElementById('fechamento-dinheiro-contado');
    if (contadoInput && !contadoInput.value) {
      contadoInput.value = summary.dinheiroEsperado.toFixed(2);
    }
    this._syncClosingDiff();
  }

  _syncClosingDiff() {
    const tipo = document.getElementById('fechamento-tipo-select')?.value || 'diario';
    const summary = this._app._shift.getClosingSummary(this._app._data, tipo);
    const contado = parseFloat(document.getElementById('fechamento-dinheiro-contado')?.value || '0') || 0;
    const diff = Math.round((contado - summary.dinheiroEsperado + Number.EPSILON) * 100) / 100;
    const diffEl = document.getElementById('fechamento-diferenca-valor');
    if (!diffEl) return;

    if (Math.abs(diff) < 0.01) {
      diffEl.textContent = 'Caixa Exato (Sem divergência)';
      diffEl.className = 'pill good';
    } else if (diff > 0) {
      diffEl.textContent = `Sobra: + ${this._app._renderer.money(diff)}`;
      diffEl.className = 'pill good';
    } else {
      diffEl.textContent = `Falta: − ${this._app._renderer.money(Math.abs(diff))}`;
      diffEl.className = 'pill warn';
    }
  }

  async _submit_closing(event) {
    event.preventDefault();
    const tipo = document.getElementById('fechamento-tipo-select')?.value || 'diario';
    const contado = parseFloat(document.getElementById('fechamento-dinheiro-contado')?.value || '0') || 0;
    const observacoes = document.getElementById('fechamento-observacoes')?.value.trim() || '';
    const session = this._app._auth.getSession();

    const ok = await this._app._commit(draft => {
      if (tipo === 'diario') {
        this._app._shift.closeDailyCash(draft, contado, session.usuario, observacoes);
      } else {
        this._app._shift.closeMonthlyCash(draft, session.usuario, null, observacoes);
      }
    }, `Fechamento de caixa ${tipo}`);

    if (ok) {
      this._app._renderer._closeModal('modal-fechamento-caixa');
      this._app._renderer.toast(`Fechamento de caixa (${tipo}) registrado com sucesso!`);
      this._renderCash();
    }
  }

  _openWithdrawalModal() {
    document.getElementById('form-despesa')?.reset();
    this._app._renderer._openModal('modal-retirada', 'sangria-motivo');
  }

  async _submit_withdrawal(event) {
    event.preventDefault();
    const motivo = document.getElementById('sangria-motivo').value.trim();
    const valor = Number(document.getElementById('sangria-valor').value);
    const shift = this._app._shift.getActiveShift(this._app._data);

    const ok = await this._app._commit(draft => {
      this._app._cash.registerWithdrawal(draft, motivo, valor, this._app._auth.getSession().usuario, shift?.id || null);
    }, 'Retirada do caixa (Sangria)');

    if (ok) {
      this._app._renderer._closeModal('modal-retirada');
      this._app._renderer.toast('Retirada registrada no caixa.');
      this._renderCash();
    }
  }

  async _exportCashReport(format, periodOverride = null) {
    if (format === 'xlsx' && !this._app._governanceCtl.ensureXlsxAllowed()) return;
    const reportpayment = { pix: 'PIX', dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito' };
    const period = periodOverride || document.getElementById('caixa-periodo')?.value || document.getElementById('quick-cash-period')?.value || 'hoje';
    const entries = this._app._cash.getFilteredEntries(this._app._data, period);
    const metrics = this._app._cash.calculateMetrics(this._app._data, period);

    const report = {
      period,
      periodLabel: period.toUpperCase(),
      generatedAt: new Date().toISOString(),
      user: this._app._auth.getSession().usuario,
      entries,
      ...metrics,
      payments: {}
    };

    const name = `BarGestao-Caixa-${period}-${new Date().toISOString().slice(0, 10)}`;
    if (format === 'xlsx') {
      const blob = this._app._export.buildXlsx(report, reportpayment, iso => this._app._renderer.dateLabel(iso));
      this._app._export.downloadBlob(blob, name + '.xlsx');
    } else {
      const blob = this._app._export.buildPdf(report, reportpayment, iso => this._app._renderer.dateLabel(iso), val => this._app._renderer.money(val));
      this._app._export.downloadBlob(blob, name + '.pdf');
    }
    this._app._renderer.toast('Relatório financeiro exportado.');
  }
}
