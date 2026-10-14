import { GOVERNANCE_STATES } from '../../application/services/GovernanceService.js';

/**
 * Controller de UI: Governança Systekna.
 * - Cadastro com homologação antes do primeiro administrador (doc 12, RN-FIREBASE.3)
 * - Aplicação dos módulos (mesas, exportação XLSX, limite de produtos) e do kill-switch remoto (doc 14),
 *   reconsultados ao voltar ao app, ao reconectar e periodicamente — sem esperar novo login
 * - Feedback do gestor e telemetria de erros sanitizada (doc 13)
 */
export class GovernanceController {
  _app;
  _service;
  _onApproved = null;
  _lastSync = 0;
  _syncing = false;

  // Reconsulta da licença com a sessão aberta: intervalo e espaçamento mínimo entre consultas
  static WATCH_INTERVAL_MS = 15 * 60 * 1000;
  static MIN_GAP_MS = 60 * 1000;

  constructor(app, service) {
    this._app = app;
    this._service = service;
  }

  bind() {
    document.getElementById('gov-register-form')?.addEventListener('submit', e => this._submit_registration(e));
    document.getElementById('gov-check-status')?.addEventListener('click', () => this._checkPendingStatus());
    document.getElementById('more-feedback')?.addEventListener('click', () => this._openFeedback());
    document.getElementById('form-feedback')?.addEventListener('submit', e => this._submit_feedback(e));
  }

  /** Telemetria: erros não tratados vão sanitizados para a governança (falha silenciosa). */
  installErrorReporting() {
    window.addEventListener('error', e => { this._service.reportError(e.error || e.message); });
    window.addEventListener('unhandledrejection', e => { this._service.reportError(e.reason); });
  }

  report(error, modulo) {
    return this._service.reportError(error, modulo);
  }

  allowsTables() {
    return this._service.allowsTables();
  }

  allowsXlsxExport() {
    return this._service.allowsXlsxExport();
  }

  /** Bloqueia a exportação XLSX desligada pela governança. @returns {boolean} true se pode exportar */
  ensureXlsxAllowed() {
    if (this.allowsXlsxExport()) return true;
    this._app._renderer.toast('A exportação em Excel não está liberada pela Governança Systekna. Use o PDF.');
    return false;
  }

  /** Lança erro (dentro do _commit) se um produto novo ultrapassar o limite do plano. */
  ensureProductCapacity(database) {
    const limite = this._service.productLimit();
    if (limite === null) return;
    const ativos = (database.produtos || []).filter(p => p.ativo !== false).length;
    if (ativos >= limite) {
      throw new Error(`limite de ${limite} produtos do plano atingido. Fale com a Governança Systekna para ampliar.`);
    }
  }

  isBlocked() {
    return this._service.isBlocked();
  }

  blockMessage() {
    const reason = this._service.getBlockReason();
    return `Lançamentos suspensos pela Governança Systekna${reason ? `: ${reason}` : '.'} Os dados locais continuam disponíveis para consulta e backup.`;
  }

  // ---------------------------------------------------------------------------
  // Primeiro acesso: homologação antes de criar o administrador
  // ---------------------------------------------------------------------------

  /**
   * Decide se o primeiro acesso pode seguir para a criação do administrador.
   * @param {Function} onApproved chamado quando a governança aprova (mostra o setup do admin)
   * @returns {Promise<boolean>} true se a tela de governança assumiu (ainda não aprovado)
   */
  async gateFirstSetup(onApproved) {
    this._onApproved = onApproved;
    const record = this._service.getRecord();
    if (!record) {
      this._showPanel('register');
      return true;
    }
    const result = await this._service.refresh();
    if (result.state === GOVERNANCE_STATES.APPROVED) {
      this._showPanel(null);
      return false;
    }
    this._renderPending(result);
    return true;
  }

  _showPanel(which) {
    document.getElementById('gov-register')?.classList.toggle('hidden', which !== 'register');
    document.getElementById('gov-pending')?.classList.toggle('hidden', which !== 'pending');
    document.getElementById('auth-login-stack')?.classList.toggle('hidden', which !== null);
    document.getElementById('setup-notice')?.classList.toggle('hidden', which !== null);
    const title = document.getElementById('auth-welcome-title');
    if (title && which === 'register') title.textContent = 'Solicitar liberação de acesso';
    if (title && which === 'pending') title.textContent = 'Cadastro em análise';
  }

  _renderPending(result) {
    this._showPanel('pending');
    const text = document.getElementById('gov-pending-text');
    if (!text) return;
    if (result.state === GOVERNANCE_STATES.REJECTED || result.state === GOVERNANCE_STATES.BLOCKED) {
      text.textContent = `A Governança da Systekna não liberou o acesso${result.motivo ? `: ${result.motivo}` : '.'}`;
    } else if (result.offline) {
      text.textContent = 'Sem conexão com a Governança da Systekna. Conecte-se à internet e verifique novamente.';
    } else {
      text.textContent = 'Sua solicitação de acesso foi enviada para a Governança da Systekna e está em análise.';
    }
  }

