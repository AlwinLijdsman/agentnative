/**
 * Source Linker — Abstract interface and factory.
 *
 * Source linkers convert domain-specific references (like "ISA 540.13")
 * into clickable markdown links pointing to source files (PDFs, etc.).
 */

import type { SourceLinker } from './types.ts';

export type { SourceLinker };

/**
 * Create a SourceLinker based on linkerType from config.
 *
 * @param linkerType - The linker type string from config (e.g. "isa-pdf", "noop")
 * @param options - Additional options passed to the linker constructor
 */
export function createSourceLinker(
  linkerType: string,
  options: {
    linkBase?: string;
    sourceDir?: string;
    fileList?: string[];
  } = {},
): SourceLinker {
  switch (linkerType) {
    case 'isa-pdf':
      return createIsaPdfLinker(options.linkBase ?? '../staging/pdf/', options.fileList ?? []);
    case 'noop':
    default:
      return createNoopLinker();
  }
}

// ============================================================
// NoOp Linker — Returns references as-is
// ============================================================

function createNoopLinker(): SourceLinker {
  return {
    linkifyRef(sourceRef: string): string {
      return sourceRef;
    },
    getSourceFileMap(): Record<string, string> {
      return {};
    },
    extractIdentifier(_sourceRef: string): string | null {
      return null;
    },
  };
}

// ============================================================
// ISA PDF Linker — Links ISA references to PDF files
// ============================================================

/**
 * Build a map of ISA number → PDF filename from a list of files.
 * Matches patterns like "ISA 540 - Auditing Accounting Estimates.pdf"
 */
function buildIsaFileMap(fileList: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const file of fileList) {
    const match = file.match(/ISA\s+(\d{3})/i);
    if (match) {
      map[match[1]!] = file;
    }
  }
  return map;
}

function createIsaPdfLinker(linkBase: string, fileList: string[]): SourceLinker {
  const fileMap = buildIsaFileMap(fileList);

  return {
    linkifyRef(sourceRef: string): string {
      const isaNum = this.extractIdentifier(sourceRef);
      if (!isaNum || !fileMap[isaNum]) {
        return sourceRef; // No matching PDF — return plain text
      }
      const pdfFile = fileMap[isaNum]!;
      const encodedPath = encodeURIComponent(pdfFile).replace(/%2F/g, '/');
      const base = linkBase.endsWith('/') ? linkBase : linkBase + '/';
      return `[${sourceRef}](${base}${encodedPath})`;
    },

    getSourceFileMap(): Record<string, string> {
      return { ...fileMap };
    },

    extractIdentifier(sourceRef: string): string | null {
      const match = sourceRef.match(/ISA\s+(\d{3})/i);
      return match ? match[1]! : null;
    },
  };
}
