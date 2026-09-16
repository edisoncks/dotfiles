import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createDuckDuckGoState,
  withDuckDuckGoRequestSlot,
  isRetryableDuckDuckGoError,
  DuckDuckGoDriftError,
  DuckDuckGoUnavailableError,
} from "../index.js";

describe("isRetryableDuckDuckGoError (P4: typed retry)", () => {
  it("does not retry circuit-open, drift, or abort", () => {
    assert.equal(
      isRetryableDuckDuckGoError(new DuckDuckGoUnavailableError("busy", Date.now() + 1000)),
      false,
    );
    assert.equal(isRetryableDuckDuckGoError(new DuckDuckGoDriftError("drift")), false);
    assert.equal(
      isRetryableDuckDuckGoError(new DOMException("aborted", "AbortError")),
      false,
    );
  });

  it("retries transient I/O failures", () => {
    assert.equal(isRetryableDuckDuckGoError(new Error("spawn obscura ETIMEDOUT")), true);
    assert.equal(isRetryableDuckDuckGoError(new Error("fetch failed")), true);
    assert.equal(
      isRetryableDuckDuckGoError(new Error("Obscura returned empty DuckDuckGo HTML")),
      true,
    );
  });
});

describe("withDuckDuckGoRequestSlot spacing (P4: success-only penalty)", () => {
  it("does not advance nextRequestAt on deterministic failure, releases queue", async () => {
    const state = createDuckDuckGoState();
    await assert.rejects(
      withDuckDuckGoRequestSlot(state, undefined, () => {
        throw new DuckDuckGoDriftError("markup changed");
      }),
      /markup changed/,
    );
    assert.equal(state.nextRequestAt, 0);
    // Queue released: a later success still runs.
    const out = await withDuckDuckGoRequestSlot(state, undefined, async () => "ok");
    assert.equal(out, "ok");
  });

  it("advances nextRequestAt on success", async () => {
    const state = createDuckDuckGoState();
    const before = Date.now();
    await withDuckDuckGoRequestSlot(state, undefined, async () => "ok");
    assert.ok(state.nextRequestAt >= before + 2500, `nextRequestAt=${state.nextRequestAt}`);
    assert.ok(state.nextRequestAt <= Date.now() + 5000, `nextRequestAt=${state.nextRequestAt}`);
  });
});
