/** A JSON object, as the console reads one. */
type JsonObject = Readonly<Record<string, unknown>>;

/** Whether a value read from JSON is an object with keys. */
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the segments of a JSON Pointer (RFC 6901).
 *
 * @param pointer - The pointer, such as `/applications/0/name`.
 * @returns Its segments, unescaped; none for the whole document.
 */
export function segmentsOf(pointer: string): string[] {
  return pointer === ""
    ? []
    : pointer
        .slice(1)
        .split("/")
        .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/**
 * Reads the value at a JSON Pointer.
 *
 * @param document - The document.
 * @param pointer - Where to read.
 * @returns The value; `undefined` where there is none.
 */
export function valueAt(document: unknown, pointer: string): unknown {
  return segmentsOf(pointer).reduce<unknown>(
    (value, segment) => (isObject(value) || Array.isArray(value) ? (value as JsonObject)[segment] : undefined),
    document,
  );
}

/** The document with the value at the segments given replaced, or removed when it is `undefined`; what is missing on the way is made an object. */
function replaced(value: unknown, segments: readonly string[], next: unknown): unknown {
  const [segment, ...rest] = segments;
  if (segment === undefined) return next;
  if (Array.isArray(value)) return value.map((item, index) => (String(index) === segment ? replaced(item, rest, next) : item));
  const object = isObject(value) ? value : {};
  const child = replaced(object[segment], rest, next);
  const { [segment]: _, ...others } = object;
  return child === undefined ? others : { ...others, [segment]: child };
}

/**
 * Sets a value in a document, which stays as it was.
 *
 * @param document - The document.
 * @param pointer - Where to set the value.
 * @param value - The value; `undefined` removes the key.
 * @returns The document changed.
 */
export function changedAt<Document>(document: Document, pointer: string, value: unknown): Document {
  return replaced(document, segmentsOf(pointer), value) as Document;
}

/**
 * Appends an item to a list of a document, which stays as it was.
 *
 * @param document - The document.
 * @param pointer - Where the list is; it is made when there is none.
 * @param item - The item.
 * @returns The document changed.
 */
export function appendedAt<Document>(document: Document, pointer: string, item: unknown): Document {
  const list = valueAt(document, pointer);
  return changedAt(document, pointer, [...(Array.isArray(list) ? list : []), item]);
}

/**
 * Removes an item of a list, or a key of an object, from a document, which stays as it was.
 *
 * @param document - The document.
 * @param pointer - What to remove.
 * @returns The document changed.
 */
export function removedAt<Document>(document: Document, pointer: string): Document {
  const segments = segmentsOf(pointer);
  const parent = `/${segments
    .slice(0, -1)
    .map((segment) => segment.replaceAll("~", "~0").replaceAll("/", "~1"))
    .join("/")}`;
  const list = valueAt(document, parent);
  if (!Array.isArray(list)) return changedAt(document, pointer, undefined);
  const index = Number(segments.at(-1));
  return changedAt(
    document,
    parent,
    list.filter((_, rank) => rank !== index),
  );
}
