// Comanda da mesa em tela cheia (v3.1.0): lançar, corrigir, cancelar e receber na mesma tela, e o voltar do Android.
// Camada de UI testada sem navegador: DOM e history simulados; serviços (OrderService, StockService, ShiftService) reais.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ComandaController } from '../src/js/ui/controllers/ComandaController.js';
import { SalesController } from '../src/js/ui/controllers/SalesController.js';
import { OrderService } from '../src/js/application/services/OrderService.js';
import { StockService } from '../src/js/application/services/StockService.js';
import { ShiftService } from '../src/js/application/services/ShiftService.js';

const resultados = [];
async function teste(id, nome, fn) {
  try { await fn(); resultados.push(true); console.log(`✅ [PASS] ${id} - ${nome}`); }
  catch (e) { resultados.push(false); console.error(`❌ [FAIL] ${id} - ${nome} -> ${e.message}`); }
}

// ---------- DOM / history simulados ----------
let els, listeners, histStack, popHandlers, openModals;
function el(id) {
  if (!els.has(id)) {
    const classes = new Set(['tab-comanda', 'cmd-pagamento', 'cmd-novo'].includes(id) ? ['hidden'] : []); // estado inicial do HTML
    els.set(id, {
      id, value: '', textContent: '', disabled: false, children: [],
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle: (c, on) => (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c) },
      replaceChildren() { this.children = []; }, append(...n) { this.children.push(...n); },
      addEventListener(ev, fn) { (listeners[id + ':' + ev] ||= []).push(fn); },
      focus() {}, setAttribute() {}
    });
  }
  return els.get(id);
}
function instalarAmbiente() {
  els = new Map(); listeners = {}; histStack = [{ base: true }]; popHandlers = []; openModals = new Set();
  globalThis.document = { getElementById: el, querySelector: () => null };
  globalThis.history = {
    pushState(state) { histStack.push(state); },
    back() { histStack.pop(); queueMicrotask(() => popHandlers.forEach(h => h())); }
  };
  globalThis.window = { addEventListener: (ev, fn) => { if (ev === 'popstate') popHandlers.push(fn); } };
}
const tick = () => new Promise(r => setTimeout(r, 0));

function criarApp({ perfil = 'gerente' } = {}) {
  const toasts = [];
  const made = (tag, cls, txt) => ({ tag, cls, textContent: txt ?? '', children: [], append(...n) { this.children.push(...n); }, setAttribute() {}, disabled: false });
  const app = {
    _data: {
      categorias: ['Cervejas', 'Porções'],
      produtos: [
        { id: 'p1', nome: 'Cerveja', categoria: 'Cervejas', compra: 4, venda: 9.5, qtd: 10, min: 1, ativo: true },
        { id: 'p2', nome: 'Batata', categoria: 'Porções', compra: 8, venda: 22, qtd: 3, min: 1, ativo: true },
        { id: 'p3', nome: 'Sem estoque', categoria: 'Porções', compra: 1, venda: 5, qtd: 0, min: 0, ativo: true }
      ],
      mesas: {}, mesaClientes: {}, caixa: [], movimentacoesEstoque: [], cancelamentos: [], turnosCaixa: [], auditoria: []
    },
    _order: new OrderService(), _stock: new StockService(), _shift: new ShiftService(),
    _auth: { getSession: () => ({ usuario: 'ana', perfil }) },
    _printer: { printOrderReceipt: async () => {} },
    _governance: { getRecord: () => ({ nomeEstabelecimento: 'Bar Teste' }) },
    _renderer: {
      make: made, money: v => `R$ ${Number(v).toFixed(2)}`, empty: t => made('div', 'empty', t),
      btn: (t, fn, cls) => ({ ...made('button', cls, t), onclick: fn }), icon: () => made('svg'),
      toast: m => toasts.push(m),
      _openModal: id => openModals.add(id), _closeModal: id => openModals.delete(id)
    },
    setText(id, v) { el(id).textContent = String(v ?? ''); },
    toasts,
    // Commit transacional simplificado: rascunho -> mutação -> troca o estado -> renderAll
    async _commit(fn) {
      const draft = structuredClone(this._data);
      try { fn(draft); } catch (e) { toasts.push('Não foi possível salvar: ' + e.message); return false; }
      this._data = draft;
      this._comandaCtl.render();
      return true;
    }
  };
  const ctl = new ComandaController(app);
  app._comandaCtl = ctl;
  ctl.bind();
  return { app, ctl };
}
const fillNew = (n, c) => { el('cmd-numero').value = String(n); el('cmd-cliente').value = c; };

