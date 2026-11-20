// Seçilen görünüm (Ayarlar > Görünüm) sayfa çizilmeden önce uygulanır; açılışta öbür tema bir an görünmesin diye
// <head> içinde, modüllerden önce yüklenir. "auto" ya da kayıt yoksa telefonun ayarına uyulur.
(function () {
  var t = null;
  try { t = localStorage.getItem('tema'); } catch (e) { /* erişilemiyor */ }
  if (t === 'light' || t === 'dark') {
    document.documentElement.setAttribute('data-theme', t);
    var c = t === 'dark' ? '#0c0d10' : '#f6f7f9';
    var m = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < m.length; i++) m[i].setAttribute('content', c);
  }
}());