  async _submit_registration(event) {
    event.preventDefault();
    const errorEl = document.getElementById('auth-error');
    if (errorEl) errorEl.textContent = '';
    const button = document.getElementById('gov-register-submit');
    if (button) button.disabled = true;
    try {
      const record = await this._service.submitRegistration({
        usuario: document.getElementById('gov-usuario')?.value,
        nomeEstabelecimento: document.getElementById('gov-nome')?.value,
        cnpj: document.getElementById('gov-cnpj')?.value,
        tipoComercio: document.getElementById('gov-tipo')?.value
      });
      const loginUser = document.getElementById('login-user');
      if (loginUser) loginUser.value = record.usuario;
      this._renderPending({ state: GOVERNANCE_STATES.PENDING, offline: false });
    } catch (e) {
      if (errorEl) errorEl.textContent = 'Não foi possível enviar a solicitação: ' + e.message;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async _checkPendingStatus() {
    const button = document.getElementById('gov-check-status');
    if (button) button.disabled = true;
    try {
      const result = await this._service.refresh();
      if (result.state === GOVERNANCE_STATES.APPROVED) {
        this._showPanel(null);
        const loginUser = document.getElementById('login-user');
        if (loginUser && !loginUser.value) loginUser.value = this._service.getRecord()?.usuario || '';
        this._onApproved?.();
        this._app._renderer.toast('Acesso liberado pela governança. Crie o administrador.');
      } else {
        this._renderPending(result);
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Após o login: sincroniza licença e módulos sem travar a operação offline
  // ---------------------------------------------------------------------------

  async syncAfterLogin() {
    if (this._service.getRecord()) {
      this._lastSync = Date.now();
      await this._service.refresh();
    }
    this.applyState();
  }

  /** Bloqueio/liberação feitos no painel chegam com o app aberto, sem depender de novo login. */
  startWatching() {
    const tick = () => { this.resync().catch(() => {}); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
    window.addEventListener('online', tick);
    setInterval(tick, GovernanceController.WATCH_INTERVAL_MS);
  }

  async resync() {
    if (this._syncing || !this._app._auth.getSession() || !this._service.getRecord()) return;
    if (Date.now() - this._lastSync < GovernanceController.MIN_GAP_MS) return;
    this._syncing = true;
    this._lastSync = Date.now();
    try {
      const before = JSON.stringify(this._service.getRecord()?.lastState || null) + this.isBlocked();
      await this._service.refresh();
      const after = JSON.stringify(this._service.getRecord()?.lastState || null) + this.isBlocked();
      // Só redesenha quando algo mudou, para não atrapalhar quem está lançando
      if (before !== after) {
        this.applyState();
        this._app._renderer.toast(this.isBlocked() ? this.blockMessage() : 'A Governança Systekna atualizou as permissões deste aparelho.');
      }
    } finally {
      this._syncing = false;
    }
  }

  applyState() {
    const banner = document.getElementById('gov-banner');
    if (banner) {
      banner.textContent = this.isBlocked() ? this.blockMessage() : '';
      banner.classList.toggle('hidden', !this.isBlocked());
    }
    const tables = this.allowsTables();
    for (const id of ['home-new-order', 'home-all-tables']) {
      document.getElementById(id)?.classList.toggle('hidden', !tables);
    }
    const xlsx = this.allowsXlsxExport();
    for (const id of ['cash-export-xlsx', 'more-export-excel']) {
      document.getElementById(id)?.classList.toggle('hidden', !xlsx);
    }
    if (!tables && this._app._currenttab === 'vendas') {
      this._app._currenttab = 'inicio';
    }
    if (this._app._auth.getSession()) {
      this._app._changeTab(this._app._currenttab);
    }
  }

  // ---------------------------------------------------------------------------
  // Feedback do gestor
  // ---------------------------------------------------------------------------

  _openFeedback() {
    document.getElementById('form-feedback')?.reset();
    const errorEl = document.getElementById('feedback-error');
    if (errorEl) errorEl.textContent = '';
    this._app._renderer._openModal('modal-feedback', 'feedback-tipo');
  }

  async _submit_feedback(event) {
    event.preventDefault();
    const errorEl = document.getElementById('feedback-error');
    if (errorEl) errorEl.textContent = '';
    const button = document.getElementById('feedback-submit');
    if (button) button.disabled = true;
    try {
      await this._service.sendFeedback({
        tipo: document.getElementById('feedback-tipo')?.value,
        avaliacao: Number(document.getElementById('feedback-nota')?.value),
        mensagem: document.getElementById('feedback-mensagem')?.value
      });
      this._app._renderer._closeModal('modal-feedback');
      this._app._renderer.toast('Feedback recebido pela Governança da Systekna. Obrigado!');
    } catch (e) {
      if (errorEl) errorEl.textContent = e.message;
    } finally {
      if (button) button.disabled = false;
    }
  }
}
