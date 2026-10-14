export const ENTRY_DIR: string;
export const CHANGELOG: string;
export const HEADINGS: string[];
export const FILE_NAME: RegExp;
export function parseEntry(text: string, name?: string): { sections: Record<string, string[]>; errors: string[] };
export function validateEntry(text: string, name: string): string[];
export function listEntryFiles(dir?: string): string[];
export function checkDir(dir?: string): { files: string[]; errors: string[] };
export function mergeEntries(entries: { name: string; text: string }[]): Record<string, string[]>;
export function renderRelease(version: string, date: string, merged: Record<string, string[]>): string;
export function foldIntoChangelog(changelog: string, entries: { name: string; text: string }[], version: string, date: string): string;
export function fold(options: {
  dir?: string;
  changelogPath?: string;
  version: string;
  date?: string;
  dryRun?: boolean;
}): { text: string; files: string[]; release: string };
export function main(argv: string[], log?: (message: string) => void, logError?: (message: string) => void): number;
