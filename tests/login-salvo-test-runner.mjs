// Login salvo (v2.7.0): um PIN só (o do aparelho). Depois do 1º login com usuário e senha, a chave do cofre fica no
// cofre do kit (window.secureStorage) e a próxima abertura entra direto. Aqui o cofre do kit é simulado por um Map.
import assert from 'node:assert/strict';
import { WebCryptoAdapter } from '../src/js/infrastructure/adapters/WebCryptoAdapter.js';
import { AuthService } from '../src/js/application/services/AuthService.js';

const resultados = [];
async function teste(id, nome, fn) {
  try {
    await fn();
    resultados.push(true);
    console.log(`✅ [PASS] ${id} - ${nome}`);
  } catch (err) {
    resultados.push(false);
    console.error(`❌ [FAIL] ${id} - ${nome} -> ${err.message}`);
  }
}

const SENHA = 'SenhaForte!2026';

function cofreDoKit() {
  const m = new Map();
  return {
    m,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); }
  };
}

async function montar(usuarios = [{ usuario: 'celso', perfil: 'gerente', ativo: true }]) {
  const c = new WebCryptoAdapter();
  const db = new Map();
  const storage = { dbRead: async (s, k) => db.get(`${s}/${k}`), dbWrite: async (s, k, v) => { db.set(`${s}/${k}`, structuredClone(v)); } };
  const raw = c.randomBytes(32);
  const lista = [];
  for (const u of usuarios) lista.push({ ...u, senha: await c.wrapKey(SENHA, raw), pin: null, deviceSeal: null });
  const auth = new AuthService(c, storage);
  await auth.saveMeta({ version: 7, usuarios: lista, lastUser: usuarios[0].usuario });
  // dados do bar cifrados com a chave do cofre, para provar que a chave retomada abre os dados
  const chaveOriginal = await c.importAesKey(raw);
  const dados = await c.seal({ mesas: 3 }, chaveOriginal, 'BG:teste');
  return { c, auth, storage, dados };
}

await teste('LS-01', 'Login com senha + "manter conectado" guarda a chave no cofre do kit, nunca a senha', async () => {
  const { auth } = await montar();
  const kit = cofreDoKit();
  await auth.passwordAuth('celso', SENHA);
  assert.equal(await auth.rememberLogin(kit), true);
  const salvo = kit.getItem(AuthService.LOGIN_SALVO);
  assert.ok(salvo, 'login salvo gravado');
  assert.ok(!salvo.includes(SENHA), 'a senha não aparece no que foi salvo');
  const j = JSON.parse(salvo);
  assert.equal(j.usuario, 'celso');
  assert.match(j.chave, /^[0-9a-f]{64}$/);
  assert.equal(auth.hasSavedLogin(kit), true);
});

await teste('LS-02', 'Próxima abertura: retoma a sessão sem senha e a chave abre os dados', async () => {
  const { c, auth, dados } = await montar();
  const kit = cofreDoKit();
  await auth.passwordAuth('celso', SENHA);
  await auth.rememberLogin(kit);
  auth.discardSession();
  assert.equal(auth.getSession(), null);
  const r = await auth.resumeLogin(kit);
  assert.ok(r, 'retomou');
  assert.deepEqual(auth.getSession(), { usuario: 'celso', perfil: 'gerente' });
  assert.deepEqual(await c.open(dados, r.key, 'BG:teste'), { mesas: 3 });
});

await teste('LS-03', 'Perfil vem do cadastro atual, não do que foi salvo', async () => {
  const { auth } = await montar([{ usuario: 'ana', perfil: 'gerente', ativo: true }]);
  const kit = cofreDoKit();
  await auth.passwordAuth('ana', SENHA);
  await auth.rememberLogin(kit);
  auth.discardSession();
  const meta = auth.getMeta();
  meta.usuarios[0].perfil = 'funcionario';
  await auth.saveMeta(meta);
  await auth.resumeLogin(kit);
  assert.equal(auth.getSession().perfil, 'funcionario');
  assert.equal(auth.isManager(), false);
});

await teste('LS-04', 'Usuário desativado: não entra e o login salvo é apagado', async () => {
  const { auth } = await montar();
  const kit = cofreDoKit();
  await auth.passwordAuth('celso', SENHA);
  await auth.rememberLogin(kit);
  auth.discardSession();
  const meta = auth.getMeta();
  meta.usuarios[0].ativo = false;
  await auth.saveMeta(meta);
  assert.equal(await auth.resumeLogin(kit), null);
  assert.equal(auth.getSession(), null);
  assert.equal(auth.hasSavedLogin(kit), false);
});

await teste('LS-05', 'Usuário removido: não entra e o login salvo é apagado', async () => {
  const { auth } = await montar([{ usuario: 'celso', perfil: 'gerente', ativo: true }, { usuario: 'joao', perfil: 'funcionario', ativo: true }]);
  const kit = cofreDoKit();
  await auth.passwordAuth('joao', SENHA);
  await auth.rememberLogin(kit);
  auth.discardSession();
  const meta = auth.getMeta();
  meta.usuarios = meta.usuarios.filter(u => u.usuario !== 'joao');
  await auth.saveMeta(meta);
  assert.equal(await auth.resumeLogin(kit), null);
  assert.equal(auth.hasSavedLogin(kit), false);
});

await teste('LS-06', 'Registro salvo adulterado ou de outra versão: descartado', async () => {
  const { auth } = await montar();
  for (const ruim of ['{lixo', JSON.stringify({ v: 9, usuario: 'celso', chave: 'a'.repeat(64) }), JSON.stringify({ v: 1, usuario: 'celso', chave: 'xyz' })]) {
    const kit = cofreDoKit();
    kit.setItem(AuthService.LOGIN_SALVO, ruim);
    assert.equal(await auth.resumeLogin(kit), null);
    assert.equal(auth.hasSavedLogin(kit), false, 'registro inválido apagado: ' + ruim.slice(0, 20));
  }
});

await teste('LS-07', 'Sem sessão não há o que salvar; sem login salvo não retoma', async () => {
  const { auth } = await montar();
  const kit = cofreDoKit();
  assert.equal(await auth.rememberLogin(kit), false);
  assert.equal(await auth.resumeLogin(kit), null);
  assert.equal(await auth.rememberLogin(null), false);
});

await teste('LS-08', 'Trocar usuário / Sair: esquecer apaga o login salvo', async () => {
  const { auth } = await montar();
  const kit = cofreDoKit();
  await auth.passwordAuth('celso', SENHA);
  await auth.rememberLogin(kit);
  auth.forgetLogin(kit);
  assert.equal(auth.hasSavedLogin(kit), false);
  assert.equal(kit.m.size, 0);
  // cofre do kit bloqueado (getItem lança): não quebra
  const bloqueado = { getItem() { throw new Error('Cofre bloqueado.'); }, removeItem() { throw new Error('Cofre bloqueado.'); } };
  assert.equal(auth.hasSavedLogin(bloqueado), false);
  auth.forgetLogin(bloqueado);
});

const total = resultados.length, ok = resultados.filter(Boolean).length;
console.log(`📊 TOTAL: ${total} | ✅ PASS: ${ok} | ❌ FAIL: ${total - ok}`);
if (ok !== total) process.exit(1);
