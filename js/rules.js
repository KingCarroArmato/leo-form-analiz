// =====================================================================
//  KURAL TABLOSU: Antrenörler bu dosyadaki eşikleri ve metinleri
//  kendi akademilerinin verisine göre güncelleyebilir.
//
//  Eşik türleri:
//    higher : değer >= good → İyi, >= ok → Orta, değilse Geliştirilmeli
//    lower  : değer <= good → İyi, <= ok → Orta, değilse Geliştirilmeli
//    range  : good=[a,b] aralığı İyi, ok=[c,d] aralığı Orta, dışı Geliştirilmeli
//    info   : yalnızca bilgi, değerlendirme yapılmaz
//  ageBased: true ise eşikler yaş grubuna göre verilir.
//
//  NOT: Yaşa bağlı eşikler başlangıç tahminleridir; birkaç ay veri
//  topladıktan sonra akademinizin ortalamalarına göre güncelleyin.
// =====================================================================

export const AGE_GROUPS = ['6-8', '9-10', '11-12', '13-15'];

export function ageGroup(age) {
  if (age == null) return '9-10';
  if (age <= 8) return '6-8';
  if (age <= 10) return '9-10';
  if (age <= 12) return '11-12';
  return '13-15';
}

export const TESTS = {
  jump: {
    name: 'Zıplama',
    short: 'Zıplama',
    icon: '⤒',
    desc: 'Yerinde dikey sıçrama (bir veya birkaç tekrar).',
    guide: [
      'Telefonu tripoda koyun, 3–4 m uzaklıktan çekin.',
      'Çocuğun baştan ayağa tamamı kadrajda olsun, ayakların altında boşluk kalsın.',
      'Önden çekim: dizlerin içe kapanması ölçülür. Yandan çekim: diz bükülmesi ölçülür.',
      'Çocuk 1–2 sn hareketsiz dursun, sonra zıplasın ve inişten sonra 2 sn dengede kalsın.',
    ],
  },
  run: {
    name: 'Koşu',
    short: 'Koşu',
    icon: '➜',
    desc: 'Tam hızda koşu (sprint) tekniği.',
    guide: [
      'Yandan çekin: çocuk kameranın önünden yatay olarak geçsin.',
      'Kamerayı 5–6 m uzağa koyun, en az 3–4 adım kadrajda görünsün.',
      'Çocuk kadraja girmeden önce hızlanmış olsun.',
      'Telefon sabit kalmalı (tripod); çocuğu takip etmek için çevirmeyin.',
    ],
  },
  spin: {
    name: 'Kendi Etrafında Dönme',
    short: 'Dönme',
    icon: '↻',
    desc: 'Yerinde 360° dönüşler (denge ve koordinasyon).',
    guide: [
      'Önden, 3–4 m uzaklıktan çekin; çocuğun tamamı kadrajda olsun.',
      'Çocuk kameraya dönük başlasın, 2–3 tam tur dönsün.',
      'Dönüş bittikten sonra 2 sn hareketsiz dursun (bitiş dengesi ölçülür).',
      'Kadrajda başka kişiler de varsa, video yüklenince analiz edilecek çocuğa dokunun.',
    ],
  },
  free: {
    name: 'Diğer Hareket',
    short: 'Diğer',
    icon: '✦',
    desc: 'Videodaki hareketi tanır ve tekniğini puanlar.',
    guide: [
      'Diz çekme, squat, öne/yana hamle, bacak salınımı, düz bacak tekmesi, tek ayak denge, yana kayma gibi hareketler tanınır.',
      'Mümkünse tek bir egzersiz çekin; birkaç egzersiz art arda çekilirse her biri ayrı bölüm olarak gösterilir.',
      'Telefon sabit dursun (tripod), çocuğun baştan ayağa tamamı kadrajda olsun.',
      'Çömelme ve hamle için yandan, yana kayma için önden çekin.',
      'Puan teknik doğruluğa göre verilir (yaşa göre değil); bu kayıtlar gelişim grafiğine girmez.',
    ],
  },
};

// Serbest hareket analizinde tanınan hareketler. test: aynı hareketin puanlı testi varsa onun adı.
export const MOTIONS = {
  highKnees: { name: 'Diz çekme', short: 'Diz çekme' },
  squat: { name: 'Squat (çömelme)', short: 'Squat' },
  lunge: { name: 'Öne hamle (lunge)', short: 'Hamle' },
  sideLunge: { name: 'Yana hamle', short: 'Yana hamle' },
  legSwing: { name: 'Bacak salınımı', short: 'Salınım' },
  legKick: { name: 'Düz bacak tekmesi', short: 'Tekme' },
  balance: { name: 'Tek ayak denge', short: 'Denge' },
  shuffle: { name: 'Yana kayma', short: 'Yana kayma' },
  walk: { name: 'Yürüyüş', short: 'Yürüyüş' },
  run: { name: 'Koşu', short: 'Koşu', test: 'run' },
  jump: { name: 'Sıçrama', short: 'Sıçrama', test: 'jump' },
  spin: { name: 'Kendi etrafında dönme', short: 'Dönme', test: 'spin' },
  still: { name: 'Hareketsiz duruş', short: 'Duruş' },
  other: { name: 'Tanımlanamayan hareket', short: 'Diğer' },
};

