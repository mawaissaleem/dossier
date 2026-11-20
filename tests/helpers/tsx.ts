import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { join } from "node:path";

// Runs a TypeScript script through tsx's own CLI with the current Node binary. Not node_modules/.bin/tsx: on Windows
// that is tsx.cmd, which execFileSync cannot start without a shell. This form works the same on every OS.
const TSX_CLI = join(process.cwd(), "node_modules/tsx/dist/cli.mjs");
export const runTsx = (args: string[], options: ExecFileSyncOptions = {}) =>
  execFileSync(process.execPath, [TSX_CLI, ...args], options);