// ------------------------------------------------------------------ testes
await teste('CMD.1', 'Nova comanda abre a tela, empilha histórico e mostra campos de mesa e cliente', async () => {
  instalarAmbiente(); const { ctl } = criarApp();
  ctl.openNew();
  assert.equal(ctl.isOpen, true);
  assert.equal(el('tab-comanda').classList.contains('hidden'), false);
  assert.equal(el('cmd-novo').classList.contains('hidden'), false);
  assert.equal(el('cmd-titulo').textContent, 'Nova comanda');
  assert.equal(histStack.length, 2, 'uma entrada de histórico empilhada');
});

await teste('CMD.2', 'Lançar sem número da mesa ou sem cliente é recusado com aviso e não grava nada', async () => {
  instalarAmbiente(); const { app, ctl } = criarApp();
  ctl.openNew();
  assert.equal(await ctl._addProduct(app._data.produtos[0]), false);
  assert.match(app.toasts.at(-1), /número da mesa/);
  fillNew(7, '');
  assert.equal(await ctl._addProduct(app._data.produtos[0]), false);
  assert.match(app.toasts.at(-1), /nome do cliente/);
  fillNew(0, 'Ana'); assert.equal(await ctl._addProduct(app._data.produtos[0]), false);
  fillNew(10000, 'Ana'); assert.equal(await ctl._addProduct(app._data.produtos[0]), false);
  assert.deepEqual(app._data.mesas, {});
});

await teste('CMD.3', 'Primeiro toque abre a mesa (cliente informado), baixa estoque e passa a mostrar a mesa no cabeçalho', async () => {
  instalarAmbiente(); const { app, ctl } = criarApp();
  ctl.openNew(); fillNew(7, 'Joao');
  assert.equal(await ctl._addProduct(app._data.produtos[0]), true);
  assert.equal(ctl.currentTable, 'Mesa 07');
  assert.equal(app._data.mesaClientes['Mesa 07'], 'Joao');
  assert.equal(app._data.produtos[0].qtd, 9);
  assert.equal(el('cmd-titulo').textContent, 'Mesa 07');
  assert.equal(el('cmd-subtitulo').textContent, 'Cliente: Joao');
  assert.equal(el('cmd-novo').classList.contains('hidden'), true);
  assert.equal(el('cmd-total').textContent, 'R$ 9.50');
  assert.equal(el('cmd-receber').disabled, false);
});

await teste('CMD.4', 'Tocar de novo no mesmo produto soma na linha existente (sem 5 linhas "× 1")', async () => {
  instalarAmbiente(); const { app, ctl } = criarApp();
  ctl.openNew(); fillNew(7, 'Joao');
  for (let i = 0; i < 3; i++) await ctl._addProduct(app._data.produtos[0]);
  assert.equal(app._data.mesas['Mesa 07'].length, 1);
  assert.equal(app._data.mesas['Mesa 07'][0].qtd, 3);
  assert.equal(app._data.produtos[0].qtd, 7);
  assert.equal(el('cmd-total').textContent, 'R$ 28.50');
});

