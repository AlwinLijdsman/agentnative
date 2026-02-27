/**
 * Markdown Formatters — Generic building blocks for structured markdown output.
 *
 * These are pure functions that produce markdown strings.
 * No side effects, no file I/O, no external dependencies.
 */

/**
 * Build a markdown table from headers and rows.
 */
export function markdownTable(
  headers: string[],
  rows: string[][],
): string {
  if (headers.length === 0) return '';

  const headerRow = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const dataRows = rows.map((row) => `| ${row.join(' | ')} |`);

  return [headerRow, separator, ...dataRows].join('\n');
}

/**
 * Build a blockquote from content lines.
 */
export function blockquote(content: string): string {
  return content
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * Build a metadata header with key-value pairs.
 */
export function metadataHeader(pairs: Array<[string, string]>): string {
  return pairs.map(([key, value]) => `**${key}:** ${value}`).join('  \n');
}

/**
 * Wrap text in a collapsible details/summary block.
 */
export function collapsible(summary: string, content: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${content}\n\n</details>`;
}

/**
 * Build a horizontal rule separator.
 */
export function separator(): string {
  return '\n---\n';
}

/**
 * Escape markdown-special characters in text.
 * Currently escapes pipe characters to prevent breaking markdown tables.
 * Matches gamma's `_escape_md` behavior.
 */
export function escapeMd(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/**
 * Insert blank `> ` lines between consecutive blockquote entries
 * to prevent them rendering as a single blockquote wall.
 * Matches gamma's `_format_source_blocks` pattern.
 *
 * Detects boundaries between source entries (lines matching `> **SourceRef:**`)
 * and inserts a blank `>` separator line between them.
 */
export function formatSourceBlockSpacing(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    result.push(line);

    // If this line starts a source entry and the next line also starts one,
    // insert a blank blockquote line between them
    const nextLine = lines[i + 1];
    if (
      i < lines.length - 1 &&
      nextLine !== undefined &&
      line.startsWith('> *') &&
      nextLine.startsWith('> *') &&
      !line.startsWith('> **Sources**')
    ) {
      result.push('>');
    }
  }

  return result.join('\n');
}
