/**
 * Controller de UI: equipe (aba Usuários). Só o gerente cadastra, edita perfil e remove (a remoção troca a chave dos dados).
 * Quem não é gerente não vê a aba, o menu nem aviso algum; o AuthService também nega.
 * Regras de senha, perfil e limite do plano ficam no AuthService; aqui só formulário, lista e avisos.
 * Senhas só digitadas (kit): a leitura usa typedValue, que recusa texto colado ou preenchido por fora.
 */
import { typedValue, clearTyped, protectField } from '../adapters/TypedSecrets.js';

const PERFIL_ROTULO = { gerente: 'Gerente', operador: 'Operador (funcionário)' };

export class TeamController {
  _app;
  _editing = null; // usuário em edição; null = cadastro novo
  _removing = null;
  _newFields = {};

  constructor(app) {
    this._app = app;
  }

  bind() {
    document.getElementById('abrir-usuario')?.addEventListener('click', () => this.openCreate());
    document.getElementById('form-usuario')?.addEventListener('submit', e => this._submit(e));
    document.getElementById('usuario-cancelar')?.addEventListener('click', () => this._app._renderer._closeModal('modal-usuario'));
    document.getElementById('form-remover-usuario')?.addEventListener('submit', e => this._submitRemove(e));
    document.getElementById('remover-cancelar')?.addEventListener('click', () => this._app._renderer._closeModal('modal-remover-usuario'));
  }

  _limit() {
    return this._app._governanceCtl?.userLimit?.() ?? null;
  }

  render() {
    const root = document.getElementById('lista-usuarios');
    if (!root) return;
    root.replaceChildren();
    const manager = this._app._auth.isManager();
    document.getElementById('abrir-usuario')?.classList.toggle('hidden', !manager);
    if (!manager) return; // vendedor/operador: nada de lista, contagem ou aviso
    const r = this._app._renderer;
    const users = this._app._auth.listUsers();
    const limit = this._limit();
    this._app.setText('usuarios-count', `${users.length} usuário${users.length === 1 ? '' : 's'}${limit ? ` de ${limit}` : ''}`);
    const me = this._app._auth.getSession()?.usuario;
    for (const u of users) {
      const el = r.make('div', 'entry');
      const head = r.make('div', 'entry-head');
      const left = r.make('div', 'entry-left');
      left.append(
        r.make('strong', '', u.usuario + (u.usuario === me ? ' (você)' : '')),
        r.make('div', 'meta', `${PERFIL_ROTULO[u.perfil] || u.perfil}${u.email ? ` · ${u.email}` : ''}`)
      );
      const pills = r.make('div', 'user-pills');
      if (u.temPin) pills.append(r.make('span', 'pill', 'PIN'));
      head.append(left, pills);
      const actions = r.make('div', 'actions');
      actions.append(r.btn('Editar', () => this.openEdit(u), 'btn ghost'));
      if (u.usuario !== me) actions.append(r.btn('Remover', () => this.openRemove(u), 'btn danger'));
      el.append(head, actions);
      root.append(el);
    }
  }

  _setError(text) {
    const el = document.getElementById('usuario-erro');
    if (el) el.textContent = text || '';
  }

  openCreate() {
    if (!this._app._auth.isManager()) {
      this._app._renderer.toast('Somente o gerente cadastra usuários.');
      return;
    }
    this._editing = null;
    this._fillForm({ title: 'Cadastrar usuário', submit: 'Cadastrar usuário', login: '', loginLocked: false, email: '', perfil: 'operador', senhaLabel: 'SENHA', senhaRequired: true, editOptions: false });
    this._app._renderer._openModal('modal-usuario', 'novo-user-login');
  }

  openEdit(user) {
    if (!this._app._auth.isManager()) return;
    this._editing = user.usuario;
    this._fillForm({ title: `Editar ${user.usuario}`, submit: 'Salvar alterações', login: user.usuario, loginLocked: true, email: user.email || '', perfil: user.perfil, senhaLabel: 'NOVA SENHA (opcional)', senhaRequired: false, editOptions: true });
    this._app._renderer._openModal('modal-usuario', 'novo-user-email');
  }

