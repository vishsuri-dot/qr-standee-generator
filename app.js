/*
 * WeTravel QR Standee Generator — client-side PDF generation
 *
 * Mirrors the Python/reportlab design at 1:1 fidelity.
 *
 * A5 standee: split layout (teal top + white bottom), white QR card straddling split,
 *   payment icons row, POWERED BY / wetravel-teal footer.
 * Business card: teal left panel + white right with QR, name top-left, white pill
 *   "SCAN TO PAY" badge, white wetravel footer.
 *
 * Uses pdf-lib + fontkit + qrcode-generator + jszip (all from CDN).
 */

const { PDFDocument, rgb } = PDFLib;

// ---------- constants ----------
const MM = 2.83465;                     // mm to pt
const TEAL  = rgb(0x19/255, 0xBE/255, 0xD2/255);
const WHITE = rgb(1, 1, 1);
const DARK  = rgb(0x1A/255, 0x1F/255, 0x2E/255);
const BLACK = rgb(0, 0, 0);

const URL_PATTERN = /wetravel\.com\/.*popups\/spot_payment_link\?uuid=\d+/i;
const RECENT_KEY  = 'wetravel-qr-recent-v1';
const RECENT_MAX  = 10;

// ---------- asset loader ----------
let assetCache = null;
async function loadAssets() {
  if (assetCache) return assetCache;
  const fetchBytes = async (path) => {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
    return await r.arrayBuffer();
  };
  assetCache = {
    poppinsBold:   await fetchBytes('fonts/Poppins-Bold.ttf'),
    visa:          await fetchBytes('assets/visa.png'),
    mastercard:    await fetchBytes('assets/mastercard.png'),
    amex:          await fetchBytes('assets/amex.png'),
    applepay:      await fetchBytes('assets/applepay.png'),
    gpay:          await fetchBytes('assets/gpay.png'),
    wetravelWhite: await fetchBytes('assets/wetravel-white.png'),
    wetravelTeal:  await fetchBytes('assets/wetravel-teal.png'),
  };
  return assetCache;
}

