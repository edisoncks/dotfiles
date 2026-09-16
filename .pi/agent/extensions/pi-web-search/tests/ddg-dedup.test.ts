import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { waitForPromiseWithSignal } from "../index.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("shared in-flight wait (P2: abort isolation)", () => {
  it("aborting one waiter does not reject co-waiters on the same shared promise", async () => {
    const shared = deferred<string>();
    const controllerA = new AbortController();
    const controllerB = new AbortController();

    const waiterA = waitForPromiseWithSignal(shared.promise, controllerA.signal);
    const waiterB = waitForPromiseWithSignal(shared.promise, controllerB.signal);

    controllerA.abort(new Error("A went away"));
    await assert.rejects(waiterA, /A went away/);

    // Shared work completes normally; B (never aborted) still resolves.
    shared.resolve("ok");
    assert.equal(await waiterB, "ok");
  });

  it("aborting the wait does not reject the shared work itself", async () => {
    const shared = deferred<string>();
    const controller = new AbortController();
    const waiter = waitForPromiseWithSignal(shared.promise, controller.signal);
    controller.abort();
    await assert.rejects(waiter);
    // Underlying shared promise is untouched and can still resolve for others.
    shared.resolve("still-ok");
    assert.equal(await shared.promise, "still-ok");
  });

  it("no signal passes the shared promise through untouched", async () => {
    const shared = Promise.resolve(42);
    assert.equal(await waitForPromiseWithSignal(shared, undefined), 42);
  });
});
