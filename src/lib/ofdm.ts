// Pure-TypeScript 5G-OFDM PAPR simulation: clipping + frequency-domain filtering.

export type Modulation = "QPSK" | "16-QAM" | "64-QAM" | "256-QAM";
export const MOD_BITS: Record<Modulation, number> = { QPSK: 2, "16-QAM": 4, "64-QAM": 6, "256-QAM": 8 };

export interface Params {
  subcarriers: number; // N (power of 2)
  symbols: number; // OFDM symbols for PAPR/CCDF
  modulation: Modulation;
  oversampling: number; // L (power of 2)
  clippingRatio: number; // CR = A_max / RMS
  filterIterations: number; // repeated clip+filter passes
  snrMin: number;
  snrMax: number;
  snrStep: number;
  berSymbols: number; // OFDM symbols per SNR point
}

export const defaultParams = (): Params => ({
  subcarriers: 256,
  symbols: 1000,
  modulation: "16-QAM",
  oversampling: 4,
  clippingRatio: 1.4,
  filterIterations: 1,
  snrMin: 0,
  snrMax: 30,
  snrStep: 2,
  berSymbols: 60,
});

// ---------- complex arrays ----------
export interface CArr { re: Float64Array; im: Float64Array }
const carr = (n: number): CArr => ({ re: new Float64Array(n), im: new Float64Array(n) });

// ---------- seeded RNG ----------
let seed = 12345;
export const setSeed = (s: number) => { seed = s >>> 0 || 1; };
const rand = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const randn = () => { const u = Math.max(rand(), 1e-12); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };

