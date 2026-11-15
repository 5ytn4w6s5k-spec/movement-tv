// Keeps the app's screens up to date by loading the latest version from GitHub,
// the same files the Firestick app uses. Runs them with Chrome's user scripts
// feature, which needs the "Allow User Scripts" toggle on this extension's
// details page. Without it, the copy built into the extension is used instead.

var REPO = '5ytn4w6s5k-spec/movement-tv';
var WEB = 'app/src/main/assets/web/';
var MATCHES = ['https://www.skool.com/__tvapp/*'];
var APP_URL = 'https://www.skool.com/__tvapp/index.html';

function userScriptsOn() {
  try { chrome.userScripts.getScripts(); return true; } catch (e) { return false; }
}

function bundled(path) {
  return fetch(chrome.runtime.getURL(path)).then(function (r) { return r.text(); });
}

// Downloads the newest screens if GitHub has a newer version than the one saved.
async function fetchLatest() {
  try {
    var r = await fetch('https://api.github.com/repos/' + REPO + '/commits/main', {
      headers: { Accept: 'application/vnd.github.sha' }, cache: 'no-store'
    });
    if (!r.ok) return false;
    var sha = (await r.text()).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) return false;
    var saved = await chrome.storage.local.get('sha');
    if (saved.sha === sha) return false;
    var get = function (f) {
      return fetch('https://raw.githubusercontent.com/' + REPO + '/' + sha + '/' + WEB + f, { cache: 'no-store' })
        .then(function (x) { if (!x.ok) throw new Error(f); return x.text(); });
    };
    var files = await Promise.all([get('app.js'), get('app.css')]);
    await chrome.storage.local.set({ sha: sha, js: files[0], css: files[1] });
    return true;
  } catch (e) {
    return false;
  }
}

async function install() {
  if (userScriptsOn()) {
    try { await chrome.scripting.unregisterContentScripts({ ids: ['mtv-bundled'] }); } catch (e) { /* not registered */ }
    var boot = await bundled('boot.js');
    var saved = await chrome.storage.local.get('js');
    var js = saved.js || await bundled('app.js');
    await chrome.userScripts.configureWorld({ messaging: true });
    var def = {
      id: 'mtv',
      matches: MATCHES,
      runAt: 'document_start',
      world: 'USER_SCRIPT',
      js: [{ code: 'var MTV_MODE = "live";\n' + boot + '\n' + js }]
    };
    var existing = await chrome.userScripts.getScripts({ ids: ['mtv'] });
    if (existing.length) await chrome.userScripts.update([def]);
    else await chrome.userScripts.register([def]);
  } else {
    var reg = await chrome.scripting.getRegisteredContentScripts({ ids: ['mtv-bundled'] });
    if (!reg.length) {
      await chrome.scripting.registerContentScripts([{
        id: 'mtv-bundled',
        matches: MATCHES,
        js: ['boot.js', 'app.js'],
        css: ['app.css'],
        runAt: 'document_start',
        persistAcrossSessions: true
      }]);
    }
  }
}

async function refresh() {
  await fetchLatest();
  await install();
}

function toBase64(buf) {
  var bytes = new Uint8Array(buf);
  var out = '';
  for (var i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

// The live screens ask for their styles, font and icon once the page starts.
async function handle(msg, sender) {
  if (!msg || msg.type !== 'assets' || !sender.tab) return null;
  var saved = await chrome.storage.local.get('css');
  var css = (saved.css || await bundled('app.css')).replace(/@font-face\s*\{[^}]*\}/, '');
  await chrome.scripting.insertCSS({ target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, css: css });
  var font = await fetch(chrome.runtime.getURL('fonts/archivo.woff2')).then(function (r) { return r.arrayBuffer(); });
  var icon = await fetch(chrome.runtime.getURL('icons/32.png')).then(function (r) { return r.arrayBuffer(); });
  return { font: toBase64(font), icon: toBase64(icon) };
}

if (chrome.runtime.onUserScriptMessage) {
  chrome.runtime.onUserScriptMessage.addListener(function (msg, sender, sendResponse) {
    handle(msg, sender).then(sendResponse, function () { sendResponse(null); });
    return true;
  });
}

chrome.runtime.onInstalled.addListener(function () {
  chrome.alarms.create('mtv-update', { periodInMinutes: 30 });
  refresh();
});
chrome.runtime.onStartup.addListener(function () { refresh(); });
chrome.alarms.onAlarm.addListener(function (a) { if (a.name === 'mtv-update') refresh(); });

// Clicking the toolbar button checks for the newest version, then opens the app.
chrome.action.onClicked.addListener(function () {
  refresh().catch(function () {}).then(function () { chrome.tabs.create({ url: APP_URL }); });
});
