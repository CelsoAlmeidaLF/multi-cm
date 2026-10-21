// v3.2.0: cadastro de equipe (aba Usuários), mesas desabilitadas pela Governança, rótulo compacto do gráfico e guarda do kit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WebCryptoAdapter } from '../src/js/infrastructure/adapters/WebCryptoAdapter.js';
import { AuthService } from '../src/js/application/services/AuthService.js';
import { OrderService } from '../src/js/application/services/OrderService.js';
import { CashService } from '../src/js/application/services/CashService.js';
import { StockService } from '../src/js/application/services/StockService.js';
import { ShiftService } from '../src/js/application/services/ShiftService.js';
import { TeamController } from '../src/js/ui/controllers/TeamController.js';
import { SalesController } from '../src/js/ui/controllers/SalesController.js';
import { ComandaController } from '../src/js/ui/controllers/ComandaController.js';
import { CashController } from '../src/js/ui/controllers/CashController.js';
import { StorageAdapter } from '../src/js/infrastructure/adapters/StorageAdapter.js';
import { compactMoney } from '../src/js/ui/adapters/CompactMoney.js';

const resultados = [];
async function teste(id, nome, fn) {
  try { await fn(); resultados.push(true); console.log(`✅ [PASS] ${id} - ${nome}`); }
  catch (e) { resultados.push(false); console.error(`❌ [FAIL] ${id} - ${nome} -> ${e.message}`); }
}

const SENHA = 'SenhaForte!2026';
async function montar() {
  const c = new WebCryptoAdapter();
  const db = new Map();
  const storage = { dbRead: async (s, k) => db.get(`${s}/${k}`), dbWrite: async (s, k, v) => { db.set(`${s}/${k}`, structuredClone(v)); } };
  const raw = c.randomBytes(32);
  const auth = new AuthService(c, storage);
  await auth.saveMeta({ version: 7, lastUser: 'celso', usuarios: [{ usuario: 'celso', perfil: 'gerente', email: null, ativo: true, pin: null, deviceSeal: null, senha: await c.wrapKey(SENHA, raw) }] });
  await auth.passwordAuth('celso', SENHA);
  return { c, auth, storage, raw };
}
const hex = u8 => Array.from(u8, x => x.toString(16).padStart(2, '0')).join('');
const comoOutro = async (env, usuario, senha) => { // sessão nova com o mesmo storage
  const a = new AuthService(env.c, env.storage); await a.loadMeta(); await a.passwordAuth(usuario, senha); return a;
};

// ---------------------------------------------------------------- AuthService (equipe)
await teste('EQP.1', 'Gerente cadastra operador: ele entra com a própria senha e abre a MESMA chave do cofre; lista sem segredos', async () => {
  const env = await montar();
  await env.auth.addUser({ usuario: 'ana', senha: 'Senha@Ana123', perfil: 'operador', email: 'ana@bar.com' });
  const ana = await comoOutro(env, 'ANA', 'Senha@Ana123'); // nome sem diferenciar maiúsculas
  assert.equal(hex(ana.getVaultRaw()), hex(env.raw));
  assert.deepEqual(ana.getSession(), { usuario: 'ana', perfil: 'operador' });
  const lista = env.auth.listUsers();
  assert.deepEqual(lista.map(u => u.usuario), ['celso', 'ana']);
  assert.deepEqual(Object.keys(lista[1]).sort(), ['email', 'perfil', 'temPin', 'usuario']);
  await assert.rejects(() => comoOutro(env, 'ana', 'senha errada 123'));
});

await teste('EQP.2', 'Validações: nome, senha, perfil, e-mail e duplicado são recusados sem gravar nada', async () => {
  const env = await montar();
  const ok = { usuario: 'bia', senha: 'Senha@Bia123', perfil: 'operador' };
  const casos = [
    [{ ...ok, usuario: 'ab' }, /Nome de usuário/], [{ ...ok, usuario: '<script>' }, /Nome de usuário/],
    [{ ...ok, senha: 'curta' }, /8 ou mais/], [{ ...ok, perfil: 'admin' }, /Perfil inválido/],
    [{ ...ok, email: 'sem-arroba' }, /E-mail inválido/], [{ ...ok, usuario: 'CELSO' }, /Já existe/]
  ];
  for (const [input, re] of casos) await assert.rejects(() => env.auth.addUser(input), re);
  assert.equal(env.auth.listUsers().length, 1);
});

