import assert from 'node:assert/strict';
import { Product } from '../src/js/domain/entities/Product.js';
import { OrderItem } from '../src/js/domain/entities/OrderItem.js';
import { Table } from '../src/js/domain/entities/Table.js';
import { CashTransaction } from '../src/js/domain/entities/CashTransaction.js';
import { Shift } from '../src/js/domain/entities/Shift.js';
import { StockMovement } from '../src/js/domain/entities/StockMovement.js';
import { AuditEntry } from '../src/js/domain/entities/AuditEntry.js';

import { OrderService } from '../src/js/application/services/OrderService.js';
import { StockService } from '../src/js/application/services/StockService.js';
import { CashService } from '../src/js/application/services/CashService.js';
import { ShiftService } from '../src/js/application/services/ShiftService.js';
import { RecoveryService } from '../src/js/application/services/RecoveryService.js';
import { AuthService } from '../src/js/application/services/AuthService.js';

import { WebCryptoAdapter } from '../src/js/infrastructure/adapters/WebCryptoAdapter.js';

// Setup de Crypto Port para o ambiente de testes
const cryptoAdapter = new WebCryptoAdapter();
const recoveryService = new RecoveryService(cryptoAdapter);
const orderService = new OrderService();
const stockService = new StockService();
const cashService = new CashService();
const shiftService = new ShiftService();

const testResults = [];

async function testCase(id, name, severity, fn) {
  try {
    await fn();
    testResults.push({ id, name, severity, status: 'PASS', error: null });
    console.log(`✅ [PASS] ${id} - ${name}`);
  } catch (err) {
    testResults.push({ id, name, severity, status: 'FAIL', error: err.message });
    console.error(`❌ [FAIL] ${id} - ${name} -> ${err.message}`);
  }
}

console.log('='.repeat(70));
console.log('🧪 INICIANDO SUÍTE DE TESTES UNITÁRIOS DE QA — CRISTOVON (L6)');
console.log('='.repeat(70));

// =========================================================================
// 1. REGRAS DE NEGÓCIO: ESTOQUE E PRODUTOS (RN-EST)
// =========================================================================

await testCase('RN-EST.1', 'RN07: Proibição de venda a descoberto (estoque insuficiente)', '🔴', async () => {
  const db = {
    produtos: [{ id: 'p1', nome: 'Cerveja Artesanal', venda: 15.0, compra: 8.0, qtd: 3, ativo: true }],
    mesas: {},
    mesaClientes: {},
    movimentacoesEstoque: []
  };

  assert.throws(() => {
    orderService.addOrderItem(db, 'Mesa 01', 'Carlos', 'p1', 5, 'garcom1');
  }, /Estoque insuficiente/);

  // Garantir que o saldo físico permaneceu intacto em 3
  assert.equal(db.produtos[0].qtd, 3);
});

await testCase('RN-EST.2', 'RN08: Estorno obrigatório em cancelamento de pedido', '🔴', async () => {
  const db = {
    produtos: [{ id: 'p1', nome: 'Chopp Pilsen', venda: 10.0, compra: 5.0, qtd: 10, ativo: true }],
    mesas: {},
    mesaClientes: {},
    movimentacoesEstoque: [],
    cancelamentos: []
  };

  // Vender 4 itens -> estoque deve ir para 6
  const item = orderService.addOrderItem(db, 'Mesa 02', 'Mariana', 'p1', 4, 'garcom1');
  assert.equal(db.produtos[0].qtd, 6);
  assert.equal(db.mesas['Mesa 02'].length, 1);

  // Cancelar o item pelo gerente -> estoque deve retornar a 10
  orderService.cancelOrderItem(db, 'Mesa 02', item.id, 'Cliente desistiu', 'gerente1');
  assert.equal(db.produtos[0].qtd, 10);
  assert.equal(db.cancelamentos.length, 1);
  assert.equal(db.movimentacoesEstoque[0].tipo, 'Cancelamento');
  assert.equal(db.movimentacoesEstoque[0].delta, 4);
});

