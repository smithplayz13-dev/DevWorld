// contracts:check — fail if openapi.json drifts from the backend schema.
// Usage: node scripts/check-contracts.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const committed = new URL("../packages/contracts/openapi.json", import.meta.url);
let before = "";
try {
  before = readFileSync(committed, "utf8");
} catch {
  console.error("packages/contracts/openapi.json missing — run pnpm contracts:generate");
  process.exit(1);
}
const cmd = "uv";
const fresh = execFileSync(
  cmd,
  ["run", "--project", "apps/backend", "python", "-c",
    "import json; from devworld.api.main import create_app; print(json.dumps(create_app().openapi(), indent=2))"],
  { encoding: "utf8" },
);
if (fresh.trim() !== before.trim()) {
  console.error("contract drift: openapi.json differs from backend schema. Run pnpm contracts:generate.");
  process.exit(1);
}
console.log("contracts:check ok");
