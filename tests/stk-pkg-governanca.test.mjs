// stk-pkg-governanca: contrato, cliente e canal REST. Roda no pacote e na cópia de cada app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
// No pacote os arquivos ficam em ../; num app, em ../src/stk-pkg-governanca/
const base = [join(aqui, '..'), join(aqui, '..', 'src', 'stk-pkg-governanca')].find(p => existsSync(join(p, 'stk-pkg-governanca-contrato.js')));
const contrato = await import(join(base, 'stk-pkg-governanca-contrato.js'));
const { GovernancaCliente, MAX_DIAS_OFFLINE } = await import(join(base, 'stk-pkg-governanca-cliente.js'));
const { FirestoreRestGovernanca, codificarCampos, decodificarCampos, METODOS_PORTA } = await import(join(base, 'stk-pkg-governanca-firestore.js'));
const { ESTADOS, avaliar, formatarUid, isUidGovernanca, criarUid, normalizarCadastro, modulosDoPlano, PLANOS, MODULOS, CAMPOS_SOLICITACAO_APP, higienizar } = contrato;

const UID = 'a'.repeat(32);
const DIA = 24 * 60 * 60 * 1000;
const tenantAtivo = (modulos = {}, licenca = {}) => ({ licenca: { status: 'ativo', expiraEm: new Date(Date.now() + 30 * DIA).toISOString(), ...licenca }, permissoesModulos: modulos });

function memoria() {
  let reg = null;
  return { ler: async () => structuredClone(reg), gravar: async r => { reg = structuredClone(r); }, get valor() { return reg; } };
}
function portaFake(over = {}) {
  const chamadas = { solicitacoes: [], erros: [], feedbacks: [] };
  return {
    chamadas,
    enviarSolicitacao: async (id, d) => { chamadas.solicitacoes.push({ id, d }); },
    buscarSolicitacao: async () => null,
    buscarTenant: async () => null,
    enviarErro: async (id, d) => { chamadas.erros.push({ id, d }); },
    enviarFeedback: async (id, d) => { chamadas.feedbacks.push({ id, d }); },
    ...over
  };
}
const novoCliente = (porta, extra = {}) => new GovernancaCliente({ porta, armazenamento: memoria(), appId: 'TESTE', versaoApp: '1.0.0', ...extra });

// --- Contrato ------------------------------------------------------------------

test('UID: novo (32 hex) e legado (UUID v4) valem; o resto não', async () => {
  const uid = await criarUid({ usuario: 'bar_x', cnpj: null, tipoComercio: 'bar' });
  assert.match(uid, /^[0-9a-f]{32}$/);
  assert.notEqual(uid, await criarUid({ usuario: 'bar_x', cnpj: null, tipoComercio: 'bar' }), 'segredo aleatório: nunca repete');
  assert.ok(isUidGovernanca('3f2a9c01-1234-4abc-8def-0123456789ab'));
  for (const ruim of ['', 'A'.repeat(32), '../x', null, 'a'.repeat(31)]) assert.equal(isUidGovernanca(ruim), false);
});

test('formatarUid: igual para app e painel, inclusive no UID legado', () => {
  assert.equal(formatarUid('3f2a9c01' + '0'.repeat(24)), '3F2A-9C01-0000-0000-0000-0000-0000-0000');
  assert.equal(formatarUid('3f2a9c01-1234-4abc-8def-0123456789ab'), '3F2A-9C01-1234-4ABC-8DEF-0123-4567-89AB');
  assert.equal(formatarUid(null), '');
  assert.equal(formatarUid('<b>x</b>'), '<b>x</b>', 'texto que não é UID volta como está (quem exibe escapa)');
});

test('normalizarCadastro: CNPJ opcional com dígito verificador; tipo fora da lista vira outro', () => {
  assert.equal(normalizarCadastro({ usuario: 'coxinha', tipoComercio: 'loja_salgados' }).cnpj, null);
  assert.equal(normalizarCadastro({ usuario: 'pub.x', cnpj: '11.222.333/0001-81' }).cnpj, '11222333000181');
  assert.throws(() => normalizarCadastro({ usuario: 'pub', cnpj: '11.222.333/0001-00' }), /CNPJ inválido/);
  assert.throws(() => normalizarCadastro({ usuario: 'a b<script>' }), /Usuário/);
  assert.equal(normalizarCadastro({ usuario: 'abc', tipoComercio: 'cassino' }).tipoComercio, 'outro');
});