const DRILL = {
  jumpPower: 'Squat jump (3×5), ip atlama, merdiven zıplamaları.',
  countermovement: 'Aynaya karşı "çömel–zıpla" tekrarları; kolları geriden öne savurarak zıplama.',
  softLanding: '"Sessiz iniş" oyunu: kutudan inip ses çıkarmadan diz ve kalçayı bükerek konma.',
  knees: 'Diz hizası çalışması: ayak parmakları ve dizler aynı yöne; dizlerin arasına hayali top koyarak iniş.',
  balance: 'Tek ayak üzerinde 10 sn durma, sıçrayıp "dondur" oyunu.',
  cadence: 'Hızlı ayak merdiveni, yerinde hızlı ayak (5 sn), kısa ve çabuk adımlarla 10 m koşu.',
  posture: 'Duvara dayalı A-march, "boyunu uzat" komutuyla 20 m koşular.',
  kneeDrive: 'A-skip ve yüksek diz koşusu (2×15 m).',
  heelRecovery: 'Topuk-kalça (butt kicks) koşusu, B-skip.',
  overstride: 'Kısa çit / kon üzerinden adımlama; ayağı kalçanın altına basma.',
  arms: 'Yerinde kol çalışması: dirsek 90°, eller "cepten-çeneye" hareketi.',
  spinSpeed: 'Kollar gövdeye yakın dönme; 1-2-3 sayarak hızlanan dönüşler.',
  spinPlace: 'Yere bir kon/halka koyup içinde kalarak dönme.',
  spinTilt: 'Başı sabit tutup bir noktaya bakarak (spotting) dönüş çalışması.',
  rhythm: 'Ritmik alkış eşliğinde sabit tempoyla dönme.',
};

