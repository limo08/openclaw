/**
 * Tests for the chunking module.
 */

import { describe, it, expect } from "vitest";
import { chunkMarkdown, simpleChunker } from "./simple-chunker.js";
import {
  findSafeSplitPoint,
  splitLongLine,
  isHeading,
  isCodeBlockFence,
  isListItem,
  isEmptyLine,
  isStructuralBoundary,
  getLineRole,
  type LineRole,
} from "./markdown-boundaries.js";
import { chunkingConfigFromTokens, DEFAULT_CHUNKING_CONFIG } from "./chunk-strategy.js";

describe("chunking.markdownBoundaries", () => {
  describe("isHeading", () => {
    it("detects ATX headings", () => {
      expect(isHeading("# Heading 1")).toBe(true);
      expect(isHeading("## Heading 2")).toBe(true);
      expect(isHeading("### Heading 3")).toBe(true);
      expect(isHeading("  ## Indented heading")).toBe(true);
      expect(isHeading("Not a heading")).toBe(false);
      expect(isHeading("Seven#s is not a heading")).toBe(false);
    });
  });

  describe("isCodeBlockFence", () => {
    it("detects code fences", () => {
      expect(isCodeBlockFence("```typescript")).toBe(true);
      expect(isCodeBlockFence("```js")).toBe(true);
      expect(isCodeBlockFence("   ```python")).toBe(true);
      expect(isCodeBlockFence("Not a fence")).toBe(false);
    });
  });

  describe("isListItem", () => {
    it("detects list items", () => {
      expect(isListItem("- item")).toBe(true);
      expect(isListItem("* item")).toBe(true);
      expect(isListItem("+ item")).toBe(true);
      expect(isListItem("1. item")).toBe(true);
      expect(isListItem("  - indented")).toBe(true);
      expect(isListItem("not a list")).toBe(false);
    });
  });

  describe("isEmptyLine", () => {
    it("detects empty lines", () => {
      expect(isEmptyLine("")).toBe(true);
      expect(isEmptyLine("   ")).toBe(true);
      expect(isEmptyLine("\t")).toBe(true);
      expect(isEmptyLine("content")).toBe(false);
    });
  });

  describe("isStructuralBoundary", () => {
    it("identifies good split points", () => {
      expect(isStructuralBoundary("")).toBe(true);
      expect(isStructuralBoundary("   ")).toBe(true);
      expect(isStructuralBoundary("# Heading")).toBe(true);
      expect(isStructuralBoundary("---")).toBe(true);
      expect(isStructuralBoundary("***")).toBe(true);
      expect(isStructuralBoundary("regular content")).toBe(false);
    });
  });

  describe("findSafeSplitPoint", () => {
    it("returns full length when line is short enough", () => {
      expect(findSafeSplitPoint("short", 100)).toBe(5);
    });

    it("splits at word boundaries when possible", () => {
      const line = "hello world foo bar baz";
      expect(findSafeSplitPoint(line, 15)).toBe(11); // After "world "
    });

    it("splits at punctuation when no spaces available", () => {
      const line = "hello,world,foo,bar";
      // Algorithm finds the split point closest to maxLength
      // With maxLength=12, it finds the comma at index 11 (",")
      // and returns 12 (after the comma)
      expect(findSafeSplitPoint(line, 12)).toBe(12);
    });

    it("falls back to hard split when needed", () => {
      const line = "averylongwordwithnoboundaries";
      expect(findSafeSplitPoint(line, 10)).toBe(10);
    });

    it("handles edge cases", () => {
      expect(findSafeSplitPoint("", 10)).toBe(0);
      expect(findSafeSplitPoint("a", 0)).toBe(0);
    });
  });

  describe("splitLongLine", () => {
    it("returns single segment for short lines", () => {
      expect(splitLongLine("short", 100)).toEqual(["short"]);
    });

    it("splits at word boundaries", () => {
      const line = "hello world foo bar baz";
      const result = splitLongLine(line, 15);
      expect(result.length).toBeGreaterThan(1);
      expect(result[0]).toBe("hello world");
      expect(result[1]).toBe("foo bar baz");
    });

    it("trims whitespace from split segments", () => {
      const line = "hello world foo bar";
      const result = splitLongLine(line, 10);
      result.forEach((seg) => {
        expect(seg).not.toMatch(/^\s/);
        expect(seg).not.toMatch(/\s$/);
      });
    });
  });

  describe("getLineRole", () => {
    const roles: LineRole[] = [
      "empty",
      "heading",
      "code_fence",
      "list_item",
      "blockquote",
      "thematic_break",
      "content",
    ];

    it("classifies all line types correctly", () => {
      expect(getLineRole("")).toBe("empty");
      expect(getLineRole("# Heading")).toBe("heading");
      expect(getLineRole("```ts")).toBe("code_fence");
      expect(getLineRole("- item")).toBe("list_item");
      expect(getLineRole("> quote")).toBe("blockquote");
      expect(getLineRole("---")).toBe("thematic_break");
      expect(getLineRole("regular content")).toBe("content");
    });

    it("returns one of the valid roles", () => {
      const role = getLineRole("some line");
      expect(roles).toContain(role);
    });
  });
});

