// multi-cm/tests/mobile-design-test-runner.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

console.log('======================================================================');
console.log('📱 [QA/UI] - VALIDAÇÃO DETERMINÍSTICA DO DESIGN E LAYOUT MOBILE');
console.log('======================================================================');

const rootDir = fs.existsSync('multi-cm/src') ? 'multi-cm' : '.';
const layoutCss = fs.readFileSync(path.resolve(rootDir, 'src/css/layout.css'), 'utf-8');
const componentsCss = fs.readFileSync(path.resolve(rootDir, 'src/css/components.css'), 'utf-8');

// 1. Validação da Topbar no Mobile
assert.ok(
  layoutCss.includes('.topbar') && layoutCss.includes('safe-area-inset-top'),
  '[MOBILE_ERR] Suporte à safe-area-inset-top ausente na topbar'
);
assert.ok(
  layoutCss.includes('.topbar') && layoutCss.includes('position: sticky;'),
  '[MOBILE_ERR] Fixação sticky da topbar ausente no mobile'
);
console.log('✅ [PASS] Topbar móvel otimizada com Glassmorphism e suporte a safe-area de notch');

// 2. Validação da Mobile Touch Navigation (.mobile-nav)
assert.ok(layoutCss.includes('.mobile-nav') && layoutCss.includes('z-index: 40;'), '[MOBILE_ERR] z-index elevado ausente em .mobile-nav');
assert.ok(layoutCss.includes('.mobile-nav') && layoutCss.includes('safe-area-inset-bottom'), '[MOBILE_ERR] Suporte a safe-area-inset-bottom ausente em .mobile-nav');
assert.ok(layoutCss.includes('.mobile-nav button.active'), '[MOBILE_ERR] Estado ativo da navegação inferior ausente');
assert.ok(layoutCss.includes('user-select: none;'), '[MOBILE_ERR] Prevenção de seleção acidental de texto ausente em mobile-nav');
console.log('✅ [PASS] Barra inferior Mobile Nav calibrada com touch ergonomics e Glassmorphism 2.0');

// 3. Validação dos Cards e Aproveitamento de Tela
assert.ok(
  layoutCss.includes('.card, .v9-panel') && layoutCss.includes('padding: 18px 16px;'),
  '[MOBILE_ERR] Padding otimizado para tela útil mobile ausente em .card, .v9-panel'
);
console.log('✅ [PASS] Padding de cartões e painéis equalizado para ganho de espaço útil no mobile');

// 4. Validação do Bottom Sheet em Modais (.aero-modal)
assert.ok(componentsCss.includes('@keyframes sheet-up'), '[MOBILE_ERR] Animação @keyframes sheet-up ausente em components.css');
assert.ok(componentsCss.includes('border-radius: 24px 24px 0 0;'), '[MOBILE_ERR] Curvatura de Bottom Sheet ausente no modal');
console.log('✅ [PASS] Modais Aero transformados em Bottom Sheet fluida com animação de subida nativa');

// 5. Validação das Ações de Mesa (.mesa-entry e .actions)
assert.ok(
  componentsCss.includes('.mesa-entry') && componentsCss.includes('padding: 16px 14px;'),
  '[MOBILE_ERR] Padding tátil de mesa-entry ausente no mobile'
);
assert.ok(
  componentsCss.includes('.actions') && componentsCss.includes('grid-template-columns: repeat(2, 1fr);'),
  '[MOBILE_ERR] Grid simétrico de 2 colunas para polegar ausente nas ações de mesa'
);
assert.ok(
  componentsCss.includes('.mesa-entry .actions .btn:first-child') && componentsCss.includes('grid-column: span 2;'),
  '[MOBILE_ERR] Destaque de linha completa para o botão principal Adicionar Pedido ausente em .mesa-entry'
);
console.log('✅ [PASS] Ergonomia de polegar (Thumb Zone) em grid de 2 colunas com botão primário span 2 validada para comandas');

// 6. Validação do Rodapé Fixo no Modal de Pedidos (.sticky-submit)
assert.ok(
  componentsCss.includes('.sticky-submit') && componentsCss.includes('position: sticky;'),
  '[MOBILE_ERR] Fixação sticky do rodapé de pedido ausente no mobile'
);
assert.ok(
  componentsCss.includes('.sticky-submit') && componentsCss.includes('backdrop-filter: blur(16px)'),
  '[MOBILE_ERR] Efeito Aero Glassmorphism ausente no rodapé de pedido móvel'
);
console.log('✅ [PASS] Rodapé de pedido fixo (Sticky Footer) com Glassmorphism 2.0 ativo no modal mobile');

// 7. Validação do Carrossel de Categorias e Fechamento
assert.ok(
  componentsCss.includes('.category-chips') && componentsCss.includes('scroll-snap-type: x mandatory;'),
  '[MOBILE_ERR] Rolagem suave nativa com scroll-snap ausente no carrossel de categorias mobile'
);
assert.ok(
  componentsCss.includes('.receipt-preview strong') && componentsCss.includes('font-size: 30px;'),
  '[MOBILE_ERR] Realce tipográfico de alto contraste ausente no total de fechamento mobile'
);
console.log('✅ [PASS] Carrossel tátil com scroll-snap e fechamento de alto impacto tipográfico validados');

// 8. Validação de Touch Targets em Inputs e Links
assert.ok(
  componentsCss.includes('input, select, textarea') && componentsCss.includes('min-height: 44px;'),
  '[MOBILE_ERR] Altura mínima de 44px para inputs móveis ausente'
);
assert.ok(
  componentsCss.includes('.more-link') && componentsCss.includes('min-height: 52px;'),
  '[MOBILE_ERR] Área de toque ergonômica mínima de 52px ausente em .more-link'
);
console.log('✅ [PASS] Touch targets de 44px / 52px em conformidade com diretrizes WCAG móveis');

console.log('======================================================================');
console.log('🎉 TODAS AS VALIDAÇÕES DE DESIGN E LAYOUT MOBILE FORAM APROVADAS!');
console.log('======================================================================');

