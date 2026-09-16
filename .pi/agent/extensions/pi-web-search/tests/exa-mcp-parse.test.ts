import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMcpResponse } from "../index.js";

describe("parseMcpResponse (P1: content-type-aware)", () => {
  it("parses plain JSON containing 'data:' as JSON, not SSE", () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      result: { content: [{ type: "text", text: "foo data: bar" }] },
    });
    const out = parseMcpResponse(body, "application/json");
    assert.equal(out.result?.content?.[0]?.text, "foo data: bar");
  });

  it("parses JSON with null content-type containing 'data:' as JSON", () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      result: { content: [{ type: "text", text: "data: URL spec" }] },
    });
    const out = parseMcpResponse(body, null);
    assert.equal(out.result?.content?.[0]?.text, "data: URL spec");
  });

  it("parses pretty-printed multiline JSON containing 'data:' as JSON", () => {
    const body = JSON.stringify(
      {
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: "line1\ndata: value\nline3" }] },
      },
      null,
      2,
    );
    const out = parseMcpResponse(body, "application/json; charset=utf-8");
    assert.equal(out.result?.content?.[0]?.text, "line1\ndata: value\nline3");
  });

  it("parses real SSE event-stream, returning last JSON frame", () => {
    const frame1 = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { a: 1 } });
    const frame2 = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      result: { content: [{ type: "text", text: "hello" }] },
    });
    const body = `event: message\ndata: ${frame1}\n\n event: message\ndata: ${frame2}\n\n`.replace(
      " event:",
      "event:",
    );
    const out = parseMcpResponse(body, "text/event-stream");
    assert.equal(out.result?.content?.[0]?.text, "hello");
  });

  it("returns {} on empty body (202 notifications/initialized)", () => {
    assert.deepEqual(parseMcpResponse("   \n  ", "application/json"), {});
    assert.deepEqual(parseMcpResponse("", null), {});
  });

  it("throws actionable error when body is neither JSON nor SSE", () => {
    assert.throws(() => parseMcpResponse("not-json{{{", "application/json"), /neither as JSON/);
  });
});
