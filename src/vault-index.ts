import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, posix } from "node:path";

export type VaultIndexNote = {
  path: string;
  title: string;
  aliases: string[];
  headings: string[];
  tags: string[];
  summary: string;
  outgoingLinks: string[];
};

export type VaultIndex = {
  schemaVersion: 1;
  generatedAt: string;
  notes: VaultIndexNote[];
};

export async function buildVaultIndex(vaultPath: string, now = new Date()): Promise<VaultIndex> {
  const notePaths = await listMarkdownNotes(vaultPath);
  const notes = await Promise.all(
    notePaths.map(async (relativePath) => parseVaultIndexNote(relativePath, await readFile(join(vaultPath, relativePath), "utf8")))
  );

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    notes: notes.sort((left, right) => left.path.localeCompare(right.path))
  };
}

export function selectCandidateNotes(index: VaultIndex, freeformCapture: string, limit = 5): string[] {
  const captureTokens = meaningfulTokens(freeformCapture);

  if (captureTokens.size === 0 || limit <= 0) {
    return [];
  }

  return index.notes
    .map((note) => ({ note, score: scoreCandidate(note, captureTokens) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.note.path.localeCompare(right.note.path))
    .slice(0, limit)
    .map(({ note }) => note.path);
}

async function listMarkdownNotes(vaultPath: string, directory = "."): Promise<string[]> {
  const entries = await readdir(join(vaultPath, directory), { withFileTypes: true });
  const notePaths: string[] = [];

  for (const entry of entries) {
    const relativePath = directory === "." ? entry.name : posix.join(directory, entry.name);

    if (shouldSkipPath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      notePaths.push(...(await listMarkdownNotes(vaultPath, relativePath)));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }

    const absolutePath = join(vaultPath, relativePath);
    if ((await stat(absolutePath)).isFile()) {
      notePaths.push(relativePath);
    }
  }

  return notePaths;
}

function shouldSkipPath(relativePath: string): boolean {
  return (
    relativePath === ".onix" ||
    relativePath.startsWith(".onix/") ||
    relativePath === "Onix/Sessions" ||
    relativePath.startsWith("Onix/Sessions/") ||
    relativePath.split("/").some((segment) => segment.startsWith("."))
  );
}

function parseVaultIndexNote(path: string, content: string): VaultIndexNote {
  const { frontmatter, body } = splitFrontmatter(content);
  const headings = extractHeadings(body);
  const title = headings[0] ?? basename(path, ".md");
  const summary = readFrontmatterScalar(frontmatter, "summary") ?? firstOpeningParagraph(body);

  return {
    path,
    title,
    aliases: readFrontmatterList(frontmatter, "aliases"),
    headings,
    tags: unique([...readFrontmatterList(frontmatter, "tags"), ...extractInlineTags(body)]),
    summary,
    outgoingLinks: extractOutgoingLinks(body)
  };
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith("---\n")) {
    return { frontmatter: "", body: content };
  }

  const frontmatterEnd = content.indexOf("\n---", 4);

  if (frontmatterEnd === -1) {
    return { frontmatter: "", body: content };
  }

  return {
    frontmatter: content.slice(4, frontmatterEnd),
    body: content.slice(frontmatterEnd + "\n---".length).replace(/^\r?\n/, "")
  };
}

function readFrontmatterScalar(frontmatter: string, key: string): string | undefined {
  const line = frontmatter
    .split(/\r?\n/)
    .find((candidate) => candidate.trimStart().startsWith(`${key}:`));

  if (line === undefined) {
    return undefined;
  }

  const value = line.slice(line.indexOf(":") + 1).trim();
  return value.length > 0 ? stripQuotes(value) : undefined;
}

function readFrontmatterList(frontmatter: string, key: string): string[] {
  const lines = frontmatter.split(/\r?\n/);
  const lineIndex = lines.findIndex((candidate) => candidate.trimStart().startsWith(`${key}:`));

  if (lineIndex === -1) {
    return [];
  }

  const line = lines[lineIndex];
  const value = line?.slice(line.indexOf(":") + 1).trim() ?? "";

  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => stripQuotes(item.trim()))
      .filter((item) => item.length > 0);
  }

  if (value.length > 0) {
    return [stripQuotes(value)];
  }

  const blockItems: string[] = [];
  for (const blockLine of lines.slice(lineIndex + 1)) {
    const trimmed = blockLine.trim();
    if (!trimmed.startsWith("- ")) {
      break;
    }

    blockItems.push(stripQuotes(trimmed.slice(2).trim()));
  }

  return blockItems.filter((item) => item.length > 0);
}

function extractHeadings(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => /^#{1,6}\s+(.+?)\s*$/.exec(line)?.[1]?.trim())
    .filter((heading): heading is string => heading !== undefined && heading.length > 0);
}

function firstOpeningParagraph(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    return trimmed;
  }

  return "";
}

function extractInlineTags(body: string): string[] {
  return Array.from(body.matchAll(/(?:^|\s)#([A-Za-z0-9/_-]+)/g), (match) => match[1] ?? "");
}

function extractOutgoingLinks(body: string): string[] {
  const wikiLinks = Array.from(body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g), (match) =>
    (match[1] ?? "").trim()
  );
  const markdownLinks = Array.from(body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g), (match) => (match[1] ?? "").trim());

  return unique([...wikiLinks, ...markdownLinks].filter((link) => link.length > 0));
}

function scoreCandidate(note: VaultIndexNote, captureTokens: Set<string>): number {
  const weightedFields: Array<{ value: string; weight: number }> = [
    { value: note.title, weight: 6 },
    { value: note.aliases.join(" "), weight: 5 },
    { value: note.tags.join(" "), weight: 4 },
    { value: note.headings.join(" "), weight: 3 },
    { value: note.summary, weight: 2 },
    { value: note.path, weight: 1 }
  ];

  return weightedFields.reduce((score, field) => {
    const fieldTokens = meaningfulTokens(field.value);
    let matches = 0;

    for (const token of captureTokens) {
      if (fieldTokens.has(token)) {
        matches += 1;
      }
    }

    return score + matches * field.weight;
  }, 0);
}

function meaningfulTokens(value: string): Set<string> {
  const stopWords = new Set([
    "and",
    "before",
    "con",
    "del",
    "el",
    "existing",
    "flow",
    "for",
    "from",
    "la",
    "las",
    "los",
    "of",
    "should",
    "the",
    "to",
    "una",
    "un",
    "with"
  ]);

  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !stopWords.has(token))
  );
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
