package app.movementtv;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * Full-screen web view for the Firestick.
 *
 * The app's screens (HTML, CSS, JavaScript) are served as if they lived at
 * https://www.skool.com/__tvapp/, so they can read your programs using your normal
 * Skool sign-in. The screens are loaded from the latest version in the GitHub
 * repository, so changes to them show up without reinstalling. A copy is kept on the
 * device, and the version built into the app is the fallback when offline.
 */
public class MainActivity extends Activity {

    /** Bump when this Java shell changes in a way the screens need to know about. */
    static final int SHELL_VERSION = 2;

    private static final String ORIGIN = "https://www.skool.com";
    private static final String HOST = "www.skool.com";
    private static final String APP_PREFIX = "/__tvapp/";
    private static final String APP_URL = ORIGIN + APP_PREFIX + "index.html";
    private static final int BACKGROUND = 0xFFF8F7F5;

    private static final String REPO = "5ytn4w6s5k-spec/movement-tv";
    private static final String WEB_PATH = "app/src/main/assets/web/";
    private static final String[] CORE_FILES = { "index.html", "app.css", "app.js", "fonts/archivo.woff2" };
    private static final long RECHECK_AFTER_MS = 10 * 60 * 1000;

    private WebView web;
    private ImageView splash;
    private boolean signingIn = false;
    private SharedPreferences prefs;
    /** Commit of the screens currently being served; null means the built-in copy. */
    private volatile String activeSha = null;
    private volatile String loadedSha = null;
    private long lastCheck = 0;
    private boolean checking = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setBackgroundColor(BACKGROUND);

        prefs = getSharedPreferences("movementtv", MODE_PRIVATE);
        activeSha = prefs.getString("activeSha", null);
        if (activeSha != null && !coreFilesPresent(activeSha)) activeSha = null;

