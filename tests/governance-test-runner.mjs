// Integração com a Governança Systekna (docs 12, 13 e 14): cadastro, licença, telemetria e feedback.
import assert from 'node:assert/strict';
import { GovernanceService, GOVERNANCE_STATES, MAX_OFFLINE_DAYS } from '../src/js/application/services/GovernanceService.js';
import { FirebaseGovernanceAdapter } from '../src/js/infrastructure/adapters/FirebaseGovernanceAdapter.js';

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

function memoryStorage() {
  const db = new Map();
  return {
    dbRead: async (store, key) => structuredClone(db.get(`${store}/${key}`) ?? null),
    dbWrite: async (store, key, value) => { db.set(`${store}/${key}`, structuredClone(value)); }
  };
}

function fakePort(overrides = {}) {
  const calls = { registrations: [], errors: [], feedbacks: [] };
  return {
    calls,
    submitRegistration: async (id, data) => { calls.registrations.push({ id, data }); },
    fetchRegistration: async () => null,
    fetchTenant: async () => null,
    reportError: async (id, data) => { calls.errors.push({ id, data }); },
    sendFeedback: async (id, data) => { calls.feedbacks.push({ id, data }); },
    ...overrides
  };
}

console.log('='.repeat(70));
console.log('🧪 SUÍTE DE GOVERNANÇA — CADASTRO, LICENÇA, TELEMETRIA E FEEDBACK');
console.log('='.repeat(70));

await testCase('GOV-01', 'RN-FIREBASE.1: CNPJ opcional, sanitizado e com dígitos verificados', async () => {
  const semCnpj = GovernanceService.normalizeRegistration({ usuario: 'central_coxinha', tipoComercio: 'loja_salgados' });
  assert.equal(semCnpj.cnpj, null);
  const comCnpj = GovernanceService.normalizeRegistration({ usuario: 'pub.esperanca', cnpj: '11.222.333/0001-81' });
  assert.equal(comCnpj.cnpj, '11222333000181');
  assert.throws(() => GovernanceService.normalizeRegistration({ usuario: 'pub', cnpj: '11.222.333/0001-00' }), /CNPJ inválido/);
  assert.throws(() => GovernanceService.normalizeRegistration({ usuario: 'a b<script>' }), /Usuário/);
  assert.equal(GovernanceService.normalizeRegistration({ usuario: 'abc', tipoComercio: 'cassino' }).tipoComercio, 'outro');
});

await testCase('GOV-02', 'Cadastro envia solicitação pendente e grava estado local', async () => {
  const port = fakePort();
  const svc = new GovernanceService(port, memoryStorage(), { appVersion: '2.5.0' });
  await svc.load();
  assert.equal(svc.getState(), GOVERNANCE_STATES.NOT_REGISTERED);
  assert.equal(svc.allowsTables(), true, 'instalação legada sem cadastro mantém mesas');

  const rec = await svc.submitRegistration({ usuario: 'bar_do_ze', tipoComercio: 'bar' });
  assert.match(rec.id, /^[0-9a-f-]{36}$/);
  const sent = port.calls.registrations[0].data;
  assert.equal(sent.status, 'pendente');
  assert.equal(sent.aprovadoPor, null);
  assert.ok(sent.solicitadoEm instanceof Date);
  assert.equal(svc.getState(), GOVERNANCE_STATES.PENDING);
  assert.equal(svc.allowsTables(), false, 'pendente não libera mesas');
});