describe("chunking.chunkStrategy", () => {
  describe("chunkingConfigFromTokens", () => {
    it("converts token-based config to byte-based", () => {
      const config = chunkingConfigFromTokens(500, 50);
      expect(config.maxBytes).toBe(2000); // 500 * 4
      expect(config.overlapBytes).toBe(200); // 50 * 4
      expect(config.preserveStructure).toBe(true);
    });

    it("handles zero overlap", () => {
      const config = chunkingConfigFromTokens(500, 0);
      expect(config.overlapBytes).toBe(0);
    });

    it("enforces minimum maxBytes", () => {
      const config = chunkingConfigFromTokens(1, 0);
      expect(config.maxBytes).toBe(32); // Minimum
    });
  });

  describe("DEFAULT_CHUNKING_CONFIG", () => {
    it("has sensible defaults", () => {
      expect(DEFAULT_CHUNKING_CONFIG.maxBytes).toBe(2000);
      expect(DEFAULT_CHUNKING_CONFIG.overlapBytes).toBe(200);
      expect(DEFAULT_CHUNKING_CONFIG.preserveStructure).toBe(true);
    });
  });
});

describe("chunking.simpleChunker", () => {
  describe("chunkMarkdown", () => {
    it("handles empty content", () => {
      const chunks = chunkMarkdown("", { tokens: 500, overlap: 50 });
      expect(chunks).toEqual([]);
    });

    it("handles single line content", () => {
      const content = "single line";
      const chunks = chunkMarkdown(content, { tokens: 500, overlap: 50 });
      expect(chunks.length).toBe(1);
      expect(chunks[0]?.text).toBe(content);
    });

    it("handles content within max size", () => {
      const content = "line 1\nline 2\nline 3";
      const chunks = chunkMarkdown(content, { tokens: 500, overlap: 50 });
      expect(chunks.length).toBe(1);
      expect(chunks[0]?.text).toBe(content);
    });

    it("splits content that exceeds max size", () => {
      const content = Array(100).fill("a line of text").join("\n");
      const chunks = chunkMarkdown(content, { tokens: 10, overlap: 2 });
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("includes overlap between chunks", () => {
      // Create content that will split into 2 chunks with overlap
      const lines = Array(20).fill("a line");
      const content = lines.join("\n");
      // Smaller maxBytes and larger overlap to ensure overlap occurs
      const chunks = chunkMarkdown(content, { tokens: 6, overlap: 4 });

      expect(chunks.length).toBeGreaterThan(1);

      // Check that there's some overlap in line numbers
      const firstEndLine = chunks[0]?.endLine ?? 0;
      const secondStartLine = chunks[1]?.startLine ?? Infinity;
      expect(secondStartLine).toBeLessThan(firstEndLine);
    });

    it("preserves line numbers correctly", () => {
      const content = "line 1\nline 2\nline 3\nline 4";
      const chunks = chunkMarkdown(content, { tokens: 2, overlap: 0 });

      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        expect(chunk).toBeDefined();
        expect(chunk?.startLine).toBeGreaterThan(0);
        expect(chunk?.endLine).toBeGreaterThanOrEqual(chunk?.startLine ?? 0);

        // Verify line numbers are sequential and increasing
        if (i > 0 && chunk) {
          const prevChunk = chunks[i - 1];
          expect(chunk.startLine).toBeGreaterThan(prevChunk?.endLine ?? 0);
        }
      }
    });

    it("generates correct hashes", () => {
      const content = "test content";
      const chunks = chunkMarkdown(content, { tokens: 500, overlap: 50 });
      expect(chunks[0]?.hash).toBeDefined();
      expect(chunks[0]?.hash.length).toBeGreaterThan(0);
    });

    it("includes embeddingInput", () => {
      const content = "test content";
      const chunks = chunkMarkdown(content, { tokens: 500, overlap: 50 });
      expect(chunks[0]?.embeddingInput).toEqual({
        text: content,
      });
    });

    it("handles legacy config format", () => {
      const content = "test content";
      const chunks = chunkMarkdown(content, {
        tokens: 500,
        overlap: 50,
      });
      expect(chunks.length).toBe(1);
    });

    it("handles new byte-based config format", () => {
      const content = "test content";
      const chunks = chunkMarkdown(content, {
        maxBytes: 2000,
        overlapBytes: 200,
      });
      expect(chunks.length).toBe(1);
    });

    it("splits long lines at natural boundaries", () => {
      // Create a line that's too long but has word boundaries
      const words = Array(50).fill("word");
      const content = words.join(" "); // All on one line

      const chunks = chunkMarkdown(content, { tokens: 10, overlap: 0 });
      expect(chunks.length).toBeGreaterThan(0);

      // Check that chunks don't have trailing/leading spaces from splits
      for (const chunk of chunks) {
        const lines = chunk.text.split("\n");
        for (const line of lines) {
          // Internal newlines from splits shouldn't have odd whitespace
          if (line.trim().length > 0) {
            expect(line).not.toMatch(/^\s/);
            expect(line).not.toMatch(/\s$/);
          }
        }
      }
    });

    it("handles mixed short and long lines", () => {
      const content = [
        "short line",
        "another short",
        Array(100).fill("x").join(""), // long line without spaces
        "back to short",
        "another one",
      ].join("\n");

      const chunks = chunkMarkdown(content, { tokens: 10, overlap: 2 });
      expect(chunks.length).toBeGreaterThan(0);

      // Verify all chunks have proper structure
      for (const chunk of chunks) {
        expect(chunk.startLine).toBeGreaterThan(0);
        expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
        expect(chunk.hash).toBeDefined();
      }
    });
  });

  describe("simpleChunker", () => {
    it("uses the SimpleChunker instance", () => {
      expect(simpleChunker.name).toBe("simple");
    });

    it("chunks content via the interface", () => {
      const content = "line 1\nline 2\nline 3";
      const chunks = simpleChunker.chunk(content, {
        maxBytes: 1000,
        overlapBytes: 100,
      });
      expect(chunks.length).toBe(1);
      expect(chunks[0]?.text).toBe(content);
    });
  });
});
