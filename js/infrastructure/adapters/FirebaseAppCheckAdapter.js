import { AppCheckGovernanca } from '../../../stk-pkt-governanca/stk-pkt-governanca-firestore.js';

/**
 * Adaptador de App Check (reCAPTCHA Enterprise) do projeto da governança.
 * O Firestore exige App Check: sem o token, toda leitura/gravação volta HTTP 403.
 * Implementação e configuração pública vêm do pacote stk-pkt-governanca.
 */
export class FirebaseAppCheckAdapter extends AppCheckGovernanca {}
