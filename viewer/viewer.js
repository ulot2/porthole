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
    await showPdf(main, await (await get('pdf')).json());   // see pdfview.js
  },

  async word() {
    // Word saves where each page ended; using those breaks gives the same pages as Word.
    // "experimental" turns on tab stops (text aligned with the Tab key).
    const options = { ignoreLastRenderedPageBreak: false, experimental: true };
    const doc = await docx.parseAsync(await (await get('file')).blob(), options);
    markPageFields(doc);
    main.className = 'word';
    main.replaceChildren(...await docx.renderDocument(doc, options));
    fillPageFields();
    // Lay the page out at full paper width and let the phone scale the view to fit, like a desktop
    // website. Shrinking the page with CSS instead breaks the tab stops, which are measured on screen.
    const width = Math.max(...[...main.querySelectorAll('section.docx')].map((s) => s.offsetWidth));
    if (width > 0 && screen.width < width + 16)
      document.querySelector('meta[name=viewport]').content = `width=${width + 16}, initial-scale=${screen.width / (width + 16)}`;
  },

  async sheet() {
    await showSheet(main, await (await get('file')).arrayBuffer(), ext);   // see sheet.js
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

// Headers and footers keep the page number that Word saved last ("Page 1 of 2" on every page).
// Swap the saved value of each PAGE and NUMPAGES field for a marker, then fill in the real numbers
// once the pages exist.
const PAGE = '', PAGES = '';

function markPageFields(doc) {
  const marker = (instruction) => {
    const name = instruction.trim().split(/\s+/)[0].toUpperCase();
    return name === 'PAGE' ? PAGE : name === 'NUMPAGES' || name === 'SECTIONPAGES' ? PAGES : null;
  };
  for (const part of doc.parts) {
    if (!/header|footer/.test(part.path)) continue;
    let code = '', inResult = false, mark = null;
    const walk = (el) => {
      if (el.type === 'complexField') {
        if (el.charType === 'begin') code = '';
        if (el.charType === 'separate') { inResult = true; mark = marker(code); }
        if (el.charType === 'end') { inResult = false; mark = null; }
      } else if (el.type === 'instruction') {
        code += el.text;
      } else if (el.type === 'simpleField') {
        mark = marker(el.instruction ?? '');
        inResult = true;
        el.children?.forEach(walk);
        inResult = false;
        return;
      } else if (el.type === 'text' && inResult && mark) {
        el.text = mark;   // the first piece of the saved value becomes the marker
        mark = '';        // the rest of the saved value is removed
      } else if (el.type === 'text' && inResult && mark === '') {
        el.text = '';
      }
      el.children?.forEach(walk);
    };
    walk(part.rootElement);
  }
}

function fillPageFields() {
  const pages = main.querySelectorAll('section.docx');
  pages.forEach((page, i) => {
    for (const part of page.querySelectorAll('header, footer')) {
      const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const t = walker.currentNode;
        if (t.data.includes(PAGE) || t.data.includes(PAGES))
          t.data = t.data.replaceAll(PAGE, i + 1).replaceAll(PAGES, pages.length);
      }
    }
  });
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
