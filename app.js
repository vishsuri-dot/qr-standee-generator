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
 * Uses pdf-lib + fontkit + qrcode.js (all from CDN).
 */

const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;

// ---------- constants ----------
const MM = 2.83465;                     // mm to pt
const TEAL = rgb(0x19/255, 0xBE/255, 0xD2/255);
const WHITE = rgb(1, 1, 1);
const DARK  = rgb(0x1A/255, 0x1F/255, 0x2E/255);
const BLACK = rgb(0, 0, 0);

// caches so we only fetch assets once
let assetCache = null;

async function loadAssets() {
  if (assetCache) return assetCache;
  const fetchBytes = async (path) => {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
    return await r.arrayBuffer();
  };
  assetCache = {
    poppinsBold:  await fetchBytes('fonts/Poppins-Bold.ttf'),
    visa:         await fetchBytes('assets/visa.png'),
    mastercard:   await fetchBytes('assets/mastercard.png'),
    amex:         await fetchBytes('assets/amex.png'),
    applepay:     await fetchBytes('assets/applepay.png'),
    gpay:         await fetchBytes('assets/gpay.png'),
    wetravelWhite:await fetchBytes('assets/wetravel-white.png'),
    wetravelTeal: await fetchBytes('assets/wetravel-teal.png'),
  };
  return assetCache;
}

async function generateQrPng(url, errorCorrectionLevel = 'M') {
  // qrcode.js produces a PNG data URL with crisp pixel scaling
  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel,
    margin: 0,
    width: 1000,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ---------- helpers ----------
function fitFontSize(text, font, maxWidth, startSize, minSize = 8) {
  let size = startSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.5;
  }
  return size;
}

