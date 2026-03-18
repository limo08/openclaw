/**
 * Simple chunking strategy with improved boundary detection.
 *
 * This is the default chunker that:
 * 1. Uses UTF-8 byte estimation for consistent sizing
 * 2. Preserves line structure when possible
 * 3. Splits long lines at natural boundaries (spaces, punctuation)
 * 4. Maintains overlap using complete lines/semantic units
 */

import { estimateUtf8Bytes } from "../embedding-input-limits.js";
import { hashText, type MemoryChunk } from "../internal.js";
import type { ChunkStrategy, ChunkingConfig } from "./chunk-strategy.js";
import { splitLongLineByBytes } from "./markdown-boundaries.js";
import { buildTextEmbeddingInput } from "../embedding-inputs.js";

/**
 * Represents a single line with its metadata.
 */
type LineEntry = {
  line: string;
  lineNo: number;
  byteSize: number;
};

/**
 * Simple chunker implementation.
 */
export class SimpleChunker implements ChunkStrategy {
  readonly name = "simple";

  chunk(content: string, config: ChunkingConfig): MemoryChunk[] {
    // Note: config.preserveStructure is reserved for future Phase 2+ features.
    // The SimpleChunker handles basic UTF-8 byte-aware chunking; use
    // SemanticChunker for structure-aware splitting.
    const lines = content.split("\n");
    // Handle empty content - split("\n") on empty string returns [""]
    if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
      return [];
    }

    // Pre-compute byte sizes for all lines
    const lineEntries: LineEntry[] = lines.map((line, i) => ({
      line,
      lineNo: i + 1,
      byteSize: estimateUtf8Bytes(line) + 1, // +1 for newline
    }));

    const chunks: MemoryChunk[] = [];
    let currentEntries: LineEntry[] = [];
    let currentBytes = 0;

    const flush = () => {
      if (currentEntries.length === 0) {
        return;
      }
      const firstEntry = currentEntries[0]!;
      const lastEntry = currentEntries[currentEntries.length - 1]!;
      const text = currentEntries.map((e) => e.line).join("\n");
      chunks.push({
        startLine: firstEntry.lineNo,
        endLine: lastEntry.lineNo,
        text,
        hash: hashText(text),
        embeddingInput: buildTextEmbeddingInput(text),
      });
    };

    const carryOverlap = () => {
      const { overlapBytes } = config;
      if (overlapBytes <= 0 || currentEntries.length === 0) {
        currentEntries = [];
        currentBytes = 0;
        return;
      }

      // Keep whole lines from the end until we exceed overlap
      let acc = 0;
      const kept: LineEntry[] = [];
      for (let i = currentEntries.length - 1; i >= 0; i -= 1) {
        const entry = currentEntries[i]!;
        if (acc + entry.byteSize > overlapBytes && kept.length > 0) {
          break;
        }
        kept.unshift(entry);
        acc += entry.byteSize;
      }

      currentEntries = kept;
      currentBytes = acc;
    };

    for (const entry of lineEntries) {
      // Handle long lines by splitting them at natural boundaries
      const segments = this.splitEntryIfNeeded(entry, config.maxBytes);

      for (const segment of segments) {
        const wouldExceed =
          currentBytes + segment.byteSize > config.maxBytes && currentEntries.length > 0;

        if (wouldExceed) {
          flush();
          carryOverlap();
        }

        currentEntries.push(segment);
        currentBytes += segment.byteSize;
      }
    }

    flush();
    return chunks;
  }

  /**
   * Split a line entry if it exceeds the max bytes.
   * Returns an array of entries (original or split).
   */
  private splitEntryIfNeeded(entry: LineEntry, maxBytes: number): LineEntry[] {
    // If the line fits, return as-is
    if (entry.byteSize <= maxBytes) {
      return [entry];
    }

    // Split the long line at natural boundaries, respecting UTF-8 byte limits
    const maxTextBytes = maxBytes - 1; // Account for newline
    const textSegments = splitLongLineByBytes(entry.line, maxTextBytes);

    return textSegments.map((segment) => ({
      line: segment,
      lineNo: entry.lineNo,
      byteSize: estimateUtf8Bytes(segment) + 1,
    }));
  }
}

/**
 * Singleton instance for convenience.
 */
export const simpleChunker = new SimpleChunker();

/**
 * Chunk markdown content using the simple strategy.
 *
 * This is the main export that replaces the legacy chunkMarkdown function.
 *
 * @param content - The markdown content to chunk
 * @param config - Chunking configuration (or legacy { tokens, overlap } object)
 * @returns Array of memory chunks
 */
export function chunkMarkdown(
  content: string,
  config: ChunkingConfig | { tokens: number; overlap: number },
): MemoryChunk[] {
  // Support legacy config format
  const chunkingConfig =
    "maxBytes" in config
      ? config
      : { maxBytes: Math.max(32, config.tokens * 4), overlapBytes: Math.max(0, config.overlap * 4) };

  return simpleChunker.chunk(content, chunkingConfig);
}
