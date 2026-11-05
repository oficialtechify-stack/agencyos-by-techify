import { readdir, readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

const files = [];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (p.endsWith(".js")) files.push(p);
  }
}
await walk("api");
const tmp = await mkdtemp(join(tmpdir(), "syntax-"));
for (const html of ["index.html", "recover.html"]) {
  const src = await readFile(html, "utf8");
  const scripts = [...src.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  for (let i = 0; i < scripts.length; i++) {
    const p = join(tmp, `${html}-${i}.js`);
    await writeFile(p, scripts[i]);
    files.push(p);
  }
}
for (const f of files) await run(process.execPath, ["--check", f]);
console.log(`syntax ok: ${files.length} arquivos`);