test('avaliar: fail-closed — sem dado, sem liberação', () => {
  assert.equal(avaliar(null, null), null);
  assert.equal(avaliar({ status: 'aprovado' }, null), null, 'aprovado sem tenant é indeterminado');
  const pend = avaliar({ status: 'pendente', permiteMesas: true }, null);
  assert.equal(pend.state, ESTADOS.PENDENTE);
  assert.equal(pend.permiteMesas, false);
  assert.equal(pend.permiteExportacaoXlsx, false, 'sem acesso, nenhum módulo');
  assert.equal(avaliar({ status: 'reprovado', motivoDecisao: 'x' }, null).state, ESTADOS.REPROVADO);
  assert.equal(avaliar({ status: 'bloqueado' }, null).state, ESTADOS.BLOQUEADO);
});

test('avaliar: licença bloqueada, inativa ou vencida bloqueia', () => {
  const sol = { status: 'aprovado' };
  assert.equal(avaliar(sol, tenantAtivo({}, { bloqueioRemoto: true, motivoBloqueio: 'débito' })).motivo, 'débito');
  assert.equal(avaliar(sol, tenantAtivo({}, { status: 'inadimplente' })).state, ESTADOS.BLOQUEADO);
  assert.equal(avaliar(sol, tenantAtivo({}, { expiraEm: new Date(Date.now() - DIA).toISOString() })).state, ESTADOS.BLOQUEADO);
  assert.equal(avaliar(sol, tenantAtivo({}, { status: 'trial' })).state, ESTADOS.APROVADO);
});

test('avaliar: módulos — tenant > solicitação > padrão do catálogo', () => {
  const sem = avaliar({ status: 'aprovado' }, tenantAtivo());
  assert.equal(sem.permiteMesas, false, 'mesas só com decisão');
  assert.equal(sem.permiteExportacaoXlsx, true, 'padrão histórico: Excel liberado');
  assert.equal(sem.limiteProdutos, null);
  assert.equal(avaliar({ status: 'aprovado', permiteMesas: true }, tenantAtivo()).permiteMesas, true, 'vale a solicitação');
  assert.equal(avaliar({ status: 'aprovado', permiteMesas: true }, tenantAtivo({ permiteMesas: false })).permiteMesas, false, 'tenant manda');
  const com = avaliar({ status: 'aprovado' }, tenantAtivo({ permiteExportacaoXlsx: false, limiteProdutos: 50, limiteUsuarios: -3 }));
  assert.equal(com.permiteExportacaoXlsx, false);
  assert.equal(com.limiteProdutos, 50);
  assert.equal(com.limiteUsuarios, null, 'limite inválido = sem limite');
});

test('Planos: tabela única para aprovar e trocar de plano', () => {
  assert.deepEqual(modulosDoPlano('starter', { permiteMesas: true }), { permiteMesas: true, permiteBiometria: true, ...PLANOS.starter });
  assert.equal(modulosDoPlano('enterprise').limiteProdutos, 100000);
  assert.deepEqual(modulosDoPlano('inexistente'), modulosDoPlano('pro'));
  for (const plano of Object.values(PLANOS)) for (const k of Object.keys(plano)) assert.ok(MODULOS[k], `${k} fora do catálogo`);
});

