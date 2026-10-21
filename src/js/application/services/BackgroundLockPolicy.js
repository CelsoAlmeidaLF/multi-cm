/**
 * Politica de bloqueio ao esconder o app ("Bloquear ao sair"), camada Application.
 *
 * Recarregar a pagina tambem dispara visibilitychange -> hidden. Se o app bloquear o cofre do kit
 * nesse instante, o PIN e pedido a cada F5 (e a tolerancia de recarga do kit nunca vale).
 * Com o cofre do kit, o bloqueio e adiado para o RETORNO a aba (o kit faz o mesmo): quem recarrega
 * nao volta (a pagina e destruida) e segue sem novo PIN; quem troca de app e volta, e bloqueado.
 * Sem cofre do kit, mantem o comportamento anterior (descarta ao esconder).
 */
export class BackgroundLockPolicy {
  _pending = false;

  /**
   * @param {{hasSession:boolean, lockOnHide:boolean, kitVaultLock:boolean}} state
   * @returns {'discard'|'defer'|'none'}
   */
  onHide({ hasSession, lockOnHide, kitVaultLock }) {
    if (!hasSession || !lockOnHide) return 'none';
    if (kitVaultLock) { this._pending = true; return 'defer'; }
    return 'discard';
  }

  /** @returns {boolean} true se deve bloquear agora (voltou a aba depois de esconder) */
  onReturn({ hasSession }) {
    const pending = this._pending;
    this._pending = false;
    return pending && hasSession;
  }
}