// ---------- FFT (in-place radix-2) ----------
function fft(x: CArr, inverse = false) {
  const n = x.re.length, re = x.re, im = x.im;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// ---------- bits & QAM ----------
export function generate_bits(n: number): Uint8Array {
  const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = rand() < 0.5 ? 1 : 0; return b;
}
const gray = (v: number) => v ^ (v >> 1);
function pamLevels(m: number) { // m = bits per axis, Gray-coded levels
  const M = 1 << m, lv = new Float64Array(M);
  for (let i = 0; i < M; i++) lv[gray(i)] = 2 * i - M + 1;
  return lv;
}
const qamNorm = (k: number) => Math.sqrt((2 * ((1 << k) - 1)) / 3);

export function qam_modulate(bits: Uint8Array, mod: Modulation): CArr {
  const k = MOD_BITS[mod], h = k / 2, lv = pamLevels(h), s = qamNorm(k), n = bits.length / k, out = carr(n);
  for (let i = 0; i < n; i++) {
    let a = 0, b = 0;
    for (let j = 0; j < h; j++) { a = (a << 1) | bits[i * k + j]; b = (b << 1) | bits[i * k + h + j]; }
    out.re[i] = lv[a] / s; out.im[i] = lv[b] / s;
  }
  return out;
}

export function qam_demodulate(sym: CArr, mod: Modulation): Uint8Array {
  const k = MOD_BITS[mod], h = k / 2, M = 1 << h, s = qamNorm(k), n = sym.re.length, out = new Uint8Array(n * k);
  const dec = (v: number) => { let i = Math.round((v * s + M - 1) / 2); i = Math.min(M - 1, Math.max(0, i)); return gray(i); };
  for (let i = 0; i < n; i++) {
    const a = dec(sym.re[i]), b = dec(sym.im[i]);
    for (let j = 0; j < h; j++) { out[i * k + j] = (a >> (h - 1 - j)) & 1; out[i * k + h + j] = (b >> (h - 1 - j)) & 1; }
  }
  return out;
}

// ---------- OFDM ----------
// Oversampled IFFT: N data bins placed at the edges of an L*N grid (zero-padding in the middle).
export function ofdm_modulate(sym: CArr, N: number, L: number): CArr {
  const M = N * L, x = carr(M), half = N / 2;
  for (let k = 0; k < half; k++) { x.re[k] = sym.re[k]; x.im[k] = sym.im[k]; }
  for (let k = half; k < N; k++) { x.re[M - N + k] = sym.re[k]; x.im[M - N + k] = sym.im[k]; }
  fft(x, true);
  const g = Math.sqrt(M * M / N); // unit average power
  for (let i = 0; i < M; i++) { x.re[i] *= g; x.im[i] *= g; }
  return x;
}

export function ofdm_demodulate(x: CArr, N: number, L: number): CArr {
  const M = N * L, X = { re: Float64Array.from(x.re), im: Float64Array.from(x.im) }, half = N / 2, out = carr(N);
  fft(X);
  const g = Math.sqrt(N) / M; // undo modulator scaling
  for (let k = 0; k < half; k++) { out.re[k] = X.re[k] * g; out.im[k] = X.im[k] * g; }
  for (let k = half; k < N; k++) { out.re[k] = X.re[M - N + k] * g; out.im[k] = X.im[M - N + k] * g; }
  return out;
}

export function calculate_papr(x: CArr): number {
  let peak = 0, sum = 0;
  for (let i = 0; i < x.re.length; i++) { const p = x.re[i] ** 2 + x.im[i] ** 2; sum += p; if (p > peak) peak = p; }
  return 10 * Math.log10(peak / (sum / x.re.length));
}

const rms = (x: CArr) => { let s = 0; for (let i = 0; i < x.re.length; i++) s += x.re[i] ** 2 + x.im[i] ** 2; return Math.sqrt(s / x.re.length); };

export function clip_signal(x: CArr, cr: number, refRms?: number): CArr {
  const A = cr * (refRms ?? rms(x)), y = carr(x.re.length);
  for (let i = 0; i < x.re.length; i++) {
    const a = Math.hypot(x.re[i], x.im[i]), f = a > A ? A / a : 1;
    y.re[i] = x.re[i] * f; y.im[i] = x.im[i] * f;
  }
  return y;
}

// Ideal frequency-domain low-pass (FFT → zero out-of-band bins → IFFT)
export function filter_signal(x: CArr, N: number, L: number): CArr {
  const M = N * L, y = { re: Float64Array.from(x.re), im: Float64Array.from(x.im) }, half = N / 2;
  fft(y);
  for (let k = half; k < M - half; k++) { y.re[k] = 0; y.im[k] = 0; }
  fft(y, true);
  return y;
}

export function clip_and_filter(x: CArr, p: Params): { clipped: CArr; filtered: CArr } {
  const r0 = rms(x), clipped = clip_signal(x, p.clippingRatio, r0);
  let f = filter_signal(clipped, p.subcarriers, p.oversampling);
  for (let i = 1; i < p.filterIterations; i++) f = filter_signal(clip_signal(f, p.clippingRatio, r0), p.subcarriers, p.oversampling);
  return { clipped, filtered: f };
}

export function add_awgn_noise(x: CArr, snrDb: number, sigPower = 1): CArr {
  const s = Math.sqrt(sigPower / 10 ** (snrDb / 10) / 2), y = carr(x.re.length);
  for (let i = 0; i < x.re.length; i++) { y.re[i] = x.re[i] + s * randn(); y.im[i] = x.im[i] + s * randn(); }
  return y;
}

export function calculate_ber(a: Uint8Array, b: Uint8Array) { let e = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) e++; return e / a.length; }

export function calculate_ccdf(papr: number[], from = 0, to = 13, step = 0.25) {
  const pts: { x: number; p: number }[] = [];
  for (let t = from; t <= to + 1e-9; t += step) pts.push({ x: +t.toFixed(2), p: papr.filter((v) => v > t).length / papr.length });
  return pts;
}

// ---------- full analysis ----------
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

function oneSymbol(p: Params) {
  const bits = generate_bits(p.subcarriers * MOD_BITS[p.modulation]);
  const sym = qam_modulate(bits, p.modulation);
  const x = ofdm_modulate(sym, p.subcarriers, p.oversampling);
  return { bits, sym, x, ...clip_and_filter(x, p) };
}