await teste('CMD.5', 'Produto sem estoque fica desabilitado; lançar além do estoque é recusado pelo serviço', async () => {
  instalarAmbiente(); const { app, ctl } = criarApp();
  ctl.openNew(); fillNew(1, 'Ana');
  const semEstoque = el('cmd-produtos').children.find(c => /Sem estoque/.test(c.textContent) || c.children?.some(x => x.textContent === 'Sem estoque'));
  assert.ok(semEstoque?.disabled, 'card sem estoque desabilitado');
  const batata = app._data.produtos[1];
  for (let i = 0; i < 3; i++) await ctl._addProduct(batata);
  assert.equal(await ctl._addProduct(batata), false);
  assert.match(app.toasts.at(-1), /Estoque insuficiente/);
  assert.equal(app._data.produtos[1].qtd, 0);
});

await teste('CMD.6', '+ e − ajustam a quantidade; − na quantidade 1 pede o cancelamento (não remove em silêncio)', async () => {
  instalarAmbiente(); const { app, ctl } = criarApp();
  ctl.openNew(); fillNew(2, 'Ana'); await ctl._addProduct(app._data.produtos[0]);
  let item = app._data.mesas['Mesa 02'][0];
  assert.equal(await ctl._changeQty(item, +1), true);
  assert.equal(app._data.mesas['Mesa 02'][0].qtd, 2);
  assert.equal(await ctl._changeQty(app._data.mesas['Mesa 02'][0], -1), true);
  item = app._data.mesas['Mesa 02'][0];
  assert.equal(item.qtd, 1);
  assert.equal(await ctl._changeQty(item, -1), false);
  assert.ok(openModals.has('modal-cancelamento'), 'abre a confirmação com motivo');
  assert.equal(app._data.mesas['Mesa 02'][0].qtd, 1, 'nada foi removido ainda');
});

for (const perfil of ['gerente', 'vendedor']) {
  await teste(`CMD.7-${perfil}`, `Perfil ${perfil} cancela item com motivo: estoque devolvido e cancelamento auditado`, async () => {
    instalarAmbiente(); const { app, ctl } = criarApp({ perfil });
    ctl.openNew(); fillNew(3, 'Ana');
    await ctl._addProduct(app._data.produtos[0]); await ctl._addProduct(app._data.produtos[1]);
    const item = app._data.mesas['Mesa 03'].find(i => i.nome === 'Cerveja');
    ctl._askCancel(item);
    el('cancel-reason').value = 'Pedido lançado por engano';
    assert.equal(await ctl._submitCancel({ preventDefault() {} }), true);
    assert.equal(app._data.mesas['Mesa 03'].length, 1);
    assert.equal(app._data.produtos[0].qtd, 10, 'estoque devolvido');
    assert.equal(app._data.cancelamentos.length, 1);
    assert.equal(app._data.cancelamentos[0].usuario, 'ana');
    assert.equal(app._data.cancelamentos[0].motivo, 'Pedido lançado por engano');
    assert.equal(openModals.has('modal-cancelamento'), false);
  });
}

await teste('CMD.8', 'Negativo: perfil desconhecido é negado no serviço e nada é cancelado', async () => {
  instalarAmbiente(); const { app, ctl } = criarApp({ perfil: 'convidado' });
  ctl.openNew(); fillNew(3, 'Ana'); await ctl._addProduct(app._data.produtos[0]);
  ctl._askCancel(app._data.mesas['Mesa 03'][0]);
  el('cancel-reason').value = 'teste de motivo';
  assert.equal(await ctl._submitCancel({ preventDefault() {} }), false);
  assert.match(app.toasts.at(-1), /Acesso negado/);
  assert.equal(app._data.mesas['Mesa 03'].length, 1);
  assert.equal(app._data.cancelamentos.length, 0);
});

