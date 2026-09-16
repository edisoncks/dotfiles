import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createExaSearchError,
  createDuckDuckGoSearchError,
  formatExaSearchResult,
} from "../index.js";

describe("createExaSearchError (P7: actionable auth hint, warn-and-try)", () => {
  it("names EXA_API_KEY on 401/403", () => {
    const err401 = createExaSearchError(new Error("Exa MCP returned HTTP 401: unauthorized"));
    assert.match(err401.message, /EXA_API_KEY/);
    assert.match(err401.message, /web_search_ddg/);
    const err403 = createExaSearchError(new Error("Exa MCP returned HTTP 403 forbidden"));
    assert.match(err403.message, /EXA_API_KEY/);
  });

  it("keeps quota vs generic distinction otherwise", () => {
    assert.match(
      createExaSearchError(new Error("quota exceeded")).message,
      /quota or rate limit/i,
    );
    assert.match(
      createExaSearchError(new Error("fetch failed")).message,
      /unavailable/,
    );
  });
});

describe("createDuckDuckGoSearchError (P7: obscura PATH hint)", () => {
  it("names obscura and PATH on ENOENT", () => {
    const err = createDuckDuckGoSearchError(
      new Error("spawn obscura ENOENT"),
    );
    assert.match(err.message, /obscura not found on PATH/);
    assert.match(err.message, /web_search_exa/);
  });

  it("keeps generic message for other failures", () => {
    const err = createDuckDuckGoSearchError(new Error("fetch failed"));
    assert.match(err.message, /DuckDuckGo web search is unavailable/);
  });
});

describe("formatExaSearchResult resultCount (P7: honest zero)", () => {
  const params = {
    query: "q",
    allowedDomains: [],
    blockedDomains: [],
    numResults: 8,
  };

  it("reports 0 for unstructured text even with Title: lines in body", () => {
    const out = formatExaSearchResult(
      { content: [{ type: "text", text: "Title: foo\nTitle: bar\nsome body" }] },
      params,
    );
    assert.equal(out.resultCount, 0);
    assert.match(out.text, /Title: foo/);
  });

  it("reports 0 for empty results", () => {
    const out = formatExaSearchResult({ content: [] }, params);
    assert.equal(out.resultCount, 0);
  });

  it("counts structured results honestly", () => {
    const structured = JSON.stringify({
      results: [
        { title: "A", url: "https://example.com/a", text: "s1" },
        { title: "B", url: "https://example.com/b", text: "s2" },
      ],
    });
    const out = formatExaSearchResult(
      { content: [{ type: "text", text: structured }] },
      params,
    );
    assert.equal(out.resultCount, 2);
  });
});
