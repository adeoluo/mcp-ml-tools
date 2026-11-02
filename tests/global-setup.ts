import { execSync } from "node:child_process";

/** The integration tests spawn the compiled server, so build it once before the run. */
export default function setup(): void {
  execSync("npm run -s build", { stdio: "inherit" });
}