function wrapText(text, font, size, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// rounded rect via composed primitives — pdf-lib's drawSvgPath uses a flipped
// Y axis which corrupted the layout. Compose from rect + corner circles.
function drawRoundedRect(page, x, y, w, h, r, color) {
  // two overlapping rectangles for the body (cross shape that fills everything
  // except the 4 corner-radius squares)
  page.drawRectangle({ x: x + r, y, width: w - 2*r, height: h, color });
  page.drawRectangle({ x, y: y + r, width: w, height: h - 2*r, color });
  // 4 corner circles to round the corners
  const corners = [
    [x + r,     y + r],
    [x + w - r, y + r],
    [x + r,     y + h - r],
    [x + w - r, y + h - r],
  ];
  for (const [cx, cy] of corners) {
    page.drawCircle({ x: cx, y: cy, size: r, color });
  }
}

function drawCropMarks(page, ox, oy, w, h) {
  // 4 corners, small ticks outside trim
  const L = 4 * MM, G = 1 * MM, lw = 0.25;
  const corners = [
    [ox,       oy],         // bl
    [ox + w,   oy],         // br
    [ox,       oy + h],     // tl
    [ox + w,   oy + h],     // tr
  ];
  for (const [x, y] of corners) {
    // horizontal tick
    const xDir = (x === ox) ? -1 : 1;
    page.drawLine({
      start: { x: x + xDir * G, y },
      end:   { x: x + xDir * (G + L), y },
      thickness: lw,
      color: BLACK,
    });
    // vertical tick
    const yDir = (y === oy) ? -1 : 1;
    page.drawLine({
      start: { x, y: y + yDir * G },
      end:   { x, y: y + yDir * (G + L) },
      thickness: lw,
      color: BLACK,
    });
  }
}

// drawScaledImage: fit image into box keeping aspect
function drawScaledImage(page, img, cx, cy, maxW, maxH) {
  const aspect = img.width / img.height;
  let dw, dh;
  if (maxW / maxH > aspect) { dh = maxH; dw = maxH * aspect; }
  else                       { dw = maxW; dh = maxW / aspect; }
  page.drawImage(img, { x: cx - dw/2, y: cy - dh/2, width: dw, height: dh });
}

// ==================================================
// A5 STANDEE (148 × 210 mm + 3mm bleed)
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

  // QR (high error correction for resilience)
  const qrBytes = await generateQrPng(url, 'M');
  const qr = await pdf.embedPng(qrBytes);

  // logos
  const visa     = await pdf.embedPng(a.visa);
  const mc       = await pdf.embedPng(a.mastercard);
  const amex     = await pdf.embedPng(a.amex);
  const apay     = await pdf.embedPng(a.applepay);
  const gpay     = await pdf.embedPng(a.gpay);
  const wtTeal   = await pdf.embedPng(a.wetravelTeal);

  // ---- background: full bleed teal top, white bottom ----
  const splitY = OY + A5_H * 0.42;
  page.drawRectangle({ x: 0, y: splitY, width: PAGE_W, height: PAGE_H - splitY, color: TEAL });
  page.drawRectangle({ x: 0, y: 0,      width: PAGE_W, height: splitY,           color: WHITE });

  const M = 12 * MM;
  const innerW = A5_W - 2*M;

  // ---- organizer name (centered) ----
  const nameY = OY + A5_H - 22*MM;
  const nameSize = fitFontSize(orgName, font, innerW, 28, 18);
  const nameW = font.widthOfTextAtSize(orgName, nameSize);
  page.drawText(orgName, {
    x: OX + (A5_W - nameW)/2,
    y: nameY,
    font, size: nameSize, color: WHITE,
  });

  // ---- white rounded QR card straddling split ----
  const cardW = 110 * MM, cardH = 110 * MM;
  const cardX = OX + (A5_W - cardW)/2;
  const cardY = splitY - cardH * 0.30;
  drawRoundedRect(page, cardX, cardY, cardW, cardH, 6*MM, WHITE);

  // QR
  const pad = 8*MM, labelBand = 22*MM;
  const qrBoxH = cardH - pad - labelBand;
  const qrSize = Math.min(cardW - 2*pad, qrBoxH);
  const qrX = cardX + (cardW - qrSize)/2;
  const qrY = cardY + labelBand + (qrBoxH - qrSize)/2;
  page.drawImage(qr, { x: qrX, y: qrY, width: qrSize, height: qrSize });

  // SCAN TO PAY
  const label = 'SCAN TO PAY';
  const labelSize = 16;
  const lw = font.widthOfTextAtSize(label, labelSize);
  page.drawText(label, {
    x: cardX + (cardW - lw)/2,
    y: cardY + 7*MM,
    font, size: labelSize, color: DARK,
  });

  // ---- payment icons row (on white, no pills) ----
  const rowCy = cardY - 20*MM;
  const iconH = 8.5 * MM;
  const capW  = 17 * MM;
  const icons = [
    { img: visa, name: 'visa' },
    { img: mc,   name: 'mc' },
    { img: amex, name: 'amex' },
    { img: apay, name: 'apay' },
    { img: gpay, name: 'gpay' },
  ];
  const widths = icons.map(({img}) => Math.min(iconH * (img.width / img.height), capW));
  const gap = 9 * MM;
  const totalW = widths.reduce((s,w) => s + w, 0) + gap * (icons.length - 1);
  let curX = OX + (A5_W - totalW)/2;
  icons.forEach((ic, i) => {
    const w = widths[i];
    drawScaledImage(page, ic.img, curX + w/2, rowCy, w, iconH);
    curX += w + gap;
  });

  // ---- footer: stacked POWERED BY / wetravel-teal ----
  const footBaseline = OY + 12*MM;
  const weH = 5 * MM;
  const weW = weH * (wtTeal.width / wtTeal.height);
  const cx = OX + A5_W / 2;
  page.drawImage(wtTeal, { x: cx - weW/2, y: footBaseline, width: weW, height: weH });
  const poweredBy = 'POWERED BY';
  const pbSize = 7;
  const pbW = font.widthOfTextAtSize(poweredBy, pbSize);
  page.drawText(poweredBy, {
    x: cx - pbW/2,
    y: footBaseline + weH + 2*MM,
    font, size: pbSize, color: TEAL,
  });

  // crop marks
  drawCropMarks(page, OX, OY, A5_W, A5_H);

  return await pdf.save();
}

