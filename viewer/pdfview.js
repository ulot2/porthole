// PDF pages on Android. The app draws pictures of the pages (see MainActivity.page).
// Each page first loads as one picture as sharp as the screen at normal size. When you zoom in and stop,
// showPdf asks for only the part of the page that you see, drawn sharp for that zoom. That keeps text
// sharp at any zoom without huge pictures. The browser itself does the pinch zoom and the scrolling.

async function showPdf(main, sizes) {
  // Up to 10x zoom; the app's WebView zooms with two fingers.
  document.querySelector('meta[name=viewport]').content = 'width=device-width, initial-scale=1, maximum-scale=10';
  const base = Math.round(Math.min(innerWidth - 16, 900) * devicePixelRatio);
  const pages = sizes.map(([width, height], i) => {
    const page = Object.assign(document.createElement('div'), { className: 'page' });
    page.style.aspectRatio = `${width} / ${height}`;
    page.append(Object.assign(new Image(), { src: `page/${i}?w=${base}`, loading: 'lazy', alt: `Page ${i + 1}` }));
    return page;
  });
  const counter = Object.assign(document.createElement('div'), { className: 'counter', hidden: true });
  main.className = 'pages';
  main.replaceChildren(...pages, counter);

  const view = visualViewport;
  let timer, hide;
  const moved = () => {
    // The page under the middle of the screen, shown as "3 / 12" for a moment.
    const middle = view.offsetTop + view.height / 2;
    const now = pages.findIndex((p) => p.getBoundingClientRect().bottom > middle) + 1 || pages.length;
    counter.textContent = `${now} / ${pages.length}`;
    counter.hidden = false;
    // Keep the counter the same size and at the bottom of the screen at any zoom.
    counter.style.transform = `translate(${view.offsetLeft + view.width / 2}px, ${view.offsetTop + view.height - 56 / view.scale}px) scale(${1 / view.scale}) translateX(-50%)`;
    clearTimeout(hide);
    hide = setTimeout(() => { counter.hidden = true; }, 1500);
    clearTimeout(timer);
    timer = setTimeout(sharpen, 250);
  };
  view.addEventListener('resize', moved);
  view.addEventListener('scroll', moved);
  addEventListener('scroll', moved);

  function sharpen() {
    const ratio = view.scale * devicePixelRatio;
    pages.forEach((page, i) => {
      const box = page.getBoundingClientRect();
      const left = Math.max(box.left, view.offsetLeft), right = Math.min(box.right, view.offsetLeft + view.width);
      const top = Math.max(box.top, view.offsetTop), bottom = Math.min(box.bottom, view.offsetTop + view.height);
      const width = Math.round(box.width * ratio);   // the page width in screen pixels at this zoom
      // Not on screen, or the first picture is already sharp enough: no sharp part needed.
      if (right <= left || bottom <= top || width <= base * 1.2) {
        page.querySelector('.sharp')?.remove();
        page.dataset.want = '';
        return;
      }
      const k = width / box.width;   // screen pixels for each CSS pixel
      const [x, y, cw, ch] = [left - box.left, top - box.top, right - left, bottom - top].map((v) => Math.round(v * k));
      const url = `page/${i}?w=${width}&x=${x}&y=${y}&cw=${cw}&ch=${ch}`;
      if (page.dataset.want === url) return;
      page.dataset.want = url;
      const img = new Image();
      img.className = 'sharp';
      img.alt = '';
      Object.assign(img.style, {
        left: `${(100 * x) / width}%`, top: `${(100 * y) / (width * box.height / box.width)}%`,
        width: `${(100 * cw) / width}%`, height: `${(100 * ch) / (width * box.height / box.width)}%`,
      });
      img.onload = () => {
        if (page.dataset.want !== url) return;   // you moved again while it was drawing
        page.querySelector('.sharp')?.remove();
        page.append(img);
      };
      img.src = url;
    });
  }
}
