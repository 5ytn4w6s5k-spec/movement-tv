// Runs before Skool's own page loads at https://www.skool.com/__tvapp/... and swaps it
// for the app. Running on skool.com lets the app use your normal Skool sign-in.
(function () {
  if (window.__mtvBooted) return;
  window.__mtvBooted = true;
  var live = typeof MTV_MODE !== 'undefined' && MTV_MODE === 'live';
  window.__mtvBundled = !live;
  try { window.stop(); } catch (e) { /* ignore */ }

  var html = document.documentElement;
  if (!html) { html = document.createElement('html'); document.appendChild(html); }
  html.innerHTML =
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Movement Skool</title></head>' +
    '<body><div id="player" aria-hidden="true"></div>' +
    '<div id="stage"><div id="screen"></div><div id="toast" role="status"></div></div></body>';

  function fromBase64(b64) {
    var s = atob(b64);
    var bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes.buffer;
  }
  function useFont(buf) {
    new FontFace('Archivo', buf, { weight: '100 900', stretch: '62% 125%' }).load().then(function (face) {
      document.fonts.add(face);
      if (window.MTV && window.MTV.refit) window.MTV.refit();
    }, function () { /* falls back to the system font */ });
  }
  function useIcon(href) {
    var icon = document.createElement('link');
    icon.rel = 'icon';
    icon.href = href;
    document.head.appendChild(icon);
  }

  if (live) {
    // Styles, font and icon come from the extension once the page has started.
    html.style.visibility = 'hidden';
    chrome.runtime.sendMessage({ type: 'assets' }, function (res) {
      html.style.visibility = '';
      if (window.MTV && window.MTV.refit) window.MTV.refit();
      if (!res) return;
      if (res.font) useFont(fromBase64(res.font));
      if (res.icon) useIcon('data:image/png;base64,' + res.icon);
    });
    setTimeout(function () { html.style.visibility = ''; }, 4000);
  } else {
    useIcon(chrome.runtime.getURL('icons/32.png'));
    fetch(chrome.runtime.getURL('fonts/archivo.woff2'))
      .then(function (r) { return r.arrayBuffer(); })
      .then(useFont)
      .catch(function () { /* falls back to the system font */ });
  }
})();
