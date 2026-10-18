/* ==========================================================================
   A PNG READER, IN THE STANDARD LIBRARY

   The board's grid lines are the one thing on it that cannot be verified by
   reading the DOM. A line can be exactly where the CSS says it is, one pixel
   wide, the right colour, and still be invisible - because it landed between
   two device pixels and the renderer split it across both at half strength.
   The only honest way to know whether a line is visible is to look at the
   pixels the renderer actually produced.

   So this decodes the screenshot. It handles what Chrome emits and nothing
   else: eight bits per channel, not interlaced. That is a real PNG decoder
   for the subset we need and no more - no palette, no 16-bit, no Adam7.

   No library. A PNG is a signature, a list of length-prefixed chunks, and a
   zlib stream of scanlines each prefixed with the filter that was used to
   encode it; zlib is in node:zlib and the filters are fifty lines.
   ========================================================================== */

import { inflateSync } from "node:zlib";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Decode a PNG buffer into raw samples.
 * @returns {{width:number,height:number,channels:number,data:Buffer}}
 */
export function decodePng(buffer) {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (buffer[i] !== SIGNATURE[i]) throw new Error("not a PNG");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  const compressed = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === "IDAT") {
      compressed.push(body);
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length; // length + type + body + crc
  }

  if (depth !== 8) throw new Error(`unsupported bit depth: ${depth}`);
  if (interlace !== 0) throw new Error("interlaced PNG is not supported");

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colour type: ${colorType}`);

  const raw = inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[at++];
    const line = raw.subarray(at, at + stride);
    at += stride;

    const row = out.subarray(y * stride, (y + 1) * stride);
    const above = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      // The three neighbours a filter may refer to: the byte to the left in
      // this row, the byte above in the column, and the one diagonally up-left.
      const left = x >= channels ? row[x - channels] : 0;
      const up = above ? above[x] : 0;
      const upLeft = above && x >= channels ? above[x - channels] : 0;

      let value = line[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          value += left;
          break;
        case 2:
          value += up;
          break;
        case 3:
          value += (left + up) >> 1;
          break;
        case 4: {
          // Paeth: whichever neighbour the encoder predicted closest to.
          const p = left + up - upLeft;
          const dl = Math.abs(p - left);
          const du = Math.abs(p - up);
          const dul = Math.abs(p - upLeft);
          value += dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
          break;
        }
        default:
          throw new Error(`unknown filter ${filter} on row ${y}`);
      }
      row[x] = value & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

/** One pixel as [r, g, b, a]. */
export function pixel(image, x, y) {
  const i = y * image.width * image.channels + x * image.channels;
  return [
    image.data[i],
    image.data[i + 1],
    image.data[i + 2],
    image.channels === 4 ? image.data[i + 3] : 255,
  ];
}

/** "#2a2a2a" -> [42, 42, 42]. */
export function rgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** How far apart two RGB triples are, worst channel. 0 means identical. */
export function distance(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}