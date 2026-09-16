import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveDuckDuckGoResultUrl,
  parseDuckDuckGoResults,
} from "../index.js";

describe("resolveDuckDuckGoResultUrl (P6: no DDG self-links)", () => {
  it("drops internal links without a uddg target", () => {
    assert.equal(resolveDuckDuckGoResultUrl("/l/?kh=-1"), undefined);
    assert.equal(
      resolveDuckDuckGoResultUrl("https://duckduckgo.com/l/?kh=-1"),
      undefined,
    );
  });

  it("decodes valid uddg redirect targets", () => {
    assert.equal(
      resolveDuckDuckGoResultUrl("/l/?kh=-1&uddg=https%3A%2F%2Fexample.com%2Fa"),
      "https://example.com/a",
    );
  });

  it("preserves direct external hrefs", () => {
    assert.equal(
      resolveDuckDuckGoResultUrl("https://example.com/direct"),
      "https://example.com/direct",
    );
  });

  it("rejects javascript: and DDG-hosted uddg targets", () => {
    assert.equal(
      resolveDuckDuckGoResultUrl("/l/?uddg=javascript%3Aalert(1)"),
      undefined,
    );
    assert.equal(
      resolveDuckDuckGoResultUrl(
        "/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fl%2F%3Fkh%3D-1",
      ),
      undefined,
    );
  });
});

describe("parseDuckDuckGoResults (P6: no DDG URLs in output)", () => {
  it("skips result-link anchors without uddg instead of surfacing DDG URLs", () => {
    const html = [
      '<a class="result-link" href="/l/?kh=-1">Nav junk</a>',
      '<td class="result-snippet">should not appear</td>',
      '<a class="result-link" href="/l/?kh=-1&uddg=https%3A%2F%2Fexample.com%2Freal">Real</a>',
      '<td class="result-snippet">real snippet</td>',
    ].join("\n");
    const results = parseDuckDuckGoResults(html);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.url, "https://example.com/real");
    assert.ok(
      results.every((r) => !r.url.includes("duckduckgo.com")),
      "no DDG self-URLs",
    );
  });
});
