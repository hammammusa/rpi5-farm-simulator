// Page layout for the documentation PDF. Text is drawn by the browser's canvas
// (correct Arabic shaping and bidi), wrapped and paginated here so tables and
// paragraphs never overlap; every page becomes one image in the PDF.
import { buildPdf, canvasToFlateRgb, type PdfPage, type PdfText } from './pdf';

export type Orientation = 'portrait' | 'landscape';
const A4 = { portrait: [595.28, 841.89], landscape: [841.89, 595.28] } as const;
const M = 40; // margin (pt)
const S = 2.5; // pixels per pt (≈180 dpi)
const SANS = `system-ui, 'Segoe UI', 'Noto Sans Arabic', 'Noto Sans', 'DejaVu Sans', Arial, sans-serif`;
const MONO = `ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace`;
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

export interface Column {
  title: string;
  /** relative width */
  w: number;
  mono?: boolean;
}

export class DocWriter {
  readonly pages: PdfPage[] = [];
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D;
  private measureCtx: CanvasRenderingContext2D;
  private texts: PdfText[] = [];
  private orient: Orientation = 'portrait';
  private y = M;
  pageCount = 0;

  constructor(
    readonly rtl: boolean,
    readonly draw: boolean,
    readonly footer: (n: number) => string,
  ) {
    const c = document.createElement('canvas');
    this.measureCtx = c.getContext('2d')!;
    this.ctx = this.measureCtx;
  }

  get width() {
    return A4[this.orient][0];
  }
  get height() {
    return A4[this.orient][1];
  }
  get inner() {
    return this.width - 2 * M;
  }

  // ---------------------------------------------------------------- pages
  newPage(orient: Orientation = this.orient) {
    this.flush();
    this.orient = orient;
    this.pageCount++;
    this.y = M;
    this.texts = [];
    if (!this.draw) return;
    const c = document.createElement('canvas');
    c.width = Math.round(this.width * S);
    c.height = Math.round(this.height * S);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(S, S);
    ctx.textBaseline = 'alphabetic';
    this.canvas = c;
    this.ctx = ctx;
  }

  private flush() {
    if (!this.pageCount) return;
    const f = this.footer(this.pageCount);
    this.ctx.strokeStyle = '#d4dbe2';
    this.line(M, this.height - M + 10, this.width - M, this.height - M + 10);
    this.text(f, this.rtl ? this.width - M : M, this.height - M + 24, { size: 7.5, color: '#5d6b78', align: this.rtl ? 'right' : 'left' });
    this.text(String(this.pageCount), this.rtl ? M : this.width - M, this.height - M + 24, { size: 7.5, color: '#5d6b78', align: this.rtl ? 'left' : 'right' });
    if (this.draw && this.canvas) {
      this.pages.push({ width: this.width, height: this.height, image: canvasToFlateRgb(this.canvas), texts: this.texts });
      this.canvas.width = this.canvas.height = 0;
      this.canvas = null;
    }
  }

  finish(info: { title: string; subject?: string; lang?: string }) {
    this.flush();
    this.pageCount = 0;
    return buildPdf(this.pages, info);
  }

  private ensure(h: number) {
    // the first page is opened lazily so a document may start with newPage('landscape')
    if (!this.pageCount || this.y + h > this.height - M - 4) this.newPage();
  }
  space(h: number) {
    this.y += h;
  }

  // ---------------------------------------------------------------- primitives
  private font(size: number, weight = 400, mono = false) {
    return `${weight} ${size}px ${mono ? MONO : SANS}`;
  }
  private line(x0: number, y0: number, x1: number, y1: number) {
    if (!this.draw) return;
    this.ctx.beginPath();
    this.ctx.lineWidth = 0.5;
    this.ctx.moveTo(x0, y0);
    this.ctx.lineTo(x1, y1);
    this.ctx.stroke();
  }
  private text(s: string, x: number, y: number, o: { size: number; weight?: number; mono?: boolean; color?: string; align?: CanvasTextAlign; record?: boolean }) {
    if (!this.draw) return;
    const ctx = this.ctx;
    ctx.font = this.font(o.size, o.weight, o.mono);
    ctx.fillStyle = o.color ?? '#1c2630';
    ctx.textAlign = o.align ?? 'left';
    ctx.direction = ARABIC.test(s) ? 'rtl' : 'ltr';
    ctx.fillText(s, x, y);
    if (o.record !== false) {
      const w = ctx.measureText(s).width;
      const left = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
      this.texts.push({ x: left, y, size: o.size, text: s });
    }
  }

