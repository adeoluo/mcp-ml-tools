import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "./config.js";
import { Metrics } from "./metrics.js";
import { createServer } from "./server.js";
import { NAME, VERSION } from "./version.js";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function jsonRpcError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new RangeError("request body too large");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : JSON.parse(text);
}

function authorized(request: IncomingMessage, token: string | null): boolean {
  if (token === null) return true;
  const header = request.headers.authorization ?? "";
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** Host header check that blocks DNS rebinding when the server is bound to loopback. */
export function isLoopbackHostHeader(header: string | undefined): boolean {
  if (header === undefined) return false;
  const hostname = header.startsWith("[")
    ? header.slice(0, header.indexOf("]") + 1)
    : header.split(":")[0];
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

/**
 * Starts a stateless Streamable HTTP endpoint at /mcp: each POST gets a fresh server and transport,
 * which suits these stateless tools and needs no session store. Also serves /healthz and /metrics.
 */
export async function startHttpServer(config: Config, metrics = new Metrics()): Promise<Server> {
  const { host, port, token } = config.http;
  if (!isLoopback(host) && token === null) {
    console.error(
      `[${NAME}] warning: listening on ${host} without MCP_ML_TOOLS_HTTP_TOKEN; any client that can ` +
        "reach this address can call the tools",
    );
  }

  const httpServer = createHttpServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/healthz" && request.method === "GET") {
        sendJson(response, 200, { status: "ok", name: NAME, version: VERSION });
        return;
      }
      if (url.pathname === "/metrics" && request.method === "GET") {
        response.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
        response.end(metrics.prometheus());
        return;
      }
      if (url.pathname !== "/mcp") {
        sendJson(response, 404, { error: "not found" });
        return;
      }
      if (isLoopback(host) && !isLoopbackHostHeader(request.headers.host)) {
        jsonRpcError(response, 403, "forbidden: unexpected Host header");
        return;
      }
      if (!authorized(request, token)) {
        jsonRpcError(response, 401, "unauthorized");
        return;
      }
      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        jsonRpcError(response, 405, "method not allowed: this server is stateless, use POST");
        return;
      }
      let body: unknown;
      try {
        body = await readBody(request);
      } catch (error) {
        jsonRpcError(
          response,
          error instanceof RangeError ? 413 : 400,
          `invalid request body: ${(error as Error).message}`,
        );
        return;
      }
      const server = createServer({ config, metrics });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      response.on("close", () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(request, response, body);
      } catch (error) {
        console.error(`[${NAME}] HTTP request failed:`, error);
        if (!response.headersSent) jsonRpcError(response, 500, "internal server error");
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  return httpServer;
}
