import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const start = "<!-- bundle-notice:start -->";
const end = "<!-- bundle-notice:end -->";
const normalize = text => text.replace(/\r\n?/g, "\n").trim();
const copiedSource = "packages/core/src/note-mode/quotes.ts";
const copiedInput = "packages/core/dist/note-mode/quotes.js";
const supplementalLicenses = new Map([["copied-quotes", "MIT"], ["joyent", "MIT"], ["unicode", "Unicode-3.0"]]);

// The release document owns both the package/version inventory and full text.
export function parseBundleNotice(markdown) {
  if (markdown.split(start).length !== 2 || markdown.split(end).length !== 2) {
    throw Error("Expected exactly one marked bundle NOTICE block");
  }
  const marked = markdown.split(start)[1].split(end)[0].trim();
  const match = /^```text\n([\s\S]*?)\n```$/.exec(marked);
  if (!match || match[1].includes("*/")) throw Error("Unsafe or malformed bundle NOTICE comment");
  const text = match[1];
  const packages = new Map();
  const supplements = new Map();
  for (const section of text.split(/^={72}\n/m).slice(1)) {
    const supplemental = /^Supplement: (\S+) — (\S+)\n/.exec(section);
    if (supplemental) {
      const [, id, license] = supplemental;
      if (!supplementalLicenses.has(id)) throw Error(`Unknown bundle NOTICE supplement: ${id}`);
      if (supplements.has(id)) throw Error(`Duplicate bundle NOTICE supplement: ${id}`);
      if (license !== supplementalLicenses.get(id)) throw Error(`Bundle NOTICE supplemental license mismatch: ${id}`);
      supplements.set(id, { id, license, text: section });
      continue;
    }
    const header = /^(\S+) (\S+) — (\S+)\n/.exec(section);
    if (!header) throw Error("Malformed bundle NOTICE section; expected package or Supplement header");
    const [, name, version, license] = header;
    const key = `${name}@${version}`;
    if (packages.has(key)) throw Error(`Duplicate bundle NOTICE package: ${key}`);
    packages.set(key, { name, version, license, text: section });
  }
  if (!packages.size) throw Error("Empty bundle NOTICE inventory");
  return { text, packages, supplements, banner: `/*!\n${text}\n*/` };
}

export async function collectBundledPackages(metafile, absWorkingDir) {
  if (!metafile?.outputs || typeof metafile.outputs !== "object" || Array.isArray(metafile.outputs)) {
    throw Error("Bundle metafile with outputs is required; enable esbuild metafile: true");
  }
  const packages = new Map();
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, contribution] of Object.entries(output.inputs)) {
      if (contribution.bytesInOutput <= 0) continue;
      const parts = input.split(/[\\/]/);
      const modules = parts.lastIndexOf("node_modules");
      if (modules < 0) continue; // Workspace code, including adapted sources.
      const scoped = parts[modules + 1]?.startsWith("@");
      const packageRoot = resolve(absWorkingDir, parts.slice(0, modules + (scoped ? 3 : 2)).join("/"));
      const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
      if (!metadata.name || !metadata.version) throw Error(`Missing package identity: ${input}`);
      const key = `${metadata.name}@${metadata.version}`;
      let record = packages.get(key);
      if (!record) {
        record = { name: metadata.name, version: metadata.version, license: metadata.license,
          inputs: 0, bytesInOutput: 0, roots: new Set() };
        packages.set(key, record);
      }
      record.roots.add(packageRoot);
      record.inputs++;
      record.bytesInOutput += contribution.bytesInOutput;
    }
  }
  return packages;
}