test('Regras do Firestore: campos que o app grava = hasOnly da coleção de solicitações', () => {
  const regras = [join(aqui, '..', '..', 'stk-pkg-doacao', 'firestore.rules'), join(aqui, '..', 'firestore.rules')].find(existsSync);
  if (!regras) return; // cópia num app sem as regras
  const trecho = readFileSync(regras, 'utf8').split('match /solicitacoes_governanca/')[1];
  const hasOnly = JSON.parse(/hasOnly\((\[[^\]]+\])\)/.exec(trecho)[1].replace(/'/g, '"'));
  assert.deepEqual([...hasOnly].sort(), [...CAMPOS_SOLICITACAO_APP].sort());
  const tipos = JSON.parse(/tipoComercio in (\[[^\]]+\])/.exec(trecho)[1].replace(/'/g, '"'));
  assert.deepEqual(tipos, [...contrato.TIPOS_COMERCIO]);
});

test('higienizar: segredos, documentos, contatos e valores não saem do aparelho', () => {
  const t = higienizar('senha=abc123 pin 123456 cpf 123.456.789-09 mail a@b.com R$ 10,00 fone (11) 91234-5678');
  for (const vazado of ['abc123', '123456', '123.456.789-09', 'a@b.com', '10,00', '91234-5678']) assert.ok(!t.includes(vazado), vazado);
  assert.equal(higienizar('ab '.repeat(5000)).length, 2000);
});

// --- Cliente -------------------------------------------------------------------

test('Cliente: sem cadastro não há acesso; cadastro vira solicitação pendente válida para as regras', async () => {
  const porta = portaFake();
  const c = novoCliente(porta, { sugerirModulos: cad => ({ permiteMesas: cad.tipoComercio === 'bar', limiteProdutos: 5 }) });
  await c.carregar();
  assert.equal(c.temAcesso(), false);
  assert.equal(c.motivoBloqueio(), 'este aparelho ainda não foi cadastrado na governança');
  await c.enviarCadastro({ usuario: 'bar_central', tipoComercio: 'bar' });
  const { id, d } = porta.chamadas.solicitacoes[0];
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(c.uid(), id);
  assert.equal(d.status, 'pendente');
  assert.equal(d.permiteMesas, true);
  for (const k of Object.keys(d)) assert.ok(CAMPOS_SOLICITACAO_APP.includes(k), `campo ${k} seria recusado pelas regras`);
  assert.equal(c.estado(), ESTADOS.PENDENTE);
  assert.equal(c.libera('permiteMesas'), false);
});

test('Cliente: sem sugestão, permiteMesas vai false (as regras exigem o campo)', async () => {
  const porta = portaFake();
  await novoCliente(porta).enviarCadastro({ usuario: 'lanche_1', tipoComercio: 'lanchonete' });
  assert.equal(porta.chamadas.solicitacoes[0].d.permiteMesas, false);
});

test('Cliente: aprovação libera; módulos e limites vêm do tenant; bloqueio remoto fecha', async () => {
  let tenant = tenantAtivo({ permiteMesas: true, permiteExportacaoXlsx: false, limiteProdutos: 50 });
  const porta = portaFake({ buscarSolicitacao: async () => ({ status: 'aprovado' }), buscarTenant: async () => tenant });
  const c = novoCliente(porta);
  await c.enviarCadastro({ usuario: 'bar_x' });
  await c.atualizar();
  assert.equal(c.temAcesso(), true);
  assert.equal(c.libera('permiteMesas'), true);
  assert.equal(c.libera('permiteExportacaoXlsx'), false);
  assert.equal(c.limite('limiteProdutos'), 50);
  assert.throws(() => c.libera('naoExiste'), /desconhecido/);
  tenant = tenantAtivo({}, { bloqueioRemoto: true, motivoBloqueio: 'suspenso' });
  await c.atualizar();
  assert.equal(c.temAcesso(), false);
  assert.equal(c.motivoBloqueio(), 'suspenso');
});

test('Cliente: offline mantém o último estado só até o prazo; indeterminado não libera', async () => {
  let online = true;
  const porta = portaFake({
    buscarSolicitacao: async () => { if (!online) throw new Error('rede'); return { status: 'aprovado' }; },
    buscarTenant: async () => tenantAtivo()
  });
  const c = novoCliente(porta);
  await c.enviarCadastro({ usuario: 'bar_x' });
  await c.atualizar();
  online = false;
  assert.equal((await c.atualizar()).offline, true);
  assert.equal(c.temAcesso(), true);
  assert.equal(c.temAcesso(Date.now() + (MAX_DIAS_OFFLINE + 1) * DIA), false, 'passou do prazo sem verificar');

  const indef = novoCliente(portaFake({ buscarSolicitacao: async () => ({ status: 'aprovado' }) }));
  await indef.enviarCadastro({ usuario: 'bar_y' });
  assert.equal((await indef.atualizar()).indeterminate, true);
  assert.equal(indef.temAcesso(), false);
});

test('Cliente: backup restaura o cadastro mas exige nova verificação; dados ruins são limpos', async () => {
  const c = novoCliente(portaFake());
  assert.equal(await c.restaurarDoBackup({ id: '../x' }), false);
  await c.restaurarDoBackup({ id: UID, usuario: 'bar', lastState: { state: 'aprovado', permiteMesas: true, limiteProdutos: 'muito', hack: 1 } });
  assert.equal(c.estado(), ESTADOS.APROVADO);
  assert.equal(c.temAcesso(), false, 'restaurado sem verificar não abre');
  assert.equal(c.registro().lastState.hack, undefined);
  assert.equal(c.registro().lastState.limiteProdutos, undefined);
  assert.deepEqual(Object.keys(c.exportarParaBackup()).sort(), ['cnpj', 'id', 'lastState', 'nomeEstabelecimento', 'solicitadoEm', 'tipoComercio', 'usuario']);
});

test('Cliente: erro e feedback higienizados, ligados ao UID; telemetria nunca lança', async () => {
  const porta = portaFake();
  const c = novoCliente(porta);
  await c.restaurarDoBackup({ id: UID, usuario: 'bar' });
  assert.equal(await c.relatarErro(new Error('falhou senha=xyz')), true);
  assert.equal(await c.relatarErro(new Error('falhou senha=xyz')), false, 'repetido não reenvia');
  const erro = porta.chamadas.erros[0].d;
  assert.equal(erro.uid, UID);
  assert.equal(erro.app, 'TESTE');
  assert.ok(!erro.mensagem.includes('xyz'));
  const quebrada = novoCliente(portaFake({ enviarErro: async () => { throw new Error('x'); } }));
  assert.equal(await quebrada.relatarErro(new Error('a')), false);
  await assert.rejects(() => c.enviarFeedback({ tipo: 'elogio', avaliacao: 9, mensagem: 'oi' }), /1 a 5/);
  await c.enviarFeedback({ tipo: 'hack', avaliacao: 5, mensagem: 'meu email a@b.com' });
  assert.equal(porta.chamadas.feedbacks[0].d.tipo, 'sugestao');
  assert.ok(!porta.chamadas.feedbacks[0].d.mensagem.includes('a@b.com'));
});

test('Cliente: exige porta, armazenamento e appId', () => {
  assert.throws(() => new GovernancaCliente({ porta: portaFake(), armazenamento: memoria() }), /obrigatórios/);
});

// --- Canal REST ----------------------------------------------------------------

test('REST: envia com App Check, recusa id inválido, 404 = null', async () => {
  const pedidos = [];
  const fetchImpl = async (url, init) => {
    pedidos.push({ url, init });
    if (init.method === 'GET') return { ok: false, status: 404 };
    return { ok: true, status: 200 };
  };
  const rest = new FirestoreRestGovernanca({ fetchImpl, appCheck: { getToken: async () => 'tok' } });
  for (const m of METODOS_PORTA) assert.equal(typeof rest[m], 'function');
  await rest.enviarSolicitacao(UID, { usuario: 'bar', permiteMesas: false, n: 2, d: new Date(0) });
  assert.match(pedidos[0].url, /solicitacoes_governanca\?documentId=a{32}&key=/);
  assert.equal(pedidos[0].init.headers['X-Firebase-AppCheck'], 'tok');
  assert.equal(pedidos[0].init.credentials, 'omit');
  assert.equal(await rest.buscarTenant(UID), null);
  await assert.rejects(() => rest.buscarTenant('../../x'), /inválido/);
});

test('REST: codificação ida e volta, sem poluir protótipo', () => {
  const dados = { a: 'x', b: true, c: 3, d: 1.5, e: null, f: [1, 'y'], g: { h: false } };
  assert.deepEqual(decodificarCampos(codificarCampos(dados)), dados);
  const sujo = decodificarCampos({ __proto__: { stringValue: 'x' }, constructor: { stringValue: 'y' }, ok: { stringValue: 'z' } });
  assert.deepEqual(Object.keys(sujo), ['ok']);
});