function psdAccumulate(acc: Float64Array, x: CArr) {
  const y = { re: Float64Array.from(x.re), im: Float64Array.from(x.im) }; fft(y);
  for (let k = 0; k < acc.length; k++) acc[k] += y.re[k] ** 2 + y.im[k] ** 2;
}

function evmPct(ref: CArr, rx: CArr) {
  let e = 0, s = 0;
  for (let i = 0; i < ref.re.length; i++) { e += (rx.re[i] - ref.re[i]) ** 2 + (rx.im[i] - ref.im[i]) ** 2; s += ref.re[i] ** 2 + ref.im[i] ** 2; }
  return { e, s };
}

export function paprStats(p: Params) {
  const o: number[] = [], c: number[] = [], f: number[] = [];
  for (let i = 0; i < p.symbols; i++) { const r = oneSymbol(p); o.push(calculate_papr(r.x)); c.push(calculate_papr(r.clipped)); f.push(calculate_papr(r.filtered)); }
  return { o, c, f };
}

export function berCurve(p: Params) {
  const pts: { snr: number; orig: number; clip: number; filt: number; theory?: number }[] = [];
  for (let snr = p.snrMin; snr <= p.snrMax + 1e-9; snr += p.snrStep) {
    let eo = 0, ec = 0, ef = 0, tot = 0;
    for (let i = 0; i < p.berSymbols; i++) {
      const r = oneSymbol(p);
      const dem = (sig: CArr) => qam_demodulate(ofdm_demodulate(add_awgn_noise(sig, snr, p.oversampling), p.subcarriers, p.oversampling), p.modulation);
      const b = r.bits;
      const err = (d: Uint8Array) => { let e = 0; for (let j = 0; j < b.length; j++) if (b[j] !== d[j]) e++; return e; };
      eo += err(dem(r.x)); ec += err(dem(r.clipped)); ef += err(dem(r.filtered)); tot += b.length;
    }
    const floor = 0.5 / tot;
    pts.push({ snr, orig: Math.max(eo / tot, floor), clip: Math.max(ec / tot, floor), filt: Math.max(ef / tot, floor) });
  }
  return pts;
}

