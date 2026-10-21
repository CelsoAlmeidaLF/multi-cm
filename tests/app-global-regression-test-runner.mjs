// Regressão v3.0.1: "ReferenceError: App is not defined" (telemetria da Governança, 26 ocorrências em 2.9.0/3.0.0).
// Os controllers de UI não importam a classe App (nem podem: dependência circular com App.js); eles falam com o
// app só por `this._app`. Estes testes carregam os controllers SEM nenhum global `App` e renderizam mesas e caixa.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SalesController } from '../src/js/ui/controllers/SalesController.js';
import { CashController } from '../src/js/ui/controllers/CashController.js';
import { OrderService } from '../src/js/application/services/OrderService.js';
import { CashService } from '../src/js/application/services/CashService.js';
import { ShiftService } from '../src/js/application/services/ShiftService.js';

const resultados = [];
async function teste(id, nome, fn) {
  try {
    await fn();
    resultados.push(true);
    console.log(`✅ [PASS] ${id} - ${nome}`);
  } catch (e) {
    resultados.push(false);
    console.error(`❌ [FAIL] ${id} - ${nome} -> ${e.message}`);
  }
}

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const jsDir = path.join(raiz, 'src/js');
function arquivosJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? arquivosJs(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []);
}
const semComentarios = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// --- DOM mínimo (sem navegador): elementos são stubs que registram textContent ---
const els = new Map();
function elemento(id) {
  if (!els.has(id)) {
    const filhos = [];
    els.set(id, {
      id, value: '', textContent: '', style: {}, filhos,
      replaceChildren() { filhos.length = 0; },
      append(...n) { filhos.push(...n); },
      addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} },
      appendChild(n) { filhos.push(n); }
    });
  }
  return els.get(id);
}
function instalarDom() {
  globalThis.document = { getElementById: elemento, querySelectorAll: () => [], createElement: () => elemento('x' + Math.random()) };
}
function stubApp() {
  const textos = {};
  const make = (tag, cls, txt) => ({ tag, cls, textContent: txt ?? '', style: {}, append() {}, appendChild() {} });
  const dados = {
    mesas: { 'Mesa 05': [{ id: 'i1', nome: 'Cerveja', qtd: 2, total: 19 }] },
    mesaClientes: { 'Mesa 05': 'Joao' },
    caixa: [{ id: 'c1', tipo: 'entrada', valor: 19, descricao: 'Mesa 05', data: new Date().toISOString(), origem: 'venda', formaPagamento: 'pix', mesa: 'Mesa 05' }],
    produtos: [], turnosCaixa: [], fechamentosCaixa: [], movimentacoesEstoque: [], cancelamentos: [], auditoria: []
  };
  const app = {
    _data: dados,
    _order: new OrderService(), _cash: new CashService(), _shift: new ShiftService(),
    _renderer: {
      make, money: v => `R$ ${Number(v).toFixed(2)}`, empty: t => make('div', 'empty', t),
      btn: (t) => make('button', 'btn', t), dateLabel: d => String(d), toast() {}
    },
    // Contrato que os controllers usam (App.prototype.setText): grava no texto do elemento
    setText(id, v) { textos[id] = String(v ?? ''); },
    textos
  };
  return app;
}

await teste('APP-GLB.1', 'Nenhum global `App` existe no ambiente de teste (premissa da regressão)', () => {
  assert.equal(typeof globalThis.App, 'undefined');
});

await teste('APP-GLB.2', 'Controllers/adapters/serviços não referenciam o símbolo `App` fora de App.js', () => {
  const ofensores = [];
  for (const f of arquivosJs(jsDir)) {
    if (path.basename(f) === 'App.js') continue;
    const src = semComentarios(fs.readFileSync(f, 'utf-8'));
    // `App.` ou `App(` como identificador livre (não parte de FirebaseAppCheck, this._app, etc.) e sem import
    if (/(?<![\w$.'"/-])App\s*[.(]/.test(src) && !/import[^;]*\bApp\b/.test(src)) ofensores.push(path.relative(raiz, f));
  }
  assert.deepEqual(ofensores, []);
});

await teste('APP-GLB.3', 'App.js expõe setText (instância) delegando a safeSetText', () => {
  const src = fs.readFileSync(path.join(jsDir, 'App.js'), 'utf-8');
  assert.match(src, /\n\s+setText\(idOrEl, value\) \{\s*App\.safeSetText\(idOrEl, value\);/);
  assert.match(src, /static safeSetText\(/);
});

await teste('APP-GLB.4', 'SalesController._renderTables renderiza mesas sem ReferenceError e atualiza contadores', () => {
  instalarDom();
  const app = stubApp();
  new SalesController(app)._renderTables();
  assert.equal(app.textos['stat-mesas'], '1');
  assert.equal(app.textos['mesas-count'], '1 mesa(s)');
  assert.equal(app.textos['stat-valor'], 'R$ 19.00');
});

await teste('APP-GLB.5', 'SalesController._renderTables com zero mesas (caso limite) não quebra', () => {
  instalarDom();
  const app = stubApp();
  app._data.mesas = {};
  new SalesController(app)._renderTables();
  assert.equal(app.textos['stat-mesas'], '0');
});

await teste('APP-GLB.6', 'CashController._renderCash renderiza caixa (métricas, gráfico, histórico) sem ReferenceError', () => {
  instalarDom();
  const app = stubApp();
  new CashController(app)._renderCash();
  assert.equal(app.textos['cash-vendas'], '1');
  assert.equal(app.textos['cash-faturamento'], 'R$ 19.00');
  assert.equal(app.textos['caixa-count'], '1 registros');
});

await teste('APP-GLB.7', 'CashController._updateClosingSummaryView preenche o resumo do fechamento sem ReferenceError', () => {
  instalarDom();
  const app = stubApp();
  new CashController(app)._updateClosingSummaryView();
  assert.match(app.textos['fechamento-resumo-periodo'], /^Hoje \(/);
  assert.equal(app.textos['fechamento-total-vendas'], 'R$ 19.00');
  assert.equal(app.textos['fechamento-pix'], 'R$ 19.00');
});

await teste('APP-GLB.8', 'Negativo: app sem setText (contrato quebrado) falha com TypeError, não passa em silêncio', () => {
  instalarDom();
  const app = stubApp();
  delete app.setText;
  assert.throws(() => new SalesController(app)._renderTables(), TypeError);
});

const total = resultados.length, ok = resultados.filter(Boolean).length;
console.log(`📊 TOTAL: ${total} | ✅ PASS: ${ok} | ❌ FAIL: ${total - ok}`);
if (ok !== total) process.exit(1);
