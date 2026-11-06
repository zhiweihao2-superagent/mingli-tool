import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const web = path.join(root, "web");
const files = {};

function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(absolute);
    else {
      const relative = `/${path.relative(web, absolute).split(path.sep).join("/")}`;
      files[relative] = readFileSync(absolute, "utf8");
    }
  }
}

collect(web);
const worker = readFileSync(path.join(root, "worker/index.js"), "utf8");
if (!worker.includes("__EMBEDDED_ASSETS__")) throw new Error("Worker asset placeholder is missing.");
rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, "server"), { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });
writeFileSync(path.join(dist, "server/index.js"), worker.replace("__EMBEDDED_ASSETS__", JSON.stringify(files)));
cpSync(path.join(root, ".openai/hosting.json"), path.join(dist, ".openai/hosting.json"));
console.log(`Built Worker with ${Object.keys(files).length} embedded static assets.`);
