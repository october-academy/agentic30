import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { extractPdfText } from "../sidecar/pdf-text.mjs";

// Build a minimal valid-enough PDF: one FlateDecode content stream that shows a
// literal-string line via Tj. Exercises the ASCII/literal path hermetically.
function makeLiteralTextPdf(line) {
  const content = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const deflated = zlib.deflateSync(Buffer.from(content, "latin1"));
  const head = Buffer.from(`%PDF-1.4\n1 0 obj\n<</Filter /FlateDecode /Length ${deflated.length}>>\nstream\n`, "latin1");
  const tail = Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1");
  return Buffer.concat([head, deflated, tail]);
}

// Build a PDF whose text is CID hex shown via Tj, recovered through a ToUnicode
// CMap (beginbfchar). Exercises the CJK/CID path that real Hangul proposal PDFs use.
function makeCidTextPdf(mappings) {
  // mappings: array of [glyphHex4, unicodeChar]
  const bf = mappings
    .map(([g, ch]) => `<${g}> <${ch.charCodeAt(0).toString(16).padStart(4, "0")}>`)
    .join("\n");
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n1 beginbfchar\n${bf}\nendbfchar\nendcmap end`;
  const cmapDef = zlib.deflateSync(Buffer.from(cmap, "latin1"));
  const show = mappings.map(([g]) => g).join("");
  const content = `BT /F1 12 Tf 72 720 Td <${show}> Tj ET`;
  const contentDef = zlib.deflateSync(Buffer.from(content, "latin1"));
  const parts = [Buffer.from("%PDF-1.5\n", "latin1")];
  parts.push(Buffer.from(`1 0 obj\n<</Filter /FlateDecode /Length ${cmapDef.length}>>\nstream\n`, "latin1"), cmapDef, Buffer.from("\nendstream\nendobj\n", "latin1"));
  parts.push(Buffer.from(`2 0 obj\n<</Filter /FlateDecode /Length ${contentDef.length}>>\nstream\n`, "latin1"), contentDef, Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"));
  return Buffer.concat(parts);
}

test("extractPdfText recovers literal (..)Tj ASCII text", () => {
  const pdf = makeLiteralTextPdf("Dongdong proposal mindfulness app");
  const text = extractPdfText(pdf, { maxChars: 200 });
  assert.match(text, /Dongdong proposal mindfulness app/);
});

test("extractPdfText recovers CID text via ToUnicode CMap (Hangul)", () => {
  // Arbitrary glyph codes mapped to Hangul; >= MIN_USEFUL_CHARS chars so the
  // recovered text is not discarded as noise.
  const chars = "마음챙김명상불교콘텐츠동동앱";
  const mappings = chars.split("").map((ch, i) => [(0x2800 + i).toString(16).padStart(4, "0"), ch]);
  const pdf = makeCidTextPdf(mappings);
  const text = extractPdfText(pdf, { maxChars: 200 });
  assert.match(text, /마음챙김명상불교콘텐츠동동앱/);
});

test("extractPdfText returns empty for non-PDF, tiny, and image-only inputs", () => {
  assert.equal(extractPdfText(Buffer.from("hello world, not a pdf")), "");
  assert.equal(extractPdfText(Buffer.from("%PDF-")), "");
  assert.equal(extractPdfText(Buffer.from("")), "");
  // A PDF whose only stream is an image dict must yield "" (no fabricated text).
  const imgData = zlib.deflateSync(Buffer.from([0, 1, 2, 3, 255, 254, 253]));
  const img = Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n<</Type /XObject /Subtype /Image /Filter /FlateDecode /Length ${imgData.length}>>\nstream\n`, "latin1"),
    imgData,
    Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
  ]);
  assert.equal(extractPdfText(img), "");
});

test("extractPdfText respects maxChars", () => {
  const pdf = makeLiteralTextPdf("abcdefghij klmnopqrst uvwxyz0123 456789");
  const text = extractPdfText(pdf, { maxChars: 10 });
  assert.ok(text.length <= 10);
});
