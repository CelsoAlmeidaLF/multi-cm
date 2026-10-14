import { UID_DIGITAL, isGovernanceId } from '../../domain/entities/GovernanceUid.js';

/**
 * Serviço de Aplicação: Governança Systekna
 * Cadastro com homologação (doc 12), licença/kill-switch (doc 14) e
 * telemetria de erros + feedback sanitizados (doc 13).
 *
 * Fluxo: o usuário se cadastra no app → é gerada a impressão digital (UID) do cadastro → a solicitação
 * vai ao Firebase com esse UID → a governança aprova ou não e libera/bloqueia funcionalidades no tenant
 * de mesmo UID. Sem aprovação vinda do Firebase, o app não abre (inclusive instalações antigas).
 *
 * Importante: num app local-first, o enforcement é feito no cliente. Ele impede o uso
 * normal do produto, mas não resiste a quem altera o próprio navegador; a autoridade
 * final continua sendo o Firestore (regras) e o contrato comercial.
 */
export const GOVERNANCE_STATES = Object.freeze({
  NOT_REGISTERED: 'nao_registrado',
  PENDING: 'pendente',
  APPROVED: 'aprovado',
  REJECTED: 'reprovado',
  BLOCKED: 'bloqueado'
});

const TIPOS_COMERCIO = ['bar', 'loja_salgados', 'lanchonete', 'adega', 'outro'];
const TIPOS_FEEDBACK = ['sugestao', 'elogio', 'problema', 'duvida'];
const MAX_REPORTS_PER_SESSION = 10;
// Prazo máximo sem confirmar a licença no servidor; depois disso os lançamentos ficam suspensos
export const MAX_OFFLINE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export class GovernanceService {
  _port;
  _storage;
  _appVersion;
  _record = null;
  _reportedSignatures = new Set();

  constructor(port, storage, { appVersion = '0.0.0', appId = 'BARGESTAO' } = {}) {
    this._port = port;
    this._storage = storage;
    this._appVersion = appVersion;
    this._appId = appId;
  }

  // ---------------------------------------------------------------------------
  // Estado local (IndexedDB 'private' → 'governance')
  // ---------------------------------------------------------------------------

  async load() {
    this._record = (await this._storage.dbRead('private', 'governance')) || null;
    return this.getRecord();
  }

  getRecord() {
    return this._record ? structuredClone(this._record) : null;
  }

  getState() {
    return this._record?.lastState?.state || GOVERNANCE_STATES.NOT_REGISTERED;
  }

  /** Impressão digital do cadastro (UID no Firebase), ou null sem cadastro. */
  getUid() {
    return this._record?.id || null;
  }

  /** Formato de leitura: grupos de 4 em maiúsculas (ex.: 3F2A-9C01-...). */
  static formatUid(id) {
    if (!id) return '';
    const hex = String(id).replace(/-/g, '').toUpperCase();
    return hex.match(/.{1,4}/g).join('-');
  }

  /** Permissão de usar o app: só com aprovação da governança confirmada dentro do prazo. */
  hasAccess() {
    return this.getState() === GOVERNANCE_STATES.APPROVED && !this._verificationExpired();
  }

  /** Funcionalidade de mesas: liberada só quando a governança define permiteMesas = true. */
  allowsTables() {
    return this.hasAccess() && this._record?.lastState?.permiteMesas === true;
  }

  /** Exportação XLSX liberada? Só a governança desliga (painel → Módulos Homologados). */
  allowsXlsxExport() {
    return this._record?.lastState?.permiteExportacaoXlsx !== false;
  }

  /** Teto de produtos ativos definido no tenant; null = sem limite (legado ou não informado). */
  productLimit() {
    const limite = this._record?.lastState?.limiteProdutos;
    return Number.isInteger(limite) && limite > 0 ? limite : null;
  }

  /** Aprovado, mas sem confirmação no servidor dentro do prazo (ou restaurado de backup sem verificar). */
  _verificationExpired(now = Date.now()) {
    if (!this._record || this.getState() !== GOVERNANCE_STATES.APPROVED) return false;
    const verified = Date.parse(this._record.verifiedAt || '');
    return !Number.isFinite(verified) || now - verified > MAX_OFFLINE_DAYS * DAY_MS;
  }

  isBlocked() {
    return !this.hasAccess();
  }

  getBlockReason() {
    if (!this._record) return 'este aparelho ainda não foi cadastrado na governança';
    if (this._verificationExpired()) {
      return `licença sem verificação há mais de ${MAX_OFFLINE_DAYS} dias. Conecte-se à internet para revalidar`;
    }
    if (this.getState() === GOVERNANCE_STATES.PENDING) return 'cadastro aguardando aprovação da governança';
    return this._record?.lastState?.motivo || '';
  }

  /** Dados mínimos para levar no backup: sem eles, um restore viraria instalação sem cadastro. */
  exportForBackup() {
    if (!this._record) return null;
    const { id, usuario, nomeEstabelecimento, cnpj, tipoComercio, solicitadoEm, lastState } = this._record;
    return { id, usuario, nomeEstabelecimento, cnpj, tipoComercio, solicitadoEm, lastState };
  }

  /** Restaura o registro do backup exigindo nova verificação no servidor antes de liberar lançamentos. */
  async restoreFromBackup(data) {
    if (!data || !isGovernanceId(data.id)) return false;
    const state = Object.values(GOVERNANCE_STATES).includes(data.lastState?.state) ? data.lastState.state : GOVERNANCE_STATES.PENDING;
    await this._save({
      id: data.id,
      usuario: String(data.usuario || '').slice(0, 30),
      nomeEstabelecimento: String(data.nomeEstabelecimento || '').slice(0, 120),
      cnpj: typeof data.cnpj === 'string' ? data.cnpj : null,
      tipoComercio: String(data.tipoComercio || 'outro'),
      solicitadoEm: data.solicitadoEm || null,
      lastState: {
        state,
        permiteMesas: data.lastState?.permiteMesas === true,
        permiteExportacaoXlsx: data.lastState?.permiteExportacaoXlsx !== false,
        limiteProdutos: Number.isInteger(data.lastState?.limiteProdutos) ? data.lastState.limiteProdutos : null,
        motivo: String(data.lastState?.motivo || '')
      },
      verifiedAt: null
    });
    return true;
  }

  async _save(record) {
    await this._storage.dbWrite('private', 'governance', record);
    this._record = record;
  }

  // ---------------------------------------------------------------------------
  // Cadastro e homologação
  // ---------------------------------------------------------------------------

  static normalizeRegistration({ usuario, nomeEstabelecimento = '', cnpj = '', tipoComercio = 'outro' } = {}) {
    const user = String(usuario || '').trim();
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(user)) {
      throw new Error('Usuário deve ter de 3 a 30 caracteres (letras, números, ponto, hífen ou sublinhado).');
    }
    const nome = String(nomeEstabelecimento || '').trim().slice(0, 120);
    const digits = String(cnpj || '').replace(/\D/g, '');
    if (digits && !GovernanceService.isValidCnpj(digits)) {
      throw new Error('CNPJ inválido. Confira os dígitos ou deixe o campo em branco (é opcional).');
    }
    const tipo = TIPOS_COMERCIO.includes(tipoComercio) ? tipoComercio : 'outro';
    return { usuario: user, nomeEstabelecimento: nome, cnpj: digits || null, tipoComercio: tipo };
  }

  static isValidCnpj(d) {
    if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
    const calc = (len) => {
      const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
      const r = sum % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }

  /**
   * Impressão digital do cadastro: SHA-256 de um segredo aleatório de 256 bits + dados do cadastro,
   * truncado em 128 bits. Vira o UID do usuário no Firebase (id da solicitação e do tenant).
   * O segredo não é guardado: o UID não pode ser recalculado nem adivinhado a partir do cadastro.
   */
  static async createUid(reg) {
    const segredo = crypto.getRandomValues(new Uint8Array(32));
    const dados = new TextEncoder().encode(JSON.stringify([reg.usuario, reg.cnpj, reg.tipoComercio, Date.now()]));
    const material = new Uint8Array(segredo.length + dados.length);
    material.set(segredo);
    material.set(dados, segredo.length);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', material));
    return Array.from(hash.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
  }

  async submitRegistration(input) {
    const reg = GovernanceService.normalizeRegistration(input);
    const id = await GovernanceService.createUid(reg);
    const solicitadoEm = new Date();

    await this._port.submitRegistration(id, {
      ...reg,
      status: 'pendente',
      // Mesas são sugeridas pelo tipo declarado; a decisão final é da governança
      permiteMesas: reg.tipoComercio === 'bar',
      solicitadoEm,
      aprovadoEm: null,
      aprovadoPor: null,
      motivoDecisao: ''
    });

    await this._save({
      id,
      ...reg,
      solicitadoEm: solicitadoEm.toISOString(),
      lastState: { state: GOVERNANCE_STATES.PENDING, permiteMesas: false, motivo: '' },
      checkedAt: new Date().toISOString()
    });
    return this.getRecord();
  }

  /**
   * Avalia solicitação + tenant (doc 14) e devolve o estado efetivo.
   * Retorna null quando a resposta é indeterminada (documento ausente): nesse caso quem chama
   * mantém o último estado conhecido — nunca libera por falta de dado (fail-closed).
   */
  static evaluate(registration, tenant, now = Date.now()) {
    if (!registration) return null;
    if (registration.status === 'reprovado') {
      return { state: GOVERNANCE_STATES.REJECTED, permiteMesas: false, motivo: registration.motivoDecisao || 'Cadastro não aprovado pela governança.' };
    }
    if (registration.status === 'bloqueado') {
      return { state: GOVERNANCE_STATES.BLOCKED, permiteMesas: false, motivo: registration.motivoDecisao || 'Acesso bloqueado pela governança.' };
    }
    if (registration.status !== 'aprovado') {
      return { state: GOVERNANCE_STATES.PENDING, permiteMesas: false, motivo: '' };
    }

    // Aprovado sem tenant: a licença é a autoridade, então o resultado é indeterminado
    const lic = tenant?.licenca;
    if (!lic) return null;

    if (lic.bloqueioRemoto || !['ativo', 'trial'].includes(lic.status)) {
      return {
        state: GOVERNANCE_STATES.BLOCKED,
        permiteMesas: false,
        motivo: lic.motivoBloqueio || `Licença ${lic.status || 'suspensa'}. Contate o suporte Systekna.`
      };
    }

    const expira = Date.parse(lic.expiraEm || '');
    if (Number.isFinite(expira) && expira < now) {
      return {
        state: GOVERNANCE_STATES.BLOCKED,
        permiteMesas: false,
        motivo: `Licença expirada em ${new Date(expira).toLocaleDateString('pt-BR')}. Contate o suporte Systekna.`
      };
    }

    const modulos = tenant?.permissoesModulos || {};
    const permiteMesas = typeof modulos.permiteMesas === 'boolean' ? modulos.permiteMesas : registration.permiteMesas === true;
    const limite = Number(modulos.limiteProdutos);
    return {
      state: GOVERNANCE_STATES.APPROVED,
      permiteMesas,
      permiteExportacaoXlsx: modulos.permiteExportacaoXlsx !== false,
      limiteProdutos: Number.isInteger(limite) && limite > 0 ? limite : null,
      motivo: ''
    };
  }

  /**
   * Consulta a governança. Falha de rede, erro em qualquer das consultas ou resposta indeterminada
   * mantêm o último estado conhecido; o prazo MAX_OFFLINE_DAYS limita quanto tempo ele vale.
   * @returns {{ state, permiteMesas, motivo, offline: boolean, indeterminate?: boolean }}
   */
  async refresh() {
    if (!this._record) return { state: GOVERNANCE_STATES.NOT_REGISTERED, permiteMesas: false, motivo: '', offline: false };
    let registration;
    let tenant;
    try {
      [registration, tenant] = await Promise.all([
        this._port.fetchRegistration(this._record.id),
        this._port.fetchTenant(this._record.id)
      ]);
    } catch {
      return { ...(this._record.lastState || {}), offline: true };
    }

    const lastState = GovernanceService.evaluate(registration, tenant);
    const now = new Date().toISOString();
    if (!lastState) {
      await this._save({ ...this._record, checkedAt: now });
      return { ...(this._record.lastState || {}), offline: false, indeterminate: true };
    }
    await this._save({ ...this._record, lastState, checkedAt: now, verifiedAt: now });
    return { ...lastState, offline: false };
  }

  // ---------------------------------------------------------------------------
  // Telemetria e feedback (doc 13) — Privacy by Design
  // ---------------------------------------------------------------------------

  /** Liga erros e feedbacks ao UID do cadastro, para a governança saber de quem são. */
  _uidField() {
    const id = this._record?.id;
    return typeof id === 'string' && UID_DIGITAL.test(id) ? { uid: id } : {};
  }

  static scrub(text, max = 2000) {
    if (typeof text !== 'string') return '';
    // Trunca antes das regex (evita ReDoS com entradas grandes) e corta de novo no fim
    return text
      .slice(0, max * 2)
      .replace(/\b(senha|password|passwd|pin|token|secret|segredo|chave)\b\s*[:=]\s*\S{1,200}/gi, '$1=[SEGREDO_REDUZIDO]')
      .replace(/\bpin\s+\d{4,8}\b/gi, 'pin [SEGREDO_REDUZIDO]')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[ID_REDUZIDO]')
      .replace(/[0-9a-f]{32,}/gi, '[CHAVE_REDUZIDA]')
      .replace(/[A-Za-z0-9+_-]{40,}={0,2}/g, '[SEGREDO_REDUZIDO]')
      .replace(/[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,4}/g, '[EMAIL_REDUZIDO]')
      .replace(/\b\d{2}[ .]?\d{3}[ .]?\d{3}[ /]?\d{4}[ -]?\d{2}\b/g, '[DOC_REDUZIDO]')
      .replace(/\b\d{3}[ .]?\d{3}[ .]?\d{3}[ -]?\d{2}\b/g, '[DOC_REDUZIDO]')
      .replace(/\b(?:\d[ -]?){12,18}\d\b/g, '[CARTAO_REDUZIDO]')
      .replace(/\(?\b\d{2}\)?[ -]?9?\d{4}[ -]?\d{4}\b/g, '[FONE_REDUZIDO]')
      .replace(/R\$\s?-?[\d.,]{1,20}/g, '[VALOR_REDUZIDO]')
      .replace(/\b\d{1,9}[.,]\d{2}\s*reais\b/gi, '[VALOR_REDUZIDO]')
      .slice(0, max);
  }

  static _identifier(value, fallback) {
    const v = String(value || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40);
    return v || fallback;
  }

  static _moduleFromStack(stack) {
    const m = /\/([A-Za-z]+)\.js/.exec(String(stack || ''));
    return GovernanceService._identifier(m?.[1], 'geral');
  }

  _environment() {
    const nav = globalThis.navigator || {};
    const win = globalThis.window;
    return {
      userAgent: String(nav.userAgent || 'desconhecido').slice(0, 300),
      online: nav.onLine !== false,
      opfsSuportado: Boolean(nav.storage?.getDirectory),
      viewport: win ? `${win.innerWidth}x${win.innerHeight}`.slice(0, 20) : 'n/a'
    };
  }

  /**
   * Envia relatório de erro sanitizado. Nunca lança: falha de telemetria não pode afetar a operação.
   */
  async reportError(error, modulo = null) {
    try {
      if (globalThis.navigator?.onLine === false) return false;
      if (this._reportedSignatures.size >= MAX_REPORTS_PER_SESSION) return false;

      const mensagem = GovernanceService.scrub(String(error?.message || error || 'Erro desconhecido'));
      const rawStack = String(error?.stack || '');
      const stackTrace = GovernanceService.scrub(rawStack);
      const mod = GovernanceService._identifier(modulo, GovernanceService._moduleFromStack(rawStack));
      const signature = `${mod}|${mensagem}`;
      if (this._reportedSignatures.has(signature)) return false;
      this._reportedSignatures.add(signature);

      await this._port.reportError(crypto.randomUUID(), {
        app: this._appId,
        ...this._uidField(),
        usuario: GovernanceService._identifier(this._record?.usuario, 'anonimo'),
        versaoApp: GovernanceService._identifier(this._appVersion, '0.0.0'),
        mensagem,
        modulo: mod,
        stackTrace,
        ambiente: this._environment(),
        dataOcorrencia: new Date(),
        resolvido: false
      });
      return true;
    } catch {
      return false;
    }
  }

  async sendFeedback({ tipo, avaliacao, mensagem }) {
    const texto = String(mensagem || '').trim();
    if (!texto) throw new Error('Escreva sua mensagem para a governança.');
    if (texto.length > 1000) throw new Error('A mensagem deve ter no máximo 1.000 caracteres.');
    const nota = Number(avaliacao);
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) throw new Error('Escolha uma avaliação de 1 a 5.');

    await this._port.sendFeedback(crypto.randomUUID(), {
      app: this._appId,
      ...this._uidField(),
      usuario: GovernanceService._identifier(this._record?.usuario, 'anonimo'),
      estabelecimento: String(this._record?.nomeEstabelecimento || '').slice(0, 120),
      tipo: TIPOS_FEEDBACK.includes(tipo) ? tipo : 'sugestao',
      avaliacao: nota,
      mensagem: GovernanceService.scrub(texto, 1000),
      status: 'novo',
      enviadoEm: new Date()
    });
    return true;
  }
}
