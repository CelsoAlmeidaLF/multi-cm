import { IStoragePort } from '../../domain/interfaces/IStoragePort.js';

/**
 * Adaptador de Persistência com OPFS Slots A/B, IndexedDB e LocalStorage
 */
export class StorageAdapter extends IStoragePort {
  _db = null;
  _slotnames = ['bargestao_dados_a.enc.json', 'bargestao_dados_b.enc.json'];
  _storagetype = 'OPFS';

  async init() {
    this._db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('BarGestaoSecurityV7', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('private')) d.createObjectStore('private');
        if (!d.objectStoreNames.contains('device')) d.createObjectStore('device');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  getStorageType() {
    return this._storagetype;
  }

  async _opfsRoot() {
    if (!navigator.storage?.getDirectory) {
      throw new Error('OPFS não suportado neste navegador.');
    }
    return navigator.storage.getDirectory();
  }

  async readOpfsSlot(slot) {
    try {
      const dir = await this._opfsRoot();
      const handle = await dir.getFileHandle(this._slotnames[slot]);
      const file = await handle.getFile();
      return JSON.parse(await file.text());
    } catch (e) {
      if (e?.name === 'NotFoundError') return null;
      throw e;
    }
  }

  async writeOpfsSlot(slot, packet) {
    const dir = await this._opfsRoot();
    const handle = await dir.getFileHandle(this._slotnames[slot], { create: true });
    const stream = await handle.createWritable();
    try {
      await stream.write(JSON.stringify(packet));
      await stream.close();
    } catch (e) {
      try { await stream.abort(); } catch {}
      throw e;
    }
  }

  async readCandidates() {
    let results = [];
    try {
      results = await Promise.all([this.readOpfsSlot(0), this.readOpfsSlot(1)]);
      this._storagetype = 'OPFS';
    } catch {
      this._storagetype = 'localStorage (contingência)';
    }

    for (let i = 0; i < 2; i++) {
      try {
        const c = localStorage.getItem('bargestao_json_v7_' + i);
        if (c) results.push(JSON.parse(c));
      } catch {}
    }

    try {
      if (this._db) {
        const idbCandidates = await this.dbRead('private', 'backup-candidates');
        if (Array.isArray(idbCandidates)) results.push(...idbCandidates);
      }
    } catch {}

    return results
      .filter(x => x && (x.app === 'BarGestao' || x.app === 'BarGestão') && x.v === 7 && Number.isSafeInteger(x.seq) && x.seq >= 1)
      .sort((a, b) => b.seq - a.seq);
  }

  /**
   * Apaga cópias que não passam em `keep(packet)` (ex.: pacotes cifrados com a chave antiga depois da troca de chave).
   * Só mexe em cópias auxiliares (localStorage e backup-candidates); os slots A/B do OPFS são reescritos pelo chamador.
   * @returns {Promise<number>} quantas cópias foram apagadas
   */
  async purgeCandidates(keep) {
    let removed = 0;
    for (let i = 0; i < 2; i++) {
      const k = 'bargestao_json_v7_' + i;
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        if (!(await keep(JSON.parse(raw)))) { localStorage.removeItem(k); removed++; }
      } catch { try { localStorage.removeItem(k); removed++; } catch {} }
    }
    try {
      const list = await this.dbRead('private', 'backup-candidates');
      if (Array.isArray(list) && list.length) {
        const kept = [];
        for (const packet of list) { if (await keep(packet).catch(() => false)) kept.push(packet); else removed++; }
        if (kept.length) await this.dbWrite('private', 'backup-candidates', kept);
        else await this.dbDelete('private', 'backup-candidates');
      }
    } catch {}
    return removed;
  }

  async writeSlot(slot, packet) {
    try {
      await this.writeOpfsSlot(slot, packet);
      this._storagetype = 'OPFS';
    } catch {
      try {
        localStorage.setItem('bargestao_json_v7_' + slot, JSON.stringify(packet));
        this._storagetype = 'localStorage (contingência)';
      } catch {
        throw new Error('Espaço insuficiente para gravação. Exporte um backup antes de continuar.');
      }
    }
  }

  async readSlot(slot) {
    if (this._storagetype === 'OPFS') {
      try {
        return await this.readOpfsSlot(slot);
      } catch {
        const item = localStorage.getItem('bargestao_json_v7_' + slot);
        return item ? JSON.parse(item) : null;
      }
    } else {
      const item = localStorage.getItem('bargestao_json_v7_' + slot);
      return item ? JSON.parse(item) : null;
    }
  }

  dbRead(store, key) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(store, 'readonly');
      const r = tx.objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  dbWrite(store, key, value) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transação abortada.'));
    });
  }

  dbDelete(store, key) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
}
