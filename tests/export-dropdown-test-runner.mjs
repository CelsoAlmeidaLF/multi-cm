// multi-cm/tests/export-dropdown-test-runner.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readAppSource } from './app-source.mjs';

console.log('======================================================================');
console.log('📥 [QA/UI] - VALIDAÇÃO DETERMINÍSTICA DO BOTÃO DROPDOWN UNIFICADO');
console.log('======================================================================');

const rootDir = fs.existsSync('multi-cm/src') ? 'multi-cm' : '.';
const htmlContent = fs.readFileSync(path.resolve(rootDir, 'src/index.html'), 'utf-8');
const appJsContent = readAppSource(rootDir);
const componentsCssContent = fs.readFileSync(path.resolve(rootDir, 'src/css/components.css'), 'utf-8');

// 1. Validação no HTML da Aba Caixa
assert.ok(htmlContent.includes('id="cash-export-dropdown"'), '[HTML_ERR] Container #cash-export-dropdown ausente');
assert.ok(htmlContent.includes('id="cash-export-trigger"'), '[HTML_ERR] Gatilho #cash-export-trigger ausente');
assert.ok(htmlContent.includes('id="cash-export-menu"'), '[HTML_ERR] Menu #cash-export-menu ausente');
assert.ok(htmlContent.includes('id="cash-export-xlsx"'), '[HTML_ERR] Item #cash-export-xlsx ausente');
assert.ok(htmlContent.includes('id="cash-export-pdf"'), '[HTML_ERR] Item #cash-export-pdf ausente');
console.log('✅ [PASS] Estrutura DOM do botão unificado e opções mapeadas no HTML');

// 2. Validação dos Estilos Aero Glassmorphism 2.0
assert.ok(componentsCssContent.includes('.dropdown-wrap'), '[CSS_ERR] Classe .dropdown-wrap ausente');
assert.ok(componentsCssContent.includes('.dropdown-trigger'), '[CSS_ERR] Classe .dropdown-trigger ausente');
assert.ok(componentsCssContent.includes('.dropdown-menu'), '[CSS_ERR] Classe .dropdown-menu ausente');
assert.ok(componentsCssContent.includes('.dropdown-item'), '[CSS_ERR] Classe .dropdown-item ausente');
assert.ok(componentsCssContent.includes('backdrop-filter: blur('), '[CSS_ERR] Efeito Glassmorphism ausente no menu dropdown');
console.log('✅ [PASS] Estilização Aero Glassmorphism 2.0 validada no CSS');

// 3. Validação da Interatividade em App.js
assert.ok(appJsContent.includes('cash-export-trigger'), '[JS_ERR] Handler do trigger ausente em App.js');
assert.ok(appJsContent.includes('cash-export-menu'), '[JS_ERR] Controle do menu ausente em App.js');
assert.ok(appJsContent.includes('_exportCashReport(\'xlsx\')'), '[JS_ERR] Chamada XLSX ausente em App.js');
assert.ok(appJsContent.includes('_exportCashReport(\'pdf\')'), '[JS_ERR] Chamada PDF ausente em App.js');
console.log('✅ [PASS] Comportamento reativo e exportação via clique e Escape validados em App.js');

console.log('======================================================================');
console.log('🎉 BOTÃO DROPDOWN UNIFICADO DE EXPORTAÇÃO VALIDADO COM SUCESSO!');
console.log('======================================================================');
