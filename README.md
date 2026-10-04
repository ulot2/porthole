# Porthole

Porthole opens PDF, Word, Excel, text and image files on an Android phone and on a Windows PC. It only shows files. It does not edit them.

Porthole works offline. The app has no internet permission on Android, and a file never leaves your device.

## File types

| Type | Extensions | Notes |
|---|---|---|
| PDF | `.pdf` | Android draws the pages with its own PDF reader. Pinch to zoom up to 10 times; when you stop, Porthole draws the part you see again, so text stays sharp. A page counter shows while you scroll. Windows uses the PDF viewer of Microsoft Edge. |
| Word | `.docx` | Porthole shows the pages as Word does: the same page breaks (for files saved by Word), headers, footers with page numbers, tables, pictures and tab stops. On a phone, the page fits the screen; pinch to zoom. Complex layouts, such as text boxes and shapes, can move a little. |
| Excel | `.xlsx`, `.xlsm`, `.xls`, `.ods`, `.csv`, `.tsv` | Porthole shows a grid like Excel: column letters and row numbers, frozen rows and columns, and one tab for each sheet. For `.xlsx` and `.xlsm` files, it also shows column widths, fonts, colors, borders and merged cells. It does not show charts, pictures or conditional formatting. On a phone, pinch the grid to zoom. |
| Text | `.txt`, `.md`, `.log`, `.json`, `.xml`, `.ini`, `.yml`, `.yaml` | |
| Images | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.svg`, `.avif` | |

Porthole does not open PowerPoint files or the old Word format (`.doc`) yet.

## How it works

Each app has a page view: a small browser window without an address bar. On Android this is the WebView. On Windows it is WebView2, the page view of Microsoft Edge.

The page view shows the viewer page in `viewer/`. The two apps use the same viewer page. The viewer page uses two open-source readers:

- [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) (Apache 2.0) reads Word files. It uses [JSZip](https://github.com/Stuk/jszip) (MIT) to unpack them.
- [SheetJS](https://sheetjs.com) (Apache 2.0) reads Excel files.

Phones do not have the fonts of Microsoft Office, so the viewer page includes free fonts (SIL Open Font License, in `viewer/fonts/`) to use in their place:

| Office font | Free font | Letter widths |
|---|---|---|
| Calibri, Calibri Light | Carlito | The same |
| Arial, Helvetica | Arimo | The same |
| Times New Roman | Tinos | The same |
| Courier New | Cousine | The same |
| Cambria | Caladea | Close, not the same |

When the letter widths are the same, lines break at the same words as in Word. On a PC that has the Office fonts, Porthole uses the Office fonts.

The app serves the viewer page and the open file at a made-up address, `https://porthole.local/`. Nothing goes to the internet. The viewer page also blocks all addresses outside the app.

If you tap or click a web link in a document, Porthole opens the link in your browser. Porthole never opens a link by itself, and it only opens web links (http and https).

## Install

Download both files from the latest release on the [Releases page](../../releases/latest).

### On the phone

1. Download `Porthole.apk` on the phone and open it.
2. If Android asks, allow installs from that app.

To open a file, use one of these:

- In another app, open the file and choose **Porthole** in the **Open with** list.
- Open Porthole and tap **Open a file**.

### On the laptop

1. Download `Porthole.exe` and put it in a permanent folder, for example `%LOCALAPPDATA%\Programs\Porthole`.
2. Open `Porthole.exe`. If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**. Windows shows this message because Porthole is not signed with a paid certificate.

When Porthole starts, it adds itself to the **Open with** menu in File Explorer. Then you can open a file in one of these ways:

- Right-click the file and choose **Open with > Porthole**.
- Drag the file into the Porthole window.
- Click **Open a file** in the Porthole window.

Porthole needs the WebView2 runtime. Windows 11 has it. If Porthole says that it is missing, install it from Microsoft, then open Porthole again.

## Build

GitHub Actions builds both apps (see `.github/workflows/build.yml`):

- A push to `main` or `dev` builds the apps. The files stay on the run page.
- A tag such as `v1.0.0` builds the apps and publishes a release.

The Android build signs the APK with the key in the `PORTHOLE_KEY` secret (the `.p12` file in base64) and the `PORTHOLE_KEY_PASSWORD` secret. Keep a copy of the key. If you lose the key, phones cannot update Porthole, and each user must remove it and install it again.

To build on your own computer:

- Android: JDK 21, the Android SDK, and Gradle 8.14. Put the key at `porthole.p12` in the project folder. Then set `PORTHOLE_KEY_PASSWORD` and `PORTHOLE_KEY_ALIAS`, and run `gradle assembleRelease`.
- Windows: the .NET 10 SDK. Run `dotnet publish desktop/Porthole.csproj -c Release -o out`.

To update a reader, copy its new file into `viewer/lib/`. Both apps use it at the next build.