  /** wrap text to lines no wider than `width` (word-wise, hard-breaking very long words) */
  wrap(s: string, width: number, size: number, weight = 400, mono = false): string[] {
    const ctx = this.measureCtx;
    ctx.font = this.font(size, weight, mono);
    const out: string[] = [];
    const fits = (t: string) => ctx.measureText(t).width <= width;
    for (const para of String(s ?? '').split('\n')) {
      let line = '';
      for (const token of para.split(/(?<=\s)/)) {
        if (fits((line + token).trimEnd())) {
          line += token;
          continue;
        }
        if (line.trim()) out.push(line.trimEnd());
        // a word wider than the column is broken by characters
        let word = token.trimStart();
        while (!fits(word.trimEnd()) && word.length > 1) {
          let n = 1;
          while (n < word.length && fits(word.slice(0, n + 1))) n++;
          out.push(word.slice(0, n));
          word = word.slice(n);
        }
        line = word;
      }
      out.push(line.trimEnd());
    }
    return out;
  }

  // ---------------------------------------------------------------- blocks
  title(s: string, sub?: string) {
    this.ensure(60);
    const x = this.rtl ? this.width - M : M;
    const align = this.rtl ? 'right' : 'left';
    for (const l of this.wrap(s, this.inner, 22, 700)) {
      this.y += 26;
      this.text(l, x, this.y, { size: 22, weight: 700, align });
    }
    if (sub) {
      this.y += 16;
      this.text(sub, x, this.y, { size: 10, color: '#5d6b78', align });
    }
    this.y += 8;
    if (this.draw) this.ctx.strokeStyle = '#128a63';
    this.line(M, this.y, this.width - M, this.y);
    this.y += 10;
  }

  heading(s: string, level: 1 | 2 = 1) {
    const size = level === 1 ? 14 : 11.5;
    this.ensure(size * 3);
    this.y += level === 1 ? 14 : 8;
    for (const l of this.wrap(s, this.inner, size, 700)) {
      this.y += size * 1.3;
      this.text(l, this.rtl ? this.width - M : M, this.y, { size, weight: 700, color: level === 1 ? '#0d6b4c' : '#1c2630', align: this.rtl ? 'right' : 'left' });
    }
    this.y += 4;
  }

  paragraph(s: string, o: { size?: number; color?: string; indent?: number; bullet?: string; mono?: boolean } = {}) {
    const size = o.size ?? 9.5;
    const indent = o.indent ?? 0;
    const lh = size * 1.4;
    const bw = o.bullet ? size * 1.4 : 0;
    const lines = this.wrap(s, this.inner - indent - bw, size, 400, o.mono);
    lines.forEach((l, i) => {
      this.ensure(lh);
      this.y += lh;
      const x = this.rtl ? this.width - M - indent - bw : M + indent + bw;
      if (o.bullet && i === 0) this.text(o.bullet, this.rtl ? this.width - M - indent : M + indent, this.y, { size, color: '#128a63', align: this.rtl ? 'right' : 'left', record: false });
      this.text(l, x, this.y, { size, color: o.color, mono: o.mono, align: this.rtl ? 'right' : 'left' });
    });
    this.y += size * 0.4;
  }

  list(items: string[], bullet = '•') {
    for (const it of items) this.paragraph(it, { bullet });
  }

  keyValues(rows: [string, string][]) {
    const kw = this.inner * 0.3;
    for (const [k, v] of rows) {
      const lines = this.wrap(v, this.inner - kw - 6, 9.5);
      const h = lines.length * 13.3 + 2;
      this.ensure(h);
      const kx = this.rtl ? this.width - M : M;
      const vx = this.rtl ? this.width - M - kw : M + kw;
      this.text(k, kx, this.y + 13, { size: 9.5, weight: 700, align: this.rtl ? 'right' : 'left' });
      lines.forEach((l, i) => this.text(l, vx, this.y + 13 + i * 13.3, { size: 9.5, align: this.rtl ? 'right' : 'left' }));
      this.y += h;
    }
    this.y += 4;
  }

