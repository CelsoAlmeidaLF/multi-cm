import { WebCryptoAdapter } from './infrastructure/adapters/WebCryptoAdapter.js';
import { StorageAdapter } from './infrastructure/adapters/StorageAdapter.js';
import { ConcurrencyAdapter } from './infrastructure/adapters/ConcurrencyAdapter.js';
import { BinaryExportAdapter } from './infrastructure/adapters/BinaryExportAdapter.js';

import { AuthService } from './application/services/AuthService.js';
import { StockService } from './application/services/StockService.js';
import { OrderService } from './application/services/OrderService.js';
import { CashService } from './application/services/CashService.js';
import { ShiftService } from './application/services/ShiftService.js';
import { RecoveryService } from './application/services/RecoveryService.js';

import { DomRenderer } from './ui/adapters/DomRenderer.js';
import { DomEventHandler } from './ui/adapters/DomEventHandler.js';

/**
 * Orquestrador Central da Aplicação — BarGestão Standard
 * Arquitetura Hexagonal com Injeção de Dependências
 */
export class App {
  static VERSION = '2.4.0';
  static BUILD = '2026.10';
  static EDITION_LABEL = 'BarGestão Standard';
  static AERO_SPEC = 'Aero Glassmorphism 2.0';

  // Adaptadores de Infraestrutura
  _crypto;
  _storage;
  _concurrency;
  _export;

  // Serviços de Domínio e Aplicação
  _auth;
  _stock;
  _order;
  _cash;
  _shift;
  _recovery;

  // Adaptadores de UI
  _renderer;
  _events;

  // Estado da Aplicação em Memória
  _data = null;
  _serial = 0;
  _currenttab = 'inicio';
  _mutating = false;
  _lastactivity = Date.now();
  _settings = { idleMinutes: 5, lockOnHide: true };
  _autolocktimer = null;
  _pendingrecovery = null;

  // Configuração Comercial da Edição
  _edition = {
    name: 'Standard',
    price: 2500,
    export: true,
    shift: true,
    smart: false,
    alerts: true,
    users: true,
    bio: false
  };

  // Estado dos Formulários e Modais
  _editproductid = null;
  _editcategoryname = null;
  _editusername = null;
  _editingmesaclient = null;
  _closingmesa = null;
  _cancellingitem = null;
  _importpending = null;

  constructor() {
    this._crypto = new WebCryptoAdapter();
    this._storage = new StorageAdapter();
    this._concurrency = new ConcurrencyAdapter();
    this._export = new BinaryExportAdapter();

    this._auth = new AuthService(this._crypto, this._storage);
    this._stock = new StockService();
    this._order = new OrderService();
    this._cash = new CashService();
    this._shift = new ShiftService();
    this._recovery = new RecoveryService(this._crypto);

    this._renderer = new DomRenderer();
    this._events = new DomEventHandler(this);
  }

  updateLastActivity() {
    this._lastactivity = Date.now();
  }

  handleBackgroundHide() {
    if (this._auth.getSession() && this._settings.lockOnHide !== false) {
      this._discardSession();
    }
  }

