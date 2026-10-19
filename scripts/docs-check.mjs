// docs:check — markdown links, code-fence balance and vocabulary consistency.
// Usage: node scripts/docs-check.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const files = readdirSync(join(root)).filter((f) => f.endsWith(".md"));
let failures = 0;
const vocab = ["Chronoscope", "DevWorld"];
for (const file of files) {
  const text = readFileSync(join(root, file), "utf8");
  const fences = (text.match(/```/g) || []).length;
  if (fences % 2 !== 0) {
    console.error(`${file}: unbalanced code fences`);
    failures++;
  }
  for (const match of text.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
    const target = match[2];
    if (target.startsWith("http") || target.startsWith("#") || target.startsWith("mailto:")) continue;
    const clean = target.split("#")[0];
    try {
      readFileSync(join(root, clean), "utf8");
    } catch {
      // Allow API route-style links and anchors handled elsewhere.
      if (!clean.startsWith("/api/")) {
        console.error(`${file}: broken link -> ${target}`);
        failures++;
      }
    }
  }
}
const vocabByOwner = { "PRD.md": ["DevWorld"], "DESIGN.md": ["Chronoscope", "DevWorld"] };
for (const [file, words] of Object.entries(vocabByOwner)) {
  let text;
  try {
    text = readFileSync(join(root, file), "utf8");
  } catch {
    // Specs live in Docs/ until the M0 root copy lands; check there instead.
    text = readFileSync(join(root, "Docs", file), "utf8");
  }
  for (const word of words) {
    if (!text.includes(word)) {
      console.error(`${file}: expected vocabulary ${word}`);
      failures++;
    }
  }
}
if (failures > 0) process.exit(1);
console.log(`docs:check ok (${files.length} files)`);
