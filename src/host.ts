import type { SourceRange } from "@thoughtforge/core";
import type { MarkdownState } from './markdownGate.ts';

export type PreflightResult = string | { kind: 'permission-denied'; reason: string } | undefined;
export interface MapHost {
  readonly uri: string;
  readonly file?: object;
  readonly path?: string;
  read(): Promise<string>;
  hasPendingMarkdown(savedText: string): boolean;
  markdownState?(savedText: string): MarkdownState;
  loadMarkdownTabs?(): Promise<boolean>;
  preflight?(): Promise<PreflightResult>;
  compareAndSwap(expected: string, next: string, valid?: (current?: string) => boolean): Promise<boolean>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  openVaultLink(title: string): Promise<void>;
  revealSource(range: SourceRange, bindingLive?: () => boolean): Promise<void>;
  notify(message: string): void;
}
export function isMapPath(path: string): boolean { return path.endsWith(".map.md"); }
export function mapUri(path: string): string { return `obsidian-map:${encodeURIComponent(path)}`; }
export function toLf(text: string): string { return text.replace(/\r\n/g, "\n"); }
export function editableLineEndings(text: string): boolean {
  return !text.includes("\r") || !/[\r\n]/.test(text.replace(/\r\n/g, ""));
}
