// Runs Vitest with every path using an upper-case drive letter.
// On Windows, VS Code can start terminals in "c:\..."; Vitest then loads its own modules from
// "c:\..." and the tests from "C:\..." and fails with
// "Cannot read properties of undefined (reading 'config')". Elsewhere it's a no-op.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const upperDrive = (path) => path.replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const cwd = upperDrive(process.cwd());
const bin = upperDrive(fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)));
const { status } = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { cwd, stdio: "inherit" });
process.exit(status ?? 1);
