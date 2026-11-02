import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURES = path.join(PROJECT_ROOT, "tests", "fixtures");
export const CORPUS = path.join(FIXTURES, "corpus");
export const CLI = path.join(PROJECT_ROOT, "dist", "cli.js");

/** A scratch directory inside the project (ignored by git), removed and recreated per call. */
export function workDirectory(name: string): string {
  const directory = path.join(PROJECT_ROOT, ".test-work", name);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  return directory;
}
