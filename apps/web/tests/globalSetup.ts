import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

export default async function setup(): Promise<void> {
  const monorepoRoot = path.resolve(__dirname, "../../..");
  const distServer = path.join(
    monorepoRoot,
    "packages/adapter-demo/dist/server.js",
  );
  if (!fs.existsSync(distServer)) {
    execSync("npm run build -w @ratesassist/adapter-demo", {
      cwd: monorepoRoot,
      stdio: "inherit",
    });
  }
}
