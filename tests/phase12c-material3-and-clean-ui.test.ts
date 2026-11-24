import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

async function collectFiles(dir: string, extension: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, extension)));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractUserFacingTextAndStrings(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "")
    .replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "");

  const snippets: string[] = [];

  for (const match of withoutComments.matchAll(/"([^"\n\\]*(?:\\.[^"\n\\]*)*)"/g)) {
    const value = match[1];
    if (!value) continue;
    if (/^[a-z0-9_.:/-]+$/.test(value)) continue;
    snippets.push(value);
  }
  for (const match of withoutComments.matchAll(/`([^`\\]*(?:\\.[^`\\]*)*)`/g)) {
    const value = match[1];
    if (!value) continue;
    snippets.push(value);
  }
  for (const match of withoutComments.matchAll(/>([^<>{}]+)</g)) {
    const trimmed = match[1]?.trim();
    if (trimmed) snippets.push(trimmed);
  }

  return snippets;
}

test("layout, theme tokens, and globals enforce a single self-hosted Material 3 Roboto typescale", async () => {
  const layout = await readFile(path.join(ROOT, "src/app/layout.tsx"), "utf8");
  assert.match(layout, /import\s+\{\s*Roboto\s*\}\s+from\s+["']next\/font\/google["']/);
  assert.match(layout, /@material\/web\/typography\/md-typescale-styles\.css/);
  assert.match(layout, /--font-roboto/);
  assert.match(layout, /roboto\.variable/);

  const theme = await readFile(path.join(ROOT, "src/styles/material-theme.css"), "utf8");
  assert.match(theme, /--md-ref-typeface-brand:\s*var\(--font-roboto\),\s*"Roboto",\s*sans-serif;/);
  assert.match(theme, /--md-ref-typeface-plain:\s*var\(--font-roboto\),\s*"Roboto",\s*sans-serif;/);
  assert.equal(/\bInter\b/.test(theme), false);
  assert.equal(/--md-.*-button-container-shape:\s*var\(--md-sys-shape-corner-small\)/.test(theme), false);

  const globals = await readFile(path.join(ROOT, "src/app/globals.css"), "utf8");
  assert.equal(/button,\s*input,\s*textarea,\s*select\s*\{\s*font:\s*inherit;/.test(globals), false);
  assert.match(globals, /--md-sys-typescale-body-medium-font/);
});

test("Material Web registers elevated-button, divider, elevation, and input-chip adapters", async () => {
  const registerFile = await readFile(path.join(ROOT, "src/components/material/register.ts"), "utf8");
  assert.match(registerFile, /@material\/web\/button\/elevated-button\.js/);
  assert.match(registerFile, /@material\/web\/divider\/divider\.js/);
  assert.match(registerFile, /@material\/web\/elevation\/elevation\.js/);
  assert.match(registerFile, /@material\/web\/chips\/input-chip\.js/);

  const buttonFile = await readFile(path.join(ROOT, "src/components/material/material-button.tsx"), "utf8");
  assert.match(buttonFile, /"elevated"/);
  assert.match(buttonFile, /<md-elevated-button\b/);

  const chipFile = await readFile(path.join(ROOT, "src/components/material/material-input-chip.tsx"), "utf8");
  assert.match(chipFile, /<md-input-chip\b/);
  assert.match(chipFile, /event\.preventDefault\(\)/);

  const typesFile = await readFile(path.join(ROOT, "src/components/material/types.d.ts"), "utf8");
  assert.match(typesFile, /"md-elevated-button"/);
  assert.match(typesFile, /"md-divider"/);
  assert.match(typesFile, /"md-elevation"/);
  assert.match(typesFile, /"md-input-chip"/);
});

test("UI components and pages render zero raw native HTML buttons, selects, textareas, or visible inputs", async () => {
  const roots = [path.join(ROOT, "src/app"), path.join(ROOT, "src/components")];
  const files = (await Promise.all(roots.map((dir) => collectFiles(dir, ".tsx")))).flat();
  assert.ok(files.length > 20);

  for (const absPath of files) {
    const relPath = path.relative(ROOT, absPath);
    const source = await readFile(absPath, "utf8");
    const rawControlMatch = source.match(/<(?:button|select|textarea)\b/);
    assert.equal(
      rawControlMatch,
      null,
      `Found raw native control ${rawControlMatch?.[0]} in ${relPath}`,
    );

    const inputMatches = [...source.matchAll(/<input\b[\s\S]*?>/g)];
    for (const match of inputMatches) {
      assert.equal(
        relPath,
        path.normalize("src/components/conversation/conversation-composer.tsx"),
        `Unexpected <input> outside hidden file picker in ${relPath}`,
      );
      assert.match(
        match[0],
        /type="file"/,
        `Only hidden type="file" inputs are permitted; got ${match[0]} in ${relPath}`,
      );
    }
  }
});

test("stylesheets contain zero Tailwind, zero hardcoded px font sizes, zero custom box-shadows, and zero dead selectors", async () => {
  const pkg = await readFile(path.join(ROOT, "package.json"), "utf8");
  assert.equal(/tailwindcss/.test(pkg), false);

  const cssFiles = [
    ...(await collectFiles(path.join(ROOT, "src/styles"), ".css")),
    path.join(ROOT, "src/app/globals.css"),
  ];

  const deadSelectorPattern =
    /\.(?:ano-nav-link|ano-ws-trigger|ano-ws-menu|ano-select|ano-sidebar-signout|ano-sidebar-signin|m3-attachment-chip|m3-row-action-btn|m3-template-textarea|m3-template-select|m3-json-preview)\b/;

  for (const absPath of cssFiles) {
    const relPath = path.relative(ROOT, absPath);
    const css = await readFile(absPath, "utf8");

    assert.equal(
      /(?:@apply\b|@theme\b|tailwindcss)/.test(css),
      false,
      `Found Tailwind directive in ${relPath}`,
    );
    assert.equal(
      /font-size:\s*\d+(?:\.\d+)?px/.test(css),
      false,
      `Found hardcoded pixel font-size in ${relPath}`,
    );
    assert.equal(
      /box-shadow\s*:/.test(css),
      false,
      `Found custom box-shadow in ${relPath}`,
    );
    assert.equal(
      /--ano-color-shell|--ano-elevation-card/.test(css),
      false,
      `Found removed legacy shell/elevation token in ${relPath}`,
    );
    assert.equal(
      deadSelectorPattern.test(css),
      false,
      `Found dead unstyled selector in ${relPath}`,
    );

    for (const match of css.matchAll(/font-family\s*:\s*([^;]+);/g)) {
      const value = match[1]?.trim() ?? "";
      assert.ok(
        value.includes("--md-ref-typeface-") || value.includes("--md-sys-typescale-") || value.includes("--font-roboto"),
        `Found non-token font-family "${value}" in ${relPath}`,
      );
    }
  }
});

test("rendered TSX copy is free of internal phase tags, provider ceilings, and engineering footnotes", async () => {
  const roots = [path.join(ROOT, "src/app/(app)"), path.join(ROOT, "src/components")];
  const files = (await Promise.all(roots.map((dir) => collectFiles(dir, ".tsx")))).flat();

  const forbiddenCopyPattern =
    /\b(?:PHASE|Phase)\s+[A-F]\b|\b(?:PHASE|Phase)\s+9[BC]\b|\bSTAGE\s+[AB]\b|ARTIFACT\s*·|CONTEXT RAIL|\bDiagnostics\b|Graph node|\bCheckpoint\b|Provider budget|Planned ceiling|Search ceiling|Fetch ceiling|Result ceiling|Batch limit|RFC-4180|No automatic retry|Nothing has been sent|never triggers duplicate|remaining approved budget|Regenerate all \(Free\)|Approval-gated workspace|locked Phase C|\bin Phase [DE]\b/;

  for (const absPath of files) {
    const raw = await readFile(absPath, "utf8");
    const snippets = extractUserFacingTextAndStrings(raw);
    for (const snippet of snippets) {
      const match = snippet.match(forbiddenCopyPattern);
      assert.equal(
        match,
        null,
        `Found internal UI copy (${match?.[0]}) in ${path.relative(ROOT, absPath)}: ${snippet.slice(0, 140)}`,
      );
    }
  }

  const contextRail = await readFile(path.join(ROOT, "src/components/shell/context-rail.tsx"), "utf8");
  assert.match(contextRail, /Research details/);
  assert.match(contextRail, /<md-divider\b/);
  assert.match(contextRail, /Brief &(?:amp;)? scope/);
  assert.match(contextRail, /Progress summary/);
  assert.match(contextRail, /Saved sources/);
  assert.match(contextRail, /Recent activity/);
});
