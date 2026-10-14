/**
 * Valor de Domínio: UID de governança (impressão digital do cadastro).
 * Atual: 128 bits em hex (32 caracteres). Cadastros antigos usavam UUID v4 e continuam válidos.
 */
export const UID_DIGITAL = /^[0-9a-f]{32}$/;
const UID_LEGADO = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isGovernanceId(id) {
  return typeof id === 'string' && (UID_DIGITAL.test(id) || UID_LEGADO.test(id));
}
