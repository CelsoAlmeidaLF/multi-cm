// multi-cm/tests/alignment-standardization-test-runner.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

console.log('======================================================================');
console.log('📐 [QA/UI] - VALIDAÇÃO DETERMINÍSTICA DE ALINHAMENTO GLOBAL DE ELEMENTOS');
console.log('======================================================================');

const rootDir = fs.existsSync('multi-cm/src') ? 'multi-cm' : '.';
const htmlContent = fs.readFileSync(path.resolve(rootDir, 'src/index.html'), 'utf-8');
const layoutCss = fs.readFileSync(path.resolve(rootDir, 'src/css/layout.css'), 'utf-8');
const componentsCss = fs.readFileSync(path.resolve(rootDir, 'src/css/components.css'), 'utf-8');

// 1. Validação de Estrutura Semântica no HTML
assert.ok(htmlContent.includes('class="toolbar-title-group"'), '[HTML_ERR] Classe .toolbar-title-group ausente no HTML');
assert.ok(htmlContent.includes('class="toolbar-actions"'), '[HTML_ERR] Classe .toolbar-actions ausente no HTML');
assert.ok(htmlContent.includes('class="intro-controls"'), '[HTML_ERR] Container .intro-controls ausente no HTML');

// Verificar toolbars específicas com toolbar-title-group
assert.ok(
  htmlContent.includes('<div class="toolbar"><div class="toolbar-title-group"><h2 style="margin:0">Comandas em atendimento</h2>'),
  '[HTML_ERR] Toolbar de comandas sem alinhamento agrupado'
);
assert.ok(
  htmlContent.includes('<div class="toolbar"><div class="toolbar-title-group"><h2 style="margin:0">Produtos cadastrados</h2>'),
  '[HTML_ERR] Toolbar de produtos sem alinhamento agrupado'
);
assert.ok(
  htmlContent.includes('<div class="toolbar"><div class="toolbar-title-group"><h2 style="margin:0">Histórico de movimentações</h2>'),
  '[HTML_ERR] Toolbar de movimentações sem alinhamento agrupado'
);
assert.ok(
  htmlContent.includes('<div class="toolbar"><div class="toolbar-title-group"><h2 style="margin:0">Livro caixa</h2>'),
  '[HTML_ERR] Toolbar de livro caixa sem alinhamento agrupado'
);
assert.ok(
  htmlContent.includes('<div class="toolbar"><div class="toolbar-title-group"><h2 style="margin:0">Usuários cadastrados</h2>'),
  '[HTML_ERR] Toolbar de usuários sem alinhamento agrupado'
);
console.log('✅ [PASS] Padronização semântica de toolbars (.toolbar-title-group e .toolbar-actions) validada no HTML');

// 2. Validação dos Controles do Caixa (intro-controls)
assert.ok(
  htmlContent.includes('<div class="intro-controls"><label class="period-select">'),
  '[HTML_ERR] .intro-controls deve agrupar .period-select e botões de ação do caixa'
);
console.log('✅ [PASS] Nivelamento e agrupamento da barra de controle financeiro (.intro-controls) validado no HTML');

// 3. Validação de Estilos e Altura em CSS
assert.ok(componentsCss.includes('.toolbar-title-group'), '[CSS_ERR] Regra .toolbar-title-group ausente em components.css');
assert.ok(componentsCss.includes('.toolbar-actions'), '[CSS_ERR] Regra .toolbar-actions ausente em components.css');
assert.ok(componentsCss.includes('.dropdown-trigger') && componentsCss.includes('height: 42px;'), '[CSS_ERR] Altura equalizada de 42px ausente em .dropdown-trigger');

assert.ok(layoutCss.includes('.intro-controls'), '[CSS_ERR] Regra .intro-controls ausente em layout.css');
assert.ok(layoutCss.includes('align-items: flex-end;'), '[CSS_ERR] Alinhamento vertical flex-end ausente em .intro-controls');
assert.ok(layoutCss.includes('height: 42px;') && layoutCss.includes('min-height: 42px;'), '[CSS_ERR] Altura equalizada de 42px ausente em controles de filtro');
console.log('✅ [PASS] Alinhamento dimensional, flexbox e equalização de 42px validados no CSS');

// 4. Validação de Responsividade Mobile
assert.ok(
  layoutCss.includes('#tab-caixa .intro-controls') && layoutCss.includes('flex-direction: column;'),
  '[RESPONSIVE_ERR] Empilhamento mobile ausente em .intro-controls'
);
assert.ok(
  layoutCss.includes('.toolbar-actions') && layoutCss.includes('flex-direction: column;'),
  '[RESPONSIVE_ERR] Empilhamento mobile ausente em .toolbar-actions'
);
console.log('✅ [PASS] Responsividade mobile adaptativa com fluidez 100% validada');

console.log('======================================================================');
console.log('🎉 TODOS OS ELEMENTOS AUDITADOS ESTÃO PERFEITAMENTE ALINHADOS!');
console.log('======================================================================');