await testCase('RN-EST.3', 'RN09: Bloqueio de baixa manual superior ao saldo disponível', '🟠', async () => {
  const db = {
    produtos: [{ id: 'p2', nome: 'Gin Tônica', venda: 25.0, compra: 12.0, qtd: 2, ativo: true }],
    movimentacoesEstoque: []
  };

  assert.throws(() => {
    stockService.moveStock(db, 'p2', 'baixa', 3, 'Quebra de garrafa', 'gerente1');
  }, /Não é possível retirar quantidade superior/);

  assert.equal(db.produtos[0].qtd, 2);
});

await testCase('RN-EST.4', 'RN10: Reativação/Cadastro exige categoria válida', '🟡', async () => {
  const db = {
    categorias: ['Bebidas', 'Petiscos'],
    produtos: []
  };

  assert.throws(() => {
    stockService.saveProduct(db, {
      nome: 'Vinho Tinto',
      categoria: 'Categoria Inexistente',
      venda: 50.0,
      compra: 25.0,
      qtd: 10
    });
  }, /Nome e categoria válida são obrigatórios/);
});

// =========================================================================
// 2. REGRAS DE NEGÓCIO: MESAS E COMANDAS (RN-ORD)
// =========================================================================

await testCase('RN-ORD.1', 'RN04: Unicidade de comanda por mesa (anexar se já aberta)', '🔴', async () => {
  const db = {
    produtos: [
      { id: 'p1', nome: 'Suco Natural', venda: 8.0, compra: 3.0, qtd: 20, ativo: true },
      { id: 'p2', nome: 'Pastel de Queijo', venda: 12.0, compra: 4.0, qtd: 15, ativo: true }
    ],
    mesas: {},
    mesaClientes: {},
    movimentacoesEstoque: []
  };

  orderService.addOrderItem(db, 'Mesa 05', 'Roberto', 'p1', 2, 'garcom1');
  assert.equal(db.mesas['Mesa 05'].length, 1);
  assert.equal(db.mesaClientes['Mesa 05'], 'Roberto');

  // Adicionar outro item na mesma mesa
  orderService.addOrderItem(db, 'Mesa 05', 'Tentativa Novo Nome', 'p2', 1, 'garcom1');
  assert.equal(db.mesas['Mesa 05'].length, 2);
  // O nome original do cliente é preservado
  assert.equal(db.mesaClientes['Mesa 05'], 'Roberto');
});

await testCase('RN-ORD.2', 'RN05: Alteração explícita de cliente da mesa com validação de tamanho', '🟠', async () => {
  const db = {
    mesas: { 'Mesa 03': [{ id: 'item1', total: 20 }] },
    mesaClientes: { 'Mesa 03': 'Cliente Inicial' }
  };

  // Alteração válida
  orderService.updateClientName(db, 'Mesa 03', 'Novo Cliente Autorizado');
  assert.equal(db.mesaClientes['Mesa 03'], 'Novo Cliente Autorizado');

  // Rejeição de nome excessivo (> 90 caracteres)
  assert.throws(() => {
    orderService.updateClientName(db, 'Mesa 03', 'A'.repeat(95));
  }, /até 90 caracteres/);
});

await testCase('RN-ORD.3', 'RN06: Cálculo de total de comanda livre de artefato IEEE-754', '🟠', async () => {
  const items = [
    { total: 0.1 },
    { total: 0.2 },
    { total: 0.3 }
  ];
  // 0.1 + 0.2 = 0.30000000000000004 em JS padrão
  const total = orderService.calculateOrderTotal(items);
  assert.equal(total, 0.6);
});

await testCase('RN-ORD.4', 'RN06: Fechamento de mesa, quitação e geração de caixa', '🔴', async () => {
  const db = {
    mesas: {
      'Mesa 07': [
        { id: 'i1', produtoId: 'p1', nome: 'Pizza', precoUnit: 40, custoUnit: 15, qtd: 1, total: 40 }
      ]
    },
    mesaClientes: { 'Mesa 07': 'Fernanda' },
    caixa: []
  };

  const res = orderService.receiveTable(db, 'Mesa 07', 'pix', 'caixa1', 'turno-123');
  assert.equal(res.total, 40);
  assert.equal(res.cliente, 'Fernanda');
  assert.equal(db.mesas['Mesa 07'], undefined, 'Mesa deve ser desalocada');
  assert.equal(db.caixa.length, 1);
  assert.equal(db.caixa[0].tipo, 'entrada');
  assert.equal(db.caixa[0].formaPagamento, 'pix');
  assert.equal(db.caixa[0].custoEstimado, 15);
});

