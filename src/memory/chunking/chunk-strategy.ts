/**
 * Chunking strategy interface and factory for memory segmentation.
 *
 * This module provides the abstraction layer for different chunking approaches,
 * allowing for easy extension and configuration.
 */

import type { MemoryChunk } from "../internal.js";

/**
 * Configuration for chunking behavior.
 */
export type ChunkingConfig = {
  /**
   * Maximum chunk size in estimated UTF-8 bytes.
   * This is a conservative upper bound for tokenizer output.
   */
  maxBytes: number;

  /**
   * Overlap between consecutive chunks in estimated UTF-8 bytes.
   * Helps maintain context across chunk boundaries.
   */
  overlapBytes: number;

  /**
   * Whether to preserve markdown structure when splitting.
   * When enabled, splits will prefer boundaries like headings, code blocks, etc.
   */
  preserveStructure?: boolean;
};

/**
 * Result of a chunking operation.
 */
export type ChunkingResult = {
  chunks: MemoryChunk[];
  metadata: {
    totalChunks: number;
    totalBytes: number;
    averageChunkBytes: number;
  };
};

/**
 * Interface for chunking strategies.
 */
export interface ChunkStrategy {
  /**
   * The name of this strategy.
   */
  readonly name: string;

  /**
   * Chunk the given content according to the strategy.
   *
   * @param content - The text content to chunk
   * @param config - Chunking configuration
   * @returns Array of memory chunks
   */
  chunk(content: string, config: ChunkingConfig): MemoryChunk[];
}

/**
 * Default chunking configuration.
 */
export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  maxBytes: 2000, // ~500 tokens at 4 bytes/token
  overlapBytes: 200, // ~50 tokens overlap
  preserveStructure: true,
};

/**
 * Create a chunking config from legacy token-based settings.
 */
export function chunkingConfigFromTokens(tokens: number, overlap: number): ChunkingConfig {
  return {
    maxBytes: Math.max(32, tokens * 4),
    overlapBytes: Math.max(0, overlap * 4),
    preserveStructure: true,
  };
}
