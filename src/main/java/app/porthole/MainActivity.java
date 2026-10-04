package app.porthole;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Bundle;
import android.os.FileUtils;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.view.Gravity;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;

/**
 * Shows one file. The file is copied to the cache folder. Then the viewer page (viewer/, shared with
 * the Windows app) loads from a made-up address, https://porthole.local/, which this activity serves.
 * The app has no internet permission, and every other address gets an empty answer.
 */
public class MainActivity extends Activity {
    private static final String HOST = "porthole.local";
    private static final int PICK = 1;

    private Uri uri;                 // the open file, kept so the activity can reopen it after Android recreates it
    private volatile String name;
    private File file;               // copy of the open file; file and pdf are guarded by "this"
    private PdfRenderer pdf;         // opened when the viewer first asks for PDF pages
    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Uri u = state != null ? state.getParcelable("uri") : getIntent().getData();
        if (u != null) open(u);
        else showStart();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putParcelable("uri", uri);
    }

    @Override
    protected void onDestroy() {
        synchronized (this) {
            if (pdf != null) pdf.close();
            pdf = null;
            if (file != null) file.delete();
        }
        if (web != null) web.destroy();
        super.onDestroy();
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add("Open").setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        pick();
        return true;
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == PICK && result == RESULT_OK && data != null && data.getData() != null) open(data.getData());
    }

    private void showStart() {
        setTitle("Porthole");
        Button button = new Button(this);
        button.setText("Open a file");
        button.setOnClickListener(v -> pick());
        FrameLayout frame = new FrameLayout(this);
        frame.addView(button, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        setContentView(frame);
    }

    private void pick() {
        startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"), PICK);
    }

    /** Copies the file in the background (it can be large), then shows it. */
    private void open(Uri u) {
        setTitle("Opening…");
        new Thread(() -> {
            try {
                String n = nameOf(u);
                File copy = File.createTempFile("open", null, getCacheDir());
                try (InputStream in = getContentResolver().openInputStream(u); OutputStream out = new FileOutputStream(copy)) {
                    if (in == null) throw new IOException("No data");
                    FileUtils.copy(in, out);
                } catch (IOException | RuntimeException e) {
                    copy.delete();
                    throw e;
                }
                runOnUiThread(() -> show(u, n, copy));
            } catch (IOException | RuntimeException e) {
                runOnUiThread(() -> {
                    Toast.makeText(this, "Porthole could not read this file.", Toast.LENGTH_LONG).show();
                    if (uri == null) showStart();
                    else setTitle(name);
                });
            }
        }).start();
    }

    private void show(Uri u, String n, File copy) {
        if (isDestroyed()) {
            copy.delete();
            return;
        }
        synchronized (this) {
            if (pdf != null) pdf.close();
            pdf = null;
            if (file != null) file.delete();
            file = copy;
        }
        uri = u;
        name = n;
        setTitle(n);
        if (web == null) web = newWebView();
        setContentView(web);
        web.loadUrl("https://" + HOST + "/index.html?name=" + Uri.encode(n));
    }

    private String nameOf(Uri u) {
        String n = null;
        try (Cursor c = getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) n = c.getString(0);
        } catch (RuntimeException ignored) {
            // Some apps don't answer this; fall back to the address.
        }
        if (n == null) n = u.getLastPathSegment();
        if (n == null) n = "file";
        // The viewer picks a reader by extension, and some apps send a name without one.
        String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(getContentResolver().getType(u));
        if (ext != null && !n.contains(".")) n += "." + ext;
        return n;
    }

    private WebView newWebView() {
        WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setBuiltInZoomControls(true);   // pinch to zoom
        s.setDisplayZoomControls(false);
        // Use the page's viewport width and start zoomed out to fit, so Word pages fit the screen.
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        w.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri link = request.getUrl();
                if (HOST.equals(link.getHost())) return false;
                // A link in the document opens in the browser: only web links, and only when tapped.
                if (request.hasGesture() && ("http".equals(link.getScheme()) || "https".equals(link.getScheme()))) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, link));
                    } catch (ActivityNotFoundException ignored) {
                        // No browser installed.
                    }
                }
                return true;
            }
        });
        return w;
    }

    /** Runs on a WebView background thread, once for each thing the viewer page loads. */
    private WebResourceResponse serve(Uri u) {
        String path = u.getPath();
        if (!HOST.equals(u.getHost()) || path == null) return answer(404, "text/plain", new byte[0]);
        try {
            if (path.equals("/file")) return answer(200, mime(name), new FileInputStream(currentFile()));
            if (path.equals("/pdf")) return answer(200, "application/json", pageSizes().getBytes(StandardCharsets.UTF_8));
            if (path.startsWith("/page/")) {
                byte[] picture = page(Integer.parseInt(path.substring(6)), u);
                return answer(200, u.getQueryParameter("cw") != null ? "image/png" : "image/jpeg", picture);
            }
            return answer(200, mime(path), getAssets().open(path.substring(1)));
        } catch (IOException | RuntimeException e) {
            // Missing file, damaged PDF, PDF with a password (SecurityException), or a bad page number.
            return answer(404, "text/plain", new byte[0]);
        }
    }

    private static WebResourceResponse answer(int status, String mime, byte[] body) {
        return answer(status, mime, new ByteArrayInputStream(body));
    }

    private static WebResourceResponse answer(int status, String mime, InputStream body) {
        return new WebResourceResponse(mime, "utf-8", status, status == 200 ? "OK" : "Not found",
                Collections.singletonMap("Cache-Control", "no-store"), body);
    }

    private static String mime(String n) {
        n = n.toLowerCase(Locale.ROOT);
        return n.endsWith(".html") ? "text/html"
                : n.endsWith(".js") ? "text/javascript"
                : n.endsWith(".css") ? "text/css"
                : n.endsWith(".svg") ? "image/svg+xml"
                : n.endsWith(".woff2") ? "font/woff2"
                : "application/octet-stream";
    }

    private synchronized File currentFile() throws IOException {
        if (file == null) throw new IOException("No file open");
        return file;
    }

    private synchronized PdfRenderer pdf() throws IOException {
        if (pdf == null) {
            ParcelFileDescriptor fd = ParcelFileDescriptor.open(currentFile(), ParcelFileDescriptor.MODE_READ_ONLY);
            try {
                pdf = new PdfRenderer(fd);
            } catch (IOException | RuntimeException e) {
                fd.close();
                throw e;
            }
        }
        return pdf;
    }

    /** The size of each page in points, as JSON: [[width, height], ...]. */
    private synchronized String pageSizes() throws IOException {
        PdfRenderer r = pdf();
        StringBuilder json = new StringBuilder("[");
        for (int i = 0; i < r.getPageCount(); i++) {
            try (PdfRenderer.Page p = r.openPage(i)) {
                json.append(i == 0 ? "[" : ",[").append(p.getWidth()).append(',').append(p.getHeight()).append(']');
            }
        }
        return json.append(']').toString();
    }

    /**
     * One page, or one part of it, as a picture. The address /page/3?w=1080 draws page 3 at 1080 pixels
     * wide (a JPEG). Adding x, y, cw and ch draws only that part of the page at that size, in those
     * pixels (a PNG, for sharp text). The viewer asks for a part when you zoom in.
     */
    private synchronized byte[] page(int i, Uri u) throws IOException {
        try (PdfRenderer.Page p = pdf().openPage(i)) {
            float width = number(u, "w", 1080);
            float x = number(u, "x", 0), y = number(u, "y", 0);
            float cw = number(u, "cw", width), ch = number(u, "ch", width * p.getHeight() / p.getWidth());
            if (!(width >= 1 && cw >= 1 && ch >= 1 && x >= 0 && y >= 0)) throw new IOException("Bad size");   // also catches NaN
            // Keep each picture under 16 million pixels (64 MB): draw a bigger request at a lower resolution.
            float shrink = (float) Math.min(1, Math.sqrt(16e6 / (cw * ch)));
            float scale = width * shrink / p.getWidth();
            Bitmap b = Bitmap.createBitmap(Math.max(1, Math.round(cw * shrink)), Math.max(1, Math.round(ch * shrink)), Bitmap.Config.ARGB_8888);
            b.eraseColor(Color.WHITE);   // PDF pages are see-through where nothing is drawn
            Matrix m = new Matrix();
            m.setScale(scale, scale);
            m.postTranslate(-x * shrink, -y * shrink);
            p.render(b, null, m, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            boolean part = u.getQueryParameter("cw") != null;
            b.compress(part ? Bitmap.CompressFormat.PNG : Bitmap.CompressFormat.JPEG, 92, out);
            b.recycle();
            return out.toByteArray();
        }
    }

    private static float number(Uri u, String name, float fallback) {
        String v = u.getQueryParameter(name);
        return v == null ? fallback : Float.parseFloat(v);
    }
}
