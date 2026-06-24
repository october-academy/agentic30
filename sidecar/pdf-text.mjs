// Minimal, dependency-free PDF text extraction for project-context derivation.
//
// Why in-repo instead of a library: distribution is direct DMG and the sidecar is
// bundled by build:sidecar. Every pure-JS PDF lib (pdfjs-dist, pdf-parse, unpdf)
// is multi-MB and drags worker/CMap/font machinery through the bundler. node:zlib
// is a builtin, so this stays a zero-dependency, DMG-safe helper.
//
// It handles the two real cases seen in proposal PDFs:
//   1) Latin/ASCII text shown as `(literal) Tj` / `[...] TJ`.
//   2) CJK/CID-font text shown as `<glyphhex> Tj`, recovered via the font's
//      ToUnicode CMap (beginbfchar/beginbfrange) — the standard, spec-defined
//      path for mapping glyph codes back to Unicode (this is how Korean text in
//      a Hangul proposal PDF is recovered, not a hack).
//
// Honest degradation: scanned/image-only PDFs, encrypted PDFs, or fonts without a
// ToUnicode map yield "" (the caller leaves the field blank — no fabricated text,
// no silent fallback content).
import zlib from "node:zlib";

const STREAM_OPEN = Buffer.from("stream");
const STREAM_CLOSE = Buffer.from("endstream");
const MAX_DECODED_BYTES = 24_000_000; // decompression-bomb guard
const MIN_USEFUL_CHARS = 12;

/**
 * Extract visible text from a PDF buffer. Returns "" when nothing useful is
 * recoverable. Pure + synchronous so it is trivially unit-testable.
 * @param {Buffer} buffer raw PDF bytes
 * @param {{maxChars?: number}} [opts]
 * @returns {string}
 */
export function extractPdfText(buffer, { maxChars = 4000 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) return "";
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") return "";

  // Pass 1: inflate every stream once; classify into ToUnicode CMaps vs content
  // (text) streams; skip image/font binary streams by their object dictionary.
  const cmapSources = [];
  const contentStreams = [];
  let decodedBytes = 0;
  let searchFrom = 0;
  while (decodedBytes < MAX_DECODED_BYTES) {
    const openIdx = buffer.indexOf(STREAM_OPEN, searchFrom);
    if (openIdx === -1) break;
    const closeIdx = buffer.indexOf(STREAM_CLOSE, openIdx + STREAM_OPEN.length);
    if (closeIdx === -1) break;
    searchFrom = closeIdx + STREAM_CLOSE.length;

    const dictStart = buffer.lastIndexOf(Buffer.from("<<"), openIdx);
    const dict = dictStart >= 0 ? buffer.subarray(dictStart, openIdx).toString("latin1") : "";
    // Skip image/font binary streams BEFORE inflating: a proposal PDF's first
    // streams are often multi-MB images, and inflating them would blow the
    // decompression-bomb cap before we ever reach the ToUnicode CMap streams that
    // live later in the file (which would silently lose all CID text recovery).
    if (/\/Subtype\s*\/Image|\/Image\b|\/DCTDecode|\/CCITTFaxDecode|\/JPXDecode|\/JBIG2Decode/.test(dict)) {
      continue;
    }

    let dataStart = openIdx + STREAM_OPEN.length;
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;
    let dataEnd = closeIdx;
    if (buffer[dataEnd - 1] === 0x0a) dataEnd -= 1;
    if (buffer[dataEnd - 1] === 0x0d) dataEnd -= 1;
    if (dataEnd <= dataStart) continue;

    const slice = buffer.subarray(dataStart, dataEnd);
    let content = null;
    try { content = zlib.inflateSync(slice); }
    catch { try { content = zlib.inflateRawSync(slice); } catch { content = null; } }
    if (!content || !content.length) continue;
    decodedBytes += content.length;
    const s = content.toString("latin1");

    if (s.includes("beginbfchar") || s.includes("beginbfrange")) {
      cmapSources.push(s);
      continue;
    }
    if (s.includes("BT") && (/<[0-9A-Fa-f]/.test(s) || s.includes("Tj") || s.includes("TJ"))) {
      contentStreams.push(s);
    }
  }

  if (!contentStreams.length) return "";
  const cmap = buildToUnicodeMap(cmapSources);
  const text = contentStreams.map((s) => extractTextFromContentStream(s, cmap)).join("\n");
  const cleaned = normalizeWhitespace(text);
  if (countPrintable(cleaned) < MIN_USEFUL_CHARS) return "";
  return cleaned.slice(0, maxChars);
}