// ---------- QR generation (qrcode-generator) ----------
function generateQrPngSync(url, errorCorrectionLevel = 'M') {
  const qr = qrcode(0, errorCorrectionLevel);
  qr.addData(url);
  qr.make();
  const moduleCount = qr.getModuleCount();
  const cellSize = 16;
  const size = moduleCount * cellSize;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
  }
  const dataUrl = canvas.toDataURL('image/png');
  const b64 = dataUrl.split(',')[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// ---------- text + layout helpers ----------
function fitFontSize(text, font, maxWidth, startSize, minSize = 8) {
  let s = startSize;
  while (s > minSize && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5;
  return s;
}

function wrapText(text, font, size, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) cur = test;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawRoundedRect(page, x, y, w, h, r, color) {
  page.drawRectangle({ x: x + r, y, width: w - 2*r, height: h, color });
  page.drawRectangle({ x, y: y + r, width: w, height: h - 2*r, color });
  for (const [cx, cy] of [[x+r,y+r], [x+w-r,y+r], [x+r,y+h-r], [x+w-r,y+h-r]]) {
    page.drawCircle({ x: cx, y: cy, size: r, color });
  }
}

function drawCropMarks(page, ox, oy, w, h) {
  const L = 4 * MM, G = 1 * MM, lw = 0.25;
  const corners = [[ox, oy], [ox+w, oy], [ox, oy+h], [ox+w, oy+h]];
  for (const [x, y] of corners) {
    const xDir = (x === ox) ? -1 : 1;
    const yDir = (y === oy) ? -1 : 1;
    page.drawLine({ start: { x: x + xDir*G, y }, end: { x: x + xDir*(G+L), y }, thickness: lw, color: BLACK });
    page.drawLine({ start: { x, y: y + yDir*G }, end: { x, y: y + yDir*(G+L) }, thickness: lw, color: BLACK });
  }
}

function drawScaledImage(page, img, cx, cy, maxW, maxH) {
  const aspect = img.width / img.height;
  let dw, dh;
  if (maxW / maxH > aspect) { dh = maxH; dw = maxH * aspect; }
  else                       { dw = maxW; dh = maxW / aspect; }
  page.drawImage(img, { x: cx - dw/2, y: cy - dh/2, width: dw, height: dh });
}

// ==================================================
// A5 STANDEE — unchanged design from the original
// ==================================================
async function buildA5(orgName, url) {
  const A5_W = 148 * MM, A5_H = 210 * MM;
  const BLEED = 3 * MM;
  const PAGE_W = A5_W + 2*BLEED, PAGE_H = A5_H + 2*BLEED;
  const OX = BLEED, OY = BLEED;

  const a = await loadAssets();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(a.poppinsBold);
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  const qr     = await pdf.embedPng(generateQrPngSync(url, 'M'));
  const visa   = await pdf.embedPng(a.visa);
  const mc     = await pdf.embedPng(a.mastercard);
  const amex   = await pdf.embedPng(a.amex);
  const apay   = await pdf.embedPng(a.applepay);
  const gpay   = await pdf.embedPng(a.gpay);
  const wtTeal = await pdf.embedPng(a.wetravelTeal);

  const splitY = OY + A5_H * 0.42;
  page.drawRectangle({ x: 0, y: splitY, width: PAGE_W, height: PAGE_H - splitY, color: TEAL });
  page.drawRectangle({ x: 0, y: 0,      width: PAGE_W, height: splitY,           color: WHITE });

  const M = 12 * MM, innerW = A5_W - 2*M;
  const nameY = OY + A5_H - 22*MM;
  const nameSize = fitFontSize(orgName, font, innerW, 28, 18);
  const nameW = font.widthOfTextAtSize(orgName, nameSize);
  page.drawText(orgName, { x: OX + (A5_W - nameW)/2, y: nameY, font, size: nameSize, color: WHITE });

  const cardW = 110 * MM, cardH = 110 * MM;
  const cardX = OX + (A5_W - cardW)/2;
  const cardY = splitY - cardH * 0.30;
  drawRoundedRect(page, cardX, cardY, cardW, cardH, 6*MM, WHITE);

  const pad = 8*MM, labelBand = 22*MM;
  const qrBoxH = cardH - pad - labelBand;
  const qrSize = Math.min(cardW - 2*pad, qrBoxH);
  const qrX = cardX + (cardW - qrSize)/2;
  const qrY = cardY + labelBand + (qrBoxH - qrSize)/2;
  page.drawImage(qr, { x: qrX, y: qrY, width: qrSize, height: qrSize });

  const label = 'SCAN TO PAY', labelSize = 16;
  const lw = font.widthOfTextAtSize(label, labelSize);
  page.drawText(label, { x: cardX + (cardW - lw)/2, y: cardY + 7*MM, font, size: labelSize, color: DARK });

  const rowCy = cardY - 20*MM, iconH = 8.5 * MM, capW = 17 * MM;
  const icons = [visa, mc, amex, apay, gpay];
  const widths = icons.map(img => Math.min(iconH * (img.width / img.height), capW));
  const gap = 9 * MM;
  const totalW = widths.reduce((s,w) => s + w, 0) + gap * (icons.length - 1);
  let curX = OX + (A5_W - totalW)/2;
  icons.forEach((img, i) => {
    drawScaledImage(page, img, curX + widths[i]/2, rowCy, widths[i], iconH);
    curX += widths[i] + gap;
  });

  const footBaseline = OY + 12*MM;
  const weH = 5 * MM, weW = weH * (wtTeal.width / wtTeal.height);
  const cx = OX + A5_W / 2;
  page.drawImage(wtTeal, { x: cx - weW/2, y: footBaseline, width: weW, height: weH });
  const pbW = font.widthOfTextAtSize('POWERED BY', 7);
  page.drawText('POWERED BY', { x: cx - pbW/2, y: footBaseline + weH + 2*MM, font, size: 7, color: TEAL });

  drawCropMarks(page, OX, OY, A5_W, A5_H);

  return await pdf.save();
}

// ==================================================
// BUSINESS CARD — unchanged design (V3 pill badge)
// ==================================================
async function buildCard(orgName, url) {
  const CARD_W = 85.6 * MM, CARD_H = 54 * MM;
  const BLEED  = 3 * MM;
  const PAGE_W = CARD_W + 2*BLEED, PAGE_H = CARD_H + 2*BLEED;
  const OX = BLEED, OY = BLEED;

  const a = await loadAssets();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(a.poppinsBold);
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  const qr      = await pdf.embedPng(generateQrPngSync(url, 'Q'));
  const wtWhite = await pdf.embedPng(a.wetravelWhite);

  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: WHITE });
  const panelW = CARD_W * 0.40;
  page.drawRectangle({ x: 0, y: 0, width: OX + panelW, height: PAGE_H, color: TEAL });

  const pad = 3 * MM;
  const nameW = panelW - 2 * pad;
  const nameX = OX + pad;

  let size = fitFontSize(orgName.split(/\s+/).reduce((a,b) => a.length > b.length ? a : b), font, nameW, 11, 6.5);
  let lines = wrapText(orgName, font, size, nameW);
  if (lines.length > 3) {
    size = fitFontSize(orgName, font, nameW, 9, 6.5);
    lines = wrapText(orgName, font, size, nameW);
  }
  const lineH = size * 1.18;
  let y = OY + CARD_H - 6*MM - size;
  for (const ln of lines) {
    page.drawText(ln, { x: nameX, y, font, size, color: WHITE });
    y -= lineH;
  }

  const cta = 'SCAN TO PAY', ctaSize = 8;
  const tw = font.widthOfTextAtSize(cta, ctaSize);
  const pillH = 5.5 * MM;
  const pillW = tw + 4 * MM;
  const pillX = nameX;
  const pillY = OY + 11 * MM;
  drawRoundedRect(page, pillX, pillY, pillW, pillH, pillH/2, WHITE);
  page.drawText(cta, { x: pillX + 2*MM, y: pillY + pillH/2 - ctaSize*0.32, font, size: ctaSize, color: TEAL });

  const weH = 2.4 * MM, weW = weH * (wtWhite.width / wtWhite.height);
  page.drawImage(wtWhite, { x: nameX, y: OY + 2*MM, width: weW, height: weH });
  page.drawText('POWERED BY', { x: nameX, y: OY + 2*MM + weH + 0.4*MM, font, size: 3.5, color: WHITE });

  const qrPad = 3*MM;
  const qrSize = CARD_H - 2*qrPad;
  const qrX = OX + panelW + ((CARD_W - panelW) - qrSize)/2;
  const qrY = OY + qrPad;
  page.drawImage(qr, { x: qrX, y: qrY, width: qrSize, height: qrSize });

  drawCropMarks(page, OX, OY, CARD_W, CARD_H);

  return await pdf.save();
}

