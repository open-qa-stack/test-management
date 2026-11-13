import { pointer } from "./errors.ts";

type Frame = { kind: "object"; path: string; keys: Set<string>; key: string; expectKey: boolean } | { kind: "array"; path: string; index: number };

/**
 * Finds the keys written more than once in the same object.
 *
 * @remarks
 * `JSON.parse` silently keeps the last occurrence, which would hide whatever the earlier ones hold.
 *
 * @param text - Valid JSON.
 * @returns The JSON Pointer of every repeated key.
 */
export function duplicateKeyPaths(text: string): string[] {
  const found: string[] = [];
  const stack: Frame[] = [];
  const childPath = (): string => {
    const parent = stack.at(-1);
    if (parent === undefined) return "";
    return parent.kind === "object" ? pointer(parent.path, parent.key) : pointer(parent.path, parent.index);
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const parent = stack.at(-1);
      if (parent?.kind === "object" && parent.expectKey) {
        const key = JSON.parse(text.slice(i, end + 1)) as string;
        if (parent.keys.has(key)) found.push(pointer(parent.path, key));
        parent.keys.add(key);
        parent.key = key;
        parent.expectKey = false;
      }
      i = end;
    } else if (c === "{") {
      stack.push({ kind: "object", path: childPath(), keys: new Set(), key: "", expectKey: true });
    } else if (c === "[") {
      stack.push({ kind: "array", path: childPath(), index: 0 });
    } else if (c === "}" || c === "]") {
      stack.pop();
    } else if (c === ",") {
      // A comma only appears inside an object or an array of valid JSON.
      const parent = stack.at(-1) as Frame;
      if (parent.kind === "object") parent.expectKey = true;
      else parent.index++;
    }
  }
  return found;
}
