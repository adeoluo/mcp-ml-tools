#!/usr/bin/env node
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadConfig } from "./config.js";
import { startHttpServer } from "./http.js";
import { Metrics } from "./metrics.js";
import { createServer } from "./server.js";
import { NAME, VERSION } from "./version.js";

const HELP = `${NAME} ${VERSION}: Model Context Protocol server with machine learning engineering tools

Usage:
  ${NAME} [options]            run over stdio (for Claude Desktop, VS Code, Cursor)
  ${NAME} --http [options]     run a Streamable HTTP endpoint at http://HOST:PORT/mcp

Options:
  --config <path>          JSON configuration file (or MCP_ML_TOOLS_CONFIG)
  --document-root <path>   allow bm25_search to read files under this directory
                           (or MCP_ML_TOOLS_DOCUMENT_ROOT; default: no filesystem access)
  --http                   use Streamable HTTP instead of stdio
  --host <host>            HTTP bind address (default 127.0.0.1)
  --port <port>            HTTP port (default 3333)
  --version                print the version
  --help                   print this help

Environment: MCP_ML_TOOLS_CONFIG, MCP_ML_TOOLS_DOCUMENT_ROOT, MCP_ML_TOOLS_MAX_FILES,
MCP_ML_TOOLS_MAX_FILE_BYTES, MCP_ML_TOOLS_HTTP_HOST, MCP_ML_TOOLS_HTTP_PORT,
MCP_ML_TOOLS_HTTP_TOKEN (require "Authorization: Bearer <token>" on /mcp).
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      "document-root": { type: "string" },
      http: { type: "boolean", default: false },
      host: { type: "string" },
      port: { type: "string" },
      version: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65_535)) {
    throw new ConfigError(`--port must be an integer from 0 to 65535, got "${values.port}"`);
  }
  const config = loadConfig({
    configPath: values.config,
    documentRoot: values["document-root"],
    host: values.host,
    port,
  });
  const metrics = new Metrics();

  if (values.http) {
    const server = await startHttpServer(config, metrics);
    const address = server.address();
    const shown =
      typeof address === "object" && address !== null ? `${address.address}:${address.port}` : "";
    console.error(`[${NAME}] Streamable HTTP listening on http://${shown}/mcp`);
    const shutdown = (): void => {
      server.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  const server = createServer({ config, metrics });
  await server.connect(new StdioServerTransport());
  console.error(
    `[${NAME}] ${VERSION} running on stdio; filesystem access ` +
      (config.documentRoot === null ? "disabled" : `limited to ${config.documentRoot}`),
  );
}

main().catch((error: unknown) => {
  console.error(`[${NAME}] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
