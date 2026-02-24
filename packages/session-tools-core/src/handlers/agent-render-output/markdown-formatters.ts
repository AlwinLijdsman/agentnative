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