await teste('EQP.3', 'Só o gerente gerencia: operador e sessão ausente recebem "Acesso negado"', async () => {
  const env = await montar();
  await env.auth.addUser({ usuario: 'ana', senha: 'Senha@Ana123', perfil: 'operador' });
  const ana = await comoOutro(env, 'ana', 'Senha@Ana123');
  await assert.rejects(() => ana.addUser({ usuario: 'x1x', senha: 'Senha@Xis123', perfil: 'operador' }), /Acesso negado/);
  await assert.rejects(() => ana.updateUser('celso', { perfil: 'operador' }), /Acesso negado/);
  env.auth.discardSession();
  await assert.rejects(() => env.auth.addUser({ usuario: 'x1x', senha: 'Senha@Xis123', perfil: 'operador' }), /Acesso negado/);
});

await teste('EQP.4', 'Limite do plano: recusa no limite; remover libera vaga; null = sem limite', async () => {
  const env = await montar();
  await env.auth.addUser({ usuario: 'ana', senha: 'Senha@Ana123', perfil: 'operador' }, 2); // 2 usuários
  await assert.rejects(() => env.auth.addUser({ usuario: 'bia', senha: 'Senha@Bia123', perfil: 'operador' }, 2), /Limite de 2 usuários do plano/);
  await env.auth.removeUserAndRotateKey('ana', { managerPassword: SENHA, newPasswords: {}, writeData: async () => {} });
  await env.auth.addUser({ usuario: 'bia', senha: 'Senha@Bia123', perfil: 'operador' }, 2); // vaga liberada
  await env.auth.addUser({ usuario: 'caio', senha: 'Senha@Caio123', perfil: 'operador' }, null);
  assert.equal(env.auth.listUsers().length, 3);
});

await teste('EQP.5', 'Perfil: promove operador a gerente; não rebaixa nem desativa a si mesmo; perfil inválido recusado', async () => {
  const env = await montar();
  await env.auth.addUser({ usuario: 'ana', senha: 'Senha@Ana123', perfil: 'operador' });
  await env.auth.updateUser('ana', { perfil: 'gerente' });
  assert.equal(env.auth.listUsers().find(u => u.usuario === 'ana').perfil, 'gerente');
  await assert.rejects(() => env.auth.updateUser('celso', { perfil: 'operador' }), /rebaixar/);
  await assert.rejects(() => env.auth.updateUser('ana', { perfil: 'dono' }), /Perfil inválido/);
  await assert.rejects(() => env.auth.updateUser('fantasma', { perfil: 'operador' }), /não encontrado/);
});

// ----- troca de chave na remoção
function cofreDeDados(env, dados = { mesas: { 'Mesa 01': ['cerveja'] } }) {
  const slots = []; // pacotes {seq, payload} como nos slots A/B
  let seq = 0;
  const grava = async key => { seq += 1; slots.push({ seq, payload: await env.c.seal(dados, key, `BG:v7:operacional:${seq}`) }); };
  const abre = async key => { for (const p of [...slots].sort((a, b) => b.seq - a.seq)) { try { return await env.c.open(p.payload, key, `BG:v7:operacional:${p.seq}`); } catch {} } return null; };
  return { slots, grava, abre };
}
const comRecuperacao = async env => {
  globalThis.FinancVault ||= {}; // kit carregado pelos outros runners; aqui só o necessário
  const m = env.auth.getMeta(); return m;
};

