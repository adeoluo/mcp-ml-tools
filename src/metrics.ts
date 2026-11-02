interface ToolStatistics {
  calls: number;
  errors: number;
  totalSeconds: number;
}

/** In-process call counters and latency totals per tool, exported in Prometheus text format. */
export class Metrics {
  private readonly tools = new Map<string, ToolStatistics>();
  private readonly startedAt = Date.now();

  record(tool: string, seconds: number, failed: boolean): void {
    const entry = this.tools.get(tool) ?? { calls: 0, errors: 0, totalSeconds: 0 };
    entry.calls += 1;
    entry.totalSeconds += seconds;
    if (failed) entry.errors += 1;
    this.tools.set(tool, entry);
  }

  snapshot(): { uptimeSeconds: number; tools: Record<string, ToolStatistics> } {
    return {
      uptimeSeconds: (Date.now() - this.startedAt) / 1000,
      tools: Object.fromEntries([...this.tools.entries()].sort(([x], [y]) => x.localeCompare(y))),
    };
  }

  prometheus(): string {
    const lines = [
      "# HELP mcp_ml_tools_tool_calls_total Tool calls handled.",
      "# TYPE mcp_ml_tools_tool_calls_total counter",
    ];
    const snapshot = this.snapshot();
    for (const [tool, entry] of Object.entries(snapshot.tools)) {
      lines.push(`mcp_ml_tools_tool_calls_total{tool="${tool}"} ${entry.calls}`);
    }
    lines.push(
      "# HELP mcp_ml_tools_tool_errors_total Tool calls that returned an error.",
      "# TYPE mcp_ml_tools_tool_errors_total counter",
    );
    for (const [tool, entry] of Object.entries(snapshot.tools)) {
      lines.push(`mcp_ml_tools_tool_errors_total{tool="${tool}"} ${entry.errors}`);
    }
    lines.push(
      "# HELP mcp_ml_tools_tool_seconds_total Total time spent in tool handlers.",
      "# TYPE mcp_ml_tools_tool_seconds_total counter",
    );
    for (const [tool, entry] of Object.entries(snapshot.tools)) {
      lines.push(
        `mcp_ml_tools_tool_seconds_total{tool="${tool}"} ${entry.totalSeconds.toFixed(6)}`,
      );
    }
    lines.push(
      "# HELP mcp_ml_tools_uptime_seconds Seconds since the process started.",
      "# TYPE mcp_ml_tools_uptime_seconds gauge",
      `mcp_ml_tools_uptime_seconds ${snapshot.uptimeSeconds.toFixed(3)}`,
    );
    return `${lines.join("\n")}\n`;
  }
}
