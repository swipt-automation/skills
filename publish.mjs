import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean" } } });
const root = path.dirname(fileURLToPath(import.meta.url));

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(
      `git ${args.join(" ")} exited with ${result.status ?? result.signal}`,
    );
  }
  return result.stdout.trim();
}

const status = git(["status", "--porcelain"]);
if (status) throw new Error(`Uncommitted source changes:\n${status}`);
const refs = new Map(
  git(["ls-remote", "--refs", "origin", "refs/heads/source", "refs/heads/main"])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.split(/\s+/);
      return [ref, sha];
    }),
);
if (refs.get("refs/heads/source") !== git(["rev-parse", "HEAD"])) {
  throw new Error("Check out the latest origin/source before publishing.");
}
const previous = refs.get("refs/heads/main");
if (previous) git(["fetch", "--no-tags", "origin", previous]);

execFileSync(process.execPath, [path.join(root, "generate.mjs"), "--check"], {
  cwd: root,
  stdio: "inherit",
});

const signing = spawnSync(
  "git",
  ["config", "--type=bool", "--get", "commit.gpgsign"],
  { cwd: root, encoding: "utf8" },
);
if (signing.error) throw signing.error;
if (signing.status !== 0 && signing.status !== 1)
  throw new Error(signing.stderr);
const signature = signing.stdout.trim() === "true" ? ["-S"] : [];
const temporary = fs.mkdtempSync(
  path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), "swipt-publish-"),
);
try {
  const output = path.join(temporary, "output");
  fs.mkdirSync(output);
  for (const name of [".claude-plugin", "skills", "LICENSE", "README.md"]) {
    const destination = path.join(output, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(path.join(root, name), destination, {
      recursive: true,
      filter: (file) => path.basename(file) !== ".DS_Store",
    });
  }
  const outputOptions = {
    cwd: output,
    env: {
      ...process.env,
      GIT_DIR: git(["rev-parse", "--absolute-git-dir"]),
      GIT_WORK_TREE: output,
      GIT_INDEX_FILE: path.join(temporary, "output-index"),
    },
  };
  git(["read-tree", "--empty"], outputOptions);
  git(["add", "--force", "--all"], outputOptions);
  const manifestPath = "skills/.claude-plugin/plugin.json";
  const manifestFile = path.join(output, manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const content = git(["write-tree", "--prefix=skills/"], outputOptions);
  manifest.version = `0.0.0-g${content.slice(0, 12)}`;
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  git(["add", "--force", manifestPath], outputOptions);
  const tree = git(["write-tree"], outputOptions);
  let release = previous;
  if (!previous || tree !== git(["rev-parse", `${previous}^{tree}`])) {
    release = git([
      "commit-tree",
      ...signature,
      tree,
      ...(previous ? ["-p", previous] : []),
      "-m",
      "Update skills",
    ]);
    console.log(
      `${values["dry-run"] ? "Would publish" : "Prepared"} ${release}`,
    );
  } else {
    console.log("Published content is unchanged; skipping release.");
  }
  if (values["dry-run"]) {
    console.log("Dry run; no remote refs updated.");
  } else if (release !== previous) {
    git(["push", "origin", `${release}:refs/heads/main`]);
    console.log("Published successfully.");
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
