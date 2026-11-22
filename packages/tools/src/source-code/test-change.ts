import type { Node } from "@vscode/tree-sitter-wasm";
import { stepWording, testIdOf, testIdTag, textRefusal, TestChangeRefusedError, UnknownTestError, type TestEdit } from "@open-qa-stack/domain";
import { parseSource } from "./syntax-parser.ts";
import { declaredTests, detailsOf, foundTests, stepTitlesOf, tagPairOf, titleOf } from "./test-digests.ts";

/** A file of tests once a test of it is changed. */
export interface ChangedTestFile {
  /** Its new text. */
  readonly content: string;
  /** The titles of the test changed, as `<describe>… › <title>`. */
  readonly title: string;
  /** The identifier the test bears: the one it had, or the one it was given. */
  readonly id: string;
}

/** A part of the text replaced by another. */
interface Splice {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** The quote a literal is written with: `"`, `'` or a backtick. */
function quoteOf(literal: Node): string {
  return literal.text[0]!;
}

/** A text written as a literal between a quote, escaped so that it reads back as that text. */
function quoted(text: string, quote: string): string {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll(quote, `\\${quote}`);
  return `${quote}${quote === "`" ? escaped.replaceAll("${", "\\${") : escaped}${quote}`;
}

/** The text a person wrote, trimmed, or the reason it cannot be written. */
function written(text: string): string {
  const trimmed = text.trim();
  const refusal = textRefusal(trimmed);
  if (refusal !== undefined) throw new TestChangeRefusedError(refusal);
  return trimmed;
}

/** Where the tag of an identifier is written in the details of a call of `test` that bears none: the splice, and the quote of its title. */
function idSplice(call: Node, title: Node, tag: string): Splice {
  const literal = quoted(tag, quoteOf(title) === "`" ? '"' : quoteOf(title));
  const pair = tagPairOf(call);
  const details = detailsOf(call);
  const unwritten = (): never => {
    throw new TestChangeRefusedError("The tags of the test are not written as a text or a list of texts: write them so first.");
  };
  if (pair !== undefined) {
    const value = pair.childForFieldName("value")!;
    if (value.type === "string") return { start: value.startIndex, end: value.endIndex, text: `[${value.text}, ${literal}]` };
    if (value.type !== "array") return unwritten();
    if (value.namedChildren.length === 0) return { start: value.startIndex, end: value.endIndex, text: `[${literal}]` };
    const last = value.namedChildren.at(-1)!;
    return { start: last.endIndex, end: last.endIndex, text: `, ${literal}` };
  }
  if (details === undefined) return { start: title.endIndex, end: title.endIndex, text: `, { tag: ${literal} }` };
  // A tag given by a variable of its name, or spread from another object, may be there already.
  if (details.namedChildren.some((part) => part!.type !== "pair")) return unwritten();
  if (details.namedChildren.length === 0) return { start: details.startIndex, end: details.endIndex, text: `{ tag: ${literal} }` };
  return { start: details.startIndex + 1, end: details.startIndex + 1, text: ` tag: ${literal},` };
}

/**
 * Changes a test of a file of tests — its own title, or the text of one of its steps — and gives it its identifier
 * when it bears none, by its syntax tree: each literal changed is replaced where it is, in its own quotes, and the rest
 * of the file is kept as it is, to the character.
 *
 * @remarks
 * A step the harness numbers, such as `2. Search the order`, keeps its number: the text replaces what follows it. The
 * identifier is written as a tag `@oqas-id-<uuid>`, in the list of the tags of the test, which it is added to, or in
 * its details, which are written when it has none.
 *
 * @param path - The path of the file, which the errors name.
 * @param text - Its text, in TypeScript.
 * @param title - The titles of the test, as `<describe>… › <title>`.
 * @param edit - What changes.
 * @param newId - Gives a new identifier, for a test that bears none.
 * @returns The new text, the titles of the test and its identifier.
 * @throws {@link UnknownTestError} when the file declares no test of the title.
 * @throws {@link TestChangeRefusedError} when the file holds a syntax error, the text is not valid, another test of the
 * file has the title, the test has no step of the number, or its tags are not written so that a tag can be added.
 */
export async function changedTest(path: string, text: string, title: string, edit: TestEdit, newId: () => string): Promise<ChangedTestFile> {
  const declared = await declaredTests(text);
  if (declared.unreadable) throw new TestChangeRefusedError(`The file ${path} holds a syntax error: correct it first.`);
  const test = declared.tests.find((candidate) => candidate.title === title);
  if (test === undefined) throw new UnknownTestError(path, title);
  // The extension picks the TypeScript grammar, which always exists.
  const tree = (await parseSource("tests.ts", text))!;
  try {
    const { call } = foundTests(tree.rootNode).find((found) => found.title === title)!;
    const own = call.childForFieldName("arguments")!.namedChildren[0]!;
    const splices: Splice[] = [];
    let changed = title;
    if ("title" in edit) {
      const wanted = written(edit.title);
      changed = `${title.slice(0, title.length - titleOf(own)!.length)}${wanted}`;
      if (changed !== title && declared.tests.some((other) => other.title === changed))
        throw new TestChangeRefusedError(`Another test of ${path} is titled "${changed}".`);
      splices.push({ start: own.startIndex, end: own.endIndex, text: quoted(wanted, quoteOf(own)) });
    } else {
      const step = stepTitlesOf(call)[edit.step - 1];
      if (step === undefined) throw new TestChangeRefusedError(`The test "${title}" has no step ${edit.step}.`);
      const { number } = stepWording(titleOf(step)!);
      splices.push({ start: step.startIndex, end: step.endIndex, text: quoted(`${number}${written(edit.text)}`, quoteOf(step)) });
    }
    const borne = testIdOf(test.tags);
    const id = borne ?? newId();
    if (borne === undefined) splices.push(idSplice(call, own, testIdTag(id)));
    const content = splices
      .toSorted((one, other) => other.start - one.start)
      .reduce((kept, { start, end, text: put }) => kept.slice(0, start) + put + kept.slice(end), text);
    return { content, title: changed, id };
  } finally {
    tree.delete();
  }
}