await testCase('GOV-03', 'RN-FIREBASE.2 / doc 14: avaliação de aprovação, mesas e kill-switch', async () => {
  const aprovado = { status: 'aprovado', permiteMesas: true };
  const ativo = { licenca: { status: 'ativo' } };
  assert.deepEqual(GovernanceService.evaluate(aprovado, ativo), { state: 'aprovado', permiteMesas: true, permiteExportacaoXlsx: true, limiteProdutos: null, motivo: '' });
  assert.equal(GovernanceService.evaluate(aprovado, null), null, 'aprovado sem licença é indeterminado');
  assert.equal(GovernanceService.evaluate(null, ativo), null, 'solicitação ausente é indeterminada');
  const expirada = GovernanceService.evaluate(aprovado, { licenca: { status: 'ativo', expiraEm: '2020-01-01T00:00:00Z' } });
  assert.equal(expirada.state, 'bloqueado');
  assert.match(expirada.motivo, /expirada/);
  assert.equal(GovernanceService.evaluate(aprovado, { licenca: { status: 'ativo' }, permissoesModulos: { permiteMesas: false } }).permiteMesas, false);
  const bloqueado = GovernanceService.evaluate(aprovado, { licenca: { status: 'bloqueado', bloqueioRemoto: true, motivoBloqueio: 'Inadimplência' } });
  assert.equal(bloqueado.state, 'bloqueado');
  assert.equal(bloqueado.motivo, 'Inadimplência');
  assert.equal(GovernanceService.evaluate({ status: 'reprovado', motivoDecisao: 'Dados incompletos' }, null).state, 'reprovado');
  assert.equal(GovernanceService.evaluate({ status: 'pendente' }, null).state, 'pendente');
});

await testCase('GOV-05', 'Doc 14: módulos do painel (XLSX e limite de produtos) chegam ao app e sobrevivem ao backup', async () => {
  const port = fakePort({
    fetchRegistration: async () => ({ status: 'aprovado', permiteMesas: true }),
    fetchTenant: async () => ({ licenca: { status: 'ativo' }, permissoesModulos: { permiteMesas: true, permiteExportacaoXlsx: false, limiteProdutos: 50 } })
  });
  const svc = new GovernanceService(port, memoryStorage());
  await svc.load();
  assert.equal(svc.allowsXlsxExport(), true, 'instalação legada mantém XLSX');
  assert.equal(svc.productLimit(), null, 'instalação legada não tem limite');
  await svc.submitRegistration({ usuario: 'bar_do_ze', tipoComercio: 'bar' });
  await svc.refresh();
  assert.equal(svc.allowsXlsxExport(), false);
  assert.equal(svc.productLimit(), 50);

  const restored = new GovernanceService(fakePort(), memoryStorage());
  await restored.restoreFromBackup(svc.exportForBackup());
  assert.equal(restored.allowsXlsxExport(), false, 'restore não religa o que a governança desligou');
  assert.equal(restored.productLimit(), 50);

  const semLimite = GovernanceService.evaluate({ status: 'aprovado' }, { licenca: { status: 'ativo' }, permissoesModulos: { limiteProdutos: 'abc' } });
  assert.equal(semLimite.limiteProdutos, null);
  assert.equal(semLimite.permiteExportacaoXlsx, true);
});

await testCase('GOV-04', 'Kill-switch é aplicado e mantido offline (último estado conhecido)', async () => {
  let online = true;
  const port = fakePort({
    fetchRegistration: async () => { if (!online) throw new Error('offline'); return { status: 'aprovado', permiteMesas: true }; },
    fetchTenant: async () => ({ licenca: { status: 'bloqueado', bloqueioRemoto: true, motivoBloqueio: 'Uso indevido' } })
  });
  const svc = new GovernanceService(port, memoryStorage());
  await svc.submitRegistration({ usuario: 'adega_central' });
  const r1 = await svc.refresh();
  assert.equal(r1.state, 'bloqueado');
  assert.equal(svc.isBlocked(), true);
  online = false;
  const r2 = await svc.refresh();
  assert.equal(r2.offline, true);
  assert.equal(svc.isBlocked(), true, 'bloqueio persiste sem rede');
});

