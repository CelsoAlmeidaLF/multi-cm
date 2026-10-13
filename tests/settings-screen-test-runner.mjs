/**
 * Test Runner de Validação Determinística da Tela de Configurações e Segurança
 * BarGestão Standard - Arquitetura Hexagonal & Aero Glassmorphism 2.0
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = process.cwd();
const rootDir = fs.existsSync(path.join(ROOT, 'multi-cm/src')) ? 'multi-cm' : '.';
const HTML_FILE = path.join(ROOT, rootDir, 'src/index.html');
const APP_FILE = path.join(ROOT, rootDir, 'src/js/App.js');
const CSS_COMPONENTS = path.join(ROOT, rootDir, 'src/css/components.css');

console.log('======================================================================');
console.log('⚙️ [QA/UI] - VALIDAÇÃO DETERMINÍSTICA DA TELA DE CONFIGURAÇÕES');
console.log('======================================================================');

const html = fs.readFileSync(HTML_FILE, 'utf-8');
const appJs = fs.readFileSync(APP_FILE, 'utf-8');
const css = fs.readFileSync(CSS_COMPONENTS, 'utf-8');

// 1. Verificação dos Elementos no HTML
const requiredElements = [
  'tab-mais',
  'more-avatar',
  'more-username',
  'more-role',
  'more-biometric',
  'quick-cash-period',
  'more-export-pdf',
  'more-export-excel',
  'more-caixa-acesso',
  'more-caixa',
  'more-usuarios',
  'more-backup',
  'more-lock',
  'more-security',
  'more-audit',
  'more-export-json',
  'more-import-json',
  'file-import-json',
  'more-backup-import',
  'more-signout',
  'modal-seguranca',
  'security-who',
  'form-security',
  'set-idle',
  'set-background',
  'biometric-enable',
  'biometric-disable',
  'biometric-status',
  'form-pin',
  'pin-current-password',
  'pin-new',
  'pin-confirm',
  'pin-error',
  'security-forget-pin',
  'more-recovery',
  'form-change-password',
  'change-old',
  'change-new',
  'change-confirm',
  'change-error',
  'security-storage',
  'security-persist',
  'modal-auditoria',
  'security-audit'
];

for (const elId of requiredElements) {
  assert.ok(
    html.includes(`id="${elId}"`),
    `Elemento obrigatório com id="${elId}" não foi encontrado em index.html`
  );
  console.log(`✅ [PASS] Elemento DOM mapeado em index.html: #${elId}`);
}

// 2. Verificação dos Métodos da Camada de Aplicação em App.js
const requiredMethods = [
  '_showSettings',
  '_savePreferences',
  '_configurePin',
  '_forgetOwnPin',
  '_changeOwnPassword',
  '_showAudit',
  '_requestPersistence',
  '_exportEncryptedBackup',
  '_forgetDevice',
  '_rotateRecovery',
  '_click_show_recovery',
  '_submit_recover_account',
  '_change_import_file'
];

for (const method of requiredMethods) {
  assert.ok(
    appJs.includes(`${method}(`) || appJs.includes(`${method} `),
    `Método obrigatório '${method}' ausente na classe App em App.js`
  );
  console.log(`✅ [PASS] Método operacional presente em App.js: App.${method}()`);
}

// 3. Verificação das Regras CSS de Layout e Design System
const cssRules = [
  '#tab-mais',
  '#tab-mais.active',
  '#tab-mais .group-title',
  '.more-profile',
  '.more-avatar',
  '.bio-entry',
  '.cash-quick',
  '#more-caixa-acesso',
  '.more-group.card',
  '.more-link',
  '.more-icon',
  'hr.soft',
  '.aero-modal h3',
  '.audit-record'
];

for (const rule of cssRules) {
  assert.ok(
    css.includes(rule),
    `Regra CSS obrigatória '${rule}' não encontrada em components.css`
  );
  console.log(`✅ [PASS] Estilização e Tokens de interface ativos: ${rule}`);
}

console.log('======================================================================');
console.log('🎉 TODAS AS VALIDAÇÕES DE CONFIGURAÇÕES E SEGURANÇA FORAM APROVADAS!');
console.log('======================================================================');
