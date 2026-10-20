/**
 * kdf.worker.js — Isolamento de PBKDF2 em Web Worker dedicado
 * Executa derivação intensiva (650.000 iterações) em background thread,
 * garantindo 60 FPS na UI principal e transferindo ArrayBuffers via Transferable Objects.
 */

self.addEventListener('message', async (event) => {
  const { id, passwordBuffer, saltBuffer, iterations = 650000, keyLength = 256, hash = 'SHA-256' } = event.data;

  try {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: Number(iterations),
        hash: hash
      },
      keyMaterial,
      keyLength
    );

    // Transfere o ArrayBuffer via Transferable Objects (zero cópia)
    self.postMessage(
      { id, success: true, derivedBits },
      [derivedBits]
    );
  } catch (error) {
    self.postMessage({
      id,
      success: false,
      error: error.message || 'Erro na derivação PBKDF2 no Worker'
    });
  }
});
