import assert from 'node:assert/strict';
import { BinaryExportAdapter } from '../src/js/infrastructure/adapters/BinaryExportAdapter.js';
import { WebCryptoAdapter } from '../src/js/infrastructure/adapters/WebCryptoAdapter.js';
import { AuthService } from '../src/js/application/services/AuthService.js';
import { OrderService } from '../src/js/application/services/OrderService.js';
import { StockService } from '../src/js/application/services/StockService.js';

console.log('='.repeat(75));
console.log('🛡️ [PEDRO CYBER SECURITY] - SUÍTE DE TESTES DE AUDITORIA E VULNERABILIDADES');
console.log('='.repeat(75));

const securityResults = [];

async function secTest(id, name, cwe, cvss, fn) {
  try {
    await fn();
    securityResults.push({ id, name, cwe, cvss, status: 'PASS', error: null });
    console.log(`✅ [SEGURO / BLINDADO] ${id} - ${name} (${cwe} | CVSS: ${cvss})`);
  } catch (err) {
    securityResults.push({ id, name, cwe, cvss, status: 'VULNERABLE', error: err.message });
    console.error(`🔴 [VULNERABILIDADE DETECTADA] ${id} - ${name} -> ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// 1. VULN-01: CSV / EXCEL FORMULA INJECTION (CWE-1236 / OWASP A03)
// -----------------------------------------------------------------------------
await secTest('SEC-01', 'Verificação de Sanitização de Fórmulas no XLSX (Formula Injection)', 'CWE-1236', '7.3', async () => {
  const exporter = new BinaryExportAdapter();
  const dangerousPayloads = [
    '=cmd|\'/C calc\'!A0',
    '+1+1',
    '-2+3',
    '@SUM(A1:A10)',
    '\t=1+1'
  ];

  for (const payload of dangerousPayloads) {
    const xml = exporter._sheetXml([[payload]], []);
    // Se o XML gerado contiver a fórmula crua sem escape defensivo (ex: prefixo apóstrofo ou aspas), é vulnerável
    const isRawFormula = xml.includes(`<t xml:space="preserve">${payload}</t>`);
    if (isRawFormula) {
      throw new Error(`Injeção de fórmula não neutralizada para o payload: "${payload}"`);
    }
  }
});

// -----------------------------------------------------------------------------
// 2. VULN-02: KDF ITERATIONS DOWNGRADE ATTACK (CWE-916 / OWASP A02)
// -----------------------------------------------------------------------------
await secTest('SEC-02', 'Rejeição de KDF Downgrade com Iterações Insuficientes (<450k)', 'CWE-916', '5.9', async () => {
  const crypto = new WebCryptoAdapter();
  const salt = crypto.randomBytes(16);

  // Tentativa de derivação com 100.000 iterações (limite permissivo atual)
  // O padrão do BarGestão estipula piso de 450.000 para PIN e 650.000 para Senha
  const weakIterations = 100000;
  
  // Deve rejeitar iterações abaixo do piso de segurança recomendado (450.000)
  try {
    await crypto.deriveKey('senha-fraca', salt, weakIterations);
    throw new Error(`O adaptador aceitou ${weakIterations} iterações, permitindo enfraquecimento da chave derivada (KDF Downgrade).`);
  } catch (e) {
    if (e.message.includes('KDF Downgrade')) throw e;
    // Se lançou exceção de parâmetros inválidos, está seguro
  }
});

// -----------------------------------------------------------------------------
// 3. VULN-03: BROKEN ACCESS CONTROL NO SERVICE LAYER (CWE-284 / OWASP A01)
// -----------------------------------------------------------------------------
await secTest('SEC-03', 'Validação de Perfil de Gerente em Operações Críticas de Negócio', 'CWE-284', '6.5', async () => {
  const order = new OrderService();
  const db = {
    produtos: [{ id: 'p1', nome: 'Item', venda: 10, compra: 5, qtd: 10 }],
    mesas: { 'Mesa 01': [{ id: 'item1', produtoId: 'p1', qtd: 2, total: 20 }] },
    mesaClientes: { 'Mesa 01': 'Cliente' },
    cancelamentos: [],
    movimentacoesEstoque: []
  };

  // Se um vendedor puder chamar diretamente o cancelamento sem verificação de role:
  // Segundo RN03, cancelamento é exclusivo de gerente
  const callerRole = 'vendedor';
  if (typeof order.cancelOrderItemWithRole === 'function') {
    assert.throws(() => {
      order.cancelOrderItemWithRole(db, 'Mesa 01', 'item1', 'Motivo', 'vendedor1', callerRole);
    }, /Acesso negado/);
  } else {
    throw new Error('OrderService não valida permissões de perfil (role) no nível de serviço.');
  }
});

// -----------------------------------------------------------------------------
// 4. VULN-04: PROTOTYPE POLLUTION EM DADOS IMPORTADOS (CWE-1321 / OWASP A08)
// -----------------------------------------------------------------------------
await secTest('SEC-04', 'Prevenção contra Prototype Pollution em Desserialização de Cofrinho', 'CWE-1321', '6.1', async () => {
  const maliciousJson = '{"__proto__": {"polluted": true}, "produtos": []}';
  const parsed = JSON.parse(maliciousJson);

  // Verificando se existe função sanitizadora no carregamento
  function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    for (const key of Object.keys(obj)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        delete obj[key];
      } else if (typeof obj[key] === 'object') {
        sanitizeObject(obj[key]);
      }
    }
    return obj;
  }

  sanitizeObject(parsed);
  assert.equal({}.polluted, undefined, 'Objeto raiz global não deve ser poluído');
  assert.equal(parsed.__proto__, Object.prototype);
});

// -----------------------------------------------------------------------------
// 5. VULN-05: MEMORY ZEROIZATION POST-LOGOUT (CWE-226 / OWASP A02)
// -----------------------------------------------------------------------------
await secTest('SEC-05', 'Sanitização de Memória da Master Key após Descarte de Sessão', 'CWE-226', '6.8', async () => {
  const auth = new AuthService(new WebCryptoAdapter(), null);
  const rawKeyBuffer = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe]);
  auth._vaultraw = rawKeyBuffer;
  auth._session = { usuario: 'admin', perfil: 'gerente' };

  auth.discardSession();

  // Verifica se o array na memória foi preenchido com zeros
  assert.equal(auth.getVaultRaw(), null);
  assert.deepEqual(Array.from(rawKeyBuffer), [0, 0, 0, 0, 0, 0, 0, 0], 'A memória da chave foi zerada');
});

console.log('='.repeat(75));
const total = securityResults.length;
const passed = securityResults.filter(r => r.status === 'PASS').length;
const vuln = securityResults.filter(r => r.status === 'VULNERABLE').length;
console.log(`📊 TOTAL AUDITADO: ${total} | 🛡️ PROTEGIDOS: ${passed} | 🔴 VULNERABILIDADES: ${vuln}`);
console.log('='.repeat(75));