  /** table with wrapped cells; the header row repeats on every page the table spans */
  table(cols: Column[], rows: string[][], o: { size?: number; zebra?: boolean } = {}) {
    const size = o.size ?? 7.5;
    const lh = size * 1.3;
    const pad = 3;
    const total = cols.reduce((a, c) => a + c.w, 0);
    const widths = cols.map((c) => (c.w / total) * this.inner);
    // column x positions (right-to-left documents start at the right edge)
    const xs: number[] = [];
    let acc = 0;
    for (const w of widths) {
      xs.push(this.rtl ? this.width - M - acc - w : M + acc);
      acc += w;
    }
    const layout = (cells: string[], weight: number) => cells.map((c, i) => this.wrap(c ?? '', widths[i] - 2 * pad, size, weight, cols[i].mono));
    const drawRow = (lines: string[][], h: number, head: boolean, zebra: boolean) => {
      if (this.draw) {
        if (head || zebra) {
          this.ctx.fillStyle = head ? '#ddebe4' : '#f4f6f8';
          this.ctx.fillRect(M, this.y, this.inner, h);
        }
        this.ctx.strokeStyle = '#d4dbe2';
      }
      this.line(M, this.y + h, this.width - M, this.y + h);
      lines.forEach((cell, i) => {
        cell.forEach((l, j) => {
          const rtlCell = this.rtl;
          this.text(l, rtlCell ? xs[i] + widths[i] - pad : xs[i] + pad, this.y + pad + (j + 1) * lh - lh * 0.25, { size, weight: head ? 700 : 400, mono: cols[i].mono && !head, align: rtlCell ? 'right' : 'left' });
        });
      });
      this.y += h;
    };
    const head = layout(
      cols.map((c) => c.title),
      700,
    );
    const headH = Math.max(...head.map((c) => c.length)) * lh + 2 * pad;
    const maxBody = this.height - 2 * M - 8 - headH;
    this.ensure(headH + lh * 2 + 2 * pad);
    drawRow(head, headH, true, false);
    rows.forEach((r, ri) => {
      let lines = layout(r, 400);
      let h = Math.max(1, ...lines.map((c) => c.length)) * lh + 2 * pad;
      if (h > maxBody) {
        // a single row taller than a page: keep what fits and mark the cut
        const keep = Math.floor((maxBody - 2 * pad) / lh) - 1;
        lines = lines.map((c) => (c.length > keep ? [...c.slice(0, keep), '…'] : c));
        h = Math.max(...lines.map((c) => c.length)) * lh + 2 * pad;
      }
      if (this.y + h > this.height - M - 4) {
        this.newPage();
        drawRow(head, headH, true, false);
      }
      drawRow(lines, h, false, !!o.zebra && ri % 2 === 1);
    });
    this.y += 8;
  }

  /** source code block with line numbers; always left-to-right */
  code(name: string, content: string) {
    const size = 7.2;
    const lh = size * 1.35;
    const gutter = 26;
    this.heading(name, 2);
    const lines = content.replace(/\t/g, '    ').split('\n');
    lines.forEach((src, i) => {
      const parts = this.wrap(src || ' ', this.inner - gutter - 6, size, 400, true);
      parts.forEach((p, j) => {
        this.ensure(lh);
        if (this.draw) {
          this.ctx.fillStyle = '#f4f6f8';
          this.ctx.fillRect(M, this.y, this.inner, lh);
        }
        this.y += lh;
        if (j === 0) this.text(String(i + 1), M + gutter - 4, this.y - lh * 0.25, { size, mono: true, color: '#8b98a5', align: 'right', record: false });
        else this.text('↪', M + gutter - 4, this.y - lh * 0.25, { size, color: '#8b98a5', align: 'right', record: false });
        this.text(p, M + gutter + 2, this.y - lh * 0.25, { size, mono: true, align: 'left' });
      });
    });
    this.y += 8;
  }

  /** image fitted into the remaining page (or a new page) */
  image(src: CanvasImageSource, w: number, h: number, caption?: string) {
    if (!this.pageCount) this.newPage();
    const room = caption ? 22 : 8; // keep the caption on the same page as the image
    const full = Math.min(this.inner / w, (this.height - 2 * M - room) / h);
    let k = Math.min(this.inner / w, (this.height - M - room - this.y) / h);
    if (k * h < 120 || k < full * 0.6) {
      this.newPage();
      k = full;
    }
    const dw = w * k;
    const dh = h * k;
    const x = M + (this.inner - dw) / 2;
    if (this.draw) {
      this.ctx.imageSmoothingQuality = 'high';
      this.ctx.drawImage(src, x, this.y, dw, dh);
      this.ctx.strokeStyle = '#d4dbe2';
      this.ctx.strokeRect(x, this.y, dw, dh);
    }
    this.y += dh + 4;
    if (caption) this.paragraph(caption, { size: 8, color: '#5d6b78' });
  }
}

/** Lay the document out twice: once to count pages, once to draw them. */
export async function renderDocument(rtl: boolean, footer: (n: number, total: number) => string, body: (w: DocWriter) => void | Promise<void>, info: { title: string; subject?: string; lang?: string }) {
  const counter = new DocWriter(rtl, false, () => '');
  await body(counter);
  const total = counter.pageCount;
  const w = new DocWriter(rtl, true, (n) => footer(n, total));
  await body(w);
  const pdf = w.finish(info);
  return { pdf, pages: w.pages.length };
}
