import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeDomains } from "../index.js";

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
