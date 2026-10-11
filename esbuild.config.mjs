import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkBundleNotices, parseBundleNotice } from "./scripts/bundle-notices.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const absWorkingDir = fileURLToPath(new URL(".", import.meta.url));
// A failed parse/build/check must not leave a previous bundle packageable.
await rm(`${root}main.js`, { force: true });
const notice = parseBundleNotice(await readFile(new URL("./THIRD_PARTY_NOTICES.md", import.meta.url), "utf8"));
await mkdir(`${root}dist`, { recursive: true });
const result = await build({
  absWorkingDir,
  entryPoints: [`${root}src/main.ts`],
  outfile: `${root}main.js`,
  write: false,
  metafile: true,
  banner: { js: notice.banner },
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "chrome120",
  // Embedded functions are serialized with toString(); keep their shipped form
  // compact without renaming identifiers or changing syntax.
  minifyWhitespace: true,
  charset: "utf8",
  external: ["obsidian", "fs", "path"],
  define: { "process.env.THOUGHTFORGE_DEBUG_TRACE": '"0"' },
  logLevel: "info"
});
const packages = await checkBundleNotices(notice, result.metafile, absWorkingDir);
for (const output of result.outputFiles) await writeFile(output.path, output.contents);
await writeFile(`${root}dist/metafile.json`, JSON.stringify(result.metafile, null, 2) + "\n");
await writeFile(`${root}dist/third-party-packages.json`, JSON.stringify(packages, null, 2) + "\n");
console.log(`Bundle third-party notices: ${packages.map(pkg => `${pkg.name}@${pkg.version}`).join(", ")}`);

