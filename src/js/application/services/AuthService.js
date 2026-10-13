/**
 * Serviço de Aplicação: Autenticação, Sessão e Credenciais
 */
export class AuthService {
  _crypto;
  _storage;
  _session = null;
  _vaultraw = null;
  _vaultkey = null;
  _meta = null;

  constructor(crypto, storage) {
    this._crypto = crypto;
    this._storage = storage;
  }

  getSession() {
    return this._session ? structuredClone(this._session) : null;
  }

  getVaultKey() {
    return this._vaultkey;
  }

  getVaultRaw() {
    return this._vaultraw;
  }

  getMeta() {
    return this._meta ? structuredClone(this._meta) : null;
  }

  isManager() {
    return this._session?.perfil === 'gerente';
  }

  setMeta(meta) {
    this._meta = meta;
  }

  async loadMeta() {
    this._meta = (await this._storage.dbRead('private', 'auth')) || null;
    return this._meta;
  }

  async saveMeta(nextmeta) {
    await this._storage.dbWrite('private', 'auth', nextmeta);
    this._meta = nextmeta;
  }

  async _getDeviceKey() {
    let key = await this._storage.dbRead('device', 'device-wrap');
    if (!key) {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await this._storage.dbWrite('device', 'device-wrap', key);
    }
    return key;
  }

  validatePassword(password) {
    return typeof password === 'string' && password.length >= 8 && new TextEncoder().encode(password).length <= 256;
  }

  validatePin(pin) {
    return /^\d{6,8}$/.test(pin) &&
      !/(\d)\1{4}/.test(pin) &&
      !'01234567890123456789'.includes(pin) &&
      !'98765432109876543210'.includes(pin);
  }

  async passwordAuth(username, password) {
    const user = this._meta?.usuarios?.find(u => u.usuario.toLowerCase() === username.toLowerCase() && u.ativo !== false);
    if (!user) throw new Error('Conta não encontrada.');

    const raw = await this._crypto.unwrapKey(password, user.senha);
    const key = await this._crypto.importAesKey(raw);

    this._vaultraw = raw;
    this._vaultkey = key;
    this._session = { usuario: user.usuario, perfil: user.perfil };

    const updated = structuredClone(this._meta);
    updated.lastUser = user.usuario;
    await this.saveMeta(updated);

    return { raw, key, session: this._session };
  }

  async pinAuth(username, pin) {
    const user = this._meta?.usuarios?.find(u => u.usuario.toLowerCase() === username.toLowerCase() && u.ativo !== false);
    if (!user?.pin || !user.deviceSeal) {
      throw new Error('Este usuário precisa entrar com senha e configurar PIN neste aparelho.');
    }

    const now = Date.now();
    if ((user.pin.blockedUntil || 0) > now) {
      const seg = Math.ceil((user.pin.blockedUntil - now) / 1000);
      throw new Error(`PIN bloqueado temporariamente. Aguarde ${seg} segundos.`);
    }

    const salt = Uint8Array.from(user.pin.salt.match(/.{2}/g), h => parseInt(h, 16));
    const derived = await this._crypto.deriveKey('BG_PIN:' + pin, salt, user.pin.iterations);
    const actualHex = Array.from(derived, x => x.toString(16).padStart(2, '0')).join('');

    if (!this._crypto.equalHex(actualHex, user.pin.hash)) {
      const draft = structuredClone(this._meta);
      const target = draft.usuarios.find(u => u.usuario === user.usuario);
      target.pin.failures = (target.pin.failures || 0) + 1;
      if (target.pin.failures >= 5) {
        target.pin.blockedUntil = Date.now() + Math.min(3600000, 60000 * Math.pow(2, Math.min(target.pin.failures - 5, 6)));
      }
      await this.saveMeta(draft);
      throw new Error('PIN incorreto.');
    }

    const keydevice = await this._storage.dbRead('device', 'device-wrap');
    if (!keydevice) throw new Error('Chave local perdida. Entre com sua senha mestra.');

    const unhex = s => Uint8Array.from(s.match(/.{2}/g), h => parseInt(h, 16));
    const opened = await this._crypto.open(user.deviceSeal, keydevice);
    const raw = unhex(opened.key);
    const key = await this._crypto.importAesKey(raw);

    this._vaultraw = raw;
    this._vaultkey = key;
    this._session = { usuario: user.usuario, perfil: user.perfil };

    const draft = structuredClone(this._meta);
    const target = draft.usuarios.find(u => u.usuario === user.usuario);
    target.pin.failures = 0;
    target.pin.blockedUntil = 0;
    draft.lastUser = user.usuario;
    await this.saveMeta(draft);

    return { raw, key, session: this._session };
  }

  async enableOwnPin(currentpassword, newpin) {
    if (!this._session) throw new Error('Sessão inativa.');
    const user = this._meta?.usuarios?.find(u => u.usuario === this._session.usuario);
    if (!user || !this.validatePin(newpin)) {
      throw new Error('Use PIN de 6 a 8 dígitos não sequenciais.');
    }

    const test = await this._crypto.unwrapKey(currentpassword, user.senha);
    const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
    if (!this._crypto.equalHex(hex(test), hex(this._vaultraw))) {
      throw new Error('Senha atual incorreta.');
    }

    const salt = this._crypto.randomBytes(16);
    const iterations = 450000;
    const derived = await this._crypto.deriveKey('BG_PIN:' + newpin, salt, iterations);
    const hash = Array.from(derived, x => x.toString(16).padStart(2, '0')).join('');

    const device = await this._getDeviceKey();
    const draft = structuredClone(this._meta);
    const target = draft.usuarios.find(u => u.usuario === this._session.usuario);
    target.pin = {
      salt: hex(salt),
      iterations,
      hash,
      failures: 0,
      blockedUntil: 0
    };
    target.deviceSeal = await this._crypto.seal({ key: hex(this._vaultraw) }, device);
    draft.lastUser = this._session.usuario;
    await this.saveMeta(draft);
  }

  async disableOwnPin() {
    if (!this._session) return;
    const draft = structuredClone(this._meta);
    const target = draft.usuarios.find(u => u.usuario === this._session.usuario);
    target.pin = null;
    target.deviceSeal = null;
    await this.saveMeta(draft);
  }

  async changeOwnPassword(oldpassword, newpassword) {
    if (!this._session) throw new Error('Sessão inativa.');
    if (!this.validatePassword(newpassword)) {
      throw new Error('Nova senha deve ter 8 ou mais caracteres.');
    }

    const current = this._meta.usuarios.find(u => u.usuario === this._session.usuario);
    const check = await this._crypto.unwrapKey(oldpassword, current.senha);
    const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
    if (!this._crypto.equalHex(hex(check), hex(this._vaultraw))) {
      throw new Error('Senha atual incorreta.');
    }

    const draft = structuredClone(this._meta);
    const target = draft.usuarios.find(u => u.usuario === this._session.usuario);
    target.senha = await this._crypto.wrapKey(newpassword, this._vaultraw);
    target.pin = null;
    target.deviceSeal = null;
    await this.saveMeta(draft);
  }

  discardSession() {
    this._session = null;
    if (this._vaultraw instanceof Uint8Array) {
      this._vaultraw.fill(0); // Sanitização de memória
    }
    this._vaultraw = null;
    this._vaultkey = null;
  }
}
