import { IGovernancePort } from '../../domain/interfaces/IGovernancePort.js';

/**
 * Adaptador REST do Firestore para a Governança Systekna.
 * Usa fetch nativo (sem SDK, sem build). O app não autentica no Firebase: as regras do
 * Firestore (governanca-systekna/firestore.rules) só permitem criar documentos com esquema
 * validado e ler um documento pelo id (UUID gerado neste aparelho).
 * A apiKey do Firebase Web é um identificador público de projeto, não um segredo.
 */
export class FirebaseGovernanceAdapter extends IGovernancePort {
  _base;
  _apiKey;
  _timeoutMs;

  constructor({
    projectId = 'systekna-feedback',
    apiKey = 'AIzaSyCQx8kJyXEReASiQMI4a5bT5NNWgtBmJpM',
    timeoutMs = 8000,
    fetchImpl = (...args) => globalThis.fetch(...args),
    host = 'https://firestore.googleapis.com'
  } = {}) {
    super();
    this._base = `${host}/v1/projects/${projectId}/databases/(default)/documents`;
    this._apiKey = apiKey;
    this._timeoutMs = timeoutMs;
    this._fetch = fetchImpl;
  }

  async submitRegistration(id, registration) {
    await this._create('solicitacoes_governanca', id, registration);
  }

  async fetchRegistration(id) {
    return this._get('solicitacoes_governanca', id);
  }

  async fetchTenant(id) {
    return this._get('tenants_governanca', id);
  }

  async reportError(id, report) {
    await this._create('telemetria_erros', id, report);
  }

  async sendFeedback(id, feedback) {
    await this._create('feedbacks_usuarios', id, feedback);
  }

  // ---------------------------------------------------------------------------

  async _request(url, init = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this._timeoutMs);
    try {
      return await this._fetch(url, { ...init, signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch (e) {
      throw new Error(e?.name === 'AbortError' ? 'Tempo esgotado ao contatar a governança.' : 'Sem conexão com a governança.');
    } finally {
      clearTimeout(timer);
    }
  }

  _url(path, params = {}) {
    const qs = new URLSearchParams({ ...params, key: this._apiKey });
    return `${this._base}/${path}?${qs}`;
  }

  static _assertId(id) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Identificador inválido.');
  }

  async _create(collection, id, data) {
    FirebaseGovernanceAdapter._assertId(id);
    const res = await this._request(this._url(collection, { documentId: id }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: FirebaseGovernanceAdapter.encodeFields(data) })
    });
    if (!res.ok) throw new Error(`A governança recusou o envio (HTTP ${res.status}).`);
  }

  async _get(collection, id) {
    FirebaseGovernanceAdapter._assertId(id);
    const res = await this._request(this._url(`${collection}/${id}`), { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Falha ao consultar a governança (HTTP ${res.status}).`);
    const doc = await res.json();
    return FirebaseGovernanceAdapter.decodeFields(doc.fields || {});
  }

  // --- Codificação do formato de valores tipados da API REST do Firestore -----

  static encodeValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(x => FirebaseGovernanceAdapter.encodeValue(x)) } };
    if (typeof v === 'object') return { mapValue: { fields: FirebaseGovernanceAdapter.encodeFields(v) } };
    throw new Error('Tipo de valor não suportado.');
  }

  static encodeFields(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = FirebaseGovernanceAdapter.encodeValue(v);
    return out;
  }

  static decodeValue(v) {
    if (!v || typeof v !== 'object') return null;
    if ('stringValue' in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('timestampValue' in v) return v.timestampValue;
    if ('nullValue' in v) return null;
    if ('mapValue' in v) return FirebaseGovernanceAdapter.decodeFields(v.mapValue.fields || {});
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(x => FirebaseGovernanceAdapter.decodeValue(x));
    return null;
  }

  static decodeFields(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = FirebaseGovernanceAdapter.decodeValue(v);
    }
    return out;
  }
}
