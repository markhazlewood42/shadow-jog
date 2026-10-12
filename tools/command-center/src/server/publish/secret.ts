import { inspect } from 'node:util';

/**
 * A value that must never reach a log line, an error message or a JSON file. It holds the text in a private field. `String(secret)`,
 * a template string, `JSON.stringify` and `console.log` all print "[hidden]". Only `reveal()` gives the text back, and the code
 * calls it in exactly one place: the header of the request to the store.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** The text. Call it only where the value goes on the wire. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return '[hidden]';
  }

  toJSON(): string {
    return '[hidden]';
  }

  [inspect.custom](): string {
    return '[hidden]';
  }
}