  _fillForm(o) {
    document.getElementById('form-usuario')?.reset();
    this._setError('');
    this._app.setText('form-usuario-title', o.title);
    this._app.setText('usuario-submit', o.submit);
    const login = document.getElementById('novo-user-login');
    if (login) { login.value = o.login; login.disabled = o.loginLocked; login.required = !o.loginLocked; }
    const mail = document.getElementById('novo-user-email'); if (mail) mail.value = o.email;
    const perfil = document.getElementById('novo-user-perfil'); if (perfil) perfil.value = o.perfil;
    const senha = document.getElementById('novo-user-senha');
    if (senha) { clearTyped(senha); senha.required = o.senhaRequired; senha.placeholder = o.senhaRequired ? 'Mínimo 8 caracteres' : 'Deixe vazio para manter a atual'; }
    const label = document.getElementById('usuario-label-senha');
    if (label?.firstChild) label.firstChild.textContent = o.senhaLabel;
    document.getElementById('user-edit-options')?.classList.toggle('hidden', !o.editOptions);
  }

  async _submit(event) {
    event.preventDefault();
    this._setError('');
    try {
      const senha = typedValue('novo-user-senha') || '';
      const perfil = document.getElementById('novo-user-perfil')?.value;
      const email = document.getElementById('novo-user-email')?.value.trim() || '';
      let label;
      if (this._editing) {
        const changes = { perfil, email, removerPin: Boolean(document.getElementById('remover-user-pin')?.checked) };
        if (senha) changes.senha = senha;
        await this._app._auth.updateUser(this._editing, changes);
        label = `Edição de usuário da equipe: ${this._editing}`;
      } else {
        const usuario = document.getElementById('novo-user-login')?.value.trim();
        await this._app._auth.addUser({ usuario, senha, perfil, email }, this._limit());
        label = `Cadastro de usuário da equipe: ${usuario}`;
      }
      await this._audit(label);
      clearTyped(document.getElementById('novo-user-senha'));
      this._app._renderer._closeModal('modal-usuario');
      this._app._renderer.toast(this._editing ? 'Usuário atualizado.' : 'Usuário cadastrado. Ele entra com o nome e a senha definidos.');
      this.render();
      return true;
    } catch (e) {
      this._setError(e.message);
      return false;
    }
  }

  // ---------------------------------------------------------------- remover (troca de chave)

  openRemove(user) {
    if (!this._app._auth.isManager()) return;
    if (user.usuario === this._app._auth.getSession()?.usuario) {
      this._app._renderer.toast('Você não pode remover o seu próprio usuário.');
      return;
    }
    this._removing = user.usuario;
    this._app.setText('remover-titulo', `Remover ${user.usuario}`);
    this._app.setText('remover-erro', '');
    const own = document.getElementById('remover-senha-gerente');
    if (own) clearTyped(own);
    const box = document.getElementById('remover-novas-senhas');
    box?.replaceChildren();
    this._newFields = {};
    for (const name of this._app._auth.usersNeedingNewPassword(user.usuario)) {
      const label = this._app._renderer.make('label', '', `NOVA SENHA PARA ${name}`);
      const input = this._app._renderer.make('input', '', undefined, { type: 'password', autocomplete: 'new-password', minlength: '8', placeholder: 'Mínimo 8 caracteres', required: '' });
      label.append(input);
      box?.append(label);
      try { protectField(input); } catch { /* kit ausente (testes): campo comum */ }
      this._newFields[name] = input;
    }
    this._app._renderer._openModal('modal-remover-usuario', 'remover-senha-gerente');
  }

  async _submitRemove(event) {
    event.preventDefault();
    this._app.setText('remover-erro', '');
    const submit = document.getElementById('remover-submit');
    if (submit) submit.disabled = true;
    try {
      const managerPassword = typedValue('remover-senha-gerente') || '';
      const newPasswords = {};
      for (const [name, input] of Object.entries(this._newFields || {})) {
        newPasswords[name] = input._typedProtected && input.value !== input._typed
          ? (() => { throw new Error('Digite as senhas no teclado: colar não é aceito.'); })()
          : input.value;
      }
      const usuario = this._removing;
      const recovery = await this._app.removeTeamUser(usuario, { managerPassword, newPasswords });
      for (const input of Object.values(this._newFields || {})) clearTyped(input);
      clearTyped(document.getElementById('remover-senha-gerente'));
      this._app._renderer._closeModal('modal-remover-usuario');
      this._app._renderer.toast(`${usuario} removido. A chave dos dados foi trocada.`);
      this.render();
      if (recovery) this._app._securityCtl?._displayRecovery?.(recovery.phrase, recovery.token);
      return true;
    } catch (e) {
      this._app.setText('remover-erro', e.message);
      return false;
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  /** Registra na trilha de auditoria encadeada (nunca grava senha). */
  _audit(label) {
    return this._app._commit(() => {}, label);
  }
}
