/* ==========================================================================
   SAMRAJYA - COUNTING THE CHECKS

   A script that says how many checks a revision of this repository has, and of
   what kind, without running anything.

   The number a test run prints ("238 passed, 0 failed") is the number of
   checks that RAN. The number this script prints is the number that are
   WRITTEN. The two are different, and the difference is not a mistake: a check
   written inside a condition does not run when the condition is false, and a
   check written inside the two-screen loop runs once per screen.

   So this script counts, for the end-to-end suite:

     sites          - every note() call: one written check each
     per screen     - sites inside the loop that walks both screens
     conditional    - sites inside an if or a case, so they run only sometimes
     screens        - how many screens the suite drives

   and for the other two suites:

     unit tests     - every test() block in test/
     unit asserts   - every assert.* call in test/
     asset checks   - every check() call in scripts/check-assets.js

   Usage:
     node scripts/count-checks.mjs [revision]
     node scripts/count-checks.mjs --diff <old revision> [new revision]

   The diff mode lists every check that changed name, moved, was added or was
   removed between two revisions, with the line it was on in each.
   ========================================================================== */

import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const diffMode = args[0] === "--diff";
const rev = diffMode ? args[1] || "HEAD" : args[0] || "HEAD";
const rev2 = diffMode ? args[2] || "HEAD" : null;

/** The text of a file at a revision. */
const at = (path) => {
  try {
    return execFileSync("git", ["show", `${rev}:${path}`], { encoding: "utf8" });
  } catch {
    return null;
  }
};

/** The text of a file at another revision. */
const at2 = (path) => {
  try {
    return execFileSync("git", ["show", `${rev2}:${path}`], { encoding: "utf8" });
  } catch {
    return null;
  }
};