// ==================================================
// BUSINESS CARD (85.6 × 54 mm + 3mm bleed)
// V3 design: teal left panel + white QR right, pill badge SCAN TO PAY
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

  // QR (Q-level for denser card format)
  const qrBytes = await generateQrPng(url, 'Q');
  const qr = await pdf.embedPng(qrBytes);
  const wtWhite = await pdf.embedPng(a.wetravelWhite);

  // ---- background ----
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: WHITE });
  // left teal panel extending into bleed
  const panelW = CARD_W * 0.40;
  page.drawRectangle({ x: 0, y: 0, width: OX + panelW, height: PAGE_H, color: TEAL });

  const pad = 3 * MM;
  const nameW = panelW - 2 * pad;
  const nameX = OX + pad;

  // ---- organizer name (white, wrap up to 2 lines) ----
  let size = fitFontSize(orgName.split(/\s+/).reduce((a,b) => a.length > b.length ? a : b), font, nameW, 11, 6.5);
  let lines = wrapText(orgName, font, size, nameW);
  if (lines.length > 3) {
    // shrink further to fit in fewer lines
    size = fitFontSize(orgName, font, nameW, 9, 6.5);
    lines = wrapText(orgName, font, size, nameW);
  }
  const lineH = size * 1.18;
  let y = OY + CARD_H - 6*MM - size;
  for (const ln of lines) {
    page.drawText(ln, { x: nameX, y, font, size, color: WHITE });
    y -= lineH;
  }

  // ---- white pill badge with teal SCAN TO PAY ----
  const cta = 'SCAN TO PAY';
  const ctaSize = 8;
  const tw = font.widthOfTextAtSize(cta, ctaSize);
  const pillH = 5.5 * MM;
  const pillW = tw + 4 * MM;
  const pillX = nameX;
  const pillY = OY + 11 * MM;
  drawRoundedRect(page, pillX, pillY, pillW, pillH, pillH/2, WHITE);
  page.drawText(cta, {
    x: pillX + 2*MM,
    y: pillY + pillH/2 - ctaSize*0.32,
    font, size: ctaSize, color: TEAL,
  });

  // ---- footer: POWERED BY / wetravel-white ----
  const weH = 2.4 * MM;
  const weW = weH * (wtWhite.width / wtWhite.height);
  page.drawImage(wtWhite, { x: nameX, y: OY + 2*MM, width: weW, height: weH });
  page.drawText('POWERED BY', {
    x: nameX, y: OY + 2*MM + weH + 0.4*MM,
    font, size: 3.5, color: WHITE,
  });

  // ---- QR on right side ----
  const qrPad = 3*MM;
  const qrSize = CARD_H - 2*qrPad;
  const qrXOnCard = panelW + ((CARD_W - panelW) - qrSize)/2;
  const qrX = OX + qrXOnCard;
  const qrY = OY + qrPad;
  page.drawImage(qr, { x: qrX, y: qrY, width: qrSize, height: qrSize });

  // crop marks
  drawCropMarks(page, OX, OY, CARD_W, CARD_H);

  return await pdf.save();
}

// ---------- form wiring ----------
const $ = (id) => document.getElementById(id);
const form   = $('form');
const status = $('status');
const button = $('generate');

function safeName(s) {
  return s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'standee';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const format  = $('format').value;
  const orgName = $('orgName').value.trim();
  const url     = $('url').value.trim();

  if (!orgName || !url) {
    status.textContent = 'Please fill out both fields.';
    status.className = 'status error';
    return;
  }

  button.disabled = true;
  button.textContent = 'Generating...';
  status.textContent = 'Building your PDF…';
  status.className = 'status';

  try {
    const bytes = format === 'a5'
      ? await buildA5(orgName, url)
      : await buildCard(orgName, url);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const objectUrl = URL.createObjectURL(blob);

    const suffix = format === 'a5' ? 'A5_Standee' : 'Business_Card';
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `${safeName(orgName)} - ${suffix}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);

    status.textContent = `✓ Downloaded ${a.download}`;
    status.className = 'status success';
  } catch (err) {
    console.error(err);
    status.textContent = `Error: ${err.message || err}`;
    status.className = 'status error';
  } finally {
    button.disabled = false;
    button.textContent = 'Generate PDF';
  }
});