// =========================================================================
// 3. REGRAS DE NEGÓCIO: CAIXA E TURNOS (RN-CSH)
// =========================================================================

await testCase('RN-CSH.1', 'RN11: Unicidade de turno ativo (proibido abrir turno duplicado)', '🔴', async () => {
  const db = {
    turnosCaixa: [
      { id: 't1', status: 'aberto', fundoInicial: 100, operador: 'Joana' }
    ]
  };

  assert.throws(() => {
    shiftService.openShift(db, 200, 'Marcos');
  }, /Já existe um turno aberto/);
});

await testCase('RN-CSH.2', 'RN12: Equação de conciliação de turno e apuração de divergência', '🔴', async () => {
  const shiftId = 'shift-abc';
  const db = {
    turnosCaixa: [
      { id: shiftId, status: 'aberto', fundoInicial: 150.0, operador: 'Joana', abertoEm: new Date().toISOString() }
    ],
    caixa: [
      // Entradas em dinheiro: R$ 80,00
      { id: 'c1', turnoId: shiftId, tipo: 'entrada', formaPagamento: 'dinheiro', valor: 50.0 },
      { id: 'c2', turnoId: shiftId, tipo: 'entrada', formaPagamento: 'dinheiro', valor: 30.0 },
      // Entrada em cartão (não entra no cálculo de dinheiro físico esperado do gaveteiro)
      { id: 'c3', turnoId: shiftId, tipo: 'entrada', formaPagamento: 'cartao', valor: 200.0 },
      // Saída (sangria) em dinheiro: R$ 40,00
      { id: 'c4', turnoId: shiftId, tipo: 'saida', valor: 40.0 }
    ]
  };

  // Esperado no gaveteiro = 150 (fundo) + 80 (entradas dinheiro) - 40 (sangria) = R$ 190,00
  const totals = shiftService.calculateShiftTotals(db, db.turnosCaixa[0]);
  assert.equal(totals.esperado, 190.0);

  // Operador contou R$ 185,00 (falta/quebra de R$ -5,00)
  const closed = shiftService.closeShift(db, 185.0, 'Joana', 'Falta de troco');
  assert.equal(closed.status, 'fechado');
  assert.equal(closed.esperado, 190.0);
  assert.equal(closed.contado, 185.0);
  assert.equal(closed.diferenca, -5.0);
});

await testCase('RN-CSH.3', 'RN03/RN12: Validação de retirada de dinheiro com valor positivo', '🟠', async () => {
  const db = { caixa: [] };
  assert.throws(() => {
    cashService.registerWithdrawal(db, 'Pagamento fornecedor', -50, 'gerente1');
  }, /valor positivo/);

  const t = cashService.registerWithdrawal(db, 'Pagamento Gelo', 35.5, 'gerente1', 'turno-1');
  assert.equal(t.tipo, 'saida');
  assert.equal(t.valor, 35.5);
  assert.equal(db.caixa.length, 1);
});

// =========================================================================
// 4. REGRAS DE AUTENTICAÇÃO E RECUPERAÇÃO (RN-AUT / RN-REC)
// =========================================================================

await testCase('RN-AUT.1', 'Validação de critérios de complexidade de senha e PIN', '🟠', async () => {
  const auth = new AuthService(cryptoAdapter, null);

  // Senhas menores que 8 caracteres devem ser reprovadas
  assert.equal(auth.validatePassword('curta7_'), false, 'Senha com 7 caracteres rejeitada');
  assert.equal(auth.validatePassword('senha8ok'), true, 'Senha com 8 caracteres aceita');
  assert.equal(auth.validatePassword('senha-com-12-caracteres-ok'), true);

  // PINs triviais ou repetidos devem ser reprovados
  assert.equal(auth.validatePin('111111'), false, 'Dígitos repetidos rejeitados');
  assert.equal(auth.validatePin('123456'), false, 'Sequência crescente rejeitada');
  assert.equal(auth.validatePin('654321'), false, 'Sequência decrescente rejeitada');
  assert.equal(auth.validatePin('948172'), true, 'PIN aleatório de 6 dígitos aceito');
  assert.equal(auth.validatePin('94817253'), true, 'PIN aleatório de 8 dígitos aceito');
});

