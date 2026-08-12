import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tracked = execFileSync("git", ["ls-files"], {
  cwd: root,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);

const required = [
  "LICENSE",
  "NOTICE",
  "README.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "SUPPORT.md",
  "CHANGELOG.md",
  "ROADMAP.md",
  ".env.example",
  ".gitleaks.toml",
  ".github/PULL_REQUEST_TEMPLATE.md",
];

const forbiddenPrefixes = [
  ".agents/",
  ".claude/",
  ".idea/",
  ".next/",
  "supabase/.temp/",
];
const forbiddenFiles = [".env", ".env.local", ".DS_Store", "tsconfig.tsbuildinfo"];

const failures = [];
for (const file of required) {
  if (!tracked.includes(file)) failures.push(`required file is not tracked: ${file}`);
}
for (const file of tracked) {
  if (forbiddenFiles.includes(file) || forbiddenPrefixes.some((prefix) => file.startsWith(prefix))) {
    failures.push(`machine-local or private path is tracked: ${file}`);
  }
}

const markdownLink = /\[[^\]]+\]\(([^)]+)\)/g;
for (const file of tracked.filter((path) => path.endsWith(".md"))) {
  const body = readFileSync(resolve(root, file), "utf8");
  if (body.includes("/Users/")) failures.push(`absolute user path in ${file}`);
  for (const match of body.matchAll(markdownLink)) {
    const target = match[1].split("#", 1)[0];
    if (
      !target ||
      /^(?:https?:|mailto:|#)/.test(target) ||
      target.startsWith("../../") ||
      target.startsWith("../blob/")
    ) continue;
    const local = resolve(root, dirname(file), target);
    if (!existsSync(local)) failures.push(`broken local link in ${file}: ${match[1]}`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`OSS readiness hygiene passed (${tracked.length} tracked files).`);