// "LiDAR" geçen ve lidar: true olan ölçümler kaldırılan iPhone uygulamasından kalmadır; yalnızca eski LiDAR
// raporlarını göstermek için durur, yeni analizlerde üretilmez.
export const RULES = {
  // ---------------------------- ZIPLAMA ----------------------------
  jumpHeight: {
    label: 'Sıçrama yüksekliği', unit: 'cm', decimals: 1, type: 'higher', ageBased: true,
    thresholds: { '6-8': { good: 22, ok: 15 }, '9-10': { good: 26, ok: 18 }, '11-12': { good: 30, ok: 22 }, '13-15': { good: 34, ok: 25 } },
    help: 'Havada kalma süresinden hesaplanır (h = g·t²/8).',
    messages: {
      iyi: 'Yaş grubuna göre güçlü bir sıçrama.',
      orta: 'Yaş grubu ortalamasında; patlayıcı güç çalışmasıyla gelişebilir.',
      gelistir: 'Sıçrama gücü yaş grubunun altında.',
    },
    drill: DRILL.jumpPower,
  },
  hipRise: {
    label: 'Kalça yükselmesi (LiDAR)', unit: 'cm', decimals: 1, type: 'info',
    help: 'Kalçanın ayakta duruş yüksekliğinden en tepe noktaya kadar yükselmesi; doğrudan 3B ölçüm.',
  },
  flightTime: { label: 'Havada kalma süresi', unit: 'ms', decimals: 0, type: 'info' },
  jumpCount: { label: 'Algılanan sıçrama sayısı', unit: '', decimals: 0, type: 'info' },
  cmDepth: {
    label: 'Sıçrama öncesi diz bükülmesi', unit: '°', decimals: 0, type: 'range',
    thresholds: { good: [60, 100], ok: [40, 120] },
    help: 'Zıplamadan önceki çömelmede dizin büküldüğü açı (0° = düz bacak).',
    messages: {
      iyi: 'Sıçrama öncesi çömelme derinliği uygun.',
      low: 'Sıçramadan önce yeterince çömelmiyor; daha derin bir hazırlık gücü artırır.',
      high: 'Çok derin çömeliyor; bu, sıçramayı yavaşlatabilir.',
    },
    drill: DRILL.countermovement,
  },
  landingFlex: {
    label: 'İnişte diz bükülmesi', unit: '°', decimals: 0, type: 'higher',
    thresholds: { good: 50, ok: 30 },
    help: 'Yere indikten sonraki 0,4 sn içinde dizin büküldüğü en büyük açı.',
    messages: {
      iyi: 'Yumuşak ve kontrollü iniş.',
      orta: 'İniş biraz sert; dizleri ve kalçayı daha fazla bükmeli.',
      gelistir: 'Sert (düz bacakla) iniş. Sakatlık riskini azaltmak için yumuşak iniş öğretilmeli.',
    },
    drill: DRILL.softLanding,
  },
  kasr: {
    label: 'Diz hizası (diz/ayak bileği aralığı)', unit: '', decimals: 2, type: 'higher',
    thresholds: { good: 0.9, ok: 0.7 },
    help: 'İnişte dizler arası mesafenin ayak bilekleri arası mesafeye oranı. 1,0 = dizler ayakların hizasında; düşük değer dizlerin içe kapandığını gösterir.',
    messages: {
      iyi: 'İnişte dizler ayak hizasında.',
      orta: 'İnişte dizler hafifçe içe kapanıyor; takip edilmeli.',
      gelistir: 'İnişte dizler belirgin şekilde içe kapanıyor (valgus). Diz sağlığı için öncelikli çalışılmalı.',
    },
    drill: DRILL.knees,
  },
  landingAsym: {
    label: 'İniş simetrisi (ayaklar arası fark)', unit: 'ms', decimals: 0, type: 'lower',
    thresholds: { good: 35, ok: 70 },
    help: 'İki ayağın yere değme anları arasındaki süre farkı.',
    messages: {
      iyi: 'İki ayakla dengeli iniş.',
      orta: 'Bir ayak biraz önce yere değiyor.',
      gelistir: 'İnişte belirgin tek taraf yüklenmesi var.',
    },
    drill: DRILL.balance,
  },
  landingSway: {
    label: 'İniş sonrası denge', unit: '% boy', decimals: 1, type: 'lower',
    thresholds: { good: 4, ok: 10 },
    help: 'İnişten sonraki 1 sn içinde kalçanın yatay salınımı (vücut boyunun yüzdesi).',
    messages: { iyi: 'İnişten sonra dengede kalıyor.', orta: 'İnişten sonra hafif sendeleme var.', gelistir: 'İnişten sonra dengesini toparlamakta zorlanıyor.' },
    drill: DRILL.balance,
  },
  landingSwayCm: {
    lidar: true,
    label: 'İniş sonrası denge', unit: 'cm', decimals: 1, type: 'lower',
    thresholds: { good: 5, ok: 12 },
    help: 'İnişten sonraki 1 sn içinde kalçanın yatay salınımı.',
    messages: { iyi: 'İnişten sonra dengede kalıyor.', orta: 'İnişten sonra hafif sendeleme var.', gelistir: 'İnişten sonra dengesini toparlamakta zorlanıyor.' },
    drill: DRILL.balance,
  },

  // ----------------------------- KOŞU -----------------------------
  cadence: {
    label: 'Adım sıklığı', unit: 'adım/dk', decimals: 0, type: 'higher', ageBased: true,
    thresholds: { '6-8': { good: 240, ok: 200 }, '9-10': { good: 230, ok: 195 }, '11-12': { good: 220, ok: 190 }, '13-15': { good: 215, ok: 185 } },
    help: 'Dakikadaki adım sayısı (sprint için).',
    messages: { iyi: 'Sprint için yüksek ve çabuk adım sıklığı.', orta: 'Adım sıklığı ortalama.', gelistir: 'Adımlar yavaş; ayak çabukluğu geliştirilmeli.' },
    drill: DRILL.cadence,
  },
  trunkLean: {
    label: 'Gövde eğimi', unit: '°', decimals: 0, type: 'range',
    thresholds: { good: [3, 15], ok: [0, 22] },
    help: 'Gövdenin dikeyle yaptığı açı; artı değer öne eğim.',
    messages: { iyi: 'Gövde hafif öne eğik, verimli duruş.', low: 'Gövde dik veya geriye yaslanıyor; hafif öne eğilmeli.', high: 'Gövde fazla öne eğik; dengesiz ve kısa adımlara yol açabilir.' },
    drill: DRILL.posture,
  },
  kneeDrive: {
    label: 'Diz kaldırma', unit: '°', decimals: 0, type: 'higher',
    thresholds: { good: 60, ok: 40 },
    help: 'Uyluğun öne kalkış açısı (dikeyle).',
    messages: { iyi: 'Dizler sprint için yeterince yükseliyor.', orta: 'Diz kaldırma orta düzeyde.', gelistir: 'Dizler az kalkıyor; adım gücü sınırlı.' },
    drill: DRILL.kneeDrive,
  },
  heelRecovery: {
    label: 'Topuk toplama (en küçük diz açısı)', unit: '°', decimals: 0, type: 'lower',
    thresholds: { good: 70, ok: 100 },
    help: 'Arka bacak öne gelirken dizin en çok büküldüğü açı; küçük açı = topuk kalçaya yakın.',
    messages: { iyi: 'Arka bacak hızlı ve kısa toplanıyor.', orta: 'Bacak toplama orta düzeyde.', gelistir: 'Arka bacak geniş bir yay çiziyor; toplama yavaş.' },
    drill: DRILL.heelRecovery,
  },
  overstride: {
    label: 'Ayak basış mesafesi', unit: '% bacak', decimals: 0, type: 'lower',
    thresholds: { good: 25, ok: 40 },
    help: 'Ayağın yere değdiği anda kalçanın ne kadar önünde olduğu (bacak boyunun yüzdesi).',
    messages: { iyi: 'Ayak gövdenin altına yakın basıyor.', orta: 'Ayak biraz önde basıyor.', gelistir: 'Ayak gövdenin çok önüne basıyor (fren etkisi).' },
    drill: DRILL.overstride,
  },
  elbowAngle: {
    label: 'Dirsek açısı', unit: '°', decimals: 0, type: 'range',
    thresholds: { good: [60, 110], ok: [45, 135] },
    help: 'Koşu sırasında ortalama dirsek açısı (ideal ~90°).',
    messages: { iyi: 'Kol açısı verimli.', low: 'Kollar fazla bükük ve kısa salınıyor.', high: 'Kollar fazla açık/düz sallanıyor.' },
    drill: DRILL.arms,
  },
  armCross: {
    label: 'Kolların gövde önünden çapraz geçişi', unit: '% süre', decimals: 0, type: 'lower',
    thresholds: { good: 15, ok: 35 },
    help: 'Bileğin vücut orta hattını geçtiği sürenin oranı.',
    messages: { iyi: 'Kollar ileri-geri düz hatta çalışıyor.', orta: 'Kollar zaman zaman gövdenin önünden çapraz geçiyor.', gelistir: 'Kollar sürekli çapraz salınıyor; gövde dönmesine yol açıyor.' },
    drill: DRILL.arms,
  },
  lateralSway: {
    label: 'Gövdenin yana salınımı', unit: '°', decimals: 1, type: 'lower',
    thresholds: { good: 4, ok: 8 },
    help: 'Önden çekimde gövdenin sağa-sola eğilme miktarı (standart sapma).',
    messages: { iyi: 'Gövde sabit.', orta: 'Gövde hafifçe yana salınıyor.', gelistir: 'Gövde belirgin şekilde yana salınıyor.' },
    drill: DRILL.posture,
  },
  speed: { label: 'Ortalama hız (LiDAR)', unit: 'm/sn', decimals: 2, type: 'info' },
  speedMax: { label: 'En yüksek hız (LiDAR)', unit: 'km/sa', decimals: 1, type: 'info' },
  stepLength: { label: 'Adım uzunluğu (LiDAR)', unit: 'm', decimals: 2, type: 'info' },
  vertOsc: { label: 'Dikey salınım', unit: '% bacak', decimals: 0, type: 'info', help: 'Her adımda kalçanın yukarı-aşağı hareketi.' },
  vertOscCm: { label: 'Dikey salınım (LiDAR)', unit: 'cm', decimals: 1, type: 'info', help: 'Her adımda kalçanın yukarı-aşağı hareketi.' },

  // ---------------------------- DÖNME -----------------------------
  turns: { label: 'Dönüş sayısı', unit: 'tur', decimals: 1, type: 'info' },
  spinDir: { label: 'Dönüş yönü', unit: '', type: 'info' },
  turnTime: {
    label: 'Tur süresi', unit: 'sn/tur', decimals: 2, type: 'lower', ageBased: true,
    thresholds: { '6-8': { good: 1.2, ok: 1.8 }, '9-10': { good: 1.0, ok: 1.6 }, '11-12': { good: 0.9, ok: 1.4 }, '13-15': { good: 0.8, ok: 1.3 } },
    help: 'Bir tam turun ortalama süresi.',
    messages: { iyi: 'Hızlı ve akıcı dönüş.', orta: 'Dönüş hızı ortalama.', gelistir: 'Dönüş yavaş; koordinasyon ve çeviklik çalışılmalı.' },
    drill: DRILL.spinSpeed,
  },
  spinDrift: {
    label: 'Yerinde kalma', unit: '% boy', decimals: 0, type: 'lower',
    thresholds: { good: 15, ok: 35 },
    help: 'Dönüş boyunca kalçanın başlangıç noktasından en fazla uzaklaşması (vücut boyunun yüzdesi).',
    messages: { iyi: 'Dönüşü yerinde tamamlıyor.', orta: 'Dönerken biraz yer değiştiriyor.', gelistir: 'Dönerken belirgin şekilde kayıyor; denge merkezi kontrolü zayıf.' },
    drill: DRILL.spinPlace,
  },
  spinDriftCm: {
    lidar: true,
    label: 'Yerinde kalma', unit: 'cm', decimals: 0, type: 'lower',
    thresholds: { good: 20, ok: 45 },
    help: 'Dönüş boyunca kalçanın başlangıç noktasından en fazla uzaklaşması.',
    messages: { iyi: 'Dönüşü yerinde tamamlıyor.', orta: 'Dönerken biraz yer değiştiriyor.', gelistir: 'Dönerken belirgin şekilde kayıyor; denge merkezi kontrolü zayıf.' },
    drill: DRILL.spinPlace,
  },
  spinTilt: {
    label: 'Dönüşte gövde dikliği', unit: '°', decimals: 0, type: 'lower',
    thresholds: { good: 8, ok: 15 },
    help: 'Dönüş sırasında gövdenin dikeyden ortalama sapması.',
    messages: { iyi: 'Gövde dönüş boyunca dik.', orta: 'Gövde dönerken biraz yana yatıyor.', gelistir: 'Gövde belirgin şekilde yatıyor; denge kaybı riski.' },
    drill: DRILL.spinTilt,
  },
  spinRhythm: {
    label: 'Dönüş ritmi (düzensizlik)', unit: '%', decimals: 0, type: 'lower',
    thresholds: { good: 15, ok: 30 },
    help: 'Yarım turların süre farklılığı (değişkenlik katsayısı).',
    messages: { iyi: 'Dönüş temposu düzenli.', orta: 'Tempo zaman zaman değişiyor.', gelistir: 'Dönüş temposu düzensiz.' },
    drill: DRILL.rhythm,
  },
  finishSway: {
    label: 'Bitiş dengesi', unit: '% boy', decimals: 1, type: 'lower',
    thresholds: { good: 4, ok: 10 },
    help: 'Dönüş bittikten sonraki 1 sn içindeki salınım.',
    messages: { iyi: 'Dönüş sonrası hemen dengeleniyor.', orta: 'Dönüş sonrası kısa bir sendeleme var.', gelistir: 'Dönüş sonrası dengeyi toparlamakta zorlanıyor.' },
    drill: DRILL.balance,
  },
  finishSwayCm: {
    lidar: true,
    label: 'Bitiş dengesi', unit: 'cm', decimals: 1, type: 'lower',
    thresholds: { good: 5, ok: 12 },
    help: 'Dönüş bittikten sonraki 1 sn içindeki salınım.',
    messages: { iyi: 'Dönüş sonrası hemen dengeleniyor.', orta: 'Dönüş sonrası kısa bir sendeleme var.', gelistir: 'Dönüş sonrası dengeyi toparlamakta zorlanıyor.' },
    drill: DRILL.balance,
  },

  // ----------------------- DİĞER HAREKET (puansız) ------------------------
  mReps: { label: 'Tekrar sayısı', unit: 'tekrar', decimals: 0, type: 'info' },
  mTempo: { label: 'Tempo', unit: 'tekrar/dk', decimals: 0, type: 'info', help: 'Dakikaya düşen tekrar sayısı.' },
  mSteps: { label: 'Adım sayısı', unit: 'adım', decimals: 0, type: 'info' },
  mStepRate: { label: 'Adım sıklığı', unit: 'adım/dk', decimals: 0, type: 'info' },
  mKneeLiftL: { label: 'Diz kaldırma (sol)', unit: '°', decimals: 0, type: 'info', help: 'Uyluğun dikeyle yaptığı en büyük açı; 90° = uyluk yere paralel. Yaklaşık değerdir.' },
  mKneeLiftR: { label: 'Diz kaldırma (sağ)', unit: '°', decimals: 0, type: 'info', help: 'Uyluğun dikeyle yaptığı en büyük açı; 90° = uyluk yere paralel. Yaklaşık değerdir.' },
  mKneeFlexL: { label: 'Diz bükülmesi (sol)', unit: '°', decimals: 0, type: 'info', help: 'Dizin en çok büküldüğü açı (0° = düz bacak). Yalnızca yandan ya da çapraz çekimde ölçülür.' },
  mKneeFlexR: { label: 'Diz bükülmesi (sağ)', unit: '°', decimals: 0, type: 'info', help: 'Dizin en çok büküldüğü açı (0° = düz bacak). Yalnızca yandan ya da çapraz çekimde ölçülür.' },
  mDepth: { label: 'Çömelme derinliği (uyluk açısı)', unit: '°', decimals: 0, type: 'info', help: 'En alçak noktada uyluğun dikeyle açısı; 90° = uyluk yere paralel. Hamlede öndeki bacak ölçülür. Yaklaşık değerdir.' },
  mSideDiff: { label: 'Sol-sağ farkı', unit: '%', decimals: 0, type: 'info', help: 'İki bacağın hareket genişliği arasındaki fark. Küçük değer dengeli (simetrik) hareket demektir.' },
  mHipDrop: { label: 'Kalça alçalması', unit: '% boy', decimals: 0, type: 'info', help: 'Kalçanın en yüksek ve en alçak noktası arasındaki fark (vücut boyunun yüzdesi); çömelme derinliğini gösterir.' },
  mTrunkTilt: { label: 'Gövde eğimi', unit: '°', decimals: 0, type: 'info', help: 'Gövdenin dikeyden en büyük sapması. Yandan çekimde öne-arkaya, önden çekimde yana eğilmeyi gösterir.' },
  mTravel: { label: 'Yer değiştirme', unit: '% boy', decimals: 0, type: 'info', help: 'Kalçanın yatayda gittiği en uzak mesafe (vücut boyunun yüzdesi).' },
  mSway: { label: 'Salınım', unit: '% boy', decimals: 1, type: 'info', help: 'Kalçanın yatay salınımı (standart sapma). Küçük değer daha iyi denge demektir.' },
  mBalanceTime: { label: 'Tek ayakta kalma süresi', unit: 'sn', decimals: 1, type: 'info' },
};