export function runSimulation(p: Params) {
  setSeed(2026);
  const { o, c, f } = paprStats(p);
  const M = p.subcarriers * p.oversampling;
  const psd = { o: new Float64Array(M), c: new Float64Array(M), f: new Float64Array(M) };
  let evC = { e: 0, s: 0 }, evF = { e: 0, s: 0 };
  let waveform: { n: number; orig: number; clip: number; filt: number; thr: number }[] = [];
  const nSpec = Math.min(200, p.symbols);
  for (let i = 0; i < nSpec; i++) {
    const r = oneSymbol(p);
    psdAccumulate(psd.o, r.x); psdAccumulate(psd.c, r.clipped); psdAccumulate(psd.f, r.filtered);
    const a = evmPct(r.sym, ofdm_demodulate(r.clipped, p.subcarriers, p.oversampling));
    const b = evmPct(r.sym, ofdm_demodulate(r.filtered, p.subcarriers, p.oversampling));
    evC.e += a.e; evC.s += a.s; evF.e += b.e; evF.s += b.s;
    if (i === 0) {
      const thr = p.clippingRatio * rms(r.x), len = Math.min(M, 400);
      waveform = Array.from({ length: len }, (_, n) => ({ n, orig: Math.hypot(r.x.re[n], r.x.im[n]), clip: Math.hypot(r.clipped.re[n], r.clipped.im[n]), filt: Math.hypot(r.filtered.re[n], r.filtered.im[n]), thr }));
    }
  }
  // spectrum, centered, in dB relative to in-band peak of original
  const ref = Math.max(...psd.o);
  const spectrum = Array.from({ length: M }, (_, i) => {
    const k = (i + M / 2) % M;
    const db = (v: number) => Math.max(-80, 10 * Math.log10(v / ref + 1e-12));
    return { f: +((i - M / 2) / p.subcarriers).toFixed(3), orig: db(psd.o[k]), clip: db(psd.c[k]), filt: db(psd.f[k]) };
  });
  const oob = (arr: Float64Array) => { let inb = 0, out = 0; const h = p.subcarriers / 2; arr.forEach((v, k) => (k < h || k >= M - h ? (inb += v) : (out += v))); return 10 * Math.log10(out / inb + 1e-15); };

  const ber = berCurve(p);
  const ccdfO = calculate_ccdf(o), ccdfC = calculate_ccdf(c), ccdfF = calculate_ccdf(f);
  const ccdf = ccdfO.map((pt, i) => ({ x: pt.x, orig: pt.p || null, clip: ccdfC[i].p || null, filt: ccdfF[i].p || null }));
  const p999 = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(0.999 * (s.length - 1))]; };
  const at = (snr: number, key: "orig" | "clip" | "filt") => { const pt = ber.reduce((b, q) => (Math.abs(q.snr - snr) < Math.abs(b.snr - snr) ? q : b)); return pt[key]; };
  const snrRef = Math.min(p.snrMax, 20);
  const methods = [
    { name: "Original OFDM", avg: mean(o), max: Math.max(...o), p999: p999(o), ber: at(snrRef, "orig"), evm: 0, oob: oob(psd.o) },
    { name: "Clipping", avg: mean(c), max: Math.max(...c), p999: p999(c), ber: at(snrRef, "clip"), evm: 100 * Math.sqrt(evC.e / evC.s), oob: oob(psd.c) },
    { name: "Clipping + Filtering", avg: mean(f), max: Math.max(...f), p999: p999(f), ber: at(snrRef, "filt"), evm: 100 * Math.sqrt(evF.e / evF.s), oob: oob(psd.f) },
  ];
  return { ccdf, waveform, spectrum, ber, methods, snrRef, hist: histogram(o, c, f) };
}

function histogram(o: number[], c: number[], f: number[]) {
  const bins = Array.from({ length: 28 }, (_, i) => ({ x: +(i * 0.5).toFixed(1), orig: 0, clip: 0, filt: 0 }));
  const put = (a: number[], k: "orig" | "clip" | "filt") => a.forEach((v) => { const i = Math.min(27, Math.max(0, Math.floor(v / 0.5))); bins[i][k]++; });
  put(o, "orig"); put(c, "clip"); put(f, "filt");
  return bins;
}

// ---------- parameter sweeps ----------
export function analyze_clipping_ratio(p: Params) {
  setSeed(7);
  return [0.8, 1.0, 1.2, 1.4, 1.6, 2.0].map((cr) => {
    const q = { ...p, clippingRatio: cr, symbols: 300, berSymbols: 30, snrMin: 20, snrMax: 20 };
    const s = paprStats(q), b = berCurve(q)[0];
    return { cr, orig: mean(s.o), clip: mean(s.c), filt: mean(s.f), berFilt: b.filt, berClip: b.clip };
  });
}

export function analyze_subcarriers(p: Params) {
  setSeed(9);
  return [64, 128, 256, 512, 1024].map((N) => {
    const s = paprStats({ ...p, subcarriers: N, symbols: 300 });
    return { N: String(N), orig: mean(s.o), filt: mean(s.f) };
  });
}

export function analyze_modulation(p: Params) {
  setSeed(11);
  return (Object.keys(MOD_BITS) as Modulation[]).map((m) => {
    const q = { ...p, modulation: m, symbols: 300, berSymbols: 30, snrMin: 20, snrMax: 20 };
    const s = paprStats(q), b = berCurve(q)[0];
    return { mod: m, orig: mean(s.o), filt: mean(s.f), berOrig: b.orig, berFilt: b.filt };
  });
}
