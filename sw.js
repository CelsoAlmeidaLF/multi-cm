const CACHE = 'bargestao-v3-0-1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './css/main.css',
  './css/theme.css',
  './css/layout.css',
  './css/components.css',
  './css/kit-aero.css',
  './fonts/fonts.css',
  './fonts/ibm-plex-mono-latin-400.woff2',
  './fonts/ibm-plex-mono-latin-500.woff2',
  './fonts/ibm-plex-mono-latin-600.woff2',
  './fonts/ibm-plex-mono-latin-ext-400.woff2',
  './fonts/ibm-plex-mono-latin-ext-500.woff2',
  './fonts/ibm-plex-mono-latin-ext-600.woff2',
  './fonts/space-grotesk-latin-ext.woff2',
  './fonts/space-grotesk-latin.woff2',
  './stk-pkg-secure-ui.css',
  './stk-pkg-financ-icons.js',
  './stk-pkg-bip39-pt.js',
  './stk-pkg-secure-vault.js',
  './stk-pkg-secure-ui.js',
  './stk-pkg-governanca/stk-pkg-governanca-contrato.js',
  './stk-pkg-governanca/stk-pkg-governanca-config.js',
  './stk-pkg-governanca/stk-pkg-governanca-cliente.js',
  './stk-pkg-governanca/stk-pkg-governanca-firestore.js',
  './js/App.js',
  './js/domain/interfaces/IEntity.js',
  './js/domain/interfaces/IProduct.js',
  './js/domain/interfaces/ITable.js',
  './js/domain/interfaces/ICashTransaction.js',
  './js/domain/interfaces/IShift.js',
  './js/domain/interfaces/IAuditEntry.js',
  './js/domain/interfaces/ICryptoPort.js',
  './js/domain/interfaces/IStoragePort.js',
  './js/domain/interfaces/IGovernancePort.js',
  './js/domain/interfaces/IThermalPrinterPort.js',
  './js/domain/entities/Product.js',
  './js/domain/entities/OrderItem.js',
  './js/domain/entities/Table.js',
  './js/domain/entities/CashTransaction.js',
  './js/domain/entities/Shift.js',
  './js/domain/entities/StockMovement.js',
  './js/domain/entities/AuditEntry.js',
  './js/domain/entities/GovernanceUid.js',
  './js/domain/values/Bg12LegacyWords.js',
  './js/infrastructure/adapters/WebCryptoAdapter.js',
  './js/infrastructure/adapters/KdfWorkerAdapter.js',
  './js/infrastructure/workers/kdf.worker.js',
  './js/infrastructure/adapters/WebSerialPrinterAdapter.js',
  './js/infrastructure/adapters/StorageAdapter.js',
  './js/infrastructure/adapters/ConcurrencyAdapter.js',
  './js/infrastructure/adapters/BinaryExportAdapter.js',
  './js/infrastructure/adapters/FirebaseGovernanceAdapter.js',
  './js/infrastructure/adapters/FirebaseAppCheckAdapter.js',
  './js/application/services/AuthService.js',
  './js/application/services/StockService.js',
  './js/application/services/OrderService.js',
  './js/application/services/CashService.js',
  './js/application/services/ShiftService.js',
  './js/application/services/RecoveryService.js',
  './js/application/services/GovernanceService.js',
  './js/application/services/BackupService.js',
  './js/ui/adapters/DomRenderer.js',
  './js/ui/adapters/DomEventHandler.js',
  './js/ui/adapters/TypedSecrets.js',
  './js/ui/controllers/SalesController.js',
  './js/ui/controllers/StockController.js',
  './js/ui/controllers/CashController.js',
  './js/ui/controllers/SecurityController.js',
  './js/ui/controllers/GovernanceController.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k.startsWith('bargestao-') && k !== CACHE).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Consultas à governança (Firestore) nunca passam pelo cache: o estado de licença precisa ser atual
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok && new URL(e.request.url).origin === self.location.origin) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});