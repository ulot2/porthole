// Draws a workbook like Excel: column letters and row numbers that stay in view, the file's column
// widths and row heights, fonts, fills, borders, alignment, merged cells and frozen panes.
// SheetJS reads the values and their number formats. It does not keep which style each cell uses,
// so readStyles() takes the styles from the xlsx file itself (an xlsx file is a zip of XML files).

// Excel's legacy palette, for colors that a file gives by number ("indexed").
const INDEXED = ('000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF ' +
  '800000 008000 000080 808000 800080 008080 C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF ' +
  '000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 ' +
  '3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 003366 339966 003300 333300 993300 993366 333399 333333').split(' ');

const BORDER = {
  thin: '1px solid', hair: '1px dotted', dotted: '1px dotted', dashed: '1px dashed', dashDot: '1px dashed',
  dashDotDot: '1px dashed', medium: '2px solid', mediumDashed: '2px dashed', mediumDashDot: '2px dashed',
  mediumDashDotDot: '2px dashed', slantDashDot: '2px dashed', thick: '3px solid', double: '3px double',
};

const CHUNK = 300;       // rows drawn at a time; more are drawn when you scroll near the end
const MAX_COLS = 500;    // ponytail: wider sheets are cut at 500 columns; draw columns on scroll if that matters
const HEAD = 22;         // height of the row with the column letters, in px (see .grid thead th)

async function showSheet(main, data, ext) {
  const book = XLSX.read(data, { dense: true, cellStyles: true, sheetStubs: true });
  let file = { xfs: [], sheets: {} };
  if (ext === 'xlsx' || ext === 'xlsm') {
    try {
      file = await readStyles(data, book);
    } catch (e) {
      console.error(e);   // Draw the values without styles.
    }
  }
  const names = book.SheetNames.filter((n, i) => !book.Workbook?.Sheets?.[i]?.Hidden);
  const grid = Object.assign(document.createElement('div'), { className: 'grid', zoom: 1 });
  pinchZoom(grid);
  const tabs = Object.assign(document.createElement('nav'), { className: 'tabs' });
  const pick = (n) => {
    grid.onscroll = null;
    grid.replaceChildren();
    grid.scrollTo(0, 0);
    drawSheet(grid, book.Sheets[n], file.sheets[n] ?? {}, file.xfs);
    for (const b of tabs.children) b.setAttribute('aria-pressed', b.textContent === n);
  };
  for (const n of names) tabs.append(Object.assign(document.createElement('button'), { textContent: n, onclick: () => pick(n) }));
  main.className = 'book';
  main.replaceChildren(grid, ...(names.length > 1 ? [tabs] : []));
  pick(names[0] ?? book.SheetNames[0]);
}