await teste('EQP.6', 'Remover troca a chave: o removido não abre mais nada; quem fica abre com a senha nova; PIN de todos é revogado', async () => {
  const env = await montar();
  const cofre = cofreDeDados(env);
  await cofre.grava(await env.c.importAesKey(env.raw)); // dados sob a chave antiga
  await env.auth.addUser({ usuario: 'ana', senha: 'Senha@Ana123', perfil: 'operador' });
  await env.auth.addUser({ usuario: 'bia', senha: 'Senha@Bia123', perfil: 'operador' });
  const meta = env.auth.getMeta(); meta.usuarios[0].pin = { v: 2 }; meta.usuarios[0].deviceSeal = { x: 1 }; await env.auth.saveMeta(meta);
  const copiaAntiga = env.auth.getMeta(); // backup feito ANTES da remoção (com a ana dentro)
  await env.auth.removeUserAndRotateKey('ana', { managerPassword: SENHA, newPasswords: { bia: 'NovaBia@456' }, writeData: cofre.grava });
  assert.notEqual(hex(env.auth.getVaultRaw()), hex(env.raw), 'chave trocada em memória');
  assert.deepEqual(env.auth.listUsers().map(u => u.usuario), ['celso', 'bia']);
  assert.equal(env.auth.listUsers().some(u => u.temPin), false);
  const novaChave = await env.c.importAesKey(env.auth.getVaultRaw());
  const antigaChave = await env.c.importAesKey(env.raw);
  assert.deepEqual(await cofre.abre(novaChave), { mesas: { 'Mesa 01': ['cerveja'] } }, 'dados atuais abrem com a chave nova');
  // o pacote mais novo é da chave nova; a chave antiga só abre o pacote antigo (que a limpeza apaga em produção)
  const soNovos = { slots: cofre.slots.filter(p => p.seq > 1) };
  const abreSoNovos = async key => { for (const p of soNovos.slots) { try { return await env.c.open(p.payload, key, `BG:v7:operacional:${p.seq}`); } catch {} } return null; };
  assert.equal(await abreSoNovos(antigaChave), null, 'a chave antiga não abre os dados novos');
  // a ana, com a senha dela, ainda destranca a chave ANTIGA em um backup antigo (inevitável), mas nunca a nova
  const antigaDaAna = await env.c.unwrapKey('Senha@Ana123', copiaAntiga.usuarios.find(u => u.usuario === 'ana').senha);
  assert.equal(hex(antigaDaAna), hex(env.raw));
  const atual = env.auth.getMeta();
  assert.equal(atual.usuarios.find(u => u.usuario === 'ana'), undefined);
  for (const u of atual.usuarios) await assert.rejects(() => env.c.unwrapKey('Senha@Ana123', u.senha));
  // a bia entra com a senha nova (a antiga não vale) e abre a chave nova
  await assert.rejects(() => comoOutro(env, 'bia', 'Senha@Bia123'));
  const bia = await comoOutro(env, 'bia', 'NovaBia@456');
  assert.equal(hex(bia.getVaultRaw()), hex(env.auth.getVaultRaw()));
  assert.ok(atual.chaveTrocadaEm);
  await assert.rejects(() => comoOutro(env, 'ana', 'Senha@Ana123'), /Conta não encontrada/);
});

await teste('EQP.6b', 'Recusas antes de mexer em qualquer coisa: a si mesmo, senha do gerente errada, senha nova ausente/curta, usuário inexistente', async () => {
  const env = await montar();
  await env.auth.addUser({ usuario: 'ana', senha: 'Senha@Ana123', perfil: 'operador' });
  await env.auth.addUser({ usuario: 'bia', senha: 'Senha@Bia123', perfil: 'operador' });
  let gravou = 0; const writeData = async () => { gravou++; };
  const antes = JSON.stringify(env.auth.getMeta()), rawAntes = hex(env.auth.getVaultRaw());
  await assert.rejects(() => env.auth.removeUserAndRotateKey('celso', { managerPassword: SENHA, newPasswords: {}, writeData }), /próprio usuário/);
  await assert.rejects(() => env.auth.removeUserAndRotateKey('ana', { managerPassword: 'errada!!!', newPasswords: { bia: 'NovaBia@456' }, writeData }), /Sua senha está incorreta/);
  await assert.rejects(() => env.auth.removeUserAndRotateKey('ana', { managerPassword: SENHA, newPasswords: {}, writeData }), /senha de 8 ou mais caracteres para bia/);
  await assert.rejects(() => env.auth.removeUserAndRotateKey('ana', { managerPassword: SENHA, newPasswords: { bia: 'curta' }, writeData }), /8 ou mais/);
  await assert.rejects(() => env.auth.removeUserAndRotateKey('fantasma', { managerPassword: SENHA, newPasswords: {}, writeData }), /não encontrado/);
  assert.equal(gravou, 0, 'nenhum dado foi regravado');
  assert.equal(JSON.stringify(env.auth.getMeta()), antes);
  assert.equal(hex(env.auth.getVaultRaw()), rawAntes);
});

