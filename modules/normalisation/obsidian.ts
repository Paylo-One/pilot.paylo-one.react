/**
 * modules/normalisation/obsidian.ts
 *
 * Pure Obsidian-Markdown parser. Turns a vault note (filename + raw markdown)
 * into a structured shape Normalisation/Ingestion can persist: title,
 * frontmatter, tags, internal wikilinks, and the body. No I/O, no dependencies
 * — safe to call from server actions or jobs.
 *
 * Local-first constraint (ADR-028): this only parses content the operator has
 * explicitly uploaded; it never reads a vault from disk. Ingested text is
 * untrusted (prompt-injection surface) — downstream normalisation tidies and the
 * intelligence lane sanitises before any agent sees it.
 *
 * Governance: architecture/source-integration-strategy.md §13, services/normalisation.md.
 */

export interface ParsedObsidianNote {
  /** Resolved note title (frontmatter → first H1 → filename). */
  readonly title: string;
  /** Body with the frontmatter block removed. */
  readonly body: string;
  /** Merged tags from frontmatter + inline `#tags` (deduped, no leading #). */
  readonly tags: string[];
  /** Internal `[[wikilink]]` targets (alias/section stripped, deduped). */
  readonly links: string[];
  /** Parsed frontmatter key/values (strings or string arrays). */
  readonly frontmatter: Record<string, string | string[]>;
  /** ISO date derived from frontmatter (date/created), or null. */
  readonly occurredAt: string | null;
}

/** Strip a trailing markdown/obsidian extension and any folders from a path. */
function baseTitleFromFilename(filename: string): string {
  const name = filename.split("/").pop() ?? filename;
  return name.replace(/\.(md|markdown|mdx|txt)$/i, "").trim() || name;
}

/** Split a `--- ... ---` YAML frontmatter block from the body. */
function splitFrontmatter(content: string): { fm: string | null; body: string } {
  // Frontmatter must be at the very start: `---\n ... \n---`.
  const match = /^---\n([\s\S]*?)\n---\s*\n?/.exec(content);
  if (!match) return { fm: null, body: content };
  return { fm: match[1] ?? "", body: content.slice(match[0].length) };
}

/** Minimal YAML-ish frontmatter parser: `key: value`, inline + block lists. */
function parseFrontmatter(fm: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const lines = fm.split("\n");
  let currentListKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (line.trim().length === 0) continue;

    // Block-list continuation: "  - value"
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentListKey) {
      const arr = (out[currentListKey] as string[] | undefined) ?? [];
      arr.push(stripQuotes(listItem[1] ?? ""));
      out[currentListKey] = arr;
      continue;
    }

    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      currentListKey = null;
      continue;
    }
    const key = (kv[1] ?? "").toLowerCase();
    const value = (kv[2] ?? "").trim();

    if (value.length === 0) {
      // Possibly a block list follows.
      currentListKey = key;
      out[key] = [];
      continue;
    }
    currentListKey = null;

    // Inline array: [a, b, c]
    const inlineArray = /^\[(.*)\]$/.exec(value);
    if (inlineArray) {
      out[key] = (inlineArray[1] ?? "")
        .split(",")
        .map((s) => stripQuotes(s.trim()))
        .filter((s) => s.length > 0);
    } else {
      out[key] = stripQuotes(value);
    }
  }

  // Drop empty block-list keys that never got items.
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v) && v.length === 0) delete out[k];
  }
  return out;
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, "").trim();
}

/** First level-1 heading (`# Title`) in the body, if any. */
function firstHeading(body: string): string | null {
  for (const line of body.split("\n")) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m) return (m[1] ?? "").trim();
  }
  return null;
}

/** Inline `#tags` (not markdown headings, which have a space after `#`). */
function inlineTags(body: string): string[] {
  const tags = new Set<string>();
  const re = /(?:^|\s)#([A-Za-z0-9][A-Za-z0-9_/-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) tags.add(m[1]);
  }
  return [...tags];
}

/** Internal `[[wikilink]]` targets, alias/section stripped. */
function wikilinks(body: string): string[] {
  const links = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const target = (m[1] ?? "").split("|")[0]?.split("#")[0]?.trim();
    if (target) links.add(target);
  }
  return [...links];
}

function frontmatterTags(fm: Record<string, string | string[]>): string[] {
  const raw = fm.tags ?? fm.tag;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/);
  return list.map((t) => t.replace(/^#/, "").trim()).filter((t) => t.length > 0);
}

function frontmatterDate(fm: Record<string, string | string[]>): string | null {
  const candidate = fm.date ?? fm.created ?? fm["created-at"];
  if (!candidate || Array.isArray(candidate)) return null;
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Parse one Obsidian note. */
export function parseObsidianMarkdown(
  filename: string,
  content: string,
): ParsedObsidianNote {
  const normalised = content.replace(/\r\n?/g, "\n");
  const { fm, body } = splitFrontmatter(normalised);
  const frontmatter = fm ? parseFrontmatter(fm) : {};

  const fmTitle =
    typeof frontmatter.title === "string" ? frontmatter.title : null;
  const title = (fmTitle || firstHeading(body) || baseTitleFromFilename(filename)).trim();

  const tags = [...new Set([...frontmatterTags(frontmatter), ...inlineTags(body)])];
  const links = wikilinks(body);

  return {
    title,
    body: body.trim(),
    tags,
    links,
    frontmatter,
    occurredAt: frontmatterDate(frontmatter),
  };
}
