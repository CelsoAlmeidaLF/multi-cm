/**
 * KdfWorkerAdapter.js — Cliente do Web Worker de PBKDF2 com Transferable Objects
 * Garante 60 FPS contínuos durante operações criptográficas pesadas.
 */
export class KdfWorkerAdapter {
  static _worker = null;
  static _pendingPromises = new Map();
  static _requestId = 0;

  static isSupported() {
    return typeof Worker !== 'undefined' && typeof window !== 'undefined';
  }

  static getWorker() {
    if (!this.isSupported()) return null;
    if (!this._worker) {
      try {
        const workerUrl = new URL('../workers/kdf.worker.js', import.meta.url);
        this._worker = new Worker(workerUrl, { type: 'module' });
        this._worker.addEventListener('message', (event) => {
          const { id, success, derivedBits, error } = event.data;
          const resolver = this._pendingPromises.get(id);
          if (resolver) {
            this._pendingPromises.delete(id);
            if (success) {
              resolver.resolve(derivedBits);
            } else {
              resolver.reject(new Error(error));
            }
          }
        });
        this._worker.addEventListener('error', (err) => {
          console.error('[KdfWorkerAdapter] Erro no worker:', err);
        });
      } catch (e) {
        console.warn('[KdfWorkerAdapter] Worker indisponível, usando fallback in-thread:', e.message);
        this._worker = null;
      }
    }
    return this._worker;
  }

  /**
   * Deriva bits de chave PBKDF2 via background worker com Transferable Objects
   * @param {Uint8Array|ArrayBuffer} passwordBytes
   * @param {Uint8Array|ArrayBuffer} saltBytes
   * @param {number} iterations
   * @param {number} keyLength
   * @param {string} hash
   * @returns {Promise<ArrayBuffer>}
   */
  static async deriveBits(passwordBytes, saltBytes, iterations = 650000, keyLength = 256, hash = 'SHA-256') {
    const worker = this.getWorker();

    // Normaliza para ArrayBuffer
    const pBuf = passwordBytes.buffer ? passwordBytes.buffer.slice(passwordBytes.byteOffset, passwordBytes.byteOffset + passwordBytes.byteLength) : passwordBytes;
    const sBuf = saltBytes.buffer ? saltBytes.buffer.slice(saltBytes.byteOffset, saltBytes.byteOffset + saltBytes.byteLength) : saltBytes;

    if (worker) {
      return new Promise((resolve, reject) => {
        const id = ++this._requestId;
        this._pendingPromises.set(id, { resolve, reject });

        // Envia ArrayBuffers como Transferable Objects para zero-copy
        worker.postMessage(
          { id, passwordBuffer: pBuf, saltBuffer: sBuf, iterations, keyLength, hash },
          [pBuf, sBuf]
        );
      });
    }

    // Fallback gracioso in-thread caso Workers não estejam disponíveis (ex: Node runner)
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      pBuf,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    return crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: sBuf,
        iterations: Number(iterations),
        hash: hash
      },
      keyMaterial,
      keyLength
    );
  }

  static terminate() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
      this._pendingPromises.clear();
    }
  }
}
