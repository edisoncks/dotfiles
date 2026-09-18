#!/usr/bin/env node
// Generates beep.wav: a two-tone chime (G4 -> C5) cloning the old beep.mp3.
// Mono 16-bit WAV, no dependencies. Deterministic: same bytes every run.
// Output is gitignored; the extension falls back to the terminal bell when absent.
//
// Usage: node scripts/generate-beep.mjs [output.wav]
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 22050;
const PEAK = 0.4;
const DECAY_K = 14;
const FADE = Math.floor(SR * 0.005); // 5ms raised-cosine
const G4 = 392.0;
const C5 = 523.25;
const DUR1 = 0.12;
const GAP = 0.02;
const DUR2 = 0.18;

const n1 = Math.floor(SR * DUR1);
const ng = Math.floor(SR * GAP);
const n2 = Math.floor(SR * DUR2);
const total = n1 + ng + n2;
const pcm = new Int16Array(total);

function render(offset, n, freq) {
	for (let i = 0; i < n; i++) {
		const t = i / SR;
		const env = Math.exp(-t * DECAY_K);
		let v = PEAK * env * Math.sin(2 * Math.PI * freq * t);
		const fadeInLen = Math.min(FADE, n);
		if (i < fadeInLen) {
			const u = i / fadeInLen;
			v *= 0.5 - 0.5 * Math.cos(Math.PI * u);
		}
		const fadeOutLen = Math.min(FADE, n);
		if (i >= n - fadeOutLen) {
			const u = (n - 1 - i) / fadeOutLen;
			v *= 0.5 - 0.5 * Math.cos(Math.PI * u);
		}
		if (v > 1) v = 1;
		else if (v < -1) v = -1;
		pcm[offset + i] = Math.round(v * 32767);
	}
}

render(0, n1, G4);
// Gap stays silent.
render(n1 + ng, n2, C5);

const dataBytes = total * 2;
const buf = Buffer.alloc(44 + dataBytes);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + dataBytes, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(1, 22); // mono
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 2, 28); // byte rate
buf.writeUInt16LE(2, 32); // block align
buf.writeUInt16LE(16, 34); // bits per sample
buf.write("data", 36);
buf.writeUInt32LE(dataBytes, 40);
Buffer.from(pcm.buffer).copy(buf, 44);

const extDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? join(extDir, "beep.wav");
writeFileSync(out, buf);
console.log(`wrote ${out} sr=${SR} dur=${(total / SR).toFixed(3)}s bytes=${buf.length}`);
