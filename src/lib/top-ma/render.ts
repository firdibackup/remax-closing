import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { parse, type Font } from "opentype.js";
import spec from "@/lib/top-ma/assets/top10.json";
import { fitFontSize } from "@/lib/top-ma/format";

// Poster Top 10 MA (4018×5440) dari template desainer: src/lib/top-ma/assets (salinan "Template Layout Top MA").
// Semua posisi dari top10.json (layout-spec.json bagian top10). Urutan layer: background → foto → medali → plat → teks.
// Teks diubah jadi path (opentype.js + Montserrat) supaya lebar bisa diukur dan hasil tidak bergantung font server.

const ASSET_DIR = path.join(process.cwd(), "src/lib/top-ma/assets");
const { width: W, height: H } = spec.canvas;

export type PosterSlot = { name: string; office: string; photo: Buffer | null };
export type PosterInput = { month: string; slots: PosterSlot[] };

type Assets = { bold: Font; regular: Font; files: Map<string, string> };
let assets: Assets | null = null;

const dataUri = (buf: Buffer, mime: string) => `data:${mime};base64,${buf.toString("base64")}`;
const mimeOf = (p: string) => (p.endsWith(".png") ? "image/png" : "image/jpeg");
function loadFont(file: string): Font {
  const b = readFileSync(path.join(ASSET_DIR, "fonts", file));
  return parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

function loadAssets(): Assets {
  if (assets) return assets;
  const hrefs = [spec.background, "assets/photo-placeholder.png", ...spec.slots.flatMap((s) => [s.medal.href, ...("plate" in s && s.plate ? [s.plate.href] : [])])];
  const files = new Map(hrefs.map((h) => [h, dataUri(readFileSync(path.join(ASSET_DIR, h.replace(/^assets\//, ""))), mimeOf(h))]));
  assets = { bold: loadFont("Montserrat-Bold.ttf"), regular: loadFont("Montserrat-Regular.ttf"), files };
  return assets;
}

const n = (v: number) => Math.round(v * 100) / 100;

type TextSpec = { x: number; y: number; fontSize: number; maxWidth: number; color: string; weight: number; letterSpacing?: number };

// Teks rata tengah di (x, baseline y). Huruf yang tidak ada di font diganti spasi oleh opentype (bukan kotak).
function textPath(font: Font, text: string, t: TextSpec): string {
  const clean = text.trim();
  if (!clean) return "";
  const spacingPx = t.letterSpacing ?? 0;
  const opts = (size: number) => ({ kerning: true, letterSpacing: spacingPx / size });
  // letter-spacing ditambahkan setelah setiap huruf, termasuk huruf terakhir; dikurangi supaya tengahnya pas.
  const widthAt = (size: number) => font.getAdvanceWidth(clean, size, opts(size)) - spacingPx;
  const size = fitFontSize(t.fontSize, t.maxWidth, widthAt);
  const x = t.x - widthAt(size) / 2;
  const d = font.getPath(clean, x, t.y, size, opts(size)).toPathData(1);
  return `<path d="${d}" fill="${t.color}"/>`;
}

type Box = { x: number; y: number; w: number; h: number };

// Foto menutupi kotak foto dan menempel ke atas (xMidYMin slice, sama dengan SVG template); sisanya dipotong.
function photoImage(href: string, box: Box): string {
  return `<image href="${href}" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" preserveAspectRatio="xMidYMin slice"/>`;
}

export function buildPosterSvg(input: PosterInput): string {
  const a = loadAssets();
  const defs: string[] = [];
  const photos: string[] = [];
  const medals: string[] = [];
  const plates: string[] = [];
  const texts: string[] = [textPath(a.regular, input.month, spec.month)];

  for (const [i, s] of spec.slots.entries()) {
    const slot = input.slots[i];
    if (!slot) continue; // MA kurang dari 10: slot dibiarkan kosong (panel emas dari background)
    const id = s.rank;
    const c = s.clip;
    defs.push(`<clipPath id="clip-${id}"><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}"/></clipPath>`);
    let mask = "";
    if ("fade" in s && s.fade) {
      defs.push(`<linearGradient id="fg-${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${s.fade.y0}" x2="0" y2="${s.fade.y1}"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="${s.fade.minOpacity}"/></linearGradient>`);
      defs.push(`<mask id="fade-${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="url(#fg-${id})"/></mask>`);
      mask = ` mask="url(#fade-${id})"`;
    }
    const href = slot.photo ? dataUri(slot.photo, "image/png") : a.files.get("assets/photo-placeholder.png")!;
    photos.push(`<g clip-path="url(#clip-${id})"${mask}>${photoImage(href, s.photo)}</g>`);
    medals.push(`<image href="${a.files.get(s.medal.href)}" x="${s.medal.x}" y="${s.medal.y}" width="${s.medal.w}" height="${s.medal.h}"/>`);
    if ("plate" in s && s.plate) plates.push(`<image href="${a.files.get(s.plate.href)}" x="${s.plate.x}" y="${s.plate.y}" width="${s.plate.w}" height="${s.plate.h}"/>`);
    texts.push(textPath(a.bold, slot.name, s.name), textPath(a.bold, slot.office, s.office));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
    + `<defs>${defs.join("")}</defs>`
    + `<image href="${a.files.get(spec.background)}" x="0" y="0" width="${W}" height="${H}"/>`
    + `<g>${photos.join("")}</g><g>${medals.join("")}</g><g>${plates.join("")}</g><g>${texts.join("")}</g></svg>`;
}

// Poster penuh (PNG/JPG 4018×5440) atau pratinjau kecil (lebar `width`).
export async function renderPoster(input: PosterInput, opts: { format: "png" | "jpg"; width?: number }): Promise<Buffer> {
  const svg = buildPosterSvg(input);
  // Pratinjau: SVG langsung dirasterisasi kecil (density < 72) supaya tidak menggambar 4018×5440 dulu.
  const density = opts.width && opts.width < W ? (72 * opts.width) / W : 72;
  const img = sharp(Buffer.from(svg), { density, limitInputPixels: false, unlimited: true });
  return opts.format === "jpg" ? img.flatten({ background: "#ffffff" }).jpeg({ quality: 92, mozjpeg: true }).toBuffer() : img.png({ compressionLevel: 6 }).toBuffer();
}