await teste('EQP.6c', 'Falha NO MEIO não perde dados: se a gravação dos dados falha, nada muda; se o cadastro falha, os dados abrem com a chave antiga', async () => {
  // (1) falha ao gravar os dados novos
  let env = await montar();
  await env.auth.addUser({ usuario: 'ana', senha: 'Senha@Ana123', perfil: 'operador' });
  const antes = JSON.stringify(env.auth.getMeta()), rawAntes = hex(env.auth.getVaultRaw());
  await assert.rejects(() => env.auth.removeUserAndRotateKey('ana', { managerPassword: SENHA, newPasswords: {}, writeData: async () => { throw new Error('disco cheio'); } }), /disco cheio/);
  assert.equal(JSON.stringify(env.auth.getMeta()), antes);
  assert.equal(hex(env.auth.getVaultRaw()), rawAntes);
  await comoOutro(env, 'ana', 'Senha@Ana123'); // a ana ainda entra
  // (2) dados novos gravados, mas o cadastro não persiste
  env = await montar();
  const cofre = cofreDeDados(env);
  const antigaKey = await env.c.importAesKey(env.raw);
  await cofre.grava(antigaKey);
  await env.auth.addUser({ usuario: 'ana', senha: 'Senha@Ana123', perfil: 'operador' });
  const metaAntes = JSON.stringify(env.auth.getMeta());
  const dbWrite = env.storage.dbWrite;
  env.storage.dbWrite = async () => { throw new Error('IndexedDB falhou'); };
  await assert.rejects(() => env.auth.removeUserAndRotateKey('ana', { managerPassword: SENHA, newPasswords: {}, writeData: cofre.grava }), /IndexedDB falhou/);
  env.storage.dbWrite = dbWrite;
  assert.equal(JSON.stringify(env.auth.getMeta()), metaAntes, 'cadastro intacto');
  assert.equal(hex(env.auth.getVaultRaw()), hex(env.raw), 'chave em memória intacta');
  assert.equal(cofre.slots.length, 2, 'o pacote novo (chave nova) existe, mas é ignorado na abertura');
  assert.deepEqual(await cofre.abre(antigaKey), { mesas: { 'Mesa 01': ['cerveja'] } }, 'dados abrem com a chave antiga: nada se perdeu');
  await comoOutro(env, 'ana', 'Senha@Ana123');
});

await teste('EQP.6d', 'Registro de recuperação é renovado junto: a frase antiga não abre a chave nova; sem renovar, a remoção é recusada', async () => {
  const env = await montar();
  const rec = { format: 'BG12-v1', identificador: 'old', wrapped: { iv: 'a', data: 'b' } };
  const m = env.auth.getMeta(); m.recovery = rec; await env.auth.saveMeta(m);
  await env.auth.addUser({ usuario: 'ana', senha: 'Senha@Ana123', perfil: 'operador' });
  await assert.rejects(() => env.auth.removeUserAndRotateKey('ana', { managerPassword: SENHA, newPasswords: {}, writeData: async () => {} }), /recuperação precisa ser renovado/);
  const out = await env.auth.removeUserAndRotateKey('ana', {
    managerPassword: SENHA, newPasswords: {}, writeData: async () => {},
    makeRecovery: async newRaw => ({ record: { format: 'BG12-v1', identificador: 'novo', chaveVista: hex(newRaw).slice(0, 8) }, phrase: 'p1 p2', token: 't' })
  });
  assert.deepEqual(out.recovery, { phrase: 'p1 p2', token: 't' });
  assert.equal(env.auth.getMeta().recovery.identificador, 'novo');
});

await teste('EQP.6e', 'Só o gerente remove: operador recebe "Acesso negado" no serviço', async () => {
  const env = await montar();
  await env.auth.addUser({ usuario: 'ana', senha: 'Senha@Ana123', perfil: 'operador' });
  const ana = await comoOutro(env, 'ana', 'Senha@Ana123');
  await assert.rejects(() => ana.removeUserAndRotateKey('celso', { managerPassword: 'x', newPasswords: {}, writeData: async () => {} }), /Acesso negado/);
  assert.deepEqual(ana.listUsers().length, 2);
});

await teste('EQP.7', 'Redefinir senha: a antiga para de valer, a nova vale e o PIN local é revogado; remover PIN limpa o selo', async () => {
  const env = await montar();
  await env.auth.addUser({ usuario: 'ana', senha: 'Senha@Ana123', perfil: 'operador' });
  const meta = env.auth.getMeta(); meta.usuarios[1].pin = { v: 2 }; meta.usuarios[1].deviceSeal = { x: 1 }; await env.auth.saveMeta(meta);
  assert.equal(env.auth.listUsers()[1].temPin, true);
  await env.auth.updateUser('ana', { senha: 'NovaSenha@456' });
  assert.equal(env.auth.listUsers()[1].temPin, false);
  await assert.rejects(() => comoOutro(env, 'ana', 'Senha@Ana123'));
  await comoOutro(env, 'ana', 'NovaSenha@456');
  const m2 = env.auth.getMeta(); m2.usuarios[1].pin = { v: 2 }; m2.usuarios[1].deviceSeal = { x: 1 }; await env.auth.saveMeta(m2);
  await env.auth.updateUser('ana', { removerPin: true });
  assert.equal(env.auth.listUsers()[1].temPin, false);
  await assert.rejects(() => env.auth.updateUser('ana', { senha: 'curta' }), /8 ou mais/);
});

