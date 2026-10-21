/**
 * Controller de UI: equipe (aba Usuários). Só o gerente cadastra, edita perfil e ativa/desativa.
 * Regras de senha, perfil e limite do plano ficam no AuthService; aqui só formulário, lista e avisos.
 * Senhas só digitadas (kit): a leitura usa typedValue, que recusa texto colado ou preenchido por fora.
 */
import { typedValue, clearTyped } from '../adapters/TypedSecrets.js';

export class TeamController {
  _app;
  _editing = null; // usuário em edição; null = cadastro novo

  constructor(app) {
    this._app = app;
  }

  bind() {
    document.getElementById('abrir-usuario')?.addEventListener('click', () => this.openCreate());
    document.getElementById('form-usuario')?.addEventListener('submit', e => this._submit(e));
    document.getElementById('usuario-cancelar')?.addEventListener('click', () => this._app._renderer._closeModal('modal-usuario'));
  }

  _limit() {
    return this._app._governanceCtl?.userLimit?.() ?? null;
  }

  render() {
    const root = document.getElementById('lista-usuarios');
    if (!root) return;
    root.replaceChildren();
    const r = this._app._renderer;
    const manager = this._app._auth.isManager();
    document.getElementById('abrir-usuario')?.classList.toggle('hidden', !manager);
    const users = this._app._auth.listUsers();
    const ativos = users.filter(u => u.ativo).length;
    const limit = this._limit();
    this._app.setText('usuarios-count', `${ativos} ativo${ativos === 1 ? '' : 's'}${limit ? ` de ${limit}` : ''}`);
    if (!manager) {
      root.append(r.empty('Somente o gerente gerencia a equipe.'));
      return;
    }
    const me = this._app._auth.getSession()?.usuario;
    for (const u of users) {
      const el = r.make('div', `entry${u.ativo ? '' : ' user-inactive'}`);
      const head = r.make('div', 'entry-head');
      const left = r.make('div', 'entry-left');
      left.append(
        r.make('strong', '', u.usuario + (u.usuario === me ? ' (você)' : '')),
        r.make('div', 'meta', `${u.perfil === 'gerente' ? 'Gerente' : 'Vendedor'}${u.email ? ` · ${u.email}` : ''}`)
      );
      const pills = r.make('div', 'user-pills');
      pills.append(r.make('span', `pill ${u.ativo ? 'good' : 'warn'}`, u.ativo ? 'Ativo' : 'Desativado'));
      if (u.temPin) pills.append(r.make('span', 'pill', 'PIN'));
      head.append(left, pills);
      const actions = r.make('div', 'actions');
      actions.append(r.btn('Editar', () => this.openEdit(u), 'btn ghost'));
      if (u.usuario !== me) {
        actions.append(r.btn(u.ativo ? 'Desativar' : 'Reativar', () => this.toggleActive(u), u.ativo ? 'btn danger' : 'btn ghost'));
      }
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
    this._fillForm({ title: 'Cadastrar usuário', submit: 'Cadastrar usuário', login: '', loginLocked: false, email: '', perfil: 'vendedor', senhaLabel: 'SENHA', senhaRequired: true, editOptions: false });
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
        await this._app._auth.updateUser(this._editing, changes, this._limit());
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

  async toggleActive(user) {
    try {
      await this._app._auth.updateUser(user.usuario, { ativo: !user.ativo }, this._limit());
      await this._audit(`${user.ativo ? 'Desativação' : 'Reativação'} de usuário da equipe: ${user.usuario}`);
      this._app._renderer.toast(user.ativo ? `${user.usuario} desativado: não entra mais no app.` : `${user.usuario} reativado.`);
      this.render();
      return true;
    } catch (e) {
      this._app._renderer.toast(e.message);
      return false;
    }
  }

  /** Registra na trilha de auditoria encadeada (nunca grava senha). */
  _audit(label) {
    return this._app._commit(() => {}, label);
  }
}
