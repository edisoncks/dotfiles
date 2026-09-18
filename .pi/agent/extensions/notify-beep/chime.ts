// Bundled two-tone chime (G4 -> C5), self-generated at runtime when beep.wav
// is absent. Mono 16-bit WAV, no dependencies. Deterministic: same bytes every run.
export const CHIME_SR = 22050;

export function renderChime(): Buffer {
	const SR = CHIME_SR;
	const PEAK = 0.4;
	const DECAY_K = 14;
	const FADE = Math.floor(SR * 0.005); // 5ms raised-cosine
	const G4 = 392.0;
	const C5 = 523.25;

	const n1 = Math.floor(SR * 0.12);
	const ng = Math.floor(SR * 0.02);
	const n2 = Math.floor(SR * 0.18);
	const total = n1 + ng + n2;
	const pcm = new Int16Array(total);

	const render = (offset: number, n: number, freq: number) => {
		for (let i = 0; i < n; i++) {
			const t = i / SR;
			let v = PEAK * Math.exp(-t * DECAY_K) * Math.sin(2 * Math.PI * freq * t);
			const fadeInLen = Math.min(FADE, n);
			if (i < fadeInLen) v *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeInLen);
			const fadeOutLen = Math.min(FADE, n);
			if (i >= n - fadeOutLen) v *= 0.5 - 0.5 * Math.cos((Math.PI * (n - 1 - i)) / fadeOutLen);
			pcm[offset + i] = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
		}
	};
	render(0, n1, G4);
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
	return buf;
}
