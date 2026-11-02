/** An error caused by invalid tool input; reported to the client as a tool error, not a crash. */
export class ToolInputError extends Error {
  override readonly name = "ToolInputError";
}