await teste('CMD.9', 'Cancelar o último item encerra a mesa e volta para a lista de mesas', async () => {
  instalarAmbiente(); const { app, ctl } = criarApp();
  ctl.openNew(); fillNew(4, 'Ana'); await ctl._addProduct(app._data.produtos[0]);
  ctl._askCancel(app._data.mesas['Mesa 04'][0]); el('cancel-reason').value = 'engano do cliente';
  await ctl._submitCancel({ preventDefault() {} });
  await tick();
  assert.equal(app._data.mesas['Mesa 04'], undefined);
  assert.equal(ctl.isOpen, false);
});

await teste('CMD.10', 'Receber: abre o pagamento, calcula troco e desconto, grava no caixa e fecha a tela', async () => {
  instalarAmbiente(); const { app, ctl } = criarApp();
  ctl.openNew(); fillNew(5, 'Ana');
  await ctl._addProduct(app._data.produtos[1]); await ctl._addProduct(app._data.produtos[0]); // 22 + 9,50 = 31,50
  ctl._onReceber();
  assert.equal(el('cmd-pagamento').classList.contains('hidden'), false);
  assert.equal(el('cmd-receber').textContent, 'Confirmar recebimento');
  assert.equal(el('cmd-valor-final').value, '31.50');
  el('cmd-forma').value = 'dinheiro'; el('cmd-valor-final').value = '30'; el('cmd-valor-recebido').value = '50';
  ctl._syncTroco();
  assert.equal(el('cmd-troco').textContent, 'Troco a devolver: R$ 20.00');
  assert.equal(el('cmd-desconto').textContent, 'Desconto: R$ 1.50');
  ctl._onReceber(); await tick(); await tick();
  assert.deepEqual(app._data.mesas, {});
  const v = app._data.caixa[0];
  assert.equal(v.valor, 30); assert.equal(v.valorRecebido, 50); assert.equal(v.troco, 20); assert.equal(v.desconto, 1.5);
  assert.equal(v.formaPagamento, 'dinheiro'); assert.equal(v.mesa, 'Mesa 05');
  assert.equal(ctl.isOpen, false);
  assert.match(app.toasts.at(-1), /recebida com sucesso/);
});

await teste('CMD.11', 'Receber com comanda vazia fica desabilitado e não abre o pagamento', async () => {
  instalarAmbiente(); const { ctl } = criarApp();
  ctl.openNew();
  assert.equal(el('cmd-receber').disabled, true);
  ctl._onReceber();
  assert.equal(el('cmd-pagamento').classList.contains('hidden'), true);
});

await teste('CMD.12', 'Voltar do Android (popstate) fecha a comanda e consome só a entrada empilhada', async () => {
  instalarAmbiente(); const { ctl } = criarApp();
  ctl.openNew();
  assert.equal(histStack.length, 2);
  histStack.pop(); popHandlers.forEach(h => h()); // o navegador desempilha e dispara popstate
  assert.equal(ctl.isOpen, false);
  assert.equal(el('tab-comanda').classList.contains('hidden'), true);
  assert.equal(histStack.length, 1, 'não sobra entrada nem sai do app');
});

await teste('CMD.13', 'Botão voltar da tela usa history.back() e termina na lista de mesas', async () => {
  instalarAmbiente(); const { ctl } = criarApp();
  ctl.openNew(); ctl.close(); await tick();
  assert.equal(ctl.isOpen, false);
  assert.equal(histStack.length, 1);
});

await teste('CMD.14', 'Abrir e fechar várias vezes não acumula histórico', async () => {
  instalarAmbiente(); const { ctl } = criarApp();
  for (let i = 0; i < 4; i++) { ctl.openNew(); ctl.close(); await tick(); }
  assert.equal(histStack.length, 1);
});

await teste('CMD.15', 'Bloqueio/encerramento de sessão esconde a comanda sem mexer no histórico', async () => {
  instalarAmbiente(); const { ctl } = criarApp();
  ctl.openNew(); ctl.reset();
  assert.equal(ctl.isOpen, false);
  assert.equal(el('tab-comanda').classList.contains('hidden'), true);
});