// ---------------------------------------------------------------- TeamController (UI)
let els, modals;
function el(id) {
  if (!els.has(id)) {
    const classes = new Set();
    els.set(id, { id, value: '', textContent: '', checked: false, disabled: false, required: false, placeholder: '', children: [], firstChild: { textContent: '' },
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle: (c, on) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)) },
      replaceChildren() { this.children = []; }, append(...n) { this.children.push(...n); }, addEventListener() {}, focus() {}, reset() { for (const k of ['novo-user-login', 'novo-user-email', 'novo-user-senha']) el(k).value = ''; } });
  }
  return els.get(id);
}
async function montarEquipe({ limit = null, perfilDaSessao = 'gerente' } = {}) {
  els = new Map(); modals = new Set();
  globalThis.document = { getElementById: el };
  const env = await montar();
  if (perfilDaSessao !== 'gerente') {
    await env.auth.addUser({ usuario: 'vend', senha: 'Senha@Vend123', perfil: 'operador' });
    env.auth.discardSession(); await env.auth.passwordAuth('vend', 'Senha@Vend123');
  }
  const toasts = [], audit = [];
  const made = (tag, cls, txt) => ({ tag, cls, textContent: txt ?? '', children: [], append(...n) { this.children.push(...n); } });
  const app = {
    _auth: env.auth, _governanceCtl: { userLimit: () => limit },
    _renderer: { make: made, empty: t => made('div', 'empty', t), btn: (t, fn, cls) => ({ ...made('button', cls, t), onclick: fn }), toast: m => toasts.push(m), _openModal: i => modals.add(i), _closeModal: i => modals.delete(i) },
    setText(id, v) { el(id).textContent = String(v ?? ''); },
    async _commit(fn, label) { audit.push(label); return true; },
    toasts, audit
  };
  const team = new TeamController(app);
  return { env, app, team };
}
const preencher = (login, senha, perfil, email = '') => { el('novo-user-login').value = login; el('novo-user-senha').value = senha; el('novo-user-perfil').value = perfil; el('novo-user-email').value = email; };
const rotulos = btns => btns.children.filter(c => c.tag === 'button').map(b => b.textContent);

await teste('EQP.8', 'Tela: gerente lista, cadastra pela UI, vê contagem com limite e a auditoria não leva a senha', async () => {
  const { app, team } = await montarEquipe({ limit: 5 });
  team.render();
  assert.equal(el('usuarios-count').textContent, '1 usuário de 5');
  team.openCreate();
  assert.ok(modals.has('modal-usuario'));
  assert.equal(el('form-usuario-title').textContent, 'Cadastrar usuário');
  preencher('ana', 'Senha@Ana123', 'operador', 'ana@bar.com');
  assert.equal(await team._submit({ preventDefault() {} }), true);
  assert.equal(modals.has('modal-usuario'), false);
  assert.match(app.toasts.at(-1), /Usuário cadastrado/);
  assert.equal(el('usuarios-count').textContent, '2 usuários de 5');
  assert.equal(el('lista-usuarios').children.length, 2);
  assert.deepEqual(app.audit, ['Cadastro de usuário da equipe: ana']);
  assert.ok(!JSON.stringify(app.audit).includes('Senha@Ana123'));
});

await teste('EQP.9', 'Tela: erro de regra aparece no formulário (senha curta, duplicado, limite) e nada é gravado', async () => {
  const { app, team } = await montarEquipe({ limit: 1 });
  team.openCreate();
  preencher('ana', 'curta', 'operador'); assert.equal(await team._submit({ preventDefault() {} }), false);
  assert.match(el('usuario-erro').textContent, /8 ou mais/);
  preencher('ana', 'Senha@Ana123', 'operador'); assert.equal(await team._submit({ preventDefault() {} }), false);
  assert.match(el('usuario-erro').textContent, /Limite de 1 usuário do plano/);
  assert.equal(app._auth.listUsers().length, 1);
  assert.equal(app.audit.length, 0);
});

