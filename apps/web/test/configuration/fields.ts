/**
 * The tags of the fields of a name in a piece of HTML.
 *
 * @param html - The HTML.
 * @param name - The name of the fields, their JSON Pointer.
 * @returns Each tag, as a set of its attributes written `name="value"`, and the kind of its element.
 */
export function fieldsNamed(html: string, name: string): string[][] {
  return [...html.matchAll(/<(input|select)\b([^>]*)>/g)]
    .filter(([, , attributes]) => attributes!.includes(` name="${name}"`))
    .map(([, kind, attributes]) => [kind!, ...[...attributes!.matchAll(/([\w-]+)="([^"]*)"/g)].map(([attribute]) => attribute)]);
}

/** Tells whether a field of a name bears the attributes given, whatever their order. */
export function bears(html: string, name: string, ...attributes: string[]): boolean {
  return fieldsNamed(html, name).some((field) => attributes.every((attribute) => field.includes(attribute)));
}