async function readStyles(data, book) {
  const zip = await JSZip.loadAsync(data);
  const text = (path) => zip.file(path)?.async('string');
  const xml = (s) => new DOMParser().parseFromString(s ?? '<x/>', 'application/xml');
  const kids = (el, name) => [...(el?.children ?? [])].filter((k) => k.localName === name);
  const one = (el, name) => kids(el, name)[0];
  const on = (el) => el != null && !/^(0|false|none)$/.test(el.getAttribute('val') ?? '');
  const theme = book.Themes?.themeElements?.clrScheme?.map((c) => c.rgb) ?? [];

  const color = (el) => {
    if (!el) return null;
    const hex = el.getAttribute('rgb')?.slice(-6)
      ?? (el.hasAttribute('theme') ? theme[+el.getAttribute('theme')] : null)
      ?? (el.hasAttribute('indexed') ? INDEXED[+el.getAttribute('indexed')] : null);
    return hex ? '#' + tint(hex, +el.getAttribute('tint') || 0) : null;
  };

  const root = xml(await text('xl/styles.xml')).documentElement;
  const fonts = kids(one(root, 'fonts'), 'font').map((f) => {
    const css = [];
    if (on(one(f, 'b'))) css.push('font-weight:bold');
    if (on(one(f, 'i'))) css.push('font-style:italic');
    const lines = [on(one(f, 'u')) && 'underline', on(one(f, 'strike')) && 'line-through'].filter(Boolean);
    if (lines.length) css.push('text-decoration:' + lines.join(' '));
    const size = one(f, 'sz')?.getAttribute('val');
    if (size) css.push(`font-size:${size}pt`);
    const c = color(one(f, 'color'));
    if (c) css.push('color:' + c);
    const name = one(f, 'name')?.getAttribute('val');
    if (name) css.push(`font-family:"${name.replace(/["\\]/g, '')}",Carlito,Arial,sans-serif`);
    return css.join(';');
  });
  const fills = kids(one(root, 'fills'), 'fill').map((f) => {
    const p = one(f, 'patternFill');
    return p && (p.getAttribute('patternType') ?? 'none') !== 'none' ? color(one(p, 'fgColor')) : null;
  });
  const borders = kids(one(root, 'borders'), 'border').map((b) => {
    const side = (name, alias) => {
      const e = one(b, name) ?? one(b, alias);
      const line = e && BORDER[e.getAttribute('style')];
      return line ? `${line} ${color(one(e, 'color')) ?? '#000'}` : undefined;
    };
    return { left: side('left', 'start'), right: side('right', 'end'), top: side('top'), bottom: side('bottom') };
  });
  const xfs = kids(one(root, 'cellXfs'), 'xf').map((x) => {
    const a = one(x, 'alignment');
    const fill = fills[+x.getAttribute('fillId') || 0];
    const css = [fonts[+x.getAttribute('fontId') || 0], fill && 'background:' + fill];
    const h = a?.getAttribute('horizontal');
    if (h && h !== 'general') css.push('text-align:' + ({ centerContinuous: 'center', fill: 'left', distributed: 'justify' }[h] ?? h));
    const v = a?.getAttribute('vertical') ?? 'bottom';
    css.push('vertical-align:' + ({ center: 'middle', distributed: 'middle', justify: 'middle' }[v] ?? v));
    const indent = +a?.getAttribute('indent') || 0;
    if (indent) css.push(`padding-left:${3 + indent * 9}px`);
    return {
      css: css.filter(Boolean).join(';'),
      fill: !!fill,
      aligned: !!h && h !== 'general',
      wrap: /^(1|true)$/.test(a?.getAttribute('wrapText') ?? ''),
      border: borders[+x.getAttribute('borderId') || 0] ?? {},
    };
  });

  // Find each sheet's XML file: workbook.xml names the sheets, its .rels file gives their paths.
  const target = {};
  for (const r of xml(await text('xl/_rels/workbook.xml.rels')).getElementsByTagName('Relationship'))
    target[r.getAttribute('Id')] = r.getAttribute('Target');
  const sheets = {};
  for (const s of xml(await text('xl/workbook.xml')).getElementsByTagName('sheet')) {
    const id = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
    const path = target[id];
    const src = path && await text(path.startsWith('/') ? path.slice(1) : 'xl/' + path);
    if (src) sheets[s.getAttribute('name')] = readSheet(src);
  }
  return { xfs, sheets };
}

// Reads with regular expressions instead of a full XML parse, because sheets can be very large.
function readSheet(src) {
  const xf = [];     // xf[row][column] = the style number of that cell
  for (const [, attrs] of src.matchAll(/<c\b([^>]*)>/g)) {
    const ref = /\br="([A-Z]+\d+)"/.exec(attrs);
    const s = /\bs="(\d+)"/.exec(attrs);
    if (!ref || !s) continue;   // ponytail: cells without an r="A1" address are drawn without style
    const { r, c } = XLSX.utils.decode_cell(ref[1]);
    (xf[r] ??= [])[c] = +s[1];
  }
  const rowXf = [];  // a style for the whole row, used by its empty cells
  for (const [, attrs] of src.matchAll(/<row\b([^>]*)>/g)) {
    const r = /\br="(\d+)"/.exec(attrs);
    const s = /\bs="(\d+)"/.exec(attrs);
    if (r && s && /customFormat="(1|true)"/.test(attrs)) rowXf[r[1] - 1] = +s[1];
  }
  const pane = /<pane\b[^>]*>/.exec(src)?.[0] ?? '';
  const frozen = /state="frozen/.test(pane);
  const split = (name) => frozen ? Math.round(+(new RegExp(`\\b${name}="([\\d.]+)"`).exec(pane)?.[1] ?? 0)) : 0;
  const format = /<sheetFormatPr\b[^>]*>/.exec(src)?.[0] ?? '';
  return {
    xf, rowXf,
    rows: split('ySplit'), cols: split('xSplit'),
    colWidth: +/defaultColWidth="([\d.]+)"/.exec(format)?.[1] || 8.43,
    rowHeight: +/defaultRowHeight="([\d.]+)"/.exec(format)?.[1] || 15,
  };
}

