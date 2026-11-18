/**
 * Valor monetário curto para rótulos estreitos (gráfico de vendas em 432px).
 * Abaixo de mil: reais inteiros ("R$ 28"); de mil a 999.999: "R$ 1,2k"; acima: "R$ 1,2M".
 * O valor exato continua no title/aria-label da barra.
 */
export function compactMoney(value) {
  const v = Number(value) || 0;
  if (v <= 0) return 'R$ 0';
  const fmt = (n, suffix) => `R$ ${(Math.round(n * 10) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}${suffix}`;
  if (v < 1000) return `R$ ${Math.round(v).toLocaleString('pt-BR')}`;
  if (v < 1_000_000) return fmt(v / 1000, 'k');
  return fmt(v / 1_000_000, 'M');
}
