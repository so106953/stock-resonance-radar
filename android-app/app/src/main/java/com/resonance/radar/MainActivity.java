package com.resonance.radar;

import android.app.Activity;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://radar.zhuchuck1069.workers.dev";
    private WebView webView;
    private LinearLayout offlineView;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(8, 14, 18));
        getWindow().setNavigationBarColor(Color.rgb(8, 14, 18));
        buildUi();
        configureWebView();
        if (savedInstanceState == null) loadHome(); else webView.restoreState(savedInstanceState);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(8, 14, 18));

        webView = new WebView(this);
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));

        offlineView = new LinearLayout(this);
        offlineView.setOrientation(LinearLayout.VERTICAL);
        offlineView.setGravity(Gravity.CENTER);
        offlineView.setPadding(48, 48, 48, 48);
        offlineView.setBackgroundColor(Color.rgb(8, 14, 18));
        offlineView.setVisibility(View.GONE);

        TextView title = new TextView(this);
        title.setText("网络连接不可用");
        title.setTextColor(Color.WHITE);
        title.setTextSize(22);
        title.setGravity(Gravity.CENTER);
        offlineView.addView(title);

        TextView message = new TextView(this);
        message.setText("请检查网络后重试，行情数据需要联网更新");
        message.setTextColor(Color.rgb(150, 162, 177));
        message.setTextSize(15);
        message.setGravity(Gravity.CENTER);
        message.setPadding(0, 18, 0, 28);
        offlineView.addView(message);

        Button retry = new Button(this);
        retry.setText("重新连接");
        retry.setOnClickListener(v -> loadHome());
        offlineView.addView(retry, new LinearLayout.LayoutParams(-2, -2));
        root.addView(offlineView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        webView.setBackgroundColor(Color.rgb(8, 14, 18));
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String host = request.getUrl().getHost();
                if (host != null && (host.equals("radar.zhuchuck1069.workers.dev") || host.equals("stock-resonance-data.onrender.com"))) return false;
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                offlineView.setVisibility(View.GONE);
                webView.setVisibility(View.VISIBLE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }
        });
        webView.setOnLongClickListener(v -> true);
        webView.setLongClickable(false);
    }

    private boolean online() {
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        Network network = cm.getActiveNetwork();
        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void loadHome() {
        if (!online()) { showOffline(); return; }
        webView.setVisibility(View.VISIBLE);
        offlineView.setVisibility(View.GONE);
        webView.loadUrl(APP_URL);
    }

    private void showOffline() {
        webView.setVisibility(View.GONE);
        offlineView.setVisibility(View.VISIBLE);
    }

    @Override public void onBackPressed() {
        if (webView.getVisibility() == View.VISIBLE && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
