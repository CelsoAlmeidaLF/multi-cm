// Regressão v3.0.2: recarregar a página (F5) não deve pedir o PIN do cofre do kit.
// Causa: o F5 dispara visibilitychange->hidden e o app bloqueava o cofre na hora, anulando a tolerância de recarga do kit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BackgroundLockPolicy } from '../src/js/application/services/BackgroundLockPolicy.js';

const resultados = [];
async function teste(id, nome, fn) {
  try { await fn(); resultados.push(true); console.log(`✅ [PASS] ${id} - ${nome}`); }
  catch (e) { resultados.push(false); console.error(`❌ [FAIL] ${id} - ${nome} -> ${e.message}`); }
}
const base = { hasSession: true, lockOnHide: true, kitVaultLock: true };

await teste('RLD.1', 'Com cofre do kit, esconder (F5) NÃO bloqueia na hora: adia para o retorno', () => {
  const p = new BackgroundLockPolicy();
  assert.equal(p.onHide(base), 'defer');
});
await teste('RLD.2', 'F5: a página é destruída, não há retorno, então nenhum bloqueio é executado', () => {
  const p = new BackgroundLockPolicy();
  p.onHide(base); // não chama onReturn: página recarregada
  assert.equal(new BackgroundLockPolicy().onReturn({ hasSession: true }), false);
});
await teste('RLD.3', 'Trocar de app e voltar continua bloqueando (segurança preservada)', () => {
  const p = new BackgroundLockPolicy();
  p.onHide(base);
  assert.equal(p.onReturn({ hasSession: true }), true);
  assert.equal(p.onReturn({ hasSession: true }), false, 'só bloqueia uma vez por ocultação');
});
await teste('RLD.4', 'Sem cofre do kit mantém o comportamento anterior (descarta ao esconder)', () => {
  assert.equal(new BackgroundLockPolicy().onHide({ ...base, kitVaultLock: false }), 'discard');
});
await teste('RLD.5', 'Negativos: sem sessão ou com "bloquear ao sair" desligado não faz nada e não agenda bloqueio', () => {
  const p = new BackgroundLockPolicy();
  assert.equal(p.onHide({ ...base, hasSession: false }), 'none');
  assert.equal(p.onHide({ ...base, lockOnHide: false }), 'none');
  assert.equal(p.onReturn({ hasSession: true }), false);
});
await teste('RLD.6', 'Sessão encerrada entre esconder e voltar não tenta bloquear de novo', () => {
  const p = new BackgroundLockPolicy();
  p.onHide(base);
  assert.equal(p.onReturn({ hasSession: false }), false);
});
await teste('RLD.7', 'Fiação: App usa a política; DomEventHandler chama o retorno; sw.js faz precache', () => {
  const app = fs.readFileSync('src/js/App.js', 'utf-8');
  assert.match(app, /new BackgroundLockPolicy\(\)/);
  assert.match(app, /handleBackgroundReturn\(\)/);
  assert.doesNotMatch(app, /handleBackgroundHide\(\) \{\s*if \(this\._auth\.getSession\(\) && this\._settings\.lockOnHide !== false\) \{\s*this\._discardSession/);
  assert.match(fs.readFileSync('src/js/ui/adapters/DomEventHandler.js', 'utf-8'), /handleBackgroundReturn\(\)/);
  assert.match(fs.readFileSync('src/sw.js', 'utf-8'), /BackgroundLockPolicy\.js/);
});

const total = resultados.length, ok = resultados.filter(Boolean).length;
console.log(`📊 TOTAL: ${total} | ✅ PASS: ${ok} | ❌ FAIL: ${total - ok}`);
if (ok !== total) process.exit(1);