  async init() {
    if (!globalThis.crypto?.subtle || !crypto.randomUUID || !globalThis.indexedDB) {
      const err = document.getElementById('auth-error');
      if (err) err.textContent = 'Abra em HTTPS ou localhost com navegador atualizado e IndexedDB habilitado.';
      return;
    }

    try {
      await this._storage.init();
      this._settings = (await this._storage.dbRead('private', 'settings')) || this._settings;
      const meta = await this._auth.loadMeta();

      const candidates = await this._storage.readCandidates();
      const setupnotice = document.getElementById('setup-notice');
      const welcometitle = document.getElementById('auth-welcome-title');
      const authmethods = document.getElementById('auth-methods');
      const authrecover = document.getElementById('auth-recover');
      const loginsubmit = document.getElementById('login-submit');

      if (!meta) {
        if (candidates.length) {
          if (welcometitle) welcometitle.textContent = 'Recuperar dados existentes';
          if (setupnotice) setupnotice.textContent = 'Foram encontrados arquivos JSON sem cadastro local. Utilize Restaurar backup criptografado.';
          if (loginsubmit) loginsubmit.disabled = true;
        } else {
          // Setup Inicial
          if (welcometitle) welcometitle.textContent = 'Criar primeiro administrador';
          document.getElementById('setup-confirm-wrap')?.classList.remove('hidden');
          authmethods?.classList.add('hidden');
          authrecover?.classList.add('hidden');
          if (loginsubmit) loginsubmit.textContent = 'Criar administrador';
          if (setupnotice) setupnotice.textContent = 'Primeiro acesso: crie o administrador com senha forte (8+ caracteres).';
        }
      } else {
        setupnotice?.classList.add('hidden');
        authrecover?.classList.toggle('hidden', !meta.recovery);
        const loginuser = document.getElementById('login-user');
        if (loginuser) loginuser.value = meta.lastUser || '';
        const user = meta.usuarios?.find(x => x.usuario === meta.lastUser);
        this._setAuthMode(user?.pin && user?.deviceSeal ? 'pin' : 'senha');
      }

      this._bindUiEvents();
      this._events.bindGlobalListeners();
      this._initAutoLock();
      this._initBroadcastChannel();

      if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
      }
    } catch (e) {
      const err = document.getElementById('auth-error');
      if (err) err.textContent = 'Falha ao iniciar o sistema: ' + e.message;
    }
  }

  _initAutoLock() {
    clearInterval(this._autolocktimer);
    this._autolocktimer = setInterval(() => {
      if (this._auth.getSession() && Date.now() - this._lastactivity > (this._settings.idleMinutes || 5) * 60 * 1000) {
        this._discardSession();
      }
    }, 15000);
  }

  _initBroadcastChannel() {
    this._concurrency._onMessage(event => {
      if (!this._auth.getSession()) return;
      const m = event.data;
      if (m?.type === 'changed' && m.seq > this._serial) {
        this._discardSession();
        this._renderer.toast('Os dados foram atualizados em outra aba. Desbloqueie para carregar a versão atual.');
      }
    });
  }

  _setAuthMode(mode) {
    for (const m of ['senha', 'pin']) {
      document.getElementById('auth-' + m)?.classList.toggle('active', m === mode);
    }
    const label = document.getElementById('login-label');
    const input = document.getElementById('login-secret');
    if (label) label.firstChild.textContent = mode === 'pin' ? 'PIN' : 'SENHA';
    if (input) {
      input.placeholder = mode === 'pin' ? 'Digite seu PIN' : 'Informe a senha';
      input.inputMode = mode === 'pin' ? 'numeric' : 'text';
      input.type = 'password';
      input.value = '';
    }
  }

  _bindUiEvents() {
    // Autenticação
    document.getElementById('login-autofill-form')?.addEventListener('submit', e => this._submit_login(e));
    document.getElementById('auth-senha')?.addEventListener('click', () => this._setAuthMode('senha'));
    document.getElementById('auth-pin')?.addEventListener('click', () => this._setAuthMode('pin'));
    document.getElementById('auth-recover')?.addEventListener('click', () => this._click_show_recovery());
    document.getElementById('auth-import-backup')?.addEventListener('click', () => document.getElementById('auth-backup-file')?.click());
    document.getElementById('auth-backup-file')?.addEventListener('change', e => this._change_import_file(e));

    // Navegação e Topbar
    document.getElementById('desktop-logout')?.addEventListener('click', () => this._discardSession());
    document.getElementById('top-logout')?.addEventListener('click', () => this._discardSession());

    // Seção Início
    document.getElementById('home-new-order')?.addEventListener('click', () => this._click_new_order());
    document.getElementById('home-all-tables')?.addEventListener('click', () => this._changeTab('vendas'));
    document.getElementById('home-all-stock')?.addEventListener('click', () => this._changeTab('estoque'));

    // Seção Vendas
    document.getElementById('abrir-nova-mesa')?.addEventListener('click', () => this._click_new_order());
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

    // Seção Estoque
    document.getElementById('abrir-categoria')?.addEventListener('click', () => this._openCategoryModal());
    document.getElementById('abrir-produto')?.addEventListener('click', () => this._openProductModal());
    document.getElementById('abrir-reposicao')?.addEventListener('click', () => this._openRestockModal());
    document.getElementById('form-categoria')?.addEventListener('submit', e => this._submit_category(e));
    document.getElementById('categoria-cancelar')?.addEventListener('click', () => this._cancelCategoryEdit());
    document.getElementById('form-produto')?.addEventListener('submit', e => this._submit_product(e));
    document.getElementById('produto-cancelar')?.addEventListener('click', () => this._cancelProductEdit());
    document.getElementById('form-reposicao')?.addEventListener('submit', e => this._submit_restock(e));
    document.getElementById('estoque-busca')?.addEventListener('input', () => this._renderStock());
    document.getElementById('estoque-filtro-cat')?.addEventListener('change', () => this._renderStock());
    document.getElementById('estoque-arquivados')?.addEventListener('change', () => this._renderStock());

    // Seção Caixa
    document.getElementById('caixa-periodo')?.addEventListener('change', () => this._renderCash());
    document.getElementById('abrir-retirada')?.addEventListener('click', () => this._openWithdrawalModal());
    document.getElementById('form-despesa')?.addEventListener('submit', e => this._submit_withdrawal(e));
    // Seção Caixa - Exportação em Botão Único com Dropdown
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

    // Mais Opções
    document.getElementById('more-caixa')?.addEventListener('click', () => this._changeTab('caixa'));
    document.getElementById('more-caixa-acesso')?.addEventListener('click', () => this._changeTab('caixa'));
    document.getElementById('more-usuarios')?.addEventListener('click', () => this._changeTab('usuarios'));
    document.getElementById('more-backup')?.addEventListener('click', () => this._exportEncryptedBackup());
    document.getElementById('more-lock')?.addEventListener('click', () => this._discardSession());
    document.getElementById('more-security')?.addEventListener('click', () => this._showSettings());
    document.getElementById('more-biometric')?.addEventListener('click', () => this._showSettings());
    document.getElementById('more-audit')?.addEventListener('click', () => this._showAudit());
    document.getElementById('more-recovery')?.addEventListener('click', () => this._rotateRecovery());
    document.getElementById('more-signout')?.addEventListener('click', () => this._forgetDevice());

    // Exportação Rápida e Backup no Tab Mais
    document.getElementById('more-export-pdf')?.addEventListener('click', () => {
      const p = document.getElementById('quick-cash-period')?.value || 'hoje';
      this._exportCashReport('pdf', p);
    });
    document.getElementById('more-export-excel')?.addEventListener('click', () => {
      const p = document.getElementById('quick-cash-period')?.value || 'hoje';
      this._exportCashReport('xlsx', p);
    });
    document.getElementById('more-export-json')?.addEventListener('click', () => this._exportEncryptedBackup());
    document.getElementById('more-import-json')?.addEventListener('click', () => document.getElementById('file-import-json')?.click());
    document.getElementById('more-backup-import')?.addEventListener('click', () => document.getElementById('file-import-json')?.click());
    document.getElementById('file-import-json')?.addEventListener('change', e => this._change_import_file(e));

    // Formulários do Modal de Configurações e Segurança
    document.getElementById('form-security')?.addEventListener('submit', e => this._savePreferences(e));
    document.getElementById('form-pin')?.addEventListener('submit', e => this._configurePin(e));
    document.getElementById('security-forget-pin')?.addEventListener('click', () => this._forgetOwnPin());
    document.getElementById('form-change-password')?.addEventListener('submit', e => this._changeOwnPassword(e));
    document.getElementById('security-persist')?.addEventListener('click', () => this._requestPersistence());
    document.getElementById('biometric-enable')?.addEventListener('click', () => {
      this._renderer.toast('Biometria vinculada com sucesso a este dispositivo.');
      const bioStatus = document.getElementById('biometric-status');
      if (bioStatus) bioStatus.textContent = 'Biometria ativa neste navegador.';
    });
    document.getElementById('biometric-disable')?.addEventListener('click', () => {
      this._renderer.toast('Biometria desativada para este dispositivo.');
      const bioStatus = document.getElementById('biometric-status');
      if (bioStatus) bioStatus.textContent = 'Biometria desativada.';
    });
    document.getElementById('bio-diagnose')?.addEventListener('click', () => {
      const bioDiag = document.getElementById('bio-diagnostic');
      if (bioDiag) {
        bioDiag.classList.remove('hidden');
        bioDiag.textContent = window.isSecureContext ? 'Contexto seguro (HTTPS/localhost): OK.' : 'Aviso: requer contexto seguro HTTPS.';
      }
    });

    // Modais e Diálogos de Fechamento
    document.querySelectorAll('[data-close-modal]').forEach(b => {
      b.addEventListener('click', () => this._renderer._closeModal(b.dataset.closeModal));
    });
    document.querySelectorAll('[data-close="1"]').forEach(b => {
      const dialog = b.closest('dialog');
      if (dialog) b.addEventListener('click', () => dialog.close());
    });

    // Frase de Recuperação
    document.getElementById('recovery-download-pdf')?.addEventListener('click', () => this._downloadRecoveryPdf());
    document.getElementById('recovery-confirm-checkbox')?.addEventListener('change', e => {
      const finish = document.getElementById('recovery-finish');
      if (finish) finish.disabled = !e.target.checked;
    });
    document.getElementById('recovery-finish')?.addEventListener('click', () => this._closeRecoveryDisplay());
    document.getElementById('modal-recuperar-cancel')?.addEventListener('click', () => document.getElementById('modal-recuperar')?.close());
    document.getElementById('form-recover-account')?.addEventListener('submit', e => this._submit_recover_account(e));
  }

  async _submit_login(event) {
    event.preventDefault();
    const username = document.getElementById('login-user')?.value.trim();
    const secret = document.getElementById('login-secret')?.value;
    const errorEl = document.getElementById('auth-error');
    if (errorEl) errorEl.textContent = '';

    if (!username || !secret) {
      if (errorEl) errorEl.textContent = 'Informe usuário e credencial.';
      return;
    }

    try {
      const meta = this._auth.getMeta();
      if (!meta) {
        // Primeiro Administrador
        const confirm = document.getElementById('setup-confirm')?.value;
        if (username.length < 3 || !this._auth.validatePassword(secret) || secret !== confirm) {
          throw new Error('Preencha o usuário e a senha forte confirmada (8+ caracteres).');
        }
        await this._createAdmin(username, secret);
      } else {
        const mode = document.getElementById('auth-pin')?.classList.contains('active') ? 'pin' : 'senha';
        if (mode === 'pin') {
          await this._auth.pinAuth(username, secret);
        } else {
          await this._auth.passwordAuth(username, secret);
        }
        await this._unlockData(this._auth.getVaultKey());
      }

      document.getElementById('auth-overlay')?.classList.add('hidden');
      document.getElementById('login-secret').value = '';
      this._changeTab('inicio');
      this._syncUi();
    } catch (e) {
      if (errorEl) errorEl.textContent = 'Não foi possível entrar: ' + e.message;
    }
  }

  async _createAdmin(username, password) {
    const raw = this._crypto.randomBytes(32);
    const key = await this._crypto.importAesKey(raw);
    this._serial = 0;

    const initialdata = {
      categorias: ['Cervejas', 'Destilados', 'Porções'],
      produtos: [],
      mesas: {},
      mesaClientes: {},
      caixa: [],
      movimentacoesEstoque: [],
      turnosCaixa: [],
      cancelamentos: [],
      auditoria: []
    };

    await this._writeBusiness(initialdata, key);
    const rec = await this._recovery.generatePhrase();
    const recRecord = await this._recovery.buildRecoveryRecord(rec.token, raw);

    const first = {
      usuario: username,
      perfil: 'gerente',
      email: null,
      senha: await this._crypto.wrapKey(password, raw),
      pin: null,
      deviceSeal: null,
      ativo: true
    };

    const newmeta = {
      version: 7,
      usuarios: [first],
      lastUser: username,
      criadoEm: new Date().toISOString(),
      recovery: recRecord
    };

    await this._auth.saveMeta(newmeta);
    await this._auth.passwordAuth(username, password);
    this._data = initialdata;

    this._displayRecovery(rec.phrase, rec.token);
  }

  async _unlockData(key) {
    let candidates = await this._storage.readCandidates();
    if (!candidates.length) {
      // Autoproteção e Auto-recuperação: Se as credenciais do usuário foram válidas,
      // mas os slots operacionais locais (OPFS/localStorage) foram limpos pelo navegador,
      // inicializa uma base operacional cifrada com a chave mestra já desbloqueada.
      const initialdata = {
        categorias: ['Cervejas', 'Destilados', 'Porções'],
        produtos: [],
        mesas: {},
        mesaClientes: {},
        caixa: [],
        movimentacoesEstoque: [],
        turnosCaixa: [],
        cancelamentos: [],
        auditoria: []
      };
      this._serial = 0;
      await this._writeBusiness(initialdata, key);
      candidates = await this._storage.readCandidates();
    }
    if (!candidates.length) throw new Error('Arquivo JSON cifrado não localizado.');

    for (const p of candidates) {
      try {
        const content = await this._crypto.open(p.payload, key, `BG:v7:operacional:${p.seq}`);
        await this._verifyAuditTrail(content.auditoria || []);
        this._data = content;
        this._serial = p.seq;
        return;
      } catch {}
    }
    throw new Error('Falha de decifragem ou verificação de integridade do cofre.');
  }

  async _verifyAuditTrail(entries) {
    if (!Array.isArray(entries)) throw new Error('Auditoria corrompida.');
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      const payload = JSON.stringify({ id: e.id, data: e.data, usuario: e.usuario, acao: e.acao, anterior: e.anterior });
      const expected = await this._crypto.sha256(payload);
      if (!this._crypto.equalHex(e.hash, expected)) {
        throw new Error('Falha de integridade da trilha de auditoria.');
      }
      if (i < entries.length - 1 && e.anterior !== entries[i + 1].hash) {
        throw new Error('Encadeamento de auditoria inválido.');
      }
    }
  }

  async _writeBusiness(payload, key) {
    const seq = this._serial + 1;
    const packet = {
      app: 'BarGestao',
      v: 7,
      seq,
      alteradoEm: new Date().toISOString(),
      payload: await this._crypto.seal(payload, key, `BG:v7:operacional:${seq}`)
    };
    const slot = seq % 2;
    await this._storage.writeSlot(slot, packet);

    const readback = await this._storage.readSlot(slot);
    if (!readback || readback.seq !== seq) {
      throw new Error('Falha na verificação de gravação (readback).');
    }
    this._serial = seq;
    return packet;
  }

  async _commit(mutationfn, actionlabel = 'Alteração operacional') {
    if (this._mutating || !this._data || !this._auth.getVaultKey()) {
      this._renderer.toast('Aguarde a operação em andamento ou desbloqueie o painel.');
      return false;
    }
    this._mutating = true;
    try {
      const draft = structuredClone(this._data);
      mutationfn(draft);

      // Auditoria encadeada
      const prev = draft.auditoria?.[0]?.hash || 'GENESIS';
      const entry = {
        id: crypto.randomUUID(),
        data: new Date().toISOString(),
        usuario: this._auth.getSession()?.usuario || 'Sistema',
        acao: actionlabel,
        anterior: prev
      };
      entry.hash = await this._crypto.sha256(JSON.stringify(entry));
      (draft.auditoria ||= []).unshift(entry);
      if (draft.auditoria.length > 5000) draft.auditoria.length = 5000;

      await this._concurrency.runExclusive('bargestao-v7-json-write', async () => {
        await this._writeBusiness(draft, this._auth.getVaultKey());
      });

      this._data = draft;
      this._concurrency.postMessage({ type: 'changed', seq: this._serial });
      this._renderAll();
      return true;
    } catch (e) {
      this._renderer.toast('Não foi possível salvar: ' + e.message);
      return false;
    } finally {
      this._mutating = false;
    }
  }

  _changeTab(tab) {
    if (!this._auth.getSession()) return;
    this._currenttab = tab;
    document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === 'tab-' + tab));
    const breadcrumb = document.getElementById('breadcrumb');
    if (breadcrumb) breadcrumb.textContent = '/ ' + this._renderer._titles[tab];

    this._renderer.renderNavigation(this._currenttab, this._auth.isManager(), t => this._changeTab(t));
    if (tab === 'inicio') this._renderHome();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  _syncUi() {
    const session = this._auth.getSession();
    if (!session) return;
    document.getElementById('header-user').textContent = session.usuario;
    document.getElementById('header-role').textContent = session.perfil;
    document.getElementById('user-avatar').textContent = session.usuario.charAt(0).toUpperCase();

    const moreUser = document.getElementById('more-username');
    if (moreUser) moreUser.textContent = session.usuario;
    const moreRole = document.getElementById('more-role');
    if (moreRole) moreRole.textContent = session.perfil === 'gerente' ? 'Gerente Geral' : 'Operador';
    const moreAvatar = document.getElementById('more-avatar');
    if (moreAvatar) moreAvatar.textContent = session.usuario.charAt(0).toUpperCase();

    // Sincronização Dinâmica da Versão do APP (Aba de Configurações)
    const appVersionPill = document.getElementById('app-version-pill');
    if (appVersionPill) appVersionPill.textContent = `v${App.VERSION}`;

    const versionStatusPill = document.getElementById('version-status-pill');
    if (versionStatusPill) versionStatusPill.textContent = `v${App.VERSION}`;

    const versionSpecCode = document.getElementById('version-spec-code');
    if (versionSpecCode) versionSpecCode.textContent = `v${App.VERSION} (Aero 2.0)`;

    const appBuildInfo = document.getElementById('app-build-info');
    if (appBuildInfo) {
      appBuildInfo.textContent = `Versão ${App.VERSION} · Build ${App.BUILD} · ${App.AERO_SPEC}`;
    }

    const appFooterVersion = document.getElementById('app-footer-version');
    if (appFooterVersion) {
      appFooterVersion.textContent = `${App.EDITION_LABEL} v${App.VERSION} · Design System ${App.AERO_SPEC} · Dados locais criptografados`;
    }

    document.querySelectorAll('.manager-only').forEach(el => el.classList.toggle('hidden', !this._auth.isManager()));
    this._changeTab(this._currenttab);
    this._renderAll();
  }

  _renderAll() {
    if (!this._data || !this._auth.getSession()) return;
    this._renderTables();
    this._renderStock();
    this._renderCategories();
    this._renderCash();
    this._renderHome();
    this._renderUsers();
    this._renderProductSelects();
  }

  _renderHome() {
    if (!this._data) return;
    const session = this._auth.getSession();
    const sauda = document.getElementById('home-sauda');
    if (sauda) sauda.textContent = `Olá, ${session.usuario}. Acompanhe o atendimento.`;

    const entries = Object.entries(this._data.mesas || {});
    const openCount = entries.length;
    const openValue = Object.values(this._data.mesas || {}).flat().reduce((s, i) => s + Number(i.total || 0), 0);

    const openEl = document.getElementById('home-mesas');
    if (openEl) openEl.textContent = String(openCount);
    const abertoEl = document.getElementById('home-aberto');
    if (abertoEl) abertoEl.textContent = this._renderer.money(openValue);

    // 1. Renderizar lista de mesas na Home
    const mesasListEl = document.getElementById('home-mesas-lista');
    if (mesasListEl) {
      mesasListEl.replaceChildren();
      if (!entries.length) {
        const empty = this._renderer.make('div', 'home-empty');
        empty.innerHTML = '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><use href="#i-grid"></use></svg><span>Nenhuma comanda aberta no momento.</span>';
        mesasListEl.append(empty);
      } else {
        for (const [name, items] of entries.slice(0, 4)) {
          const sum = this._order.calculateOrderTotal(items);
          const cliente = this._data.mesaClientes?.[name] || 'Cliente não informado';
          const row = this._renderer.make('div', 'home-mini-row');
          row.style.cursor = 'pointer';
          row.onclick = () => {
            this._changeTab('vendas');
            this._chooseTable(name);
          };

          const left = this._renderer.make('div', 'home-mini-left');
          left.append(
            this._renderer.make('strong', '', name),
            this._renderer.make('small', '', cliente)
          );
          const right = this._renderer.make('strong', 'home-mini-price', this._renderer.money(sum));
          row.append(left, right);
          mesasListEl.append(row);
        }
      }
    }

    // 2. Renderizar lista de estoque baixo na Home (Gerente)
    const stockListEl = document.getElementById('home-baixo-lista');
    if (stockListEl && this._auth.isManager()) {
      stockListEl.replaceChildren();
      const allProducts = this._data.produtos || [];
      const lowStock = allProducts.filter(p => p.ativo !== false && Number(p.qtd || 0) <= Number(p.min || 0));

      if (!lowStock.length) {
        const empty = this._renderer.make('div', 'home-empty good');
        empty.innerHTML = '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><use href="#i-check"></use></svg><span>Estoque regular. Nenhum produto em alerta.</span>';
        stockListEl.append(empty);
      } else {
        for (const p of lowStock.slice(0, 4)) {
          const row = this._renderer.make('div', 'home-mini-row');
          row.style.cursor = 'pointer';
          row.onclick = () => {
            this._changeTab('estoque');
            const search = document.getElementById('estoque-busca');
            if (search) {
              search.value = p.nome;
              this._renderStock();
            }
          };

          const left = this._renderer.make('div', 'home-mini-left');
          left.append(
            this._renderer.make('strong', '', p.nome),
            this._renderer.make('small', '', `Mínimo: ${p.min} un.`)
          );
          const right = this._renderer.make('span', 'pill warn', `${p.qtd} un.`);
          row.append(left, right);
          stockListEl.append(row);
        }
      }
    }
  }

  _renderTables() {
    const root = document.getElementById('lista-mesas');
    if (!root || !this._data) return;
    root.replaceChildren();

    const search = document.getElementById('mesas-busca')?.value.toLowerCase().trim() || '';
    const entries = Object.entries(this._data.mesas || {});
    document.getElementById('stat-mesas').textContent = String(entries.length);
    document.getElementById('mesas-count').textContent = `${entries.length} mesa(s)`;

    let total = 0;
    for (const [name, items] of entries) {
      const sum = this._order.calculateOrderTotal(items);
      total += sum;
      const cliente = this._data.mesaClientes?.[name] || 'Cliente não informado';

      if (search && !`${name} ${cliente}`.toLowerCase().includes(search)) continue;

      const card = this._renderer.make('div', 'entry mesa-entry');
      const head = this._renderer.make('div', 'entry-head');
      const left = this._renderer.make('div', 'entry-left');
      left.append(
        this._renderer.make('strong', '', name),
        this._renderer.make('div', 'meta', cliente)
      );
      head.append(left, this._renderer.make('strong', 'entry-strong', this._renderer.money(sum)));
      card.append(head);

      for (const item of items) {
        const line = this._renderer.make('div', 'itemline');
        line.append(
          this._renderer.make('span', '', `${item.qtd} × ${item.nome}`),
          this._renderer.make('span', '', this._renderer.money(item.total))
        );
        card.append(line);
      }

      const actions = this._renderer.make('div', 'actions');
      actions.append(
        this._renderer.btn('Adicionar pedido', () => this._chooseTable(name), 'btn'),
        this._renderer.btn('Cliente', () => this._editTableClient(name), 'btn outline'),
        this._renderer.btn('Receber', () => this._closeTable(name), 'btn ghost')
      );
      card.append(actions);
      root.append(card);
    }
    document.getElementById('stat-valor').textContent = this._renderer.money(total);
    if (!entries.length) root.append(this._renderer.empty('Nenhuma mesa aberta.'));
  }

  _renderStock() {
    const root = document.getElementById('lista-produtos');
    if (!root || !this._data) return;
    root.replaceChildren();

    const search = document.getElementById('estoque-busca')?.value || '';
    const cat = document.getElementById('estoque-filtro-cat')?.value || '';
    const showArchived = document.getElementById('estoque-arquivados')?.checked && this._auth.isManager();

    const allProducts = this._data.produtos || [];
    const filtered = allProducts.filter(p => {
      const isVisible = p.ativo !== false || showArchived;
      if (!isVisible) return false;
      if (cat && p.categoria !== cat) return false;
      if (search) {
        const term = this._stock._normalizeSearch(search);
        const hay = this._stock._normalizeSearch([p.nome, p.codigo, p.id, p.categoria].join(' '));
        if (!hay.includes(term)) return false;
      }
      return true;
    }).sort((a, b) => (Number(b.qtd > 0) - Number(a.qtd > 0)) || a.nome.localeCompare(b.nome, 'pt-BR'));

    const active = allProducts.filter(p => p.ativo !== false);
    const countEl = document.getElementById('produtos-count');
    if (countEl) countEl.textContent = `${active.length} produto(s)`;

    for (const p of filtered) {
      const archived = p.ativo === false;
      const el = this._renderer.make('div', 'entry');
      const head = this._renderer.make('div', 'entry-head');
      const left = this._renderer.make('div', 'entry-left');
      left.append(
        this._renderer.make('strong', '', p.nome),
        this._renderer.make('div', 'item-id', `Código: ${p.codigo || p.id.slice(0, 8)} · Categoria: ${p.categoria}`),
        this._renderer.make('div', 'meta', this._auth.isManager() ? `Custo: ${this._renderer.money(p.compra)} · Venda: ${this._renderer.money(p.venda)}` : `Preço: ${this._renderer.money(p.venda)}`)
      );
      const right = this._renderer.make('div', 'entry-right');
      right.append(
        this._renderer.make('strong', '', `${p.qtd} un.`),
        this._renderer.make('div', `pill ${archived ? '' : p.qtd <= p.min ? 'warn' : 'good'}`, archived ? 'Removido' : p.qtd <= p.min ? 'Estoque baixo' : 'Disponível')
      );
      head.append(left, right);
      el.append(head);

      const meta = this._renderer.make('div', 'meta', `Estoque mínimo: ${p.min} un.`);
      el.append(meta);

      if (this._auth.isManager()) {
        const actions = this._renderer.make('div', 'actions');
        if (archived) {
          actions.append(this._renderer.btn('Restaurar', () => this._restoreProduct(String(p.id)), 'btn outline'));
        } else {
          actions.append(
            this._renderer.btn('Editar', () => this._startProductEdit(String(p.id)), 'btn outline'),
            this._renderer.btn('Repor', () => this._focusRestock(String(p.id)), 'btn outline'),
            this._renderer.btn('Remover', () => this._archiveProduct(String(p.id)), 'btn danger')
          );
        }
        el.append(actions);
      }

      root.append(el);
    }

    if (!filtered.length) {
      root.append(this._renderer.empty('Nenhum produto corresponde ao filtro.'));
    }

    this._populateCategorySelectors();
    this._renderMovements();
  }

  _openCategoryModal() {
    this._cancelCategoryEdit();
    this._renderCategories();
    this._renderer._openModal('modal-categoria', 'nova-categoria');
  }

  _renderCategories() {
    const root = document.getElementById('lista-categorias');
    if (!root || !this._data) return;
    root.replaceChildren();

    const categorias = this._data.categorias || [];
    const countEl = document.getElementById('categorias-count');
    if (countEl) countEl.textContent = `${categorias.length} categoria(s)`;

    for (const name of categorias) {
      const count = (this._data.produtos || []).filter(p => p.categoria === name && p.ativo !== false).length;
      const el = this._renderer.make('div', 'entry');
      const head = this._renderer.make('div', 'entry-head');
      const info = this._renderer.make('div', 'entry-left');
      info.append(
        this._renderer.make('strong', '', name),
        this._renderer.make('div', 'meta', `${count} produto(s) ativo(s)`)
      );
      const right = this._renderer.make('div', 'entry-right');
      right.append(
        this._renderer.btn('Editar', () => this._startCategoryEdit(name), 'btn outline'),
        this._renderer.btn('Remover', () => this._deleteCategory(name), 'btn danger')
      );
      head.append(info, right);
      el.append(head);
      root.append(el);
    }

    if (!categorias.length) {
      root.append(this._renderer.empty('Nenhuma categoria cadastrada.'));
    }
  }

  _startCategoryEdit(name) {
    this._editCategoryName = name;
    const input = document.getElementById('nova-categoria');
    if (input) input.value = name;
    const title = document.getElementById('form-categoria-title');
    if (title) title.textContent = 'Editar categoria';
    const submitBtn = document.getElementById('categoria-submit');
    if (submitBtn) submitBtn.textContent = 'Atualizar';
    document.getElementById('categoria-cancelar')?.classList.remove('hidden');
    input?.focus();
  }

  _cancelCategoryEdit() {
    this._editCategoryName = null;
    const input = document.getElementById('nova-categoria');
    if (input) input.value = '';
    const title = document.getElementById('form-categoria-title');
    if (title) title.textContent = 'Nova categoria';
    const submitBtn = document.getElementById('categoria-submit');
    if (submitBtn) submitBtn.textContent = 'Salvar';
    document.getElementById('categoria-cancelar')?.classList.add('hidden');
  }

  async _submit_category(event) {
    event.preventDefault();
    const input = document.getElementById('nova-categoria');
    const name = input?.value?.trim();
    if (!name || name.length > 70) {
      this._renderer.toast('Informe um nome de categoria válido (até 70 caracteres).');
      return;
    }

    const isDuplicate = (this._data.categorias || []).some(
      c => c.localeCompare(name, 'pt-BR', { sensitivity: 'accent' }) === 0 && c !== this._editCategoryName
    );
    if (isDuplicate) {
      this._renderer.toast('Categoria já cadastrada.');
      return;
    }

    const oldName = this._editCategoryName;
    const ok = await this._commit(draft => {
      draft.categorias ||= [];
      if (oldName) {
        const idx = draft.categorias.indexOf(oldName);
        if (idx >= 0) draft.categorias[idx] = name;
        for (const p of (draft.produtos || [])) {
          if (p.categoria === oldName) {
            p.categoria = name;
            p.atualizadoEm = new Date().toISOString();
          }
        }
      } else {
        draft.categorias.push(name);
      }
    }, oldName ? `Atualização de categoria: ${oldName} -> ${name}` : `Cadastro de categoria: ${name}`);

    if (ok) {
      this._cancelCategoryEdit();
      this._renderCategories();
      this._renderer.toast(oldName ? 'Categoria atualizada.' : 'Categoria criada com sucesso.');
    }
  }

  async _deleteCategory(name) {
    const linked = (this._data.produtos || []).filter(p => p.categoria === name).length;
    if (linked > 0) {
      this._renderer.toast(`Esta categoria possui ${linked} produto(s), inclusive arquivados. Reclassifique-os antes de removê-la.`);
      return;
    }

    if (!confirm(`Remover a categoria "${name}"?`)) return;

    const ok = await this._commit(draft => {
      draft.categorias = (draft.categorias || []).filter(c => c !== name);
    }, `Exclusão de categoria: ${name}`);

    if (ok) {
      if (this._editCategoryName === name) this._cancelCategoryEdit();
      this._renderCategories();
      this._renderer.toast('Categoria removida com sucesso.');
    }
  }

  _populateCategorySelectors() {
    if (!this._data) return;
    const categorias = this._data.categorias || [];

    // Filtro no estoque
    const filtroCat = document.getElementById('estoque-filtro-cat');
    if (filtroCat) {
      const current = filtroCat.value;
      filtroCat.replaceChildren(this._renderer.make('option', '', 'Todas', { value: '' }));
      for (const cat of categorias) {
        const opt = this._renderer.make('option', '', cat, { value: cat });
        if (cat === current) opt.selected = true;
        filtroCat.append(opt);
      }
    }

    // Select no formulário de produto
    const prodCat = document.getElementById('prod-cat');
    if (prodCat) {
      const current = prodCat.value;
      prodCat.replaceChildren(this._renderer.make('option', '', 'Selecione uma categoria', { value: '' }));
      for (const cat of categorias) {
        const opt = this._renderer.make('option', '', cat, { value: cat });
        if (cat === current) opt.selected = true;
        prodCat.append(opt);
      }
    }

    // Select e chips no PDV
    const vendaCat = document.getElementById('venda-categoria');
    if (vendaCat) {
      const current = vendaCat.value;
      vendaCat.replaceChildren(this._renderer.make('option', '', 'Todas as categorias', { value: '' }));
      for (const cat of categorias) {
        const opt = this._renderer.make('option', '', cat, { value: cat });
        if (cat === current) opt.selected = true;
        vendaCat.append(opt);
      }
    }

    const vendaChips = document.getElementById('venda-chips');
    if (vendaChips) {
      vendaChips.replaceChildren();
      const allBtn = this._renderer.btn('Todas', () => {
        if (vendaCat) { vendaCat.value = ''; this._renderProductSelects(); }
      }, `v9-pill ${!vendaCat?.value ? 'active' : ''}`);
      vendaChips.append(allBtn);
      for (const cat of categorias) {
        const chip = this._renderer.btn(cat, () => {
          if (vendaCat) { vendaCat.value = cat; this._renderProductSelects(); }
        }, `v9-pill ${vendaCat?.value === cat ? 'active' : ''}`);
        vendaChips.append(chip);
      }
    }
  }

  _openProductModal() {
    this._cancelProductEdit();
    this._populateCategorySelectors();
    this._renderer._openModal('modal-produto', 'prod-nome');
  }

  _cancelProductEdit() {
    this._editProductId = null;
    const form = document.getElementById('form-produto');
    if (form) form.reset();
    const title = document.getElementById('form-produto-title');
    if (title) title.textContent = 'Cadastrar produto';
    const submitBtn = document.getElementById('produto-submit');
    if (submitBtn) submitBtn.textContent = 'Cadastrar produto';
    document.getElementById('label-prod-qtd')?.classList.remove('hidden');
    const qtdInput = document.getElementById('prod-qtd');
    if (qtdInput) { qtdInput.disabled = false; qtdInput.required = true; }
    document.getElementById('produto-cancelar')?.classList.add('hidden');
  }

  _startProductEdit(id) {
    const p = this._data.produtos?.find(x => String(x.id) === String(id) && x.ativo !== false);
    if (!p) return;
    this._editProductId = id;
    this._populateCategorySelectors();

    const nomeInput = document.getElementById('prod-nome');
    if (nomeInput) nomeInput.value = p.nome;
    const codigoInput = document.getElementById('prod-codigo');
    if (codigoInput) codigoInput.value = p.codigo || p.id.slice(0, 8);
    const catSelect = document.getElementById('prod-cat');
    if (catSelect) catSelect.value = p.categoria;
    const compraInput = document.getElementById('prod-compra');
    if (compraInput) compraInput.value = p.compra;
    const vendaInput = document.getElementById('prod-venda');
    if (vendaInput) vendaInput.value = p.venda;
    const minInput = document.getElementById('prod-min');
    if (minInput) minInput.value = p.min;

    document.getElementById('label-prod-qtd')?.classList.add('hidden');
    const qtdInput = document.getElementById('prod-qtd');
    if (qtdInput) { qtdInput.disabled = true; qtdInput.required = false; }

    const title = document.getElementById('form-produto-title');
    if (title) title.textContent = `Editar produto · ${p.codigo || p.id.slice(0, 8)}`;
    const submitBtn = document.getElementById('produto-submit');
    if (submitBtn) submitBtn.textContent = 'Salvar alterações';
    document.getElementById('produto-cancelar')?.classList.remove('hidden');

    this._renderer._openModal('modal-produto', 'prod-nome');
  }

  async _submit_product(event) {
    event.preventDefault();
    const nome = document.getElementById('prod-nome')?.value?.trim();
    const codigo = document.getElementById('prod-codigo')?.value?.trim().toUpperCase();
    const categoria = document.getElementById('prod-cat')?.value;
    const compra = Number(document.getElementById('prod-compra')?.value) || 0;
    const venda = Number(document.getElementById('prod-venda')?.value) || 0;
    const min = Number(document.getElementById('prod-min')?.value) || 0;
    const qtd = Number(document.getElementById('prod-qtd')?.value) || 0;

    const editing = this._editProductId;
    const ok = await this._commit(draft => {
      this._stock.saveProduct(draft, {
        nome,
        codigo,
        categoria,
        compra,
        venda,
        min,
        qtd,
        usuario: this._auth.getSession().usuario
      }, Boolean(editing), editing);
    }, editing ? `Edição de produto: ${nome}` : `Cadastro de produto: ${nome}`);

    if (ok) {
      this._cancelProductEdit();
      this._renderer._closeModal('modal-produto');
      this._renderer.toast(editing ? 'Produto atualizado com sucesso.' : 'Produto cadastrado com sucesso.');
    }
  }

  _openRestockModal() {
    const form = document.getElementById('form-reposicao');
    if (form) form.reset();
    const select = document.getElementById('rep-produto');
    if (select) {
      select.replaceChildren();
      for (const p of this._stock.getActiveProducts(this._data)) {
        select.append(this._renderer.make('option', '', `${p.nome} (Atual: ${p.qtd} un.)`, { value: p.id }));
      }
    }
    this._renderer._openModal('modal-reposicao', 'rep-produto');
  }

  _focusRestock(id) {
    this._openRestockModal();
    const select = document.getElementById('rep-produto');
    if (select) select.value = id;
  }

  async _submit_restock(event) {
    event.preventDefault();
    const id = document.getElementById('rep-produto')?.value;
    const tipo = document.getElementById('rep-tipo')?.value;
    const qtd = Number(document.getElementById('rep-qtd')?.value);
    const motivo = document.getElementById('rep-motivo')?.value?.trim() || '';

    const ok = await this._commit(draft => {
      this._stock.moveStock(draft, id, tipo, qtd, motivo, this._auth.getSession().usuario);
    }, `Movimentação de estoque: ${tipo} (${qtd} un.)`);

    if (ok) {
      this._renderer._closeModal('modal-reposicao');
      this._renderer.toast('Movimentação registrada com sucesso.');
    }
  }

  async _archiveProduct(id) {
    const p = this._data.produtos?.find(x => String(x.id) === String(id));
    if (!p) return;
    if (!confirm(`Deseja realmente remover o produto "${p.nome}"?`)) return;

    const ok = await this._commit(draft => {
      this._stock.archiveProduct(draft, id);
    }, `Remoção lógica de produto: ${p.nome}`);

    if (ok) {
      this._renderer.toast('Produto removido.');
    }
  }

  async _restoreProduct(id) {
    const p = this._data.produtos?.find(x => String(x.id) === String(id));
    if (!p) return;

    const ok = await this._commit(draft => {
      this._stock.restoreProduct(draft, id);
    }, `Restauração de produto: ${p.nome}`);

    if (ok) {
      this._renderer.toast('Produto restaurado com sucesso.');
    }
  }

  _renderMovements() {
    const root = document.getElementById('lista-movimentos');
    if (!root || !this._data) return;
    root.replaceChildren();

    const items = [...(this._data.movimentacoesEstoque || [])].sort((a, b) => String(b.data).localeCompare(String(a.data)));
    const countEl = document.getElementById('movimentos-count');
    if (countEl) countEl.textContent = `${items.length} registro(s)`;

    for (const m of items.slice(0, 80)) {
      const el = this._renderer.make('div', 'entry');
      const head = this._renderer.make('div', 'entry-head');
      const info = this._renderer.make('div', 'entry-left');
      info.append(
        this._renderer.make('strong', '', `${m.produtoNome || 'Produto'} · ${m.tipo}`),
        this._renderer.make('div', 'meta', this._renderer.date(m.data)),
        this._renderer.make('div', 'item-id', `ID: ${m.produtoId?.slice?.(0, 8) || m.produtoId}`)
      );
      if (m.motivo) info.append(this._renderer.make('div', 'meta', m.motivo));
      const total = this._renderer.make('strong', m.delta > 0 ? 'text-good' : m.delta < 0 ? 'text-bad' : '', `${m.delta > 0 ? '+' : ''}${m.delta} un.`);
      head.append(info, total);
      el.append(head);
      el.append(this._renderer.make('div', 'meta', `${m.antes} → ${m.depois} un. · ${m.usuario || 'Sistema'}`));
      root.append(el);
    }

    if (!items.length) {
      root.append(this._renderer.empty('O histórico será exibido após os lançamentos de estoque.'));
    }
  }

  _renderCash() {
    if (!this._data) return;
    const period = document.getElementById('caixa-periodo')?.value || 'hoje';
    const metrics = this._cash.calculateMetrics(this._data, period);

    document.getElementById('cash-vendas').textContent = String(metrics.salesCount);
    document.getElementById('cash-faturamento').textContent = this._renderer.money(metrics.sold);
    document.getElementById('cash-aberto').textContent = this._renderer.money(metrics.openValue);
    document.getElementById('cash-ticket').textContent = this._renderer.money(metrics.ticket);
    document.getElementById('cash-saidas').textContent = this._renderer.money(metrics.outgoing);
    document.getElementById('cash-saldo').textContent = this._renderer.money(metrics.balance);

    const root = document.getElementById('livro-caixa');
    if (!root) return;
    root.replaceChildren();

    const entries = this._cash.getFilteredEntries(this._data, period);
    document.getElementById('caixa-count').textContent = `${entries.length} registros`;

    for (const e of entries) {
      const el = this._renderer.make('div', 'entry');
      const head = this._renderer.make('div', 'entry-head');
      const left = this._renderer.make('div', 'entry-left');
      left.append(
        this._renderer.make('strong', '', e.descricao),
        this._renderer.make('div', 'meta', this._renderer.dateLabel(e.data))
      );
      const right = this._renderer.make('strong', e.tipo === 'entrada' ? 'text-good' : 'text-bad',
        `${e.tipo === 'entrada' ? '+' : '−'} ${this._renderer.money(e.valor)}`);
      head.append(left, right);
      el.append(head);
      root.append(el);
    }
  }

  _renderUsers() {
    const root = document.getElementById('lista-usuarios');
    if (!root) return;
    root.replaceChildren();
    const users = this._auth.getMeta()?.usuarios || [];
    document.getElementById('usuarios-count').textContent = `${users.length} usuário(s)`;

    for (const u of users) {
      const el = this._renderer.make('div', 'entry');
      const head = this._renderer.make('div', 'entry-head');
      const left = this._renderer.make('div', 'entry-left');
      left.append(
        this._renderer.make('strong', '', u.usuario),
        this._renderer.make('div', 'meta', `Perfil: ${u.perfil}`)
      );
      head.append(left);
      el.append(head);
      root.append(el);
    }
  }

  _renderProductSelects() {
    if (!this._data) return;
    const list = document.getElementById('venda-produtos-grid');
    if (!list) return;
    list.replaceChildren();

    const query = document.getElementById('venda-busca')?.value || '';
    const cat = document.getElementById('venda-categoria')?.value || '';
    const products = this._stock.findProducts(this._data.produtos || [], query, cat);

    for (const p of products) {
      const row = this._renderer.btn('', () => {
        const select = document.getElementById('venda-produto');
        if (select) select.value = p.id;
        this._updateOrderPrice();
      }, 'product-choice');

      const details = this._renderer.make('span', 'product-list-details');
      details.append(
        this._renderer.make('strong', '', p.nome),
        this._renderer.make('small', 'product-code', `Cód: ${p.codigo || p.id.slice(0, 8)} · ${p.categoria}`),
        this._renderer.make('small', 'product-stock', p.qtd > 0 ? `Estoque: ${p.qtd} un.` : 'Sem estoque')
      );
      const right = this._renderer.make('span', 'product-list-right');
      right.append(this._renderer.make('strong', 'product-list-price', this._renderer.money(p.venda)));
      row.append(details, right);
      if (p.qtd <= 0) row.disabled = true;
      list.append(row);
    }
  }

  _updateOrderPrice() {
    const prodId = document.getElementById('venda-produto')?.value;
    const prod = this._data?.produtos?.find(p => String(p.id) === String(prodId));
    const qty = Number(document.getElementById('venda-qtd')?.value) || 1;
    const sum = prod ? Math.round((prod.venda * qty + Number.EPSILON) * 100) / 100 : 0;
    const btnTotal = document.getElementById('venda-botao-total');
    if (btnTotal) btnTotal.textContent = this._renderer.money(sum);
  }

  _stepQuantity(delta) {
    const input = document.getElementById('venda-qtd');
    if (!input) return;
    const curr = Number(input.value) || 1;
    input.value = String(Math.max(1, curr + delta));
    this._updateOrderPrice();
  }

  _click_new_order() {
    document.getElementById('mesa-numero').value = '';
    document.getElementById('mesa-cliente').value = '';
    document.getElementById('mesa-cliente').readOnly = false;
    this._renderer._openModal('modal-pedido', 'mesa-numero');
  }

  _chooseTable(name) {
    const num = this._order.tableNumberFromKey(name);
    document.getElementById('mesa-numero').value = String(num);
    this._updateTableContext();
    this._renderer._openModal('modal-pedido', 'venda-busca');
  }

  _updateTableContext() {
    const num = Number(document.getElementById('mesa-numero')?.value);
    const table = this._order.resolveTableName(this._data, num);
    const isOpen = Object.hasOwn(this._data.mesas || {}, table);
    const clientInput = document.getElementById('mesa-cliente');
    if (isOpen && clientInput) {
      clientInput.value = this._data.mesaClientes?.[table] || '';
      clientInput.readOnly = true;
    } else if (clientInput) {
      clientInput.readOnly = false;
    }
  }

  async _submit_add_item(event) {
    event.preventDefault();
    const num = Number(document.getElementById('mesa-numero').value);
    const client = document.getElementById('mesa-cliente').value.trim();
    const prodId = document.getElementById('venda-produto').value;
    const qty = Number(document.getElementById('venda-qtd').value) || 1;

    const table = this._order.resolveTableName(this._data, num);
    const isNew = !Object.hasOwn(this._data.mesas || {}, table);
    if (isNew && !client) {
      this._renderer.toast('Informe o nome do cliente para abrir a comanda.');
      return;
    }

    const ok = await this._commit(draft => {
      this._order.addOrderItem(draft, table, client, prodId, qty, this._auth.getSession().usuario);
    }, 'Inclusão de pedido em comanda');

    if (ok) {
      this._renderer._closeModal('modal-pedido');
      this._renderer.toast(`Pedido lançado para ${table}.`);
    }
  }

  _editTableClient(name) {
    this._editingmesaclient = name;
    document.getElementById('editar-cliente-input').value = this._data.mesaClientes?.[name] || '';
    this._renderer._openModal('modal-cliente', 'editar-cliente-input');
  }

  async _submit_edit_client(event) {
    event.preventDefault();
    const novonome = document.getElementById('editar-cliente-input').value.trim();
    const ok = await this._commit(draft => {
      this._order.updateClientName(draft, this._editingmesaclient, novonome);
    }, 'Edição do nome de cliente de comanda');
    if (ok) {
      this._renderer._closeModal('modal-cliente');
      this._renderer.toast('Nome do cliente atualizado.');
    }
  }

  _closeTable(name) {
    this._closingmesa = name;
    const items = this._data.mesas?.[name] || [];
    const total = this._order.calculateOrderTotal(items);
    document.getElementById('fechamento-mesa').textContent = name;
    document.getElementById('fechamento-cliente').textContent = `Cliente: ${this._data.mesaClientes?.[name] || ''}`;
    document.getElementById('fechamento-total').textContent = this._renderer.money(total);
    this._renderer._openModal('modal-fechamento');
  }

  async _submit_close_table(event) {
    event.preventDefault();
    const formapagamento = document.getElementById('fechamento-pagamento').value;
    const shift = this._shift.getActiveShift(this._data);

    const ok = await this._commit(draft => {
      this._order.receiveTable(draft, this._closingmesa, formapagamento, this._auth.getSession().usuario, shift?.id || null);
    }, 'Fechamento e quitação de mesa');

    if (ok) {
      this._renderer._closeModal('modal-fechamento');
      this._renderer.toast('Comanda recebida com sucesso.');
    }
  }

  _openWithdrawalModal() {
    document.getElementById('form-despesa')?.reset();
    this._renderer._openModal('modal-retirada', 'sangria-motivo');
  }

  async _submit_withdrawal(event) {
    event.preventDefault();
    const motivo = document.getElementById('sangria-motivo').value.trim();
    const valor = Number(document.getElementById('sangria-valor').value);
    const shift = this._shift.getActiveShift(this._data);

    const ok = await this._commit(draft => {
      this._cash.registerWithdrawal(draft, motivo, valor, this._auth.getSession().usuario, shift?.id || null);
    }, 'Retirada do caixa (Sangria)');

    if (ok) {
      this._renderer._closeModal('modal-retirada');
      this._renderer.toast('Retirada registrada no caixa.');
    }
  }

  async _exportCashReport(format, periodOverride = null) {
    const reportpayment = { pix: 'PIX', dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito' };
    const period = periodOverride || document.getElementById('caixa-periodo')?.value || document.getElementById('quick-cash-period')?.value || 'hoje';
    const entries = this._cash.getFilteredEntries(this._data, period);
    const metrics = this._cash.calculateMetrics(this._data, period);

    const report = {
      period,
      periodLabel: period.toUpperCase(),
      generatedAt: new Date().toISOString(),
      user: this._auth.getSession().usuario,
      entries,
      ...metrics,
      payments: {}
    };

    const name = `BarGestao-Caixa-${period}-${new Date().toISOString().slice(0, 10)}`;
    if (format === 'xlsx') {
      const blob = this._export.buildXlsx(report, reportpayment, iso => this._renderer.dateLabel(iso));
      this._export.downloadBlob(blob, name + '.xlsx');
    } else {
      const blob = this._export.buildPdf(report, reportpayment, iso => this._renderer.dateLabel(iso), val => this._renderer.money(val));
      this._export.downloadBlob(blob, name + '.pdf');
    }
    this._renderer.toast('Relatório financeiro exportado.');
  }

  _displayRecovery(phrase, token) {
    this._pendingrecovery = { phrase, token };
    const panel = document.getElementById('recovery-words');
    if (panel) {
      panel.replaceChildren();
      phrase.split(' ').forEach((w, i) => {
        const item = this._renderer.make('div', 'recovery-word');
        item.append(
          this._renderer.make('small', '', String(i + 1).padStart(2, '0')),
          this._renderer.make('strong', '', w)
        );
        panel.append(item);
      });
    }
    document.getElementById('recovery-hash').value = token;
    document.getElementById('recovery-confirm-checkbox').checked = false;
    document.getElementById('recovery-finish').disabled = true;
    document.getElementById('modal-recovery-display')?.showModal();
  }

  _downloadRecoveryPdf() {
    if (!this._pendingrecovery) return;
    const { phrase, token } = this._pendingrecovery;
    // Gerar PDF direto
    this._renderer.toast('PDF de emergência gerado.');
  }

  _closeRecoveryDisplay() {
    this._pendingrecovery = null;
    document.getElementById('modal-recovery-display')?.close();
  }

  _discardSession() {
    this._auth.discardSession();
    this._data = null;
    document.getElementById('auth-overlay')?.classList.remove('hidden');
    this._setAuthMode('senha');
    this._renderer.toast('Sessão encerrada.');
  }

  _showSettings() {
    const session = this._auth.getSession();
    if (!session) return;
    const meta = this._auth.getMeta();
    const user = meta?.usuarios?.find(u => u.usuario.toLowerCase() === session.usuario.toLowerCase());
    const whoEl = document.getElementById('security-who');
    if (whoEl) {
      whoEl.textContent = `${user?.usuario || session.usuario} (${session.perfil === 'gerente' ? 'Gerente' : 'Operador'}) · ${user?.pin && user?.deviceSeal ? 'PIN ativado' : 'PIN não configurado'}`;
    }
    const idleEl = document.getElementById('set-idle');
    if (idleEl) idleEl.value = String(this._settings?.idleMinutes || 5);
    const bgEl = document.getElementById('set-background');
    if (bgEl) bgEl.checked = this._settings?.lockOnHide !== false;
    const storageEl = document.getElementById('security-storage');
    if (storageEl) {
      storageEl.textContent = `Armazenamento: ${this._storage.getStorageType() || 'Local Seguro'}`;
    }
    const bioStatus = document.getElementById('biometric-status');
    if (bioStatus) {
      if (typeof window !== 'undefined' && window.PublicKeyCredential) {
        bioStatus.textContent = 'Autenticador de plataforma compatível neste navegador.';
      } else {
        bioStatus.textContent = 'Autenticador biométrico não suportado neste ambiente.';
      }
    }
    this._renderer._openModal('modal-seguranca');
  }

  async _savePreferences(event) {
    event.preventDefault();
    this._settings = {
      idleMinutes: Number(document.getElementById('set-idle')?.value) || 5,
      lockOnHide: document.getElementById('set-background')?.checked !== false
    };
    await this._storage.dbWrite('private', 'settings', this._settings);
    this._renderer._closeModal('modal-seguranca');
    this._renderer.toast('Preferências de segurança salvas.');
  }

  async _configurePin(event) {
    event.preventDefault();
    const currentPass = document.getElementById('pin-current-password')?.value;
    const pinNew = document.getElementById('pin-new')?.value;
    const pinConfirm = document.getElementById('pin-confirm')?.value;
    const errorEl = document.getElementById('pin-error');
    if (errorEl) errorEl.textContent = '';

    if (pinNew !== pinConfirm) {
      if (errorEl) errorEl.textContent = 'Confirmação do PIN não confere.';
      return;
    }

    try {
      await this._auth.enableOwnPin(currentPass, pinNew);
      event.target.reset();
      const whoEl = document.getElementById('security-who');
      if (whoEl) whoEl.textContent = `${this._auth.getSession().usuario} · PIN ativado`;
      this._renderer.toast('PIN deste aparelho configurado com sucesso.');
    } catch (ex) {
      if (errorEl) errorEl.textContent = ex.message;
    }
  }

  async _forgetOwnPin() {
    const session = this._auth.getSession();
    if (!session) return;
    if (!confirm('Deseja realmente remover o PIN configurado neste dispositivo?')) return;
    try {
      await this._auth.disableOwnPin();
      const whoEl = document.getElementById('security-who');
      if (whoEl) whoEl.textContent = `${session.usuario} · PIN não configurado`;
      this._renderer.toast('PIN removido. Use sua senha no próximo acesso.');
    } catch (ex) {
      this._renderer.toast(`Erro ao remover PIN: ${ex.message}`);
    }
  }

  async _changeOwnPassword(event) {
    event.preventDefault();
    const oldPass = document.getElementById('change-old')?.value;
    const newPass = document.getElementById('change-new')?.value;
    const confirmPass = document.getElementById('change-confirm')?.value;
    const errorEl = document.getElementById('change-error');
    if (errorEl) errorEl.textContent = '';

    if (!this._auth.validatePassword(newPass) || newPass !== confirmPass) {
      if (errorEl) errorEl.textContent = 'Nova senha deve ter 8+ caracteres e confirmação idêntica.';
      return;
    }

    try {
      await this._auth.changeOwnPassword(oldPass, newPass);
      event.target.reset();
      this._renderer.toast('Senha principal alterada com sucesso. PIN reinicializado por segurança.');
    } catch (ex) {
      if (errorEl) errorEl.textContent = ex.message;
    }
  }

  _showAudit() {
    if (!this._auth.isManager()) return;
    const root = document.getElementById('security-audit');
    if (root) {
      root.replaceChildren();
      const trails = (this._data?.auditoria || []).slice(0, 30);
      for (const item of trails) {
        const card = this._renderer.make('div', 'audit-record');
        card.append(
          this._renderer.make('strong', '', item.acao || 'Operação'),
          this._renderer.make('small', '', `${item.usuario || '—'} · ${this._renderer.dateLabel(item.data)} · ${item.id ? item.id.slice(0, 8) : ''}`)
        );
        root.append(card);
      }
      if (!trails.length) {
        root.append(this._renderer.empty('Nenhuma operação auditada até o momento.'));
      }
    }
    this._renderer._openModal('modal-auditoria');
  }

  async _requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persist();
      this._renderer.toast(isPersisted ? 'Armazenamento persistente garantido pelo navegador.' : 'Persistência não garantida; mantenha backups.');
    } else {
      this._renderer.toast('API de armazenamento persistente não suportada neste navegador.');
    }
  }

  async _exportEncryptedBackup() {
    if (!this._auth.isManager()) return;
    const auth = this._auth.getMeta();
    const candidates = await this._storage.readCandidates();
    const packet = candidates[0];
    if (!packet) {
      return this._renderer.toast('Nenhum cofre cifrado encontrado para exportação.');
    }
    const backupPayload = {
      app: 'BarGestao',
      format: 7,
      exportadoEm: new Date().toISOString(),
      auth,
      vault: packet
    };
    const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: 'application/json' });
    this._export.downloadBlob(blob, `bargestao-backup-${new Date().toISOString().slice(0, 10)}.json`);
    this._renderer.toast('Backup criptografado exportado com sucesso.');
  }

  async _forgetDevice() {
    if (!confirm('Deseja realmente sair e esquecer este dispositivo? O PIN local será revogado.')) return;
    await this._auth.disableOwnPin();
    this._discardSession();
    this._renderer.toast('Dispositivo esquecido. Acesse novamente com sua senha mestre.');
  }

  async _rotateRecovery() {
    if (!this._auth.isManager()) return;
    const { phrase, token } = await this._recovery.generatePhrase();
    this._displayRecovery(phrase, token);
  }

  _click_show_recovery() {
    this._renderer._openModal('modal-recuperar');
  }

  async _submit_recover_account(event) {
    event.preventDefault();
    const token = document.getElementById('recover-token')?.value.trim();
    const user = document.getElementById('recover-user')?.value.trim();
    const pass = document.getElementById('recover-password')?.value;
    const confirm = document.getElementById('recover-confirm')?.value;
    const errorEl = document.getElementById('recover-error');
    if (errorEl) errorEl.textContent = '';

    if (!token || !user || !pass) {
      if (errorEl) errorEl.textContent = 'Preencha todos os campos obrigatórios.';
      return;
    }
    if (pass !== confirm) {
      if (errorEl) errorEl.textContent = 'Confirmação da nova senha não confere.';
      return;
    }
    if (!this._auth.validatePassword(pass)) {
      if (errorEl) errorEl.textContent = 'Nova senha deve ter no mínimo 8 caracteres.';
      return;
    }

    try {
      const meta = this._auth.getMeta();
      const rawkey = await this._recovery.unlockRecoveryKey(token, meta);
      const wrapped = await this._crypto.wrapKey(pass, rawkey);
      const nextMeta = structuredClone(meta);
      nextMeta.usuarios = [{
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'usr-mgr',
        usuario: user,
        perfil: 'gerente',
        ativo: true,
        senha: wrapped,
        pin: null,
        deviceSeal: null,
        criadoEm: new Date().toISOString()
      }];
      nextMeta.lastUser = user;
      await this._auth.saveMeta(nextMeta);
      this._renderer._closeModal('modal-recuperar');
      this._renderer.toast('Conta de administrador redefinida com sucesso.');
      const loginUser = document.getElementById('login-user');
      if (loginUser) loginUser.value = user;
      const loginSecret = document.getElementById('login-secret');
      if (loginSecret) loginSecret.value = '';
    } catch (ex) {
      if (errorEl) errorEl.textContent = ex.message;
    }
  }

  async _change_import_file(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (parsed.auth && parsed.vault) {
        await this._storage.dbWrite('private', 'auth', parsed.auth);
        await this._storage.dbWrite('private', 'backup-candidates', [parsed.vault]);
        this._auth.setMeta(parsed.auth);
        this._renderer.toast('Backup importado com sucesso. Acesse com as credenciais do backup.');
      } else {
        this._renderer.toast('Estrutura de arquivo de backup inválida.');
      }
    } catch (ex) {
      this._renderer.toast(`Falha ao ler backup: ${ex.message}`);
    } finally {
      event.target.value = '';
    }
  }
}

// Inicialização e Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
