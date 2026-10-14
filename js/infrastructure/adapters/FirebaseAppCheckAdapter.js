/**
 * Adaptador de App Check (reCAPTCHA Enterprise) para o projeto systekna-feedback.
 * O Firestore do projeto exige App Check: sem o token, toda leitura/gravação volta HTTP 403.
 * Usa só os módulos firebase-app e firebase-app-check do SDK oficial (gstatic, sem build) para obter
 * o token; as chamadas ao Firestore continuam pelo REST do FirebaseGovernanceAdapter.
 */
const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const RECAPTCHA_SITE_KEY = '6LehydgtAAAAAOqkwKOQPzg2m0CZwYTRZSXPeyyx';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCQx8kJyXEReASiQMI4a5bT5NNWgtBmJpM',
  authDomain: 'systekna-feedback.firebaseapp.com',
  projectId: 'systekna-feedback',
  appId: '1:870927975015:web:0576bd5e3cdd8d067d8ac2'
};

export class FirebaseAppCheckAdapter {
  _ready = null;

  _init() {
    this._ready ||= (async () => {
      const { initializeApp, getApps } = await import(SDK + 'firebase-app.js');
      const ac = await import(SDK + 'firebase-app-check.js');
      const app = getApps().find(a => a.name === 'governanca') || initializeApp(FIREBASE_CONFIG, 'governanca');
      const appCheck = ac.initializeAppCheck(app, {
        provider: new ac.ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true
      });
      return () => ac.getToken(appCheck, false);
    })();
    // Falha de carga (offline) não pode ficar presa: a próxima chamada tenta de novo
    this._ready.catch(() => { this._ready = null; });
    return this._ready;
  }

  /** Token atual do App Check, ou null se não foi possível obter (sem rede, bloqueio de script). */
  async getToken() {
    try {
      const fetchToken = await this._init();
      const { token } = await fetchToken();
      return token || null;
    } catch {
      return null;
    }
  }
}