/** The list of paths at a revision, under a directory. */
const list = (dir) => {
  try {
    return execFileSync("git", ["ls-tree", "-r", "--name-only", rev, dir], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
};

/** How many times a pattern appears. */
const count = (text, pattern) => (text.match(pattern) || []).length;

/**
 * Every note() site in a suite, and the blocks each one sits inside.
 *
 * The blocks are found by keeping a stack of open braces as the file is read:
 * a site's enclosing blocks are the stack at that point. That is exact, and it
 * says things a reader of the file has to work out by eye: a note inside the
 * two-screen loop runs twice, and a note inside an if runs only when the
 * condition is true.
 */
function sites(text) {
  const lines = text.split("\n");
  const stack = [];
  // The blocks open at the start of each line: a check on that line sits
  // inside them.
  const stackBefore = [];
  lines.forEach((line) => {
    stackBefore.push(stack.map((b) => b.header));
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    for (let i = 0; i < opens; i += 1) stack.push({ header: line.trim() });
    for (let i = 0; i < closes; i += 1) stack.pop();
  });

  // Every note() call, wherever its label sits: a call whose label is on the
  // next line is still a check.
  const re = /note\(\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*")/g;
  const found = [];
  let m;
  while ((m = re.exec(text))) {
    const line = text.slice(0, m.index).split("\n").length;
    found.push({
      label: (m[1] || "").replace(/[`"]/g, "").trim(),
      line,
      blocks: stackBefore[line - 1] || [],
    });
  }
  return found;
}

const rows = [];
const e2e = at("scripts/e2e.js");

if (e2e) {
  const s = sites(e2e);
  const twoScreenLoop = /for\s*\(\s*const\s*\[label,\s*page\]\s*of/;
  const guard = /if\s*\(\s*label\s*!==\s*"host"\s*\)\s*continue;/;
  const lines = e2e.split("\n");
  const guardLine = lines.findIndex((l) => guard.test(l));
  const loopLine = lines.findIndex((l) => twoScreenLoop.test(l));
  // A site inside the two-screen loop, and where in the loop it sits: before
  // the host-only guard it runs on both screens, after it on one.
  const inLoop = (x) => x.blocks.some((b) => twoScreenLoop.test(b));
  const afterGuard = (x) => inLoop(x) && guardLine > -1 && x.line > guardLine + 1;
  const beforeGuard = (x) => inLoop(x) && !afterGuard(x);
  const conditional = (x) =>
    x.blocks.some((b) => /^(if|else if|case|while)\b/.test(b) || /\?/.test(b));
  const always = (x) => !inLoop(x) && !conditional(x);
  // A site inside a loop that runs more than once is a parameterised check:
  // one written check, several runs.
  const loopOf = (x) => x.blocks.filter((b) =>
    /^(for|while)\b/.test(b) && !twoScreenLoop.test(b));
  const repeated = s.filter((x) => loopOf(x).length);
  rows.push(["e2e: written checks (note sites)", s.length]);
  rows.push(["e2e: of those, in the two-screen loop", s.filter(inLoop).length]);
  rows.push(["e2e:   ... before the host-only guard (run twice)",
    s.filter(beforeGuard).length]);
  rows.push(["e2e:   ... after the host-only guard (run once)",
    s.filter(afterGuard).length]);
  rows.push(["e2e: of those, inside a condition", s.filter(conditional).length]);
  rows.push(["e2e: of those, inside neither (always run)", s.filter(always).length]);
  rows.push(["e2e: of those, inside a repeating loop", repeated.length]);
  for (const x of repeated) {
    rows.push([`    ... ${x.label.slice(0, 46)}`, loopOf(x).map((b) => b.slice(0, 40)).join(" | ")]);
  }
  rows.push(["e2e: two-screen loops in the suite", count(e2e, twoScreenLoop)]);
  rows.push(["e2e: screens the suite drives", twoScreenLoop.test(e2e) ? 2 : 1]);
  rows.push(["e2e: largest number a full run can print",
    s.filter(beforeGuard).length * 2 + s.length - s.filter(beforeGuard).length]);
} else {
  rows.push(["e2e: written checks (note sites)", "no scripts/e2e.js"]);
}

const unitFiles = list("test").filter((p) => p.endsWith(".test.js"));
let unitTests = 0;
let unitAssertions = 0;
for (const file of unitFiles) {
  const text = at(file) || "";
  unitTests += count(text, /\btest\(/g);
  unitAssertions += count(text, /\bassert\./g);
}
rows.push(["unit: named test cases (test() blocks)", unitTests]);
rows.push(["unit: individual assertions (assert.* calls)", unitAssertions]);
rows.push(["unit: test files", unitFiles.length]);

const assets = at("scripts/check-assets.js");
rows.push(["assets: checks (check() calls)", assets ? count(assets, /\bcheck\(/g) : "n/a"]);

const width = Math.max(...rows.map((r) => String(r[0]).length));
console.log(`\nrevision ${rev}`);
for (const [k, v] of rows) console.log(`  ${String(k).padEnd(width)}  ${v}`);
console.log("");

/* ------------------------------------------------------------------- diff */

if (diffMode) {
  const oldSites = sites(at("scripts/e2e.js") || "");
  const newSites = sites(at2("scripts/e2e.js") || "");

  // A check is the same check when it says the same thing. The name is the
  // identity: a check that changed its wording is a new check, and the report
  // below says so rather than pretending it is the same one.
  const oldByLabel = new Map();
  for (const s of oldSites) oldByLabel.set(s.label, s);
  const newByLabel = new Map();
  for (const s of newSites) newByLabel.set(s.label, s);

  const removed = oldSites.filter((s) => !newByLabel.has(s.label));
  const added = newSites.filter((s) => !oldByLabel.has(s.label));
  const moved = oldSites.filter((s) => newByLabel.has(s.label) &&
    newByLabel.get(s.label).line !== s.line);

  console.log(`diff ${rev} -> ${rev2}`);
  console.log(`  checks written in the old suite: ${oldSites.length}`);
  console.log(`  checks written in the new suite: ${newSites.length}`);
  console.log(`  same name and same place:        ${oldSites.length - removed.length - moved.length}`);
  console.log(`  same name, moved:                 ${moved.length}`);
  console.log(`  removed:                          ${removed.length}`);
  console.log(`  added:                            ${added.length}`);
  console.log("\n  REMOVED (old line -> label)");
  for (const s of removed) console.log(`    ${String(s.line).padStart(5)}  ${s.label}`);
  console.log("\n  ADDED (new line -> label)");
  for (const s of added) console.log(`    ${String(s.line).padStart(5)}  ${s.label}`);
  console.log("\n  MOVED (old -> new line)");
  for (const s of moved) {
    console.log(`    ${String(s.line).padStart(5)} -> ${String(newByLabel.get(s.label).line).padStart(5)}  ${s.label}`);
  }
  console.log("");
}
