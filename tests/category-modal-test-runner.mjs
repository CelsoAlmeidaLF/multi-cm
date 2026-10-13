// multi-cm/tests/category-modal-test-runner.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

console.log('======================================================================');
console.log('🏷️ [QA/UI] - VALIDAÇÃO DETERMINÍSTICA DE CATEGORIAS EM MODAL E FLUXO');
console.log('======================================================================');

const rootDir = fs.existsSync('multi-cm/src') ? 'multi-cm' : '.';
const htmlContent = fs.readFileSync(path.resolve(rootDir, 'src/index.html'), 'utf-8');
const appJsContent = fs.readFileSync(path.resolve(rootDir, 'src/js/App.js'), 'utf-8');
const layoutCssContent = fs.readFileSync(path.resolve(rootDir, 'src/css/layout.css'), 'utf-8');

// 1. Verificação de Ocultação do Card Fixo na Tela Principal de Estoque
const estoqueSectionMatch = htmlContent.match(/<section[^>]*id="tab-estoque"[^>]*>([\s\S]*?)<\/section>/i);
assert.ok(estoqueSectionMatch, '[HTML_ERR] Seção #tab-estoque não encontrada');
const estoqueSection = estoqueSectionMatch[1];

// Garante que o card estático de categorias NÃO está visível inline no estoque
assert.ok(!estoqueSection.includes('id="gerente-produtos"'), '[HTML_REGRESSION] Card fixo #gerente-produtos ainda está presente no fluxo de Estoque');
console.log('✅ [PASS] Card estático de categorias removido com sucesso do fluxo principal de Estoque');

// 2. Verificação do Botão de Acionamento na Toolbar de Estoque
assert.ok(estoqueSection.includes('id="abrir-categoria"'), '[HTML_ERR] Botão #abrir-categoria ausente na toolbar de Estoque');
console.log('✅ [PASS] Botão de disparo #abrir-categoria presente na toolbar de Produtos');

// 3. Verificação Estrutural do Modal de Categorias
const modalCategoriaMatch = htmlContent.match(/<dialog[^>]*id="modal-categoria"[^>]*>([\s\S]*?)<\/dialog>/i);
assert.ok(modalCategoriaMatch, '[HTML_ERR] Modal #modal-categoria ausente');
const modalCategoria = modalCategoriaMatch[1];

const requiredModalElements = [
  'id="form-categoria-title"',
  'id="categorias-count"',
  'id="form-categoria"',
  'id="nova-categoria"',
  'id="categoria-submit"',
  'id="categoria-cancelar"',
  'id="lista-categorias"'
];

for (const el of requiredModalElements) {
  assert.ok(modalCategoria.includes(el), `[MODAL_ERR] Elemento obrigatório ausente em #modal-categoria: ${el}`);
  console.log(`✅ [PASS] Elemento modal mapeado: ${el}`);
}

// 4. Verificação dos Métodos Operacionais no App.js
const requiredAppMethods = [
  '_openCategoryModal',
  '_renderCategories',
  '_startCategoryEdit',
  '_cancelCategoryEdit',
  '_submit_category',
  '_deleteCategory',
  '_populateCategorySelectors',
  '_openProductModal',
  '_cancelProductEdit',
  '_startProductEdit',
  '_submit_product',
  '_openRestockModal',
  '_submit_restock',
  '_archiveProduct',
  '_restoreProduct',
  '_renderMovements'
];

for (const method of requiredAppMethods) {
  assert.ok(appJsContent.includes(method), `[APP_ERR] Método operacional ausente em App.js: ${method}`);
  console.log(`✅ [PASS] Método operacional validado em App.js: ${method}()`);
}

// 5. Verificação da Integridade Mobile-First
assert.ok(layoutCssContent.includes('.inventory-grid'), '[CSS_ERR] Classe .inventory-grid ausente');
assert.ok(layoutCssContent.includes('flex-direction: column'), '[CSS_ERR] Fluxo vertical limpo ausente em .inventory-grid');
assert.ok(layoutCssContent.includes('@media (max-width: 767px)'), '[CSS_ERR] Breakpoint mobile preservado');
console.log('✅ [PASS] Arquitetura Mobile-First e responsividade de layout preservadas');

console.log('======================================================================');
console.log('🎉 TODAS AS VALIDAÇÕES DE GESTÃO DE CATEGORIAS FORAM APROVADAS COM SUCESSO!');
console.log('======================================================================');