await testCase('BG-03', 'Kill-switch não falha aberto: erro parcial, 404 e prazo offline', async () => {
  let tenantMode = 'bloqueado';
  let regMode = 'ok';
  const port = fakePort({
    fetchRegistration: async () => (regMode === '404' ? null : { status: 'aprovado', permiteMesas: true }),
    fetchTenant: async () => {
      if (tenantMode === 'erro') throw new Error('URL bloqueada');
      if (tenantMode === '404') return null;
      if (tenantMode === 'ativo') return { licenca: { status: 'ativo' } };
      return { licenca: { status: 'bloqueado', bloqueioRemoto: true } };
    }
  });
  const svc = new GovernanceService(port, memoryStorage());
  await svc.submitRegistration({ usuario: 'adega_central' });
  await svc.refresh();
  assert.equal(svc.isBlocked(), true);

  tenantMode = 'erro';
  await svc.refresh();
  assert.equal(svc.isBlocked(), true, 'erro só na licença mantém bloqueio');
  tenantMode = '404';
  await svc.refresh();
  assert.equal(svc.isBlocked(), true, 'licença apagada mantém bloqueio');
  regMode = '404';
  await svc.refresh();
  assert.equal(svc.isBlocked(), true, 'solicitação apagada mantém bloqueio');

  regMode = 'ok';
  tenantMode = 'ativo';
  await svc.refresh();
  assert.equal(svc.isBlocked(), false, 'desbloqueio só com licença ativa confirmada');

  // Prazo offline: verificação com mais de MAX_OFFLINE_DAYS suspende lançamentos
  const rec = svc.getRecord();
  svc._record = { ...rec, verifiedAt: new Date(Date.now() - (MAX_OFFLINE_DAYS + 1) * 86400000).toISOString() };
  assert.equal(svc.isBlocked(), true);
  assert.match(svc.getBlockReason(), /sem verificação/);
});

await testCase('BG-04', 'Backup leva o registro de governança e o restore exige revalidação', async () => {
  const port = fakePort({
    fetchRegistration: async () => ({ status: 'aprovado' }),
    fetchTenant: async () => ({ licenca: { status: 'ativo' } })
  });
  const origem = new GovernanceService(port, memoryStorage());
  await origem.submitRegistration({ usuario: 'bar_do_ze' });
  await origem.refresh();
  const exported = origem.exportForBackup();
  assert.equal(exported.verifiedAt, undefined);

  const destino = new GovernanceService(port, memoryStorage());
  assert.equal(await destino.restoreFromBackup(exported), true);
  assert.equal(destino.isBlocked(), true, 'restaurado não opera antes de revalidar');
  await destino.refresh();
  assert.equal(destino.isBlocked(), false);
  assert.equal(await destino.restoreFromBackup({ id: '../x' }), false);
});

await testCase('CT-TEL.1/4', 'Scrubber remove chaves, documentos, e-mails e valores; trunca em 2000', async () => {
  const key = 'a'.repeat(64);
  const out = GovernanceService.scrub(`falha ${key} cpf 123.456.789-09 cnpj 11.222.333/0001-81 joao@exemplo.com R$ 1.234,50`);
  assert.ok(!out.includes(key));
  assert.ok(!out.includes('123.456.789-09'));
  assert.ok(!out.includes('11.222.333/0001-81'));
  assert.ok(!out.includes('joao@exemplo.com'));
  assert.ok(!out.includes('1.234,50'));
  assert.equal(GovernanceService.scrub('x'.repeat(5000).replace(/x/g, 'x ')).length, 2000);
  for (const sensivel of ['123 456 789 09', '(11) 91234-5678', '4111 1111 1111 1111', '3569e4cc-e832-4f6f-bec8-75d6d34f6d80', 'senha=Abc12345!', 'pin 123457', '1234.56 reais']) {
    const saida = GovernanceService.scrub(`x ${sensivel} y`);
    assert.ok(!saida.includes(sensivel), `não mascarou: ${sensivel} -> ${saida}`);
  }
  const stack = 'at StorageAdapter.writeSlot (http://localhost:8080/js/infrastructure/adapters/StorageAdapter.js:87:13)';
  assert.equal(GovernanceService.scrub(stack), stack, 'stack trace útil é preservado');
  const t0 = Date.now();
  GovernanceService.scrub('a.'.repeat(60000));
  GovernanceService.scrub('a@'.repeat(60000));
  assert.ok(Date.now() - t0 < 500, 'sem ReDoS em entrada grande');
});

