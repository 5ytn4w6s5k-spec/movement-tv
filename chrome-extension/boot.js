// Runs before Skool's own page loads at https://www.skool.com/__tvapp/... and swaps it
// for the app. Running on skool.com lets the app use your normal Skool sign-in.
(function () {
  if (window.__mtvBooted) return;
  window.__mtvBooted = true;
  try { window.stop(); } catch (e) { /* ignore */ }

  var html = document.documentElement;
  if (!html) { html = document.createElement('html'); document.appendChild(html); }
  html.innerHTML =
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Movement Skool</title></head>' +
    '<body><div id="player" aria-hidden="true"></div>' +
    '<div id="stage"><div id="screen"></div><div id="toast" role="status"></div></div></body>';

  var icon = document.createElement('link');
  icon.rel = 'icon';
  icon.href = chrome.runtime.getURL('icons/32.png');
  document.head.appendChild(icon);

  // Load the app's typeface from the extension.
  fetch(chrome.runtime.getURL('fonts/archivo.woff2'))
    .then(function (r) { return r.arrayBuffer(); })
    .then(function (buf) { return new FontFace('Archivo', buf, { weight: '100 900', stretch: '62% 125%' }).load(); })
    .then(function (face) {
      document.fonts.add(face);
      if (window.MTV && window.MTV.refit) window.MTV.refit();
    })
    .catch(function () { /* falls back to the system font */ });
})();