// ---------- utility ----------
const $ = (id) => document.getElementById(id);
const safeName = (s) => (s || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'standee';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function downloadBlob(bytes, filename, mime = 'application/pdf') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function buildByFormat(format, orgName, url) {
  return format === 'a5' ? await buildA5(orgName, url) : await buildCard(orgName, url);
}

// ---------- URL validation ----------
function checkUrl() {
  const url = $('url').value.trim();
  const warn = $('urlWarning');
  warn.hidden = !url || URL_PATTERN.test(url);
}

// ---------- live preview ----------
let lastPreviewBlobUrl = null;
async function renderPreview() {
  const mode = currentMode();
  const format = $('format').value;
  $('previewWrap').className = `preview-frame-wrap ${format === 'a5' ? 'a5' : 'card'}`;

  let orgName, url;
  if (mode === 'single') {
    orgName = $('orgName').value.trim();
    url     = $('url').value.trim();
  } else {
    const rows = parseCsv($('batchInput').value);
    if (rows.length === 0) { hidePreview(); return; }
    ({ orgName, url } = rows[0]);
  }

  if (!orgName || !url) { hidePreview(); return; }

  $('previewSpinner').hidden = false;
  $('previewEmpty').hidden = true;
  try {
    const bytes = await buildByFormat(format, orgName, url);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    if (lastPreviewBlobUrl) URL.revokeObjectURL(lastPreviewBlobUrl);
    lastPreviewBlobUrl = URL.createObjectURL(blob);
    const frame = $('previewFrame');
    // append #toolbar=0 to suppress PDF toolbar where supported
    frame.src = lastPreviewBlobUrl + '#toolbar=0&navpanes=0';
    frame.hidden = false;
  } catch (e) {
    console.error('Preview error:', e);
    hidePreview('Could not render preview');
  } finally {
    $('previewSpinner').hidden = true;
  }
}
function hidePreview(msg = 'Fill the form to see a preview') {
  $('previewFrame').hidden = true;
  $('previewFrame').src = 'about:blank';
  const empty = $('previewEmpty');
  empty.hidden = false;
  empty.firstElementChild.textContent = msg;
}
const renderPreviewDebounced = debounce(renderPreview, 500);

// ---------- recent generations ----------
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
  catch { return []; }
}
function saveRecent(entry) {
  let list = loadRecent();
  // de-dup by orgName+url+format (latest wins, moved to top)
  list = list.filter(x => !(x.orgName === entry.orgName && x.url === entry.url && x.format === entry.format));
  list.unshift({ ...entry, timestamp: Date.now() });
  list = list.slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  renderRecentList();
}
function clearRecent() {
  localStorage.removeItem(RECENT_KEY);
  renderRecentList();
}
function renderRecentList() {
  const list = loadRecent();
  const root = $('recentList');
  const count = $('recentCount');
  count.textContent = list.length;
  count.hidden = list.length === 0;
  if (list.length === 0) {
    root.innerHTML = '<p class="recent-empty">Standees you generate will show up here.</p>';
    return;
  }
  root.innerHTML = list.map((item, i) => `
    <div class="recent-item">
      <span class="recent-name" title="${escapeHtml(item.orgName)}">${escapeHtml(item.orgName)}</span>
      <span class="recent-format">${item.format === 'a5' ? 'A5' : 'Card'}</span>
      <button class="recent-redownload" data-i="${i}" type="button">Re-download</button>
    </div>
  `).join('');
  root.querySelectorAll('.recent-redownload').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = +btn.dataset.i;
      const item = loadRecent()[i];
      if (!item) return;
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = '…';
      try {
        const bytes = await buildByFormat(item.format, item.orgName, item.url);
        downloadBlob(bytes, `${safeName(item.orgName)} - ${item.format === 'a5' ? 'A5_Standee' : 'Business_Card'}.pdf`);
      } catch (e) { console.error(e); }
      btn.disabled = false;
      btn.textContent = orig;
    });
  });
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ---------- CSV parsing ----------
function parseCsv(raw) {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // skip header
    if (i === 0 && /^organizer[_ ]?name\s*,\s*url/i.test(line)) continue;
    // split on first comma only — keeps commas in URLs (rare) intact
    const idx = line.indexOf(',');
    if (idx === -1) {
      out.push({ orgName: '', url: '', line: i + 1, error: 'Missing comma' });
      continue;
    }
    const orgName = line.slice(0, idx).trim().replace(/^"|"$/g, '');
    const url     = line.slice(idx + 1).trim().replace(/^"|"$/g, '');
    if (!orgName || !url) {
      out.push({ orgName, url, line: i + 1, error: 'Missing name or URL' });
      continue;
    }
    out.push({ orgName, url, line: i + 1 });
  }
  return out;
}

