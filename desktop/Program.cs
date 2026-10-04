using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace Porthole;

static class Program
{
    // The types Porthole adds itself to in Explorer's "Open with" menu. Keep in step with viewer/viewer.js.
    public static readonly string[] Types =
        [".pdf", ".docx", ".xlsx", ".xlsm", ".xls", ".ods", ".csv", ".txt", ".md", ".json", ".log", ".xml",
         ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];

    [STAThread]
    static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        AddToOpenWith();
        Application.Run(new Viewer(args.Length > 0 ? Path.GetFullPath(args[0]) : null));
    }

    // For this user only, so no admin is needed. Runs on each start, so the menu follows the exe if it moves.
    static void AddToOpenWith()
    {
        using var classes = Registry.CurrentUser.CreateSubKey(@"Software\Classes");
        using (var command = classes.CreateSubKey(@"Porthole.File\shell\open\command"))
            command.SetValue("", $"\"{Environment.ProcessPath}\" \"%1\"");
        foreach (var type in Types)
        {
            using var list = classes.CreateSubKey($@"{type}\OpenWithProgids");
            list.SetValue("Porthole.File", Array.Empty<byte>(), RegistryValueKind.None);
        }
    }
}

/// <summary>
/// Shows one file. Word, Excel, text and images go through the viewer page (viewer/, shared with the
/// phone app), served from inside this exe at a made-up address. PDFs open in Edge's own PDF viewer.
/// </summary>
class Viewer : Form
{
    const string Host = "porthole.local";
    readonly WebView2 web = new() { Dock = DockStyle.Fill };
    readonly ToolStripButton open;
    string? path;

    public Viewer(string? file)
    {
        Text = "Porthole";
        Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!);
        ClientSize = LogicalToDeviceUnits(new Size(1000, 760));
        open = new ToolStripButton("Open a file", null, (_, _) => Pick()) { Enabled = false };
        Controls.Add(web);
        Controls.Add(new ToolStrip(open) { GripStyle = ToolStripGripStyle.Hidden });
        Load += async (_, _) =>
        {
            try
            {
                var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Porthole");
                await web.EnsureCoreWebView2Async(await CoreWebView2Environment.CreateAsync(null, data));
            }
            catch (WebView2RuntimeNotFoundException)
            {
                MessageBox.Show(this, "Porthole needs Microsoft Edge WebView2. Get it from https://go.microsoft.com/fwlink/p/?LinkId=2124703, then open Porthole again.", "Porthole");
                Close();
                return;
            }
            var core = web.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.AddWebResourceRequestedFilter($"https://{Host}/*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += Serve;
            core.NavigationStarting += Navigating;
            core.NewWindowRequested += (_, e) => { e.Handled = true; OpenLink(e.Uri); };
            open.Enabled = true;
            Open(file);
        };
    }

    void Open(string? file)
    {
        path = file;
        var name = Path.GetFileName(file) ?? "";
        Text = file == null ? "Porthole" : $"{name} - Porthole";
        web.CoreWebView2.Navigate(file != null && Path.GetExtension(file).Equals(".pdf", StringComparison.OrdinalIgnoreCase)
            ? new Uri(file).AbsoluteUri
            : $"https://{Host}/index.html?name={Uri.EscapeDataString(name)}");
    }

    void Pick()
    {
        using var dialog = new OpenFileDialog
        {
            Filter = $"Files Porthole can show|{string.Join(";", Program.Types.Select(t => "*" + t))}|All files|*.*",
        };
        if (dialog.ShowDialog(this) == DialogResult.OK) Open(dialog.FileName);
    }

    void Navigating(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri);
        if (uri?.Host == Host || (uri?.IsFile == true && string.Equals(uri.LocalPath, path, StringComparison.OrdinalIgnoreCase)))
            return;   // the viewer page, or the open PDF
        e.Cancel = true;
        if (uri == null) return;
        if (uri.IsFile) BeginInvoke(() => Open(uri.LocalPath));   // a file dropped on the window
        else if (e.IsUserInitiated) OpenLink(e.Uri);
    }

    // A link in a document opens in the browser: only web links.
    static void OpenLink(string link)
    {
        if (Uri.TryCreate(link, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }

    // Answers the viewer page: "file" is the open file, anything else is a file of the viewer.
    void Serve(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var name = new Uri(e.Request.Uri).AbsolutePath.TrimStart('/');
        Stream? body = null;
        try
        {
            body = name == "file"
                ? path == null ? null : new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)
                : typeof(Viewer).Assembly.GetManifestResourceStream("viewer/" + name);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        e.Response = web.CoreWebView2.Environment.CreateWebResourceResponse(body, body == null ? 404 : 200, body == null ? "Not found" : "OK",
            $"Content-Type: {Mime(name == "file" ? path ?? "" : name)}\r\nCache-Control: no-store");
    }

    static string Mime(string name) => Path.GetExtension(name).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".woff2" => "font/woff2",
        _ => "application/octet-stream",
    };
}
