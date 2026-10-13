const CACHE = 'bargestao-standard-v2';
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
  './js/App.js',
  './js/domain/interfaces/IEntity.js',
  './js/domain/interfaces/IProduct.js',
  './js/domain/interfaces/ITable.js',
  './js/domain/interfaces/ICashTransaction.js',
  './js/domain/interfaces/IShift.js',
  './js/domain/interfaces/IAuditEntry.js',
  './js/domain/interfaces/ICryptoPort.js',
  './js/domain/interfaces/IStoragePort.js',
  './js/domain/entities/Product.js',
  './js/domain/entities/OrderItem.js',
  './js/domain/entities/Table.js',
  './js/domain/entities/CashTransaction.js',
  './js/domain/entities/Shift.js',
  './js/domain/entities/StockMovement.js',
  './js/domain/entities/AuditEntry.js',
  './js/infrastructure/adapters/WebCryptoAdapter.js',
  './js/infrastructure/adapters/StorageAdapter.js',
  './js/infrastructure/adapters/ConcurrencyAdapter.js',
  './js/infrastructure/adapters/BinaryExportAdapter.js',
  './js/application/services/AuthService.js',
  './js/application/services/StockService.js',
  './js/application/services/OrderService.js',
  './js/application/services/CashService.js',
  './js/application/services/ShiftService.js',
  './js/application/services/RecoveryService.js',
  './js/ui/adapters/DomRenderer.js',
  './js/ui/adapters/DomEventHandler.js'
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