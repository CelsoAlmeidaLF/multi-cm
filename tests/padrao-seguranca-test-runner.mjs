// Padrão de segurança Systekna: cofre do kit por fora (PIN FINANC, biometria, 12 palavras) e equipe por dentro.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { protectTypedSecrets, typedValue, clearTyped, TYPED_SECRET_FIELDS, NOT_TYPED_MESSAGE } from '../src/js/ui/adapters/TypedSecrets.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = p => readFileSync(join(root, 'src', p), 'utf8');
const KIT_FILES = ['stk-pkg-secure-vault.js', 'stk-pkg-secure-ui.js', 'stk-pkg-secure-ui.css', 'stk-pkg-bip39-pt.js', 'stk-pkg-financ-icons.js'];

const results = [];
async function testCase(id, name, fn) {
  try {
    await fn();
    results.push('PASS');
    console.log(`✅ [PASS] ${id} - ${name}`);
  } catch (err) {
    results.push('FAIL');
    console.error(`❌ [FAIL] ${id} - ${name} -> ${err.message}`);
  }
}

console.log('='.repeat(70));
console.log('🧪 PADRÃO DE SEGURANÇA SYSTEKNA (KIT stk-pkg-security)');
console.log('='.repeat(70));

const html = src('index.html');

await testCase('SEG-01', 'index.html abre pelo cofre do kit: html travado, app id e scripts antes do App.js', async () => {
  assert.match(html, /<html[^>]*class="vault-locked"/);
  assert.match(html, /data-vault-app="multi-cm"/);
  assert.match(html, /data-vault-name="BarGestão"/);
  const app = html.indexOf('src="js/App.js"');
  for (const f of ['stk-pkg-financ-icons.js', 'stk-pkg-bip39-pt.js', 'stk-pkg-secure-vault.js', 'stk-pkg-secure-ui.js']) {
    const at = html.indexOf(`<script src="${f}"></script>`);
    assert.ok(at > 0 && at < app, `${f} deve carregar antes do App.js`);
  }
  assert.ok(html.includes('href="stk-pkg-secure-ui.css"'));
});

await testCase('SEG-02', 'Versão do cofre = versão do app (App.VERSION)', async () => {
  const version = /static VERSION = '([\d.]+)'/.exec(src('js/App.js'))[1];
  assert.equal(/data-vault-version="([\d.]+)"/.exec(html)[1], version);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, version);
});

await testCase('SEG-03', 'App só inicia depois do cofre e não registra service worker próprio (o kit registra)', async () => {
  const app = src('js/App.js');
  assert.ok(app.indexOf('await window.vaultReady') > 0);
  assert.ok(app.indexOf('await window.vaultReady') < app.indexOf('await this._storage.init()'));
  assert.ok(!app.includes('serviceWorker.register'));
});

await testCase('SEG-04', 'Cópia do kit idêntica a PACOTES/stk-pkg-security (quando a pasta existe)', async () => {
  const pkg = join(root, '..', '..', 'PACOTES', 'stk-pkg-security');
  for (const f of KIT_FILES) assert.ok(existsSync(join(root, 'src', f)), `${f} ausente em src/`);
  if (!existsSync(pkg)) return; // CI: só o repositório do app
  for (const f of KIT_FILES) assert.equal(src(f), readFileSync(join(pkg, f), 'utf8'), `${f} difere do pacote`);
});

await testCase('SEG-05', 'Service worker guarda o kit para abrir offline', async () => {
  const sw = src('sw.js');
  for (const f of KIT_FILES) assert.ok(sw.includes(`'./${f}'`), `${f} fora do cache`);
});

await testCase('SEG-06', 'Sem ids duplicados no index.html', async () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual([...new Set(dup)], []);
});

