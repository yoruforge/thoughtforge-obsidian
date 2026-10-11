// Only the block-token API used by this adapter. Rendering/inline APIs are unused.
declare module "markdown-it" {
  export interface Token {
    type: string; tag: string; nesting: number; level: number;
    map: [number, number] | null; markup: string; content: string;
    meta?: { noteCallout?: boolean };
  }
  export interface BlockState {
    src: string; line: number; blkIndent: number; parentType: string;
    bMarks: number[]; eMarks: number[]; tShift: number[]; sCount: number[];
    bsCount: number[]; lineMax: number; level: number; tight: boolean;
    md: MarkdownIt;
    tokens: Token[]; env: Record<string, unknown>;
    push(type: string, tag: string, nesting: number): Token;
    isEmpty(line: number): boolean;
    skipEmptyLines(line: number): number;
  }
  export type BlockRule = (state: BlockState, start: number, end: number, silent: boolean) => boolean;
  export default class MarkdownIt {
    constructor(preset: string, options?: { html?: boolean; maxNesting?: number });
    enable(rule: string): this;
    options: { maxNesting: number };
    block: {
      ruler: {
        before(before: string, name: string, rule: BlockRule, options?: { alt: string[] }): void;
        at(name: string, rule: BlockRule, options?: { alt: string[] }): void;
        getRules(chain: string): BlockRule[];
      };
      tokenize(state: BlockState, start: number, end: number): void;
      parse(text: string, md: MarkdownIt, env: Record<string, unknown>, tokens: Token[]): void;
    };
  }
}
declare module "js-yaml" {
  export function load(text: string): unknown;
}
declare module "markdown-it/lib/rules_block/reference.mjs" {
  import type { BlockRule } from "markdown-it";
  const rule: BlockRule;
  export default rule;
}
