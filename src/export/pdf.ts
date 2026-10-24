// Minimal PDF 1.4 writer. Each page is one lossless (Flate/RGB) image rendered by
// the browser — that is what makes Arabic shaping and right-to-left text exact —
// plus an invisible text layer (Helvetica, WinAnsi) for Latin text so the
// document stays searchable and copyable.
import { zlibSync } from 'fflate';

export interface PdfText {
  x: number;
  y: number; // baseline, from the top of the page (pt)
  size: number;
  text: string;
}

export interface PdfPage {
  width: number; // pt
  height: number; // pt
  image: { w: number; h: number; rgb: Uint8Array /* zlib-compressed RGB */ };
  texts: PdfText[];
}

const enc = new TextEncoder();

/** RGBA pixels of a canvas → zlib-compressed RGB for /FlateDecode */
export function canvasToFlateRgb(canvas: HTMLCanvasElement): PdfPage['image'] {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    // composite on white (transparent pixels)
    const a = px[i + 3] / 255;
    rgb[j] = px[i] * a + 255 * (1 - a);
    rgb[j + 1] = px[i + 1] * a + 255 * (1 - a);
    rgb[j + 2] = px[i + 2] * a + 255 * (1 - a);
  }
  return { w, h, rgb: zlibSync(rgb, { level: 6 }) };
}

/** text that Helvetica/WinAnsi can carry: printable ASCII plus a few Latin-1 symbols */
export const pdfTextable = (s: string) => /^[\x20-\x7e°±µ·×]*$/.test(s);

const pdfString = (s: string) => {
  let out = '(';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (c < 0x20 || c > 0xff) out += '?';
    else if (c > 0x7e) out += '\\' + c.toString(8).padStart(3, '0');
    else out += ch;
  }
  return out + ')';
};

const infoString = (s: string) => {
  // UTF-16BE with BOM so titles in Arabic survive in the document properties
  let hex = 'FEFF';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else hex += cp.toString(16).padStart(4, '0');
  }
  return `<${hex.toUpperCase()}>`;
};

export function buildPdf(pages: PdfPage[], info: { title: string; subject?: string; lang?: string; date?: Date }): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const write = (d: string | Uint8Array) => {
    const b = typeof d === 'string' ? enc.encode(d) : d;
    chunks.push(b);
    pos += b.length;
  };
  write('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const obj = (n: number, body: string | (() => void)) => {
    offsets[n] = pos;
    write(`${n} 0 obj\n`);
    if (typeof body === 'string') write(body);
    else body();
    write('\nendobj\n');
  };
  // 1 catalog, 2 pages, 3 font, 4 info, then 3 objects per page
  const first = 5;
  const kids = pages.map((_, i) => `${first + i * 3} 0 R`).join(' ');
  obj(1, `<< /Type /Catalog /Pages 2 0 R${info.lang ? ` /Lang (${info.lang})` : ''} >>`);
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const d = info.date ?? new Date();
  const pd = `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
  obj(4, `<< /Title ${infoString(info.title)}${info.subject ? ` /Subject ${infoString(info.subject)}` : ''} /Producer (Raspberry Pi 5 Virtual Electronics & Smart Farming Simulator) /CreationDate (${pd}) >>`);
  pages.forEach((p, i) => {
    const n = first + i * 3;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.width.toFixed(2)} ${p.height.toFixed(2)}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> /Font << /F1 3 0 R >> >> /Contents ${n + 2} 0 R >>`);
    obj(n + 1, () => {
      write(`<< /Type /XObject /Subtype /Image /Width ${p.image.w} /Height ${p.image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${p.image.rgb.length} >>\nstream\n`);
      write(p.image.rgb);
      write('\nendstream');
    });
    // content stream kept uncompressed: the invisible text stays greppable by tests and tools
    let content = `q ${p.width.toFixed(2)} 0 0 ${p.height.toFixed(2)} 0 0 cm /Im0 Do Q\n`;
    const texts = p.texts.filter((t) => t.text.trim() && pdfTextable(t.text));
    if (texts.length) {
      content += 'BT 3 Tr\n';
      for (const t of texts) content += `/F1 ${t.size.toFixed(1)} Tf 1 0 0 1 ${t.x.toFixed(2)} ${(p.height - t.y).toFixed(2)} Tm ${pdfString(t.text)} Tj\n`;
      content += 'ET\n';
    }
    const body = enc.encode(content);
    obj(n + 2, () => {
      write(`<< /Length ${body.length} >>\nstream\n`);
      write(body);
      write('\nendstream');
    });
  });
  const xref = pos;
  const count = first + pages.length * 3;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  write(x);
  write(`trailer\n<< /Size ${count} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