await testCase('RN-AUT.2', 'Sanitização de heap no encerramento de sessão', '🔴', async () => {
  const auth = new AuthService(cryptoAdapter, null);
  auth._vaultraw = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  auth._session = { usuario: 'gerente', perfil: 'gerente' };

  const ref = auth._vaultraw;
  auth.discardSession();

  assert.equal(auth.getSession(), null);
  assert.equal(auth.getVaultRaw(), null);
  // O buffer referenciado foi sobrescrito com zeros na memória
  assert.deepEqual(Array.from(ref), [0, 0, 0, 0, 0, 0, 0, 0]);
});

await testCase('RN-REC.1', 'RN13: Algoritmo BG12 de 12 palavras determinístico com checksum', '🔴', async () => {
  const { phrase, token } = await recoveryService.generatePhrase();
  assert.equal(phrase.split(' ').length, 12, 'Deve ter 12 palavras');
  assert.equal(typeof token, 'string');
  assert.equal(token.length, 64, 'Token deve ter 64 caracteres hexadecimais');

  // Validação reversa (parsePhrase)
  const parsed = await recoveryService.parsePhrase(phrase);
  assert.equal(parsed.token, token, 'Token derivado deve ser 100% idêntico');
});

await testCase('RN-REC.2', 'RN13: Rejeição de frase BG12 adulterada ou inválida', '🟠', async () => {
  // Frase com palavra inexistente
  await assert.rejects(async () => {
    await recoveryService.parsePhrase('palavrainvalida about above abroad abscess absence absent absolute absorbed accept accepted access');
  }, /não pertencem ao dicionário/);

  // Frase válida gerada
  const { phrase } = await recoveryService.generatePhrase();
  const words = phrase.split(' ');
  let integrityFailed = false;
  // Testa permutações adjacentes até capturar a violação de integridade (elimina colisão estocástica de 4 bits)
  for (let i = 0; i < 11; i++) {
    const swapped = [...words];
    const tmp = swapped[i];
    swapped[i] = swapped[i + 1];
    swapped[i + 1] = tmp;
    try {
      await recoveryService.parsePhrase(swapped.join(' '));
    } catch (e) {
      if (/integridade/.test(e.message)) {
        integrityFailed = true;
        break;
      }
    }
  }
  assert.equal(integrityFailed, true, 'Troca de ordem de palavras deve falhar no checksum de integridade');
});

// =========================================================================
// 5. ARQUITETURA HEXAGONAL E DOMAIN ENTITIES (ARQ-HEX)
// =========================================================================

await testCase('ARQ-HEX.1', 'Domain Entities: Imutabilidade de IDs e validação de invariantes', '🟠', async () => {
  const p = new Product({
    nome: 'Cerveja Stout',
    categoria: 'Bebidas',
    venda: 22.0,
    compra: 10.0,
    qtd: 15
  });

  assert.equal(p.validate(), true);
  assert.equal(p.getName(), 'Cerveja Stout');
  assert.equal(p.getQuantity(), 15);

  const t = new Table({
    nome: 'Mesa 10',
    cliente: 'Camila'
  });
  assert.equal(t.getName(), 'Mesa 10');
  assert.equal(t.getClient(), 'Camila');

  const shift = new Shift({
    status: 'aberto',
    fundoInicial: 200,
    operador: 'Vendedor'
  });
  assert.equal(shift.validate(), true);
  assert.equal(shift.getInitialFund(), 200);
});

await testCase('ARQ-HEX.2', 'Domain Entities: Rejeição de estados inválidos na construção', '🟠', async () => {
  assert.throws(() => {
    const invalidProduct = new Product({
      nome: '', // Vazio
      categoria: 'Bebidas',
      venda: 10,
      compra: 5
    });
    invalidProduct.validate();
  }, /Nome do produto é obrigatório/);

  assert.throws(() => {
    const invalidProduct = new Product({
      nome: 'Vinho',
      categoria: 'Bebidas',
      venda: -5, // Negativo
      compra: 5
    });
    invalidProduct.validate();
  }, /Preço de venda deve ser maior que zero/);
});

