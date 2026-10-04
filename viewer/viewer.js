// Shows one file. The app (Android or Windows) serves this page from inside itself, and serves the
// open file at "file". On Android it also serves the PDF page sizes at "pdf" and each page as a
// picture at "page/<number>" (Windows shows PDFs in Edge's own viewer instead).
const name = new URLSearchParams(location.search).get('name') ?? '';
const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
const main = document.querySelector('main');

const kinds = {
  pdf: 'pdf',
  docx: 'word', docm: 'word', dotx: 'word',
  xlsx: 'sheet', xlsm: 'sheet', xls: 'sheet', ods: 'sheet', csv: 'sheet', tsv: 'sheet',
  txt: 'text', md: 'text', log: 'text', json: 'text', xml: 'text', ini: 'text', yml: 'text', yaml: 'text',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', avif: 'image',
};

async function get(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r;
}

const show = {
  async pdf() {
    const sizes = await (await get('pdf')).json();
    main.className = 'pages';
    // The width and height make each page take its place before its picture loads.
    main.replaceChildren(...sizes.map(([width, height], i) =>
      Object.assign(new Image(width, height), { src: `page/${i}`, loading: 'lazy', alt: `Page ${i + 1}` })));
  },

  async word() {
    main.className = 'word';
    main.replaceChildren();
    await docx.renderAsync(await (await get('file')).blob(), main, null, { ignoreLastRenderedPageBreak: true });
    fit();
    addEventListener('resize', fit);
  },

  // ponytail: draws the whole sheet at once; very large sheets (100,000+ rows) will be slow.
  async sheet() {
    const book = XLSX.read(await (await get('file')).arrayBuffer(), { dense: true });
    const tabs = Object.assign(document.createElement('nav'), { className: 'tabs' });
    const sheet = Object.assign(document.createElement('div'), { className: 'sheet' });
    const pick = (n) => {
      sheet.innerHTML = XLSX.utils.sheet_to_html(book.Sheets[n], { header: '', footer: '' });
      for (const b of tabs.children) b.setAttribute('aria-pressed', b.textContent === n);
    };
    for (const n of book.SheetNames)
      tabs.append(Object.assign(document.createElement('button'), { textContent: n, onclick: () => pick(n) }));
    main.className = '';
    main.replaceChildren(...(book.SheetNames.length > 1 ? [tabs] : []), sheet);
    pick(book.SheetNames[0]);
  },

  async text() {
    main.className = '';
    main.replaceChildren(Object.assign(document.createElement('pre'), { textContent: await (await get('file')).text() }));
  },

  async image() {
    const img = Object.assign(new Image(), { src: 'file', alt: name });
    await img.decode();
    main.className = 'image';
    main.replaceChildren(img);
  },
};

// Word pages have a fixed paper width. Shrink them to fit a phone screen; pinch to zoom in.
function fit() {
  const wrapper = main.querySelector('.docx-wrapper');
  const page = wrapper?.querySelector('section');
  if (!page) return;
  wrapper.style.zoom = 1;
  wrapper.style.zoom = Math.min(1, document.documentElement.clientWidth / (page.offsetWidth + 16));
}

function message(text) {
  main.className = '';
  main.replaceChildren(Object.assign(document.createElement('p'), { className: 'message', textContent: text }));
}

if (!name) message('Open a file to see it here. You can also drag a file into this window.');
else if (!kinds[ext]) message(ext ? `Porthole cannot show .${ext} files yet.` : 'Porthole cannot find the type of this file.');
else show[kinds[ext]]().catch((e) => {
  console.error(e);
  message('Porthole could not open this file. It may be damaged, or protected with a password.');
});
