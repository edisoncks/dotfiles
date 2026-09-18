#!/usr/bin/env node
// Thin wrapper around ../chime.ts (single source of truth).
// Output is gitignored; the extension self-generates at runtime when absent.
//
// Usage: node scripts/generate-beep.mjs [output.wav]
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHIME_DUR_S, CHIME_SR, renderChime } from "../chime.ts";

const extDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? join(extDir, "beep.wav");
const buf = renderChime();
writeFileSync(out, buf);
console.log(`wrote ${out} sr=${CHIME_SR} dur=${CHIME_DUR_S.toFixed(3)}s bytes=${buf.length}`);