await teste('EQP.10', 'Tela: editar perfil e remover; o próprio gerente não tem botão de remover; remover abre o diálogo com um campo por pessoa que fica', async () => {
  const { app, team } = await montarEquipe();
  await app._auth.addUser({ usuario: 'ana', senha: 'Senha@Ana123', perfil: 'operador' });
  await app._auth.addUser({ usuario: 'bia', senha: 'Senha@Bia123', perfil: 'operador' });
  team.render();
  const [meu, ana] = el('lista-usuarios').children;
  assert.deepEqual(rotulos(meu.children.at(-1)), ['Editar']);
  assert.deepEqual(rotulos(ana.children.at(-1)), ['Editar', 'Remover']);
  team.openEdit(app._auth.listUsers()[1]);
  assert.equal(el('form-usuario-title').textContent, 'Editar ana');
  assert.equal(el('novo-user-login').disabled, true);
  el('novo-user-perfil').value = 'gerente'; el('novo-user-senha').value = '';
  assert.equal(await team._submit({ preventDefault() {} }), true);
  assert.equal(app._auth.listUsers()[1].perfil, 'gerente');
  assert.match(el('lista-usuarios').children[1].children[0].children[0].children[1].textContent, /Gerente/);
  team.openRemove(app._auth.listUsers()[2]);
  assert.ok(modals.has('modal-remover-usuario'));
  assert.equal(el('remover-titulo').textContent, 'Remover bia');
  assert.deepEqual(Object.keys(team._newFields), ['ana'], 'campo de senha nova só para quem fica (menos o gerente logado)');
  team.openRemove(app._auth.listUsers()[0]);
  assert.match(app.toasts.at(-1), /próprio usuário/);
});

await teste('EQP.10b', 'Tela: confirmar a remoção chama o app com a senha do gerente e as novas senhas, mostra a nova frase e fecha o diálogo', async () => {
  const { app, team } = await montarEquipe();
  await app._auth.addUser({ usuario: 'ana', senha: 'Senha@Ana123', perfil: 'operador' });
  await app._auth.addUser({ usuario: 'bia', senha: 'Senha@Bia123', perfil: 'operador' });
  let chamada; let frase;
  app.removeTeamUser = async (usuario, dados) => { chamada = { usuario, ...dados }; return { phrase: 'a b c', token: 'tok' }; };
  app._securityCtl = { _displayRecovery: (p, t) => { frase = [p, t]; } };
  team.openRemove(app._auth.listUsers()[2]); // bia sai; ana fica
  el('remover-senha-gerente').value = SENHA; team._newFields.ana.value = 'NovaAna@456';
  assert.equal(await team._submitRemove({ preventDefault() {} }), true);
  assert.deepEqual(chamada, { usuario: 'bia', managerPassword: SENHA, newPasswords: { ana: 'NovaAna@456' } });
  assert.deepEqual(frase, ['a b c', 'tok']);
  assert.equal(modals.has('modal-remover-usuario'), false);
  assert.match(app.toasts.at(-1), /chave dos dados foi trocada/);
  // erro do app aparece no diálogo e o botão volta
  app.removeTeamUser = async () => { throw new Error('Sua senha está incorreta.'); };
  team.openRemove(app._auth.listUsers()[2]);
  assert.equal(await team._submitRemove({ preventDefault() {} }), false);
  assert.equal(el('remover-erro').textContent, 'Sua senha está incorreta.');
  assert.equal(el('remover-submit').disabled, false);
});

await teste('EQP.11', 'Operador não vê nada: lista vazia, sem contagem nem aviso, botão de cadastro oculto, não abre cadastro nem remoção, e o serviço nega', async () => {
  const { app, team } = await montarEquipe({ perfilDaSessao: 'operador' });
  team.render();
  assert.equal(el('lista-usuarios').children.length, 0);
  assert.equal(el('usuarios-count').textContent, '', 'sem contagem');
  assert.equal(el('abrir-usuario').classList.contains('hidden'), true);
  team.openCreate(); team.openRemove({ usuario: 'celso' });
  assert.equal(modals.has('modal-usuario'), false);
  assert.equal(modals.has('modal-remover-usuario'), false);
  await assert.rejects(() => app._auth.addUser({ usuario: 'x1x', senha: 'Senha@Xis123', perfil: 'operador' }), /Acesso negado/);
  await assert.rejects(() => app._auth.removeUserAndRotateKey('celso', { managerPassword: 'x', newPasswords: {}, writeData: async () => {} }), /Acesso negado/);
});