export const STATUS_LABEL = { iyi: 'İyi', orta: 'Orta', gelistir: 'Geliştirilmeli', bilgi: 'Bilgi' };

function thresholdsFor(rule, age) {
  return rule.ageBased ? rule.thresholds[ageGroup(age)] : rule.thresholds;
}

export function formatValue(key, value) {
  const rule = RULES[key];
  if (value == null) return '-';
  if (typeof value === 'string') return value;
  const d = rule?.decimals ?? 1;
  return value.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function refText(rule, t) {
  const f = (v) => v.toLocaleString('tr-TR');
  if (rule.type === 'higher') return `İyi ≥ ${f(t.good)} · Orta ≥ ${f(t.ok)}`;
  if (rule.type === 'lower') return `İyi ≤ ${f(t.good)} · Orta ≤ ${f(t.ok)}`;
  if (rule.type === 'range') return `İyi ${f(t.good[0])}–${f(t.good[1])} · Orta ${f(t.ok[0])}–${f(t.ok[1])}`;
  return '';
}

/** Bir ölçümü kural tablosuna göre değerlendirir. */
export function evaluate(key, value, age) {
  const rule = RULES[key];
  if (!rule) return { key, label: key, value, status: 'bilgi', message: '' };
  const base = { key, label: rule.label, unit: rule.unit, value, display: formatValue(key, value), help: rule.help || '' };
  if (value == null) return { ...base, status: 'bilgi', message: 'Bu çekimden ölçülemedi.' };
  if (rule.type === 'info') return { ...base, status: 'bilgi', message: '' };

  const t = thresholdsFor(rule, age);
  let status;
  let message;
  if (rule.type === 'higher') {
    status = value >= t.good ? 'iyi' : value >= t.ok ? 'orta' : 'gelistir';
    message = rule.messages[status];
  } else if (rule.type === 'lower') {
    status = value <= t.good ? 'iyi' : value <= t.ok ? 'orta' : 'gelistir';
    message = rule.messages[status];
  } else {
    if (value >= t.good[0] && value <= t.good[1]) status = 'iyi';
    else if (value >= t.ok[0] && value <= t.ok[1]) status = 'orta';
    else status = 'gelistir';
    message = status === 'iyi' ? rule.messages.iyi : value < t.good[0] ? rule.messages.low : rule.messages.high;
  }
  return {
    ...base,
    status,
    message,
    drill: status === 'iyi' ? '' : rule.drill || '',
    ref: refText(rule, t) + (rule.ageBased ? ` (${ageGroup(age)} yaş)` : ''),
    type: rule.type,
    thresholds: t,
  };
}

/** Ölçüm sözlüğünü değerlendirilmiş listeye ve özet bilgisine çevirir. */
export function buildReport(metrics, age) {
  const items = Object.entries(metrics)
    .filter(([k]) => RULES[k])
    .map(([k, v]) => evaluate(k, v, age));
  const counts = { iyi: 0, orta: 0, gelistir: 0 };
  for (const it of items) if (counts[it.status] != null) counts[it.status]++;
  const order = { gelistir: 0, orta: 1, iyi: 2, bilgi: 3 };
  items.sort((a, b) => order[a.status] - order[b.status]);
  const priorities = items.filter((i) => i.status === 'gelistir' || i.status === 'orta').slice(0, 3);
  return { items, counts, priorities };
}

// =====================================================================
//  10 ÜZERİNDEN PUAN
//  Her değerlendirilen ölçüm İyi = 10, Orta = 6,5, Geliştirilmeli = 3 puan sayılır;
//  ağırlıklı ortalama yuvarlanır. weight verilmeyen ölçümün ağırlığı 1'dir.
// =====================================================================
const POINTS = { iyi: 10, orta: 6.5, gelistir: 3 };
// Puanlı testlerde yaşa bağlı ana ölçüm iki kat sayılır
const MAIN_WEIGHT = { jumpHeight: 2, cadence: 2, turnTime: 2 };

// ---------------------------------------------------------------------
//  DİĞER HAREKETLERİN TEKNİK KONTROLLERİ (yaşa bağlı değildir)
//  of: kullanılan ölçüm(ler); agg: birden fazlaysa 'min' (iki bacak da yapmalı), 'max' ya da 'mean'
//  views: yalnızca bu çekim yönlerinde değerlendirilir ('ön', 'yan', 'çapraz')
//  fix: Orta ve Geliştirilmeli durumunda gösterilen kısa açıklama
// ---------------------------------------------------------------------
const UPRIGHT = (good, ok, extra = {}) => ({
  label: 'Gövde dikliği', of: ['mTrunkTilt'], unit: '°', type: 'lower', good, ok,
  fix: { orta: 'Gövde biraz yatıyor; dik durmaya çalışmalı.', gelistir: 'Gövde belirgin şekilde yatıyor; dik durmalı.' },
  drill: DRILL.posture, ...extra,
});
const SYMMETRY = (good, ok, what) => ({
  label: 'Sol-sağ dengesi', of: ['mSideDiff'], unit: '%', type: 'lower', good, ok,
  fix: { orta: `Bir bacak ötekinden biraz daha az ${what}.`, gelistir: `İki bacak belirgin şekilde farklı ${what}; zayıf taraf ayrıca çalışılmalı.` },
  drill: 'Zayıf bacakla ek tekrar; aynaya karşı yavaş, kontrollü tekrarlar.',
});

export const MOTION_RULES = {
  highKnees: [
    { label: 'Diz yüksekliği', of: ['mKneeLiftL', 'mKneeLiftR'], agg: 'min', unit: '°', type: 'higher', good: 80, ok: 60, weight: 2,
      fix: { orta: 'Dizler kalça hizasına tam çıkmıyor.', gelistir: 'Dizler çok az kalkıyor; uyluk yere paralel olana kadar kaldırılmalı.' }, drill: DRILL.kneeDrive },
    SYMMETRY(10, 20, 'kalkıyor'),
    UPRIGHT(15, 25),
  ],
  squat: [
    { label: 'Çömelme derinliği', of: ['mDepth'], unit: '°', type: 'higher', good: 80, ok: 60, weight: 2,
      fix: { orta: 'Çömelme biraz sığ; uyluk yere paralele yaklaşmalı.', gelistir: 'Çömelme çok sığ; kalça diz hizasına kadar inmeli.' },
      drill: 'Sandalyeye dokunup kalkma (kutu squat), topuklar yerde.' },
    SYMMETRY(10, 20, 'bükülüyor'),
    UPRIGHT(45, 60, { label: 'Gövde duruşu', views: ['yan', 'çapraz'],
      fix: { orta: 'Gövde biraz fazla öne eğiliyor; göğüs yukarıda kalmalı.', gelistir: 'Gövde çok öne eğiliyor; göğüs yukarıda, sırt düz kalmalı.' },
      drill: 'Duvara yarım metre uzakta, yüzü duvara dönük squat; kollar önde.' }),
    UPRIGHT(8, 15, { label: 'Gövde dengesi', views: ['ön'],
      fix: { orta: 'Çömelirken gövde hafifçe bir yana kayıyor.', gelistir: 'Çömelirken gövde belirgin şekilde bir yana kayıyor.' },
      drill: 'Ayna karşısında yavaş squat; ağırlık iki ayağa eşit.' }),
  ],
  lunge: [
    { label: 'Hamle derinliği', of: ['mDepth'], unit: '°', type: 'higher', good: 80, ok: 60, weight: 2,
      fix: { orta: 'Hamle biraz sığ; öndeki uyluk yere paralele yaklaşmalı.', gelistir: 'Hamle çok sığ; arka diz yere yaklaşana kadar inmeli.' },
      drill: 'Arka dizin altına yastık koyup ona dokunarak hamle.' },
    UPRIGHT(15, 25, { fix: { orta: 'Hamlede gövde biraz öne eğiliyor.', gelistir: 'Hamlede gövde çok öne eğiliyor; dik kalmalı.' } }),
  ],
  sideLunge: [
    { label: 'Hamle derinliği', of: ['mDepth'], unit: '°', type: 'higher', good: 70, ok: 50, weight: 2,
      fix: { orta: 'Yana hamle biraz sığ.', gelistir: 'Yana hamle çok sığ; bükülen bacakta daha derin oturmalı.' },
      drill: 'Kon ile işaretlenmiş genişlikte, yavaş yana hamle.' },
    UPRIGHT(45, 60, { fix: { orta: 'Gövde biraz fazla eğiliyor.', gelistir: 'Gövde çok eğiliyor; göğüs yukarıda kalmalı.' } }),
  ],
  legKick: [
    { label: 'Tekme yüksekliği', of: ['mKneeLiftL', 'mKneeLiftR'], agg: 'min', unit: '°', type: 'higher', good: 90, ok: 70, weight: 2,
      fix: { orta: 'Bacak yatay hizaya tam çıkmıyor.', gelistir: 'Bacak çok az kalkıyor; esneklik çalışılmalı.' },
      drill: 'Hamstring esnetme ve yürüyerek düz bacak tekmesi (2×10 m).' },
    SYMMETRY(15, 30, 'kalkıyor'),
    UPRIGHT(20, 35, { fix: { orta: 'Tekme atarken gövde biraz geriye yatıyor.', gelistir: 'Tekme atarken gövde belirgin şekilde geriye yatıyor; dik kalmalı.' } }),
  ],
  legSwing: [
    { label: 'Salınım genişliği', of: ['mKneeLiftL', 'mKneeLiftR'], agg: 'max', unit: '°', type: 'higher', good: 60, ok: 40, weight: 2,
      fix: { orta: 'Bacak salınımı biraz kısa.', gelistir: 'Bacak çok az salınıyor; kalça esnekliği çalışılmalı.' },
      drill: 'Duvara tutunarak öne-arkaya bacak salınımı (2×12).' },
    UPRIGHT(15, 25),
  ],
  balance: [
    { label: 'Denge (salınım)', of: ['mSway'], unit: '% boy', type: 'lower', good: 1.5, ok: 3, weight: 2,
      fix: { orta: 'Tek ayakta dururken biraz sallanıyor.', gelistir: 'Tek ayakta dururken belirgin şekilde sallanıyor.' }, drill: DRILL.balance },
    UPRIGHT(10, 20),
  ],
  shuffle: [UPRIGHT(15, 25)],
  walk: [UPRIGHT(10, 20)],
  run: [UPRIGHT(20, 30)],
  jump: [
    { label: 'Havada kalma süresi', of: ['flightTime'], unit: 'ms', type: 'higher', good: 400, ok: 300, weight: 2,
      fix: { orta: 'Sıçrama orta güçte.', gelistir: 'Sıçrama zayıf; patlayıcı güç çalışılmalı.' }, drill: DRILL.jumpPower },
  ],
  spin: [UPRIGHT(8, 15, { fix: { orta: 'Dönerken gövde biraz yatıyor.', gelistir: 'Dönerken gövde belirgin şekilde yatıyor.' }, drill: DRILL.spinTilt })],
};

const aggregate = (vals, agg) => {
  const v = vals.filter((x) => typeof x === 'number');
  if (!v.length) return null;
  if (agg === 'max') return Math.max(...v);
  if (agg === 'mean') return v.reduce((a, b) => a + b, 0) / v.length;
  return Math.min(...v);
};

/** Diğer hareketin teknik kontrolleri: buildReport öğeleriyle aynı biçimde. */
export function evaluateMotion(key, metrics = {}, view) {
  return (MOTION_RULES[key] || []).flatMap((r) => {
    if (r.views && !r.views.includes(view)) return [];
    const value = aggregate(r.of.map((k) => metrics[k]), r.agg);
    if (value == null) return [];
    const t = { good: r.good, ok: r.ok };
    const status = r.type === 'higher' ? (value >= r.good ? 'iyi' : value >= r.ok ? 'orta' : 'gelistir')
      : (value <= r.good ? 'iyi' : value <= r.ok ? 'orta' : 'gelistir');
    const f = (v) => v.toLocaleString('tr-TR');
    return [{
      key: r.of.join('+'), label: r.label, unit: r.unit, value, display: Math.round(value).toLocaleString('tr-TR'),
      status, message: status === 'iyi' ? '' : r.fix[status], drill: status === 'iyi' ? '' : r.drill || '',
      type: r.type, thresholds: t, weight: r.weight || 1,
      ref: r.type === 'higher' ? `İyi ≥ ${f(r.good)} · Orta ≥ ${f(r.ok)}` : `İyi ≤ ${f(r.good)} · Orta ≤ ${f(r.ok)}`,
    }];
  });
}

/**
 * Değerlendirilmiş öğelerden 10 üzerinden puan, tek cümlelik neden ve düzeltilecekler listesi.
 * Puanlanacak öğe yoksa score null döner.
 */
export function scoreReport(items) {
  const rated = items.filter((i) => POINTS[i.status] != null);
  if (!rated.length) return { score: null, reason: '', fixes: [] };
  const w = (i) => i.weight || MAIN_WEIGHT[i.key] || 1;
  const total = rated.reduce((t, i) => t + w(i), 0);
  const score = Math.max(1, Math.min(10, Math.round(rated.reduce((t, i) => t + POINTS[i.status] * w(i), 0) / total)));
  const order = { gelistir: 0, orta: 1 };
  const weak = rated.filter((i) => i.status !== 'iyi').sort((a, b) => order[a.status] - order[b.status] || w(b) - w(a));
  const lower = (s) => s.charAt(0).toLocaleLowerCase('tr') + s.slice(1);
  const reason = !weak.length ? 'Ölçülen bütün alanlar iyi düzeyde.'
    : `Puanı düşüren: ${weak.slice(0, 3).map((i) => `${lower(i.label)} (${STATUS_LABEL[i.status].toLocaleLowerCase('tr')})`).join(', ')}.`;
  return { score, reason, fixes: weak.slice(0, 4) };
}
