const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Decodes the base64 VLQ values of one segment of source map mappings.
 *
 * @param segment - The segment, between two commas or semicolons.
 * @returns The values it encodes, in order.
 */
export function decode(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = BASE64.indexOf(char);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      values.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return values;
}

function encode(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    const digit = rest & 31;
    rest >>>= 5;
    out += BASE64[rest > 0 ? digit | 32 : digit];
  } while (rest > 0);
  return out;
}

/**
 * Makes the mappings of a single-source map start at the first line of the source and end on its last one.
 *
 * Node maps the range of a whole module through the source map: lines before the first mapping or after
 * the last one would read as never run, although they hold only comments and types.
 *
 * @param mappings - The `mappings` field, whose first generated line carries no segment.
 * @param lastGeneratedLine - Zero-based index of the generated line that closes the module.
 * @param lastSourceLine - Zero-based index of the last line of the source.
 * @returns The mappings, with a segment at the start of the first and of the closing generated line.
 */
export function spanWholeSource(mappings: string, lastGeneratedLine: number, lastSourceLine: number): string {
  const lines = mappings.split(";");
  let line = 0;
  let column = 0;
  for (const segment of lines.flatMap((l) => l.split(","))) {
    const [, , lineDelta = 0, columnDelta = 0] = decode(segment);
    line += lineDelta;
    column += columnDelta;
  }
  while (lines.length <= lastGeneratedLine) lines.push("");
  lines[0] = lines[0] === "" ? "AAAA" : `AAAA,${lines[0]}`;
  lines[lastGeneratedLine] = `AA${encode(lastSourceLine - line)}${encode(-column)}`;
  return lines.join(";");
}