await teste('EQP.12', 'Limpeza pós-troca: apaga cópias cifradas com a chave antiga (localStorage e backup-candidates) e mantém as da chave nova', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const st = new StorageAdapter();
  const idb = { 'backup-candidates': [{ id: 'novo' }, { id: 'velho' }, { id: 'lixo' }] };
  st.dbRead = async (_s, k) => idb[k]; st.dbWrite = async (_s, k, v) => { idb[k] = v; }; st.dbDelete = async (_s, k) => { delete idb[k]; };
  store.set('bargestao_json_v7_0', JSON.stringify({ id: 'velho' })); store.set('bargestao_json_v7_1', JSON.stringify({ id: 'novo' }));
  const removidos = await st.purgeCandidates(async p => { if (p.id === 'novo') return true; if (p.id === 'velho') return false; throw new Error('não abre'); });
  assert.equal(removidos, 3); // localStorage velho + idb velho + idb lixo
  assert.equal(store.has('bargestao_json_v7_0'), false);
  assert.equal(store.has('bargestao_json_v7_1'), true);
  assert.deepEqual(idb['backup-candidates'], [{ id: 'novo' }]);
  const so = new StorageAdapter(); so.dbRead = async () => [{ id: 'velho' }]; let apagou = false; so.dbDelete = async () => { apagou = true; }; so.dbWrite = async () => {};
  await so.purgeCandidates(async () => false);
  assert.equal(apagou, true, 'sem nenhuma cópia válida, a lista é apagada');
});

// ---------------------------------------------------------------- mesas desabilitadas
function appMesas(tablesOn) {
  els = new Map(); modals = new Set();
  globalThis.document = { getElementById: el, querySelector: () => null };
  globalThis.history = { pushState() {}, back() {} };
  globalThis.window = { addEventListener() {} };
  const made = (tag, cls, txt) => ({ tag, cls, textContent: txt ?? '', children: [], append(...n) { this.children.push(...n); }, style: {}, setAttribute() {} });
  const app = {
    _data: { mesas: { 'Mesa 03': [{ id: 'i1', nome: 'Cerveja', qtd: 2, total: 19, produtoId: 'p1' }], 'Balcão': [{ id: 'i2', nome: 'Água', qtd: 1, total: 5, produtoId: 'p2' }] },
      mesaClientes: { 'Mesa 03': 'Joao' }, produtos: [], categorias: [], caixa: [] },
    _order: new OrderService(), _cash: new CashService(), _shift: new ShiftService(), _stock: new StockService(),
    _governanceCtl: { allowsTables: () => tablesOn },
    _renderer: { make: made, money: v => `R$ ${Number(v).toFixed(2)}`, empty: t => made('div', 'empty', t), btn: (t, fn, cls) => ({ ...made('button', cls, t), onclick: fn }), icon: () => made('svg'), _openModal() {}, _closeModal() {}, toast() {} },
    setText(id, v) { el(id).textContent = String(v ?? ''); }
  };
  app._comandaCtl = new ComandaController(app);
  return app;
}
const nomesDosCards = root => root.children.map(c => c.children[0].children[0].children[0].textContent);

await teste('MSA.1', 'Módulo de mesas ligado: cards de mesa e balcão aparecem, botão "Abrir mesa", sem aviso', () => {
  const app = appMesas(true); new SalesController(app)._renderTables();
  assert.equal(el('lista-mesas').children.length, 2);
  assert.equal(el('abrir-nova-mesa-label').textContent, 'Abrir mesa');
  assert.equal(el('mesas-ocultas-aviso').classList.contains('hidden'), true);
});

await teste('MSA.2', 'Mesas desabilitadas pela Governança: o card da mesa some (balcão fica), botão vira "Venda no balcão" e há aviso', () => {
  const app = appMesas(false); new SalesController(app)._renderTables();
  const nomes = nomesDosCards(el('lista-mesas'));
  assert.equal(nomes.length, 1);
  assert.match(nomes[0], /Balc/);
  assert.equal(el('stat-mesas').textContent, '1');
  assert.equal(el('abrir-nova-mesa-label').textContent, 'Venda no balcão');
  assert.equal(el('mesas-ocultas-aviso').classList.contains('hidden'), false);
  assert.match(el('mesas-ocultas-aviso').textContent, /1 comanda de mesa aberta oculta/);
});

await teste('MSA.3', 'Reativar o módulo traz as mesas de volta (nada foi apagado)', () => {
  const app = appMesas(false); const s = new SalesController(app); s._renderTables();
  app._governanceCtl.allowsTables = () => true; s._renderTables();
  assert.equal(el('lista-mesas').children.length, 2);
  assert.ok(app._data.mesas['Mesa 03'], 'dados intactos');
});

await teste('MSA.4', 'Com mesas desabilitadas, "nova comanda" abre direto o balcão (sem pedir mesa)', () => {
  const app = appMesas(false); app._comandaCtl.openNew();
  assert.equal(app._comandaCtl.currentTable, 'Balcão');
  const on = appMesas(true); on._comandaCtl.openNew();
  assert.equal(on._comandaCtl.currentTable, null);
});