await testCase('SEG-07', 'Todos os campos de senha/PIN da equipe existem e recebem a proteção do kit', async () => {
  for (const id of Object.keys(TYPED_SECRET_FIELDS)) assert.ok(html.includes(`id="${id}"`), `campo ${id} não existe`);
  const elements = new Map(Object.keys(TYPED_SECRET_FIELDS).map(id => [id, { id, value: '' }]));
  const doc = { getElementById: id => elements.get(id) || null };
  const calls = [];
  const typed = { only: (input, digits) => { calls.push([input.id, digits]); input._typed = ''; return input; } };
  assert.equal(protectTypedSecrets(doc, typed), elements.size);
  assert.equal(protectTypedSecrets(doc, typed), 0, 'não protege duas vezes');
  assert.deepEqual(calls.find(c => c[0] === 'pin-new'), ['pin-new', true], 'PIN é só números');
  assert.deepEqual(calls.find(c => c[0] === 'login-secret'), ['login-secret', false]);
  assert.throws(() => protectTypedSecrets(doc, undefined), /Kit de segurança/);
});

await testCase('SEG-08', 'Valor colado ou preenchido por fora é recusado; digitado passa', async () => {
  const input = { id: 'pin-new', value: '', _typed: '', _typedProtected: true };
  const doc = { getElementById: () => input };
  input.value = '482913'; input._typed = '482913';
  assert.equal(typedValue('pin-new', doc), '482913');
  input.value = '111222'; // posto por gerenciador de senhas, sem digitação
  assert.throws(() => typedValue('pin-new', doc), new RegExp(NOT_TYPED_MESSAGE.slice(0, 20)));
  clearTyped(input);
  assert.equal(input.value, '');
  assert.equal(typedValue('pin-new', doc), '');
});

await testCase('SEG-09', 'Recuperação não carrega mais a lista em inglês no serviço (frases novas em BIP39-pt)', async () => {
  const rec = src('js/application/services/RecoveryService.js');
  assert.ok(!/able about above/.test(rec));
  assert.ok(rec.includes('FinancVault?.seed'));
});

const PKG_GOVERNANCA = ['stk-pkg-governanca-contrato.js', 'stk-pkg-governanca-config.js', 'stk-pkg-governanca-cliente.js', 'stk-pkg-governanca-firestore.js'];

await testCase('SEG-10', 'pkg-governanca: cópia idêntica a PACOTES/stk-pkg-governanca (quando a pasta existe)', async () => {
  for (const f of PKG_GOVERNANCA) assert.ok(existsSync(join(root, 'src', 'stk-pkg-governanca', f)), `${f} ausente`);
  const pkg = join(root, '..', '..', 'PACOTES', 'stk-pkg-governanca');
  if (!existsSync(pkg)) return;
  for (const f of PKG_GOVERNANCA) assert.equal(src('stk-pkg-governanca/' + f), readFileSync(join(pkg, f), 'utf8'), `${f} difere do pacote`);
  assert.equal(readFileSync(join(root, 'tests', 'stk-pkg-governanca.test.mjs'), 'utf8'), readFileSync(join(pkg, 'test', 'governanca.test.mjs'), 'utf8'));
});

await testCase('SEG-11', 'Service worker guarda todos os módulos JS (o app abre offline)', async () => {
  const sw = src('sw.js');
  const { readdirSync, statSync } = await import('node:fs');
  const walk = d => readdirSync(join(root, 'src', d)).flatMap(f => statSync(join(root, 'src', d, f)).isDirectory() ? walk(`${d}/${f}`) : [`${d}/${f}`]);
  for (const f of [...walk('js'), ...walk('stk-pkg-governanca')].filter(f => f.endsWith('.js'))) {
    assert.ok(sw.includes(`'./${f}'`), `${f} fora do cache`);
  }
});

const failed = results.filter(r => r === 'FAIL').length;
console.log('='.repeat(70));
console.log(`📊 TOTAL: ${results.length} | ✅ PASS: ${results.length - failed} | ❌ FAIL: ${failed}`);
console.log('='.repeat(70));
if (failed) process.exit(1);