export async function checkBundleNotices(notice, metafile, absWorkingDir) {
  const bundled = await collectBundledPackages(metafile, absWorkingDir);
  const inputs = new Set(Object.values(metafile.outputs).flatMap(output => Object.entries(output.inputs)
    .filter(([, contribution]) => contribution.bytesInOutput > 0)
    .map(([input]) => resolve(absWorkingDir, input))));
  const expected = new Set();
  if ([copiedInput, copiedSource].some(input => inputs.has(resolve(absWorkingDir, input)))) expected.add("copied-quotes");
  if ([...bundled.values()].some(pkg => pkg.name === "mdurl")) expected.add("joyent");
  if ([...bundled.values()].some(pkg => pkg.name === "uc.micro")) expected.add("unicode");
  const missingSupplements = [...expected].filter(id => !notice.supplements.has(id));
  const extraSupplements = [...notice.supplements.keys()].filter(id => !expected.has(id));
  if (missingSupplements.length || extraSupplements.length) {
    throw Error(`Bundle NOTICE supplement mismatch; missing: ${missingSupplements.join(", ") || "none"}; extra: ${extraSupplements.join(", ") || "none"}`);
  }
  if (expected.has("copied-quotes")) {
    const section = notice.supplements.get("copied-quotes").text;
    const source = await readFile(resolve(absWorkingDir, copiedSource), "utf8")
      .catch(() => { throw Error(`Missing bundle NOTICE copied source: ${copiedSource}`); });
    if (!section.includes(`Source: ${copiedSource}\n`) || !section.includes("Origin: markdown-it 14.3.0 ") ||
      !source.includes("// Adapted from markdown-it 14.3.0 ")) {
      throw Error(`Incomplete bundle NOTICE copied source correspondence: ${copiedSource}`);
    }
    const license = normalize(/^\/\*([\s\S]*?)\*\//.exec(source)?.[1] ?? "");
    const noticeLicense = normalize(section.split("\n\n").slice(1).join("\n\n"));
    if (!license || license !== noticeLicense) {
      throw Error(`Incomplete bundle NOTICE copied source LICENSE: ${copiedSource}`);
    }
  }
  if (expected.has("unicode")) {
    const section = notice.supplements.get("unicode").text;
    const license = section.slice(section.indexOf("UNICODE LICENSE V3\n"));
    const hash = createHash("sha256").update(normalize(license) + "\n").digest("hex");
    if (hash !== "e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96" ||
      !section.includes("Original Unicode 15.1.0 data attribution: © 2023 Unicode®, Inc.") ||
      !section.includes("UNCONFIRMED BEFORE DISTRIBUTION:\nThe generation-time license text and absence of Unicode 15.1.0-specific\nexceptions have not been fixed from release-specific official evidence.")) {
      throw Error("Incomplete bundle NOTICE Unicode attribution, fixed License v3 or historical-check warning");
    }
  }
  const missing = [...bundled.keys()].filter(key => !notice.packages.has(key));
  const extra = [...notice.packages.keys()].filter(key => !bundled.has(key));
  if (missing.length || extra.length) {
    throw Error(`Bundle NOTICE inventory mismatch; missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}`);
  }
  for (const [key, record] of bundled) {
    const section = notice.packages.get(key);
    if (section.license !== record.license) throw Error(`Bundle NOTICE license mismatch: ${key}`);
    for (const packageRoot of record.roots) {
      const licenses = (await readdir(packageRoot)).filter(name => /^licen[sc]e(?:[.-]|$)/i.test(name));
      if (!licenses.length) throw Error(`No package LICENSE found: ${key}`);
      for (const file of licenses) {
        const license = normalize(await readFile(join(packageRoot, file), "utf8"));
        // mdurl's LICENSE has a second MIT notice, now in a typed Joyent section.
        const fullText = normalize(section.text) + (record.name === "mdurl" ?
          "\n\n" + normalize(notice.supplements.get("joyent").text.split("\n").slice(1).join("\n")) : "");
        if (!license || !fullText.includes(license)) {
          throw Error(`Incomplete bundle NOTICE LICENSE: ${key}/${file}`);
        }
      }
    }
  }
  return [...bundled.values()].map(({ roots, ...record }) => record)
    .sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
}
