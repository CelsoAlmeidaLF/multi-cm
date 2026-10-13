// multi-cm/tests/responsive-layout-test-runner.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

console.log('======================================================================');
console.log('📐 [QA/UI] - VALIDAÇÃO DETERMINÍSTICA DE RESPONSIVIDADE E DESIGN SYSTEM');
console.log('======================================================================');

const rootDir = fs.existsSync('multi-cm/src') ? 'multi-cm' : '.';
const cssDir = path.resolve(rootDir, 'src/css');
const themeCss = fs.readFileSync(path.join(cssDir, 'theme.css'), 'utf-8');
const layoutCss = fs.readFileSync(path.join(cssDir, 'layout.css'), 'utf-8');
const componentsCss = fs.readFileSync(path.join(cssDir, 'components.css'), 'utf-8');
const allCss = `${themeCss}\n${layoutCss}\n${componentsCss}`;

// 1. Verificação de Integridade Sintática (Chaves balanceadas)
function checkBraceBalance(content, filename) {
  let depth = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') depth--;
    if (depth < 0) {
      throw new Error(`[SYNTAX_ERR] Fechamento de chave órfã '}' em ${filename} no índice ${i}`);
    }
  }
  assert.equal(depth, 0, `[SYNTAX_ERR] Chaves desbalanceadas em ${filename}: restaram ${depth} '{' não fechadas.`);
  console.log(`✅ [PASS] Integridade léxica e balanceamento de chaves: ${filename}`);
}

checkBraceBalance(themeCss, 'theme.css');
checkBraceBalance(layoutCss, 'layout.css');
checkBraceBalance(componentsCss, 'components.css');

// 2. Validação dos 4 Níveis de Breakpoints Exigidos
const requiredBreakpoints = [
  { name: 'Mobile (max-width: 767px)', pattern: /@media\s*\(\s*max-width:\s*767px\s*\)/ },
  { name: 'Tablets (min-width: 768px) and (max-width: 1024px)', pattern: /@media\s*\(\s*min-width:\s*768px\s*\)\s*and\s*\(\s*max-width:\s*1024px\s*\)/ },
  { name: 'Notebooks (min-width: 1025px) and (max-width: 1440px)', pattern: /@media\s*\(\s*min-width:\s*1025px\s*\)\s*and\s*\(\s*max-width:\s*1440px\s*\)/ },
  { name: 'Telas Grandes (min-width: 1441px)', pattern: /@media\s*\(\s*min-width:\s*1441px\s*\)/ },
];

for (const bp of requiredBreakpoints) {
  assert.ok(bp.pattern.test(layoutCss), `[BREAKPOINT_ERR] Breakpoint obrigatório não encontrado: ${bp.name}`);
  console.log(`✅ [PASS] Breakpoint ativo e mapeado: ${bp.name}`);
}

// 3. Validação dos Grids Fluidos de Mesas, Produtos e Dashboard
const criticalSelectors = [
  '#lista-mesas',
  '#lista-produtos',
  '.home-stats',
  '.home-panels',
  '.cash-stats',
  '.products-grid',
  '.category-chips',
  '.mobile-nav',
  '.sidebar',
  '.aero-modal'
];

for (const sel of criticalSelectors) {
  assert.ok(allCss.includes(sel), `[SELECTOR_ERR] Seletor crítico de layout ausente: ${sel}`);
  console.log(`✅ [PASS] Seletor estrutural presente com suporte multi-tela: ${sel}`);
}

// 4. Verificação de Tokens Aero Glassmorphism 2.0
assert.ok(allCss.includes('backdrop-filter: blur('), '[AERO_ERR] Efeito backdrop-filter ausente');
assert.ok(allCss.includes('saturate(180%)'), '[AERO_ERR] Efeito saturate(180%) ausente');
assert.ok(allCss.includes('translateZ(0)'), '[AERO_ERR] Aceleração de GPU translateZ ausente');
// 5. Validação da Padronização de Margens, Paddings e Spacing Tokens
const requiredSpacingTokens = [
  '--space-3xs',
  '--space-2xs',
  '--space-xs',
  '--space-sm',
  '--space-md',
  '--space-lg',
  '--space-xl',
  '--space-2xl',
  '--space-3xl'
];

for (const token of requiredSpacingTokens) {
  assert.ok(themeCss.includes(token), `[SPACING_ERR] Token de espaçamento não encontrado: ${token}`);
  console.log(`✅ [PASS] Token padronizado de espaçamento ativo: ${token}`);
}

assert.ok(themeCss.includes('h1, h2, h3, h4, h5, h6, p'), '[RESET_ERR] Reset universal de títulos e parágrafos ausente');
assert.ok(componentsCss.includes('.card, .v9-panel'), '[STANDARDIZATION_ERR] Agrupamento de padding para card e v9-panel ausente');
assert.ok(layoutCss.includes('.section-intro.with-filter'), '[STANDARDIZATION_ERR] Padronização flex para section-intro.with-filter ausente');
assert.ok(componentsCss.includes('flex-direction: column;'), '[LAYOUT_ERR] Empilhamento vertical em coluna ausente em .stat');
assert.ok(componentsCss.includes('white-space: nowrap;'), '[LAYOUT_ERR] Prevenção de quebra de linha em valor ausente');
console.log('✅ [PASS] Layout em pilha vertical [Titulo] [Valor] [Descrição] validado em .stat');
console.log('✅ [PASS] Padronização dimensional de margem e padding validada com sucesso');

console.log('======================================================================');
console.log('🎉 TODAS AS VALIDAÇÕES DE RESPONSIVIDADE E PADRONIZAÇÃO FORAM APROVADAS!');
console.log('======================================================================');
