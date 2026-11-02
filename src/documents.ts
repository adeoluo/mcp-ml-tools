import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { ToolInputError } from "./errors.js";
import type { Document } from "./tools/bm25.js";

export interface LoadLimits {
  extensions: readonly string[];
  maxFiles: number;
  maxFileBytes: number;
}

export interface LoadResult {
  documents: Document[];
  skipped: { path: string; reason: string }[];
}

// O_NOFOLLOW is not defined on Windows; there the directory walk's symbolic link check applies.
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

/**
 * Reads a regular file through one file handle, so the size check and the read see the same file
 * (no check-then-use race). Returns null when the file exceeds `maxBytes`.
 */
async function readTextFile(filePath: string, maxBytes: number): Promise<string | null> {
  const handle = await open(filePath, OPEN_FLAGS);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return null;
    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total <= maxBytes) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    return total > maxBytes ? null : buffer.subarray(0, total).toString("utf8");
  } finally {
    await handle.close();
  }
}

export function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Loads text documents from `directory`, which must resolve (after following symbolic links) to a
 * location inside `root`. Symbolic links and hidden entries inside the tree are skipped, so a link
 * cannot be used to escape the allowlisted root.
 */
export async function loadDocumentsFromDirectory(
  root: string | null,
  directory: string,
  limits: LoadLimits,
): Promise<LoadResult> {
  if (root === null) {
    throw new ToolInputError(
      "filesystem access is disabled: set documentRoot in the configuration file or the " +
        "MCP_ML_TOOLS_DOCUMENT_ROOT environment variable to allow loading documents from disk",
    );
  }
  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    throw new ToolInputError(`configured documentRoot does not exist: ${root}`);
  }
  const requested = path.resolve(rootReal, directory);
  let targetReal: string;
  try {
    targetReal = await realpath(requested);
  } catch {
    throw new ToolInputError(`directory not found inside documentRoot: ${directory}`);
  }
  if (!isWithin(rootReal, targetReal)) {
    throw new ToolInputError(`directory is outside the allowlisted documentRoot: ${directory}`);
  }
  const targetStat = await lstat(targetReal);
  if (!targetStat.isDirectory()) {
    throw new ToolInputError(`not a directory: ${directory}`);
  }

  const extensions = new Set(limits.extensions.map((extension) => extension.toLowerCase()));
  const documents: Document[] = [];
  const skipped: LoadResult["skipped"] = [];
  const pending: string[] = [targetReal];
  while (pending.length > 0 && documents.length < limits.maxFiles) {
    const current = pending.shift() as string;
    const entries = (await readdir(current, { withFileTypes: true })).sort((x, y) =>
      x.name.localeCompare(y.name),
    );
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relative = path.relative(rootReal, fullPath).split(path.sep).join("/");
      if (entry.name.startsWith(".")) continue;
      if (entry.isSymbolicLink()) {
        skipped.push({ path: relative, reason: "symbolic link" });
        continue;
      }
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue;
      if (documents.length >= limits.maxFiles) {
        skipped.push({ path: relative, reason: `maxFiles limit (${limits.maxFiles}) reached` });
        continue;
      }
      const text = await readTextFile(fullPath, limits.maxFileBytes);
      if (text === null) {
        skipped.push({
          path: relative,
          reason: `larger than maxFileBytes (${limits.maxFileBytes})`,
        });
        continue;
      }
      documents.push({ id: relative, text });
    }
  }
  return { documents, skipped };
}