        web = new WebView(this);
        web.setBackgroundColor(BACKGROUND);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public Bitmap getDefaultVideoPoster() {
                // Hide the grey play-button poster Android shows before a video starts.
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }
        });
        web.addJavascriptInterface(new Bridge(), "MTVNative");

        if (Build.VERSION.SDK_INT >= 24) {
            // In case skool.com ever installs a service worker, make sure it can't
            // intercept the app's own files.
            ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return serveAsset(request.getUrl());
                }
            });
        }

        // Startup picture, shown until the app's first screen has loaded.
        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        splash = new ImageView(this);
        splash.setImageResource(R.drawable.splash);
        splash.setScaleType(ImageView.ScaleType.CENTER_CROP);
        splash.setBackgroundColor(0xFF000000);
        root.addView(splash, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        root.postDelayed(new Runnable() {
            @Override
            public void run() { hideSplash(); }
        }, 12000);
        hideSystemUi();
        web.requestFocus(View.FOCUS_DOWN);

        // Check GitHub for newer screens (briefly), then open the app.
        new Thread(new Runnable() {
            @Override
            public void run() {
                updateScreens(3000);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() { showApp(); }
                });
            }
        }).start();
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    /* ------------------------------------------------------------------ */
    /* Live screens from GitHub                                            */
    /* ------------------------------------------------------------------ */

    private File shaDir(String sha) {
        return new File(new File(getFilesDir(), "web"), sha);
    }

    private boolean coreFilesPresent(String sha) {
        for (String f : CORE_FILES) {
            if (!new File(shaDir(sha), f).isFile()) return false;
        }
        return true;
    }

    /**
     * Looks up the latest commit of the repo and, if it's new, downloads the screens for it.
     * Only switches to the new version once every core file has downloaded, so the app never
     * mixes old and new files. Returns true if a newer version became active.
     */
    private synchronized boolean updateScreens(int timeoutMs) {
        lastCheck = SystemClock.elapsedRealtime();
        String sha = latestSha(timeoutMs);
        if (sha == null || sha.equals(activeSha)) return false;
        if (!coreFilesPresent(sha)) {
            for (String f : CORE_FILES) {
                if (!downloadFile(sha, f, timeoutMs * 3)) return false;
            }
        }
        String old = activeSha;
        activeSha = sha;
        prefs.edit().putString("activeSha", sha).apply();
        deleteOtherVersions(sha, old);
        return true;
    }

    private String latestSha(int timeoutMs) {
        byte[] body = httpGet("https://api.github.com/repos/" + REPO + "/commits/main", "application/vnd.github.sha", timeoutMs);
        if (body == null) return null;
        String sha = new String(body).trim();
        return sha.matches("[0-9a-f]{40}") ? sha : null;
    }

    private boolean downloadFile(String sha, String rel, int timeoutMs) {
        byte[] body = httpGet("https://raw.githubusercontent.com/" + REPO + "/" + sha + "/" + WEB_PATH + rel, null, timeoutMs);
        if (body == null) return false;
        File target = new File(shaDir(sha), rel);
        File parent = target.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) return false;
        File tmp = new File(target.getPath() + ".part");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(body);
        } catch (IOException e) {
            tmp.delete();
            return false;
        }
        return tmp.renameTo(target);
    }

    /** Keeps the active version and the one before it; removes anything older. */
    private void deleteOtherVersions(String keep, String previous) {
        File[] dirs = new File(getFilesDir(), "web").listFiles();
        if (dirs == null) return;
        for (File d : dirs) {
            String n = d.getName();
            if (n.equals(keep) || n.equals(previous)) continue;
            deleteTree(d);
        }
    }

    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    private static byte[] httpGet(String url, String accept, int timeoutMs) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setRequestProperty("User-Agent", "MovementSkoolTV");
            if (accept != null) conn.setRequestProperty("Accept", accept);
            if (conn.getResponseCode() != 200) return null;
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[16384];
                int n;
                while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
                return buf.toByteArray();
            }
        } catch (IOException | RuntimeException e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** Serves https://www.skool.com/__tvapp/... from the live copy, else the built-in copy. */
    private WebResourceResponse serveAsset(Uri uri) {
        if (uri == null || !HOST.equals(uri.getHost())) return null;
        String path = uri.getPath();
        if (path == null || !path.startsWith(APP_PREFIX)) return null;
        String rel = path.substring(APP_PREFIX.length());
        if (rel.isEmpty()) rel = "index.html";
        if (rel.contains("..") || rel.startsWith("/")) return notFound();

        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Access-Control-Allow-Origin", ORIGIN);

        String sha = activeSha;
        if (rel.equals("index.html")) loadedSha = sha;
        if (sha != null) {
            File f = new File(shaDir(sha), rel);
            if (!f.isFile()) downloadFile(sha, rel, 6000);
            if (f.isFile()) {
                try {
                    return new WebResourceResponse(mimeFor(rel), "UTF-8", 200, "OK", headers, new FileInputStream(f));
                } catch (IOException e) {
                    // fall through to the built-in copy
                }
            }
        }
        try {
            InputStream in = getAssets().open("web/" + rel);
            return new WebResourceResponse(mimeFor(rel), "UTF-8", 200, "OK", headers, in);
        } catch (IOException e) {
            return notFound();
        }
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeFor(String name) {
        if (name.endsWith(".html")) return "text/html";
        if (name.endsWith(".js")) return "application/javascript";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".woff2")) return "font/woff2";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    /* ------------------------------------------------------------------ */
    /* Navigation, sign-in and the bridge to the screens                   */
    /* ------------------------------------------------------------------ */

    private void hideSplash() {
        final ImageView v = splash;
        if (v == null) return;
        splash = null;
        v.animate().alpha(0f).setDuration(350).withEndAction(new Runnable() {
            @Override
            public void run() { v.setVisibility(View.GONE); }
        }).start();
    }

    private boolean onAppPage() {
        String url = web.getUrl();
        return url != null && url.startsWith(ORIGIN + APP_PREFIX);
    }

    private void showApp() {
        signingIn = false;
        if (web != null) web.loadUrl(APP_URL);
    }

    /** True for Skool pages that are part of signing in. */
    private static boolean isSignInPath(String path) {
        if (path == null) return false;
        return path.startsWith("/login") || path.startsWith("/signup") || path.startsWith("/forgot")
                || path.startsWith("/reset") || path.startsWith("/verify") || path.startsWith("/auth")
                || path.startsWith("/oauth") || path.startsWith("/sso");
    }

    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return serveAsset(request.getUrl());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (url != null && url.startsWith(ORIGIN + APP_PREFIX)) {
                view.postDelayed(new Runnable() {
                    @Override
                    public void run() { hideSplash(); }
                }, 250);
            }
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            super.doUpdateVisitedHistory(view, url, isReload);
            // Once Skool's sign-in finishes and moves on to any other Skool page,
            // come straight back to the app.
            if (!signingIn || url == null) return;
            Uri u = Uri.parse(url);
            if (HOST.equals(u.getHost()) && !isSignInPath(u.getPath())
                    && (u.getPath() == null || !u.getPath().startsWith(APP_PREFIX))) {
                view.post(new Runnable() {
                    @Override
                    public void run() { showApp(); }
                });
            }
        }
    }

    /** Called from the app's JavaScript as window.MTVNative.* */
    private class Bridge {
        @JavascriptInterface
        public void signIn() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    signingIn = true;
                    web.loadUrl(ORIGIN + "/login");
                }
            });
        }

        @JavascriptInterface
        public void openSkool(final String path) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    signingIn = false;
                    String p = (path == null || !path.startsWith("/")) ? "/" : path;
                    web.loadUrl(ORIGIN + p);
                }
            });
        }

        @JavascriptInterface
        public void exit() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { finish(); }
            });
        }

        @JavascriptInterface
        public int shellVersion() {
            return SHELL_VERSION;
        }

        @JavascriptInterface
        public String screensVersion() {
            String sha = loadedSha;
            return sha == null ? "built-in" : sha.substring(0, 7);
        }
    }

    /** After time away, look for newer screens and reload if it's a good moment. */
    private void recheckInBackground() {
        if (checking || SystemClock.elapsedRealtime() - lastCheck < RECHECK_AFTER_MS) return;
        checking = true;
        new Thread(new Runnable() {
            @Override
            public void run() {
                final boolean changed = updateScreens(4000);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        checking = false;
                        if (!changed || web == null || !onAppPage()) return;
                        web.evaluateJavascript("(window.mtvCanReload ? window.mtvCanReload() : true) ? 'yes' : 'no'", value -> {
                            if ("\"yes\"".equals(value) && web != null) web.reload();
                        });
                    }
                });
            }
        }).start();
    }

    private static String mediaKeyName(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: return "playpause";
            case KeyEvent.KEYCODE_MEDIA_PLAY: return "playpause";
            case KeyEvent.KEYCODE_MEDIA_PAUSE: return "pause";
            case KeyEvent.KEYCODE_MEDIA_REWIND: return "rew";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: return "ff";
            default: return null;
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        String media = mediaKeyName(code);

        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
            if (event.getAction() == KeyEvent.ACTION_UP) {
                if (onAppPage()) {
                    web.evaluateJavascript("(window.mtvBack && window.mtvBack()) ? 'yes' : 'no'", value -> {
                        if (!"\"yes\"".equals(value)) finish();
                    });
                } else {
                    // On a Skool page (sign-in or the site): Back returns to the app.
                    showApp();
                }
            }
            return true;
        }

        if (media != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0 && onAppPage()) {
                web.evaluateJavascript("window.mtvKey && window.mtvKey('" + media + "')", null);
            }
            return true;
        }

        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onPause() {
        if (web != null && onAppPage()) web.evaluateJavascript("window.mtvKey && window.mtvKey('pause')", null);
        if (web != null) web.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        if (lastCheck > 0) recheckInBackground();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