// ---------- tab switching ----------
function currentMode() {
  return document.querySelector('.tab.active').dataset.mode;
}
function setMode(mode) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('singleForm').hidden = mode !== 'single';
  $('batchForm').hidden  = mode !== 'batch';
  renderPreview();
}

// ---------- handlers ----------
function setupSingle() {
  const form    = $('singleForm');
  const button  = $('generate');
  const status  = $('status');
  const orgName = $('orgName');
  const url     = $('url');

  url.addEventListener('input', () => { checkUrl(); renderPreviewDebounced(); });
  url.addEventListener('blur', checkUrl);
  orgName.addEventListener('input', renderPreviewDebounced);
  $('format').addEventListener('change', () => { renderPreview(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const format = $('format').value;
    const orgVal = orgName.value.trim();
    const urlVal = url.value.trim();
    if (!orgVal || !urlVal) {
      status.textContent = 'Please fill both fields.';
      status.className = 'status error';
      return;
    }
    button.disabled = true; button.innerHTML = 'Generating…';
    status.textContent = 'Building your PDF…'; status.className = 'status';
    try {
      const bytes = await buildByFormat(format, orgVal, urlVal);
      const filename = `${safeName(orgVal)} - ${format === 'a5' ? 'A5_Standee' : 'Business_Card'}.pdf`;
      downloadBlob(bytes, filename);
      saveRecent({ format, orgName: orgVal, url: urlVal });
      status.textContent = `✓ Downloaded ${filename}`;
      status.className = 'status success';
    } catch (err) {
      console.error(err);
      status.textContent = `Error: ${err.message || err}`;
      status.className = 'status error';
    } finally {
      button.disabled = false;
      button.innerHTML = 'Generate PDF <span class="kbd">⌘ ↵</span>';
    }
  });
}

function setupBatch() {
  const form     = $('batchForm');
  const input    = $('batchInput');
  const button   = $('batchGenerate');
  const status   = $('batchStatus');
  const track    = $('progressTrack');
  const fill     = $('progressFill');

  input.addEventListener('input', renderPreviewDebounced);
  $('format').addEventListener('change', () => { renderPreview(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rows = parseCsv(input.value);
    const valid   = rows.filter(r => !r.error);
    const invalid = rows.filter(r =>  r.error);
    if (valid.length === 0) {
      status.textContent = 'No valid rows found. Each line must be "name, url".';
      status.className = 'status error';
      return;
    }
    const format = $('format').value;

    button.disabled = true; button.innerHTML = 'Generating…';
    track.hidden = false; fill.style.width = '0%';
    status.className = 'status';

    const zip = new JSZip();
    const fmtSuffix = format === 'a5' ? 'A5_Standee' : 'Business_Card';
    let done = 0, failed = [];

    for (const r of valid) {
      status.textContent = `Generating ${done + 1} of ${valid.length} — ${r.orgName}`;
      try {
        const bytes = await buildByFormat(format, r.orgName, r.url);
        zip.file(`${safeName(r.orgName)} - ${fmtSuffix}.pdf`, bytes);
      } catch (e) {
        console.error('Row failed:', r, e);
        failed.push({ ...r, msg: e.message || String(e) });
      }
      done++;
      fill.style.width = `${(done / valid.length) * 100}%`;
      await sleep(0); // yield so UI updates
    }

    try {
      status.textContent = 'Zipping…';
      const blob = await zip.generateAsync({ type: 'blob' });
      const filename = `QR_Standees_${format === 'a5' ? 'A5' : 'Cards'}_${valid.length}.zip`;
      downloadBlob(blob, filename, 'application/zip');

      const okCount = valid.length - failed.length;
      const skipped = invalid.length + failed.length;
      let msg = `✓ Downloaded ${filename} (${okCount} standees)`;
      if (skipped > 0) {
        const details = [
          ...invalid.map(r => `line ${r.line}: ${r.error}`),
          ...failed.map(r => `line ${r.line}: ${r.msg}`),
        ];
        msg += `\n${skipped} skipped:\n  ` + details.join('\n  ');
      }
      status.textContent = msg;
      status.className = 'status ' + (failed.length || invalid.length ? '' : 'success');
    } catch (err) {
      console.error(err);
      status.textContent = `Error: ${err.message || err}`;
      status.className = 'status error';
    } finally {
      button.disabled = false;
      button.innerHTML = 'Generate ZIP <span class="kbd">⌘ ↵</span>';
      setTimeout(() => { track.hidden = true; }, 1200);
    }
  });
}

function setupKeyboardShortcut() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      const form = currentMode() === 'single' ? $('singleForm') : $('batchForm');
      form.requestSubmit();
    }
  });
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
}

function setupRecent() {
  $('recentClear').addEventListener('click', () => {
    if (confirm('Clear all recent items?')) clearRecent();
  });
  renderRecentList();
}

// ---------- init ----------
function init() {
  setupTabs();
  setupSingle();
  setupBatch();
  setupKeyboardShortcut();
  setupRecent();
  hidePreview();
}
init();