await teste('CMD.16', 'Mesa já aberta abre com itens e permite continuar lançando sem pedir cliente', async () => {
  instalarAmbiente(); const { app, ctl } = criarApp();
  ctl.openNew(); fillNew(6, 'Ana'); await ctl._addProduct(app._data.produtos[0]); ctl.close(); await tick();
  ctl.open('Mesa 06');
  assert.equal(el('cmd-titulo').textContent, 'Mesa 06');
  assert.equal(el('cmd-itens-count').textContent, '1 item');
  assert.equal(await ctl._addProduct(app._data.produtos[1]), true);
  assert.equal(app._data.mesas['Mesa 06'].length, 2);
});

await teste('CMD.17', 'Editar cliente atualiza o nome da mesa na tela', async () => {
  instalarAmbiente(); const { app, ctl } = criarApp();
  ctl.openNew(); fillNew(8, 'Ana'); await ctl._addProduct(app._data.produtos[0]);
  ctl._editClient(); el('editar-cliente-input').value = 'Ana Souza';
  assert.equal(await ctl._submitClient({ preventDefault() {} }), true);
  assert.equal(el('cmd-subtitulo').textContent, 'Cliente: Ana Souza');
});

await teste('CMD.18', 'SalesController: card da mesa abre a comanda e o botão "Abrir mesa" abre nova comanda', async () => {
  instalarAmbiente(); const { app, ctl } = criarApp();
  ctl.openNew(); fillNew(9, 'Ana'); await ctl._addProduct(app._data.produtos[0]); ctl.close(); await tick();
  app._salesCtl = new SalesController(app);
  app._salesCtl.bind();
  app._salesCtl._renderTables();
  const card = el('lista-mesas').children[0];
  const abrir = card.children.at(-1).children.find(b => b.textContent === 'Abrir comanda');
  assert.ok(abrir, 'botão Abrir comanda no card');
  abrir.onclick();
  assert.equal(ctl.currentTable, 'Mesa 09');
  ctl.reset();
  (listeners['abrir-nova-mesa:click'] || []).forEach(fn => fn());
  assert.equal(ctl.isOpen, true);
  assert.equal(ctl.currentTable, null);
});

await teste('CMD.19', 'Fiação e regressão: modais antigos removidos, tela nova no HTML, SW e CSS, sem emoji como ícone', async () => {
  const html = fs.readFileSync('src/index.html', 'utf-8');
  for (const antigo of ['modal-pedido', 'modal-corrigir-comanda', 'id="modal-fechamento"', 'form-item']) assert.ok(!html.includes(antigo), `${antigo} removido`);
  for (const novo of ['id="tab-comanda"', 'id="cmd-voltar"', 'id="cmd-receber"', 'id="modal-cancelamento"', 'id="modal-cliente"']) assert.ok(html.includes(novo), `${novo} presente`);
  const sw = fs.readFileSync('src/sw.js', 'utf-8');
  assert.match(sw, /ComandaController\.js/); assert.match(sw, /css\/comanda\.css/);
  assert.match(fs.readFileSync('src/css/main.css', 'utf-8'), /comanda\.css/);
  const app = fs.readFileSync('src/js/App.js', 'utf-8');
  assert.match(app, /new ComandaController\(this\)/); assert.match(app, /_comandaCtl\.reset\(\)/); assert.match(app, /_comandaCtl\.render\(\)/);
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert.ok(!emoji.test(fs.readFileSync('src/js/ui/controllers/ComandaController.js', 'utf-8')));
  assert.ok(!emoji.test(html.match(/<section aria-label="Comanda"[\s\S]*?<\/section>\s*<nav/)[0]));
});

const total = resultados.length, ok = resultados.filter(Boolean).length;
console.log(`📊 TOTAL: ${total} | ✅ PASS: ${ok} | ❌ FAIL: ${total - ok}`);
if (ok !== total) process.exit(1);
