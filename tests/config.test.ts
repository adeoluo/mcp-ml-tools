import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_CONFIG,
  loadConfig,
  mergePrices,
  publicConfig,
} from "../src/config.js";
import { DEFAULT_PRICES, type ModelPrice } from "../src/prices.js";
import { workDirectory } from "./helpers.js";

describe("configuration", () => {
  it("defaults to no filesystem access and loopback HTTP", () => {
    const config = loadConfig({ env: {} });
    expect(config.documentRoot).toBeNull();
    expect(config.http).toEqual({ host: "127.0.0.1", port: 3333, token: null });
    expect(config.prices).toHaveLength(DEFAULT_PRICES.length);
    expect(DEFAULT_CONFIG.documentRoot).toBeNull();
  });

  it("loads a file, resolving documentRoot relative to the file", () => {
    const directory = workDirectory("config-file");
    const file = path.join(directory, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        documentRoot: "./docs",
        documentExtensions: [".txt"],
        maxFiles: 5,
        maxFileBytes: 1234,
        http: { host: "0.0.0.0", port: 8080 },
        prices: [
          {
            model: "gpt-4o",
            provider: "openai",
            inputPerMillion: 1,
            outputPerMillion: 2,
            charactersPerToken: 4,
          },
          {
            model: "my-model",
            provider: "local",
            inputPerMillion: 0,
            outputPerMillion: 0,
            charactersPerToken: 3,
          },
        ],
      }),
    );
    const config = loadConfig({ configPath: file, env: {} });
    expect(config.documentRoot).toBe(path.join(directory, "docs"));
    expect(config.documentExtensions).toEqual([".txt"]);
    expect(config.maxFiles).toBe(5);
    expect(config.maxFileBytes).toBe(1234);
    expect(config.http).toMatchObject({ host: "0.0.0.0", port: 8080 });
    expect(config.prices.find((price) => price.model === "gpt-4o")?.inputPerMillion).toBe(1);
    expect(config.prices.at(-1)?.model).toBe("my-model");
    expect(config.source).toBe(file);
  });

  it("lets environment variables override the file and flags override both", () => {
    const directory = workDirectory("config-env");
    const file = path.join(directory, "config.json");
    writeFileSync(file, JSON.stringify({ documentRoot: null, maxFiles: 5 }));
    const env = {
      MCP_ML_TOOLS_CONFIG: file,
      MCP_ML_TOOLS_DOCUMENT_ROOT: "corpus",
      MCP_ML_TOOLS_MAX_FILES: "7",
      MCP_ML_TOOLS_MAX_FILE_BYTES: "99",
      MCP_ML_TOOLS_HTTP_HOST: "localhost",
      MCP_ML_TOOLS_HTTP_PORT: "9000",
      MCP_ML_TOOLS_HTTP_TOKEN: "secret-token",
    };
    const fromEnv = loadConfig({ env, cwd: directory });
    expect(fromEnv).toMatchObject({
      documentRoot: path.join(directory, "corpus"),
      maxFiles: 7,
      maxFileBytes: 99,
    });
    expect(fromEnv.http).toEqual({ host: "localhost", port: 9000, token: "secret-token" });
    const fromFlags = loadConfig({
      env,
      cwd: directory,
      documentRoot: "other",
      host: "127.0.0.1",
      port: 1,
    });
    expect(fromFlags.documentRoot).toBe(path.join(directory, "other"));
    expect(fromFlags.http).toMatchObject({ host: "127.0.0.1", port: 1 });
  });

  it("explains invalid configuration", () => {
    const directory = workDirectory("config-invalid");
    const bad = path.join(directory, "bad.json");
    writeFileSync(bad, JSON.stringify({ maxFiles: -1, unknownKey: true }));
    expect(() => loadConfig({ configPath: bad, env: {} })).toThrow(/maxFiles/);
    const broken = path.join(directory, "broken.json");
    writeFileSync(broken, "{ not json");
    expect(() => loadConfig({ configPath: broken, env: {} })).toThrow(/not valid JSON/);
    expect(() => loadConfig({ configPath: path.join(directory, "missing.json"), env: {} })).toThrow(
      ConfigError,
    );
    expect(() => loadConfig({ env: { MCP_ML_TOOLS_HTTP_PORT: "abc" } })).toThrow(
      /non-negative integer/,
    );
  });

  it("merges prices by model name", () => {
    const merged = mergePrices(DEFAULT_PRICES.slice(0, 2), [
      { ...(DEFAULT_PRICES[0] as ModelPrice), inputPerMillion: 99 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.inputPerMillion).toBe(99);
  });

  it("never exposes the HTTP token", () => {
    const config = loadConfig({ env: { MCP_ML_TOOLS_HTTP_TOKEN: "hunter2" } });
    const exposed = JSON.stringify(publicConfig(config));
    expect(exposed).not.toContain("hunter2");
    expect(publicConfig(config)).toMatchObject({
      filesystemAccess: "disabled",
      http: { tokenRequired: true },
    });
  });
});
