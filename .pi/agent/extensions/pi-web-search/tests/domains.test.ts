import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeDomains, isDomainMatch, hostnameOf } from "../index.js";

describe("normalizeDomains (P3: strict blank rejection)", () => {
  it("throws on whitespace-only entries (silent-unfiltered guard)", () => {
    assert.throws(() => normalizeDomains([" "]), /Invalid domain/);
    assert.throws(() => normalizeDomains([" ", "  "]), /Invalid domain/);
    assert.throws(() => normalizeDomains(["good.com", " "]), /Invalid domain/);
  });

  it("throws on empty-string entries", () => {
    assert.throws(() => normalizeDomains([""]), /Invalid domain/);
  });

  it("still throws on structurally invalid domains", () => {
    assert.throws(() => normalizeDomains(["not a domain"]), /Invalid domain/);
  });

  it("passes through valid inputs unchanged in spirit", () => {
    assert.deepEqual(normalizeDomains(undefined), []);
    assert.deepEqual(normalizeDomains([]), []);
    assert.deepEqual(normalizeDomains([" Example.COM "]), ["example.com"]);
    assert.deepEqual(normalizeDomains(["a.com", "a.com", "b.com"]), ["a.com", "b.com"]);
  });
});

describe("isDomainMatch (P5: tolerant parsing, strict matching)", () => {
  it("matches scheme-less URLs callers already accept in normalizeDomain", () => {
    assert.equal(isDomainMatch("example.com/foo", ["example.com"]), true);
    assert.equal(isDomainMatch("sub.example.com/a", ["example.com"]), true);
    assert.equal(isDomainMatch("//example.com/a", ["example.com"]), true);
    assert.equal(isDomainMatch("https://example.com./", ["example.com"]), true);
    assert.equal(isDomainMatch("HTTPS://SUB.EXAMPLE.COM/", ["example.com"]), true);
  });

  it("still rejects non-matches and garbage", () => {
    assert.equal(isDomainMatch("https://evil.com/", ["example.com"]), false);
    assert.equal(isDomainMatch("https://evil-example.com/", ["example.com"]), false);
    assert.equal(isDomainMatch("not a url", ["example.com"]), false);
    assert.equal(isDomainMatch("", ["example.com"]), false);
    assert.equal(isDomainMatch("https://example.com/", []), false);
  });

  it("hostnameOf returns undefined for garbage, normalized host otherwise", () => {
    assert.equal(hostnameOf("not a url"), undefined);
    assert.equal(hostnameOf("example.com/a"), "example.com");
    assert.equal(hostnameOf("//example.com/a"), "example.com");
  });
});
