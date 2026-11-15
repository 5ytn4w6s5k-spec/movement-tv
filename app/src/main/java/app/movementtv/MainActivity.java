package app.movementtv;

import android.app.Activity;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
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

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Full-screen web view for the Firestick.
 *
 * The app's own screens are bundled in assets/web and served as if they lived at
 * https://www.skool.com/__tvapp/, so they can read your programs using your normal
 * Skool sign-in (the same cookies the Skool site uses).
 */
public class MainActivity extends Activity {

    private static final String ORIGIN = "https://www.skool.com";
    private static final String HOST = "www.skool.com";
    private static final String APP_PREFIX = "/__tvapp/";
    private static final String APP_URL = ORIGIN + APP_PREFIX + "index.html";
    private static final int BACKGROUND = 0xFFF8F7F5;

    private WebView web;
    private boolean signingIn = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setBackgroundColor(BACKGROUND);

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

        setContentView(web);
        hideSystemUi();
        web.loadUrl(APP_URL);
        web.requestFocus(View.FOCUS_DOWN);
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

    /** Serves files from assets/web for https://www.skool.com/__tvapp/... */
    private WebResourceResponse serveAsset(Uri uri) {
        if (uri == null || !HOST.equals(uri.getHost())) return null;
        String path = uri.getPath();
        if (path == null || !path.startsWith(APP_PREFIX)) return null;
        String rel = path.substring(APP_PREFIX.length());
        if (rel.isEmpty()) rel = "index.html";
        if (rel.contains("..")) return notFound();
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Access-Control-Allow-Origin", ORIGIN);
        try {
            InputStream in = getAssets().open("web/" + rel);
            return new WebResourceResponse(mimeFor(rel), "UTF-8", 200, "OK", headers, in);
        } catch (IOException e) {
            return notFound();
        }
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                new HashMap<String, String>(), new java.io.ByteArrayInputStream(new byte[0]));
    }

    private static String mimeFor(String name) {
        if (name.endsWith(".html")) return "text/html";
        if (name.endsWith(".js")) return "application/javascript";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".woff2")) return "font/woff2";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private boolean onAppPage() {
        String url = web.getUrl();
        return url != null && url.startsWith(ORIGIN + APP_PREFIX);
    }

    private void showApp() {
        signingIn = false;
        web.loadUrl(APP_URL);
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