await testCase('CT-TEL.3', 'Telemetria nunca lança, deduplica e limita envios por sessão', async () => {
  const failing = new GovernanceService(fakePort({ reportError: async () => { throw new Error('rede'); } }), memoryStorage());
  assert.equal(await failing.reportError(new Error('boom')), false);

  const port = fakePort();
  const svc = new GovernanceService(port, memoryStorage(), { appVersion: '2.5.0' });
  await svc.reportError(new Error('mesma falha'));
  await svc.reportError(new Error('mesma falha'));
  assert.equal(port.calls.errors.length, 1, 'deduplicado');
  for (let i = 0; i < 30; i++) await svc.reportError(new Error('falha ' + i));
  assert.equal(port.calls.errors.length, 10, 'limite por sessão');
  const payload = port.calls.errors[0].data;
  assert.equal(payload.app, 'BARGESTAO');
  assert.equal(payload.usuario, 'anonimo');
  assert.equal(payload.resolvido, false);
  assert.match(payload.versaoApp, /^[A-Za-z0-9._-]{1,40}$/);
  assert.deepEqual(Object.keys(payload.ambiente).sort(), ['online', 'opfsSuportado', 'userAgent', 'viewport']);
});

await testCase('CT-TEL.2', 'Feedback válido sai com status novo; inválido é recusado', async () => {
  const port = fakePort();
  const svc = new GovernanceService(port, memoryStorage());
  await assert.rejects(svc.sendFeedback({ tipo: 'sugestao', avaliacao: 9, mensagem: 'oi' }), /avaliação/);
  await assert.rejects(svc.sendFeedback({ tipo: 'sugestao', avaliacao: 5, mensagem: '   ' }), /mensagem/);
  await svc.sendFeedback({ tipo: 'elogio', avaliacao: 5, mensagem: 'Gostei do modo balcão' });
  const fb = port.calls.feedbacks[0].data;
  assert.equal(fb.status, 'novo');
  assert.equal(fb.avaliacao, 5);
  assert.ok(fb.enviadoEm instanceof Date);
});

await testCase('GOV-ADP', 'Adaptador REST: codificação tipada, documentId, 404 e recusa', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    if (url.includes('/tenants_governanca/')) return { ok: false, status: 404 };
    if (init.method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ fields: { status: { stringValue: 'aprovado' }, permiteMesas: { booleanValue: false }, licenca: { mapValue: { fields: { status: { stringValue: 'ativo' } } } } } }) };
    }
    return { ok: init.body.includes('"nota"') ? false : true, status: 403 };
  };
  const adp = new FirebaseGovernanceAdapter({ fetchImpl });
  const id = crypto.randomUUID();
  await adp.sendFeedback(id, { avaliacao: 5, enviadoEm: new Date('2026-10-14T00:00:00Z'), status: 'novo' });
  const body = JSON.parse(requests[0].init.body);
  assert.deepEqual(body.fields.avaliacao, { integerValue: '5' });
  assert.deepEqual(body.fields.enviadoEm, { timestampValue: '2026-10-14T00:00:00.000Z' });
  assert.ok(requests[0].url.includes(`documentId=${id}`));
  assert.equal(requests[0].init.credentials, 'omit');

  const reg = await adp.fetchRegistration(id);
  assert.deepEqual(reg, { status: 'aprovado', permiteMesas: false, licenca: { status: 'ativo' } });
  assert.equal(await adp.fetchTenant(id), null);
  await assert.rejects(adp.sendFeedback(id, { nota: 1 }), /recusou/);
  await assert.rejects(adp.fetchRegistration('../outra-colecao'), /inválido/);
});

const failed = results.filter(r => r === 'FAIL').length;
console.log('='.repeat(70));
console.log(`📊 TOTAL: ${results.length} | ✅ PASS: ${results.length - failed} | ❌ FAIL: ${failed}`);
console.log('='.repeat(70));
if (failed) process.exit(1);