// ---------------------------------------------------------------- gráfico e kit
await teste('GRF.1', 'Rótulo compacto cabe em 432px: reais inteiros, k e M; zero e inválido viram "R$ 0"', () => {
  assert.equal(compactMoney(0), 'R$ 0');
  assert.equal(compactMoney(undefined), 'R$ 0');
  assert.equal(compactMoney(28.5), 'R$ 29');
  assert.equal(compactMoney(999.4), 'R$ 999');
  assert.equal(compactMoney(1250), 'R$ 1,3k');
  assert.equal(compactMoney(12000), 'R$ 12k');
  assert.equal(compactMoney(1250000), 'R$ 1,3M');
  for (const v of [0, 28.5, 999.99, 1250, 99999, 1250000]) assert.ok(compactMoney(v).length <= 8, `${compactMoney(v)} cabe`);
});

await teste('GRF.2', 'CashController._renderChart usa o rótulo compacto e guarda o valor exato no title/aria-label', () => {
  els = new Map();
  globalThis.document = { getElementById: el };
  const hoje = new Date().toISOString();
  const made = (tag, cls, txt) => ({ tag, cls, textContent: txt ?? '', children: [], style: {}, attrs: {}, append(...n) { this.children.push(...n); }, setAttribute(k, v) { this.attrs[k] = v; } });
  const app = { _data: { caixa: [{ tipo: 'entrada', origem: 'venda', valor: 28.5, data: hoje }] }, _cash: new CashService(),
    _renderer: { make: made, money: v => `R$ ${Number(v).toFixed(2)}` }, setText() {} };
  new CashController(app)._renderChart();
  const col = el('chart-caixa').children.at(-1);
  const [val, body] = col.children;
  assert.equal(val.textContent, 'R$ 29');
  assert.equal(val.title, 'R$ 28.50');
  assert.match(body.title, /R\$ 28\.50/);
  assert.match(col.attrs['aria-label'], /R\$ 28\.50/);
});

await teste('KIT.1', 'Kit: cópia com a guarda do elemento de mensagem (detachedMessage) e idêntica à fonte em PACOTES', () => {
  const copia = fs.readFileSync('src/stk-pkg-secure-ui.js', 'utf-8');
  assert.match(copia, /const detachedMessage = document\.createElement\('p'\);/);
  assert.match(copia, /const get = id => document\.getElementById\(id\) \|\| \(id === 'vaultMessage' \? detachedMessage : null\);/);
  const fonte = '../../PACOTES/stk-pkg-security/stk-pkg-secure-ui.js';
  if (fs.existsSync(fonte)) assert.equal(fs.readFileSync(fonte, 'utf-8'), copia);
});

await teste('FIA.1', 'Fiação: tela de equipe no HTML com erro e botões; TeamController e CompactMoney no SW; App sem o antigo _renderUsers', () => {
  const html = fs.readFileSync('src/index.html', 'utf-8');
  for (const id of ['abrir-usuario', 'form-usuario', 'usuario-erro', 'novo-user-senha', 'novo-user-perfil', 'mesas-ocultas-aviso', 'abrir-nova-mesa-label']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /id="novo-user-senha"[^>]*type="password"/); // o kit põe o olho de mostrar/ocultar em todo type=password
  const sw = fs.readFileSync('src/sw.js', 'utf-8');
  assert.match(sw, /TeamController\.js/); assert.match(sw, /CompactMoney\.js/); assert.match(sw, /bargestao-v3-2-0/);
  const app = fs.readFileSync('src/js/App.js', 'utf-8');
  assert.match(app, /new TeamController\(this\)/); assert.match(app, /_teamCtl\.render\(\)/); assert.doesNotMatch(app, /_renderUsers/);
  assert.match(app, /tab === 'usuarios' && !this\._auth\.isManager\(\)\) tab = 'inicio'/, 'aba Usuários bloqueada em _changeTab');
  assert.ok(html.includes('id="modal-remover-usuario"') && html.includes('id="remover-senha-gerente"'));
  assert.ok(!/value="vendedor"/.test(html), 'perfil canônico é operador');
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert.ok(!emoji.test(fs.readFileSync('src/js/ui/controllers/TeamController.js', 'utf-8')));
});

const total = resultados.length, ok = resultados.filter(Boolean).length;
console.log(`📊 TOTAL: ${total} | ✅ PASS: ${ok} | ❌ FAIL: ${total - ok}`);
if (ok !== total) process.exit(1);