// Two fingers zoom the grid, not the page, so the letters and numbers stay at the edges.
// The point between the fingers stays in place. (CSS touch-action on .grid turns off the page zoom.)
function pinchZoom(grid) {
  let start = null;
  const gap = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  grid.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) start = { gap: gap(e.touches), zoom: grid.zoom };
  }, { passive: true });
  grid.addEventListener('touchmove', (e) => {
    if (!start || e.touches.length !== 2) return;
    const zoom = Math.min(3, Math.max(0.25, start.zoom * gap(e.touches) / start.gap));
    const box = grid.getBoundingClientRect();
    const x = (e.touches[0].clientX + e.touches[1].clientX) / 2 - box.left;
    const y = (e.touches[0].clientY + e.touches[1].clientY) / 2 - box.top;
    const k = zoom / grid.zoom;
    grid.zoom = zoom;
    grid.firstChild.style.zoom = zoom;
    grid.scrollLeft = (grid.scrollLeft + x) * k - x;
    grid.scrollTop = (grid.scrollTop + y) * k - y;
  }, { passive: true });
  grid.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) start = null;
  });
}

// Excel's tint: makes a theme color lighter (tint > 0) or darker (tint < 0) in HSL.
function tint(hex, t) {
  if (!t) return hex;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = t < 0 ? l * (1 + t) : l * (1 - t) + t;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const ch = (x) => {
    x = (x + 1) % 1;
    const v = x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
    return Math.round((s ? v : l) * 255).toString(16).padStart(2, '0');
  };
  return ch(h + 1 / 3) + ch(h) + ch(h - 1 / 3);
}

