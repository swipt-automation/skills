import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { remark } from "remark";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdx from "remark-mdx";

const { values } = parseArgs({ options: { check: { type: "boolean" } } });
const root = path.dirname(fileURLToPath(import.meta.url));
const swipt = path.join(root, "sources/swipt");
const site = path.join(root, "sources/swipt.io");
const directory = path.join(root, "skills/swipt/references");
const publicDirectory = path.join(site, "public");
const files = new Map();

const api = path.join(swipt, "api");
for (const name of fs
  .readdirSync(api)
  .filter((name) => name.endsWith(".d.ts"))
  .sort()) {
  files.set(`api/${name}`, fs.readFileSync(path.join(api, name)));
}

const sections = [];
function visitCommand(args) {
  const help = execFileSync(
    process.execPath,
    [path.join(swipt, "cli/swipt.mjs"), ...args, "--help"],
    {
      cwd: swipt,
      env: { ...process.env, LC_ALL: "C" },
      encoding: "utf8",
    },
  ).trimEnd();
  sections.push(help);
  const commands = help.match(/^commands:\n((?:[ \t].*\n)+)/m)?.[1] ?? "";
  for (const line of commands.trim().split("\n").filter(Boolean)) {
    visitCommand([...args, line.trim().split(/\s/)[0]]);
  }
}
visitCommand([]);
files.set("cli.txt", Buffer.from(`${sections.join("\n\n")}\n`));

const docs = path.join(site, "content/docs");
const pages = new Map();
const routes = new Map();
for (const name of fs.readdirSync(docs, { recursive: true }).sort()) {
  if (!/\.mdx?$/.test(name)) continue;
  const locale = path
    .basename(name)
    .match(/\.([a-z]{2}(?:-[A-Za-z0-9]+)*)\.mdx?$/)?.[1];
  if (locale !== undefined && locale !== "en") continue;
  const source = path.join(docs, name);
  const target = `docs/${name}`;
  pages.set(source, target);
  const slug = name
    .split(path.sep)
    .filter((part) => !/^\(.*\)$/.test(part))
    .join("/")
    .replace(/(?:\.en)?\.mdx?$/, "")
    .replace(/(^|\/)index$/, "");
  for (const prefix of ["/docs", "/en/docs"]) {
    routes.set(`${prefix}/${slug}`.replace(/\/$/, ""), source);
  }
}

function encodePath(relative) {
  return relative.split(path.sep).map(encodeURIComponent).join("/");
}

function reference(url, source) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\?)/i.test(url) || url === "") return url;
  const [, pathname, suffix] = url.match(/^([^?#]*)(.*)$/);
  const decoded = decodeURIComponent(pathname);
  const file = decoded.startsWith("/")
    ? (routes.get(decoded.replace(/\/$/, "")) ??
      path.join(publicDirectory, decoded))
    : path.resolve(path.dirname(source), decoded);
  const target = pages.get(file);
  if (target !== undefined) {
    return (
      encodePath(path.relative(path.dirname(pages.get(source)), target)) +
      suffix
    );
  }
  const relative = path.relative(publicDirectory, file);
  if (
    relative.startsWith("../") ||
    path.isAbsolute(relative) ||
    !fs.statSync(file, { throwIfNoEntry: false })?.isFile()
  ) {
    throw new Error(
      `Not an English documentation page or public file: ${url} in ${source}`,
    );
  }
  return `https://swipt.io/${encodePath(relative)}${suffix}`;
}

const markdown = remark().use(remarkFrontmatter).use(remarkMdx);
for (const [source, target] of pages) {
  const tree = markdown.parse(fs.readFileSync(source, "utf8"));
  function visit(node) {
    if (typeof node.url === "string") node.url = reference(node.url, source);
    for (const attribute of node.attributes ?? []) {
      if (
        ["src", "href"].includes(attribute.name) &&
        typeof attribute.value === "string"
      ) {
        attribute.value = reference(attribute.value, source);
      }
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  files.set(target, Buffer.from(markdown.stringify(tree)));
}

const existing = fs.existsSync(directory)
  ? fs
      .readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path.relative(directory, path.join(entry.parentPath, entry.name)),
      )
  : [];
const stale = existing.filter((name) => !files.has(name));
const changed = [...files].filter(([name, content]) => {
  const file = path.join(directory, name);
  return !fs.existsSync(file) || !fs.readFileSync(file).equals(content);
});

if (values.check) {
  if (changed.length || stale.length) {
    console.error("Skill references are out of date; run bun generate:");
    for (const name of [...changed.map(([name]) => name), ...stale].sort()) {
      console.error(`  skills/swipt/references/${name}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Skill references are up to date.");
  }
} else {
  for (const name of stale) fs.unlinkSync(path.join(directory, name));
  for (const [name, content] of changed) {
    const file = path.join(directory, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  console.log(
    `Generated ${files.size} skill references in skills/swipt/references.`,
  );
}
