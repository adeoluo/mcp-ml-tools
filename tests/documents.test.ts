import { symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isWithin, loadDocumentsFromDirectory } from "../src/documents.js";
import { ToolInputError } from "../src/errors.js";
import { CORPUS, FIXTURES, workDirectory } from "./helpers.js";

const limits = { extensions: [".txt", ".md"], maxFiles: 100, maxFileBytes: 100_000 };

describe("allowlisted document loading", () => {
  it("refuses all disk access when no root is configured", async () => {
    await expect(loadDocumentsFromDirectory(null, ".", limits)).rejects.toThrow(
      /filesystem access is disabled/,
    );
  });

  it("loads matching files recursively in a stable order, skipping hidden and other files", async () => {
    const { documents } = await loadDocumentsFromDirectory(CORPUS, ".", limits);
    expect(documents.map((document) => document.id)).toEqual([
      "bm25.md",
      "bootstrap.txt",
      "nested/tokenizer.md",
    ]);
    expect(documents[0]?.text).toContain("Lucene");
  });

  it("loads a subdirectory relative to the root", async () => {
    const { documents } = await loadDocumentsFromDirectory(CORPUS, "nested", limits);
    expect(documents.map((document) => document.id)).toEqual(["nested/tokenizer.md"]);
  });

  it("rejects paths that escape the root", async () => {
    await expect(loadDocumentsFromDirectory(CORPUS, "../outside", limits)).rejects.toThrow(
      /outside the allowlisted/,
    );
    await expect(
      loadDocumentsFromDirectory(CORPUS, path.join(FIXTURES, "outside"), limits),
    ).rejects.toThrow(ToolInputError);
  });

  // Creating symbolic links on Windows requires elevated privileges.
  it.skipIf(process.platform === "win32")(
    "does not follow symbolic links that point outside the root",
    async () => {
      const root = workDirectory("symlink-root");
      writeFileSync(path.join(root, "inside.txt"), "inside the root");
      symlinkSync(path.join(FIXTURES, "outside"), path.join(root, "escape"));
      symlinkSync(path.join(FIXTURES, "outside", "secret.txt"), path.join(root, "secret-link.txt"));
      const { documents, skipped } = await loadDocumentsFromDirectory(root, ".", limits);
      expect(documents.map((document) => document.id)).toEqual(["inside.txt"]);
      expect(skipped.map((entry) => entry.reason)).toEqual(["symbolic link", "symbolic link"]);
      await expect(loadDocumentsFromDirectory(root, "escape", limits)).rejects.toThrow(
        /outside the allowlisted/,
      );
    },
  );

  it("enforces file count and size limits", async () => {
    const root = workDirectory("limits");
    writeFileSync(path.join(root, "a.txt"), "small");
    writeFileSync(path.join(root, "b.txt"), "x".repeat(2000));
    writeFileSync(path.join(root, "c.txt"), "small");
    const sized = await loadDocumentsFromDirectory(root, ".", { ...limits, maxFileBytes: 100 });
    expect(sized.documents.map((document) => document.id)).toEqual(["a.txt", "c.txt"]);
    expect(sized.skipped[0]?.reason).toMatch(/maxFileBytes/);
    const counted = await loadDocumentsFromDirectory(root, ".", { ...limits, maxFiles: 1 });
    expect(counted.documents).toHaveLength(1);
    expect(counted.skipped.some((entry) => entry.reason.includes("maxFiles"))).toBe(true);
  });

  it("reads UTF-8 text exactly, including files at the size limit", async () => {
    const root = workDirectory("exact-size");
    const text = "naïve café 🙂\n";
    writeFileSync(path.join(root, "exact.txt"), text);
    const bytes = Buffer.byteLength(text);
    const exact = await loadDocumentsFromDirectory(root, ".", { ...limits, maxFileBytes: bytes });
    expect(exact.documents[0]?.text).toBe(text);
    const over = await loadDocumentsFromDirectory(root, ".", {
      ...limits,
      maxFileBytes: bytes - 1,
    });
    expect(over.documents).toHaveLength(0);
  });

  it("reports missing roots, missing directories, and files", async () => {
    await expect(
      loadDocumentsFromDirectory(path.join(FIXTURES, "missing"), ".", limits),
    ).rejects.toThrow(/does not exist/);
    await expect(loadDocumentsFromDirectory(CORPUS, "nope", limits)).rejects.toThrow(/not found/);
    await expect(loadDocumentsFromDirectory(CORPUS, "bm25.md", limits)).rejects.toThrow(
      /not a directory/,
    );
  });

  it("checks containment by path segments, not string prefixes", () => {
    expect(isWithin("/data/root", "/data/root")).toBe(true);
    expect(isWithin("/data/root", "/data/root/a/b")).toBe(true);
    expect(isWithin("/data/root", "/data/root-other")).toBe(false);
    expect(isWithin("/data/root", "/data")).toBe(false);
  });
});
