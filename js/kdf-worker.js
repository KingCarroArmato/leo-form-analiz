// Şifreden anahtar türetme (600.000 tur) ana iş parçacığını kilitlemesin diye ayrı iş parçacığında yapılır.
import { pbkdf2Hex } from './kdf.js';

self.onmessage = (e) => {
  const { id, password, salt, iterations } = e.data;
  self.postMessage({ id, key: pbkdf2Hex(password, salt, iterations) });
};