function drawSheet(grid, ws, sheet, xfs) {
  const data = ws['!data'] ?? [];
  const cols = ws['!cols'] ?? [];
  const rows = ws['!rows'] ?? [];
  const merges = ws['!merges'] ?? [];

  // The used area, at least as big as a screen of Excel's empty grid.
  let lastRow = Math.max(data.length, 50), lastCol = 26;
  for (const row of data) lastCol = Math.max(lastCol, row?.length ?? 0);
  for (const m of merges) { lastRow = Math.max(lastRow, m.e.r + 1); lastCol = Math.max(lastCol, m.e.c + 1); }
  lastCol = Math.min(lastCol, MAX_COLS);

  const span = [];   // span[r][c]: [rows, cols] for the first cell of a merge, 0 for the cells it covers
  for (const m of merges)
    for (let r = m.s.r; r <= m.e.r; r++)
      for (let c = m.s.c; c <= m.e.c; c++)
        (span[r] ??= [])[c] = r === m.s.r && c === m.s.c ? [m.e.r - m.s.r + 1, m.e.c - m.s.c + 1] : 0;

  const xfAt = (r, c) => {
    const i = sheet.xf?.[r]?.[c] ?? sheet.rowXf?.[r] ?? (cols[c]?.style != null ? +cols[c].style : undefined);
    return xfs[i ?? 0];
  };
  const textAt = (r, c) => {
    const cell = data[r]?.[c];
    return cell?.w ?? (cell?.v != null ? String(cell.v) : '');
  };
  // Excel's widths count characters. Calibri 11 uses 7 px a character plus 5 px of padding.
  const width = (c) => Math.round((cols[c]?.width ?? sheet.colWidth ?? 8.43) * 7 + 5);
  const height = (r) => Math.round((rows[r]?.hpt ?? sheet.rowHeight ?? 15) * 4 / 3);
  const shown = [];
  for (let c = 0; c < lastCol; c++) if (!cols[c]?.hidden) shown.push(c);

  const numbers = Math.max(32, String(lastRow).length * 8 + 14);
  const table = document.createElement('table');
  const group = table.appendChild(document.createElement('colgroup'));
  group.append(Object.assign(document.createElement('col'), { style: `width:${numbers}px` }));
  // Frozen columns stay at the left: each one starts where the previous one ends.
  const left = {};
  let x = numbers;
  for (const c of shown) {
    group.append(Object.assign(document.createElement('col'), { style: `width:${width(c)}px` }));
    if (c < sheet.cols) { left[c] = x; x += width(c); }
  }

  const head = table.createTHead().insertRow();
  head.append(document.createElement('th'));
  for (const c of shown) head.append(Object.assign(document.createElement('th'), { textContent: XLSX.utils.encode_col(c) }));

  const body = table.createTBody();
  let top = HEAD, next = 0;
  const drawRows = () => {
    const end = Math.min(next + CHUNK, lastRow);
    for (; next < end; next++) {
      const r = next;
      if (rows[r]?.hidden) continue;
      const tr = body.insertRow();
      tr.style.height = height(r) + 'px';
      tr.append(Object.assign(document.createElement('th'), { textContent: r + 1 }));
      if (r < sheet.rows) {
        tr.className = 'frozen';
        for (const cell of tr.cells) cell.style.top = top + 'px';
      }
      for (const c of shown) {
        const s = span[r]?.[c];
        if (s === 0) continue;
        const [rs, cs] = s ?? [1, 1];
        const td = tr.insertCell();
        if (rs > 1) td.rowSpan = rs;
        if (cs > 1) td.colSpan = cs;
        const xf = xfAt(r, c);
        td.style.cssText = xf?.css ?? '';
        const cell = data[r]?.[c];
        const text = textAt(r, c);
        const link = cell?.l?.Target;
        if (link && /^https?:/i.test(link)) td.append(Object.assign(document.createElement('a'), { href: link, textContent: text }));
        else td.textContent = text;
        if (!xf?.aligned) td.classList.add({ n: 'right', d: 'right', b: 'center', e: 'center' }[cell?.t] ?? 'left');
        if (xf?.wrap) td.classList.add('wrap');
        // Like Excel, text runs on into the next cell when that cell is empty.
        else if (text && cs === 1 && !textAt(r, c + 1) && span[r]?.[c + 1] == null) td.classList.add('spill');
        // Borders: each cell draws its right and bottom edge. A top or left border set on the
        // neighbor counts too, so a line set on either side of an edge shows.
        const bottom = xfAt(r + rs - 1, c)?.border.bottom ?? xfAt(r + rs, c)?.border.top;
        const right = xfAt(r, c + cs - 1)?.border.right ?? xfAt(r, c + cs)?.border.left;
        if (bottom) td.style.borderBottom = bottom; else if (xf?.fill) td.style.borderBottomColor = 'transparent';
        if (right) td.style.borderRight = right; else if (xf?.fill) td.style.borderRightColor = 'transparent';
        if (r === 0 && xf?.border.top) td.style.borderTop = xf.border.top;
        if (c === 0 && xf?.border.left) td.style.borderLeft = xf.border.left;
        if (c in left) {
          td.classList.add('frozen');
          td.style.left = left[c] + 'px';
        }
        if (r < sheet.rows) td.style.top = top + 'px';
      }
      if (r < sheet.rows) {
        top += height(r);
        if (r === sheet.rows - 1) tr.classList.add('edge');
      }
    }
  };
  drawRows();
  table.style.zoom = grid.zoom;
  grid.append(table);
  grid.onscroll = () => {
    if (next < lastRow && grid.scrollTop + grid.clientHeight > grid.scrollHeight - 1000) drawRows();
  };
}
