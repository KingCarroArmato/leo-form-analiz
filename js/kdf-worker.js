// Şifreden anahtar türetme (600.000 tur) ana iş parçacığını kilitlemesin diye ayrı iş parçacığında yapılır.
import { pbkdf2HexFast } from './kdf.js';

self.onmessage = async (e) => {
  const { id, password, salt, iterations } = e.data;
  self.postMessage({ id, key: await pbkdf2HexFast(password, salt, iterations) });
};