// Build a glyph-code → Unicode map from all ToUnicode CMap streams. Merged
// globally: a project corpus uses a small number of subset fonts and we only need
// domain signal (names, keywords), so per-font precision is unnecessary.
function buildToUnicodeMap(cmapSources) {
  const map = new Map();
  for (const s of cmapSources) {
    for (const blk of s.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
      for (const m of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        map.set(m[1].toLowerCase(), hexToUnicode(m[2]));
      }
    }
    for (const blk of s.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
      // form A: <lo> <hi> <dstLo>   form B: <lo> <hi> [<d1> <d2> ...]
      for (const m of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[\s\S]*?\]|<[0-9A-Fa-f]+>)/g)) {
        const lo = parseInt(m[1], 16);
        const hi = parseInt(m[2], 16);
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo || hi - lo > 65535) continue;
        const width = m[1].length;
        if (m[3].startsWith("[")) {
          const dsts = m[3].match(/<([0-9A-Fa-f]+)>/g) || [];
          for (let i = 0; i <= hi - lo && i < dsts.length; i++) {
            map.set((lo + i).toString(16).padStart(width, "0"), hexToUnicode(dsts[i].slice(1, -1)));
          }
        } else {
          const dstLo = parseInt(m[3].slice(1, -1), 16);
          for (let i = 0; i <= hi - lo; i++) {
            map.set((lo + i).toString(16).padStart(width, "0"), String.fromCodePoint(dstLo + i));
          }
        }
      }
    }
  }
  return map;
}

// Pull the text-showing operators from one decoded content stream. Handles both
// CID `<hex> Tj` / `[<hex> ...] TJ` (decoded via the CMap) and literal `(..)`.
function extractTextFromContentStream(s, cmap) {
  const out = [];
  const blockRe = /BT([\s\S]*?)ET/g;
  let block;
  let sawBlock = false;
  while ((block = blockRe.exec(s)) !== null) { sawBlock = true; out.push(extractSegment(block[1], cmap)); }
  if (!sawBlock) out.push(extractSegment(s, cmap));
  return out.join(" ");
}

function extractSegment(seg, cmap) {
  const pieces = [];
  // Tokenize the show operands in order: hex strings <..> and literal strings (..).
  const tokenRe = /<([0-9A-Fa-f\s]+)>|\((?:\\[\s\S]|[^\\()])*\)/g;
  let t;
  while ((t = tokenRe.exec(seg)) !== null) {
    if (t[1] !== undefined) {
      pieces.push(decodeCidHex(t[1].replace(/\s+/g, ""), cmap));
    } else {
      pieces.push(unescapePdfString(t[0].slice(1, -1)));
    }
  }
  return pieces.join("");
}

// A CID hex run is a sequence of fixed-width glyph codes. Pick the width from the
// CMap keys (commonly 4 = 2-byte CIDs); default to 4. Unknown glyphs are dropped.
function decodeCidHex(hex, cmap) {
  if (!hex) return "";
  if (cmap.size === 0) return ""; // no ToUnicode → cannot recover CID text honestly
  const width = keyWidth(cmap);
  let out = "";
  for (let i = 0; i + width <= hex.length; i += width) {
    const code = hex.slice(i, i + width).toLowerCase();
    const u = cmap.get(code);
    if (u) out += u;
  }
  return out;
}

let _cachedWidth = null;
let _cachedFor = null;
function keyWidth(cmap) {
  if (_cachedFor === cmap && _cachedWidth) return _cachedWidth;
  let w = 4;
  for (const k of cmap.keys()) { w = k.length; break; }
  _cachedFor = cmap; _cachedWidth = w;
  return w;
}

function hexToUnicode(hex) {
  let out = "";
  // UTF-16BE code units; combine surrogate pairs.
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  }
  // leftover (non-multiple of 4) — treat as a single code unit.
  if (hex.length % 4 !== 0) out += String.fromCharCode(parseInt(hex.slice(hex.length - (hex.length % 4)), 16));
  return out;
}

function unescapePdfString(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") { out += ch; continue; }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (next === "n" || next === "r") { out += "\n"; i += 1; }
    else if (next === "t") { out += "\t"; i += 1; }
    else if (next === "b" || next === "f") { i += 1; }
    else if (next === "(" || next === ")" || next === "\\") { out += next; i += 1; }
    else if (next >= "0" && next <= "7") {
      let oct = ""; let j = i + 1;
      while (j < raw.length && oct.length < 3 && raw[j] >= "0" && raw[j] <= "7") { oct += raw[j]; j += 1; }
      out += String.fromCharCode(parseInt(oct, 8) & 0xff);
      i = j - 1;
    } else { out += next; i += 1; }
  }
  return out;
}

function normalizeWhitespace(text) {
  return text
    .replace(/ /g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countPrintable(text) {
  let n = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code > 0x20 && code !== 0x7f) n += 1;
  }
  return n;
}