// =========================================================================
// 6. CRIPTOGRAFIA E INTEGRIDADE DE HARDENING (CRY-INT / CT01 a CT04)
// =========================================================================

await testCase('CRY-INT.1', 'CT01: Cifragem e decifragem nominal AES-256-GCM com AAD', '🔴', async () => {
  const rawKey = cryptoAdapter.randomBytes(32);
  const key = await cryptoAdapter.importAesKey(rawKey);
  const aad = new TextEncoder().encode('BG:v7:operacional:100');
  const payload = { mesa: 'Mesa 01', cliente: 'Lucas', total: 150.0 };

  const envelope = await cryptoAdapter.seal(payload, key, aad);
  const opened = await cryptoAdapter.open(envelope, key, aad);

  assert.deepEqual(opened, payload);
});

await testCase('CRY-INT.2', 'CT02: Teste Destrutivo Anti-Replay: Falha com AAD incorreto', '🔴', async () => {
  const rawKey = cryptoAdapter.randomBytes(32);
  const key = await cryptoAdapter.importAesKey(rawKey);
  const payload = { saldo: 5000.0 };

  const envelope = await cryptoAdapter.seal(payload, key, new TextEncoder().encode('BG:v7:seq:1'));

  await assert.rejects(async () => {
    await cryptoAdapter.open(envelope, key, new TextEncoder().encode('BG:v7:seq:2'));
  });
});

await testCase('CRY-INT.3', 'CT03: Teste Destrutivo: Flip de 1 bit no ciphertext deve falhar autenticação GCM', '🔴', async () => {
  const rawKey = cryptoAdapter.randomBytes(32);
  const key = await cryptoAdapter.importAesKey(rawKey);
  const payload = { secret: 'Confidencial' };

  const envelope = await cryptoAdapter.seal(payload, key);
  const bytes = Uint8Array.from(envelope.data.match(/.{2}/g), h => parseInt(h, 16));
  bytes[4] ^= 0x01; // Corrupção deliberada
  envelope.data = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

  await assert.rejects(async () => {
    await cryptoAdapter.open(envelope, key);
  });
});

await testCase('CRY-INT.4', 'CT04: Detecção de adulteração em Trilha de Auditoria Encadeada (Merkle Trail)', '🔴', async () => {
  const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
  const audit = [];

  const n1 = { id: 'uuid-1', data: '2026-10-13T10:00:00Z', usuario: 'admin', acao: 'Criar Mesa', anterior: 'GENESIS' };
  n1.hash = await cryptoAdapter.sha256(JSON.stringify(n1));
  audit.push(n1);

  const n2 = { id: 'uuid-2', data: '2026-10-13T10:05:00Z', usuario: 'admin', acao: 'Adicionar Pedido', anterior: n1.hash };
  n2.hash = await cryptoAdapter.sha256(JSON.stringify(n2));
  audit.push(n2);

  // Adulteração manual no nó n1
  audit[0].acao = 'Ação Adulterada';

  // Verificação de integridade deve falhar
  let chainValid = true;
  for (let i = audit.length - 1; i >= 0; i--) {
    const e = audit[i];
    const expected = await cryptoAdapter.sha256(JSON.stringify({
      id: e.id, data: e.data, usuario: e.usuario, acao: e.acao, anterior: e.anterior
    }));
    if (e.hash !== expected) {
      chainValid = false;
      break;
    }
  }
  assert.equal(chainValid, false, 'A trilha adulterada deve ser detectada imediatamente');
});

console.log('='.repeat(70));
const total = testResults.length;
const passed = testResults.filter(t => t.status === 'PASS').length;
const failed = testResults.filter(t => t.status === 'FAIL').length;
console.log(`📊 TOTAL: ${total} | ✅ PASS: ${passed} | ❌ FAIL: ${failed} | Taxa: ${((passed / total) * 100).toFixed(1)}%`);
console.log('='.repeat(70));

if (failed > 0) {
  process.exit(1);
}
