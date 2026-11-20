# MediaPipe (gömülü kopya)

Bu klasördeki dosyalar Google MediaPipe projesine aittir ve **Apache License 2.0** ile lisanslanmıştır:
https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE

Uygulamanın internete hiç bağlanmadan çalışabilmesi için bir kez indirilip buraya kopyalanmıştır (2026-10-14).

| Dosya | Kaynak | SHA-256 |
|---|---|---|
| vision_bundle.mjs | https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs | jsDelivr kaydıyla doğrulandı |
| wasm/vision_wasm_internal.js | aynı paket, wasm/ | jsDelivr kaydıyla doğrulandı |
| wasm/vision_wasm_internal.wasm | aynı paket, wasm/ | jsDelivr kaydıyla doğrulandı |
| models/pose_landmarker_heavy.task | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task | 64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b |
| models/pose_landmarker_full.task | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task | 5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1 |

SIMD desteklemeyen eski tarayıcılar için olan `vision_wasm_nosimd_internal` dosyaları eklenmedi; iOS 17 ve güncel tarayıcıların hepsi SIMD destekler.
