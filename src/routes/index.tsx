import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar, ReferenceLine,
} from "recharts";
import {
  analyze_clipping_ratio, analyze_modulation, analyze_subcarriers, defaultParams, runSimulation,
  MOD_BITS, type Modulation, type Params,
} from "@/lib/ofdm";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PAPR Reduction in 5G-OFDM — Clipping & Filtering Simulator" },
      { name: "description", content: "Interactive 5G-OFDM simulation: PAPR, CCDF, spectrum and BER before and after clipping and filtering." },
      { property: "og:title", content: "PAPR Reduction in 5G-OFDM Simulator" },
      { property: "og:description", content: "Measure OFDM PAPR, apply clipping and filtering, and see the BER trade-off." },
    ],
  }),
  component: Index,
});

type Sim = ReturnType<typeof runSimulation>;
type Sweeps = { cr: ReturnType<typeof analyze_clipping_ratio>; sc: ReturnType<typeof analyze_subcarriers>; mod: ReturnType<typeof analyze_modulation> };

const C = { orig: "var(--sig-orig)", clip: "var(--sig-clip)", filt: "var(--sig-filt)", thr: "var(--sig-thr)", grid: "var(--grid)", axis: "var(--muted-foreground)" };
const tip = { contentStyle: { background: "var(--card)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 12 } };
const f2 = (v: number) => v.toFixed(2);
const sci = (v: number) => (v === 0 ? "0" : v.toExponential(2));
const axisProps = { stroke: C.axis, fontSize: 11, fontFamily: "var(--font-mono)" };

function Index() {
  const [p, setP] = useState<Params>(defaultParams);
  const [sim, setSim] = useState<Sim | null>(null);
  const [sw, setSw] = useState<Sweeps | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (q: Params) => {
    setBusy(true);
    setTimeout(() => {
      setSim(runSimulation(q));
      setSw({ cr: analyze_clipping_ratio(q), sc: analyze_subcarriers(q), mod: analyze_modulation(q) });
      setBusy(false);
    }, 30);
  };
  useEffect(() => run(p), []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Params>(k: K, v: Params[K]) => setP((o) => ({ ...o, [k]: v }));
  const m = sim?.methods;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <header className="mb-8 border-b border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">5G-OFDM · PAPR lab</p>
        <h1 className="mt-2 text-3xl font-bold md:text-5xl">PAPR Reduction by Clipping &amp; Filtering</h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          Bits → QAM → oversampled IFFT → clip at A<sub>max</sub> = CR·RMS → frequency-domain low-pass filter → AWGN → FFT → demodulate. All computed live in your browser.
        </p>
      </header>

      <section className="mb-8 grid gap-4 rounded-lg border border-border bg-card p-5 md:grid-cols-4 lg:grid-cols-7">
        <Sel label="Subcarriers N" value={p.subcarriers} opts={[64, 128, 256, 512, 1024]} on={(v) => set("subcarriers", +v)} />
        <Sel label="Modulation" value={p.modulation} opts={Object.keys(MOD_BITS)} on={(v) => set("modulation", v as Modulation)} />
        <Sel label="Oversampling L" value={p.oversampling} opts={[1, 2, 4, 8]} on={(v) => set("oversampling", +v)} />
        <Num label="Clipping ratio CR" value={p.clippingRatio} step={0.1} min={0.5} max={3} on={(v) => set("clippingRatio", v)} />
        <Num label="Clip/filter passes" value={p.filterIterations} step={1} min={1} max={8} on={(v) => set("filterIterations", v)} />
        <Num label="OFDM symbols" value={p.symbols} step={100} min={100} max={5000} on={(v) => set("symbols", v)} />
        <div className="flex items-end">
          <button disabled={busy} onClick={() => run(p)} className="w-full rounded-md bg-primary px-4 py-2 font-mono text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
            {busy ? "Simulating…" : "Run simulation"}
          </button>
        </div>
      </section>

      {!sim || !m ? (
        <p className="font-mono text-muted-foreground">Running simulation…</p>
      ) : (
        <div className={busy ? "opacity-50 transition" : "transition"}>
          {/* Answers */}
          <section className="mb-8 grid gap-4 md:grid-cols-3">
            <Answer q="How high is the original PAPR?" big={`${f2(m[0].avg)} dB`} sub={`average · 99.9% of symbols below ${f2(m[0].p999)} dB · max ${f2(m[0].max)} dB`} />
            <Answer q="How much does clipping + filtering reduce it?" big={`−${f2(m[0].p999 - m[2].p999)} dB`} sub={`at CCDF 10⁻³ (${f2(m[0].p999)} → ${f2(m[2].p999)} dB). Average ${f2(m[0].avg)} → ${f2(m[2].avg)} dB (${((1 - m[2].avg / m[0].avg) * 100).toFixed(0)}%)`} />
            <Answer q="Cost in signal quality & BER?" big={`EVM ${m[2].evm.toFixed(1)}%`} sub={`BER @ ${sim.snrRef} dB: ${sci(m[0].ber)} → ${sci(m[2].ber)}. Out-of-band leak from clipping: ${m[1].oob.toFixed(1)} dBc, removed by filter.`} />
          </section>

          <Panel title="Performance comparison" note={`BER measured at Es/N0 = ${sim.snrRef} dB. OOB = out-of-band power relative to in-band.`}>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>{["Method", "Avg PAPR", "PAPR @10⁻³", "Max PAPR", "Reduction", "EVM", "BER", "OOB"].map((h) => <th key={h} className="border-b border-border px-3 py-2 font-normal">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {m.map((r, i) => (
                    <tr key={r.name} className="border-b border-border/50">
                      <td className="px-3 py-2" style={{ color: [C.orig, C.clip, C.filt][i] }}>{r.name}</td>
                      <td className="px-3 py-2">{f2(r.avg)} dB</td>
                      <td className="px-3 py-2">{f2(r.p999)} dB</td>
                      <td className="px-3 py-2">{f2(r.max)} dB</td>
                      <td className="px-3 py-2">{i === 0 ? "0%" : `${((1 - r.avg / m[0].avg) * 100).toFixed(1)}%`}</td>
                      <td className="px-3 py-2">{r.evm.toFixed(2)}%</td>
                      <td className="px-3 py-2">{sci(r.ber)}</td>
                      <td className="px-3 py-2">{r.oob < -100 ? "≈ none" : `${r.oob.toFixed(1)} dBc`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="CCDF of PAPR" note="P(PAPR > PAPR₀). Curves shifted left = lower PAPR.">
              <Chart>
                <LineChart data={sim.ccdf}>
                  <CartesianGrid stroke={C.grid} />
                  <XAxis dataKey="x" type="number" domain={[0, 13]} {...axisProps} label={{ value: "PAPR₀ (dB)", position: "insideBottom", offset: -4, fill: C.axis, fontSize: 11 }} />
                  <YAxis scale="log" domain={[1e-3, 1]} allowDataOverflow ticks={[1e-3, 1e-2, 1e-1, 1]} tickFormatter={sci} {...axisProps} />
                  <Tooltip {...tip} formatter={(v: number) => sci(v)} />
                  <Legend />
                  <Line dataKey="orig" name="Original" stroke={C.orig} dot={false} strokeWidth={2} connectNulls={false} />
                  <Line dataKey="clip" name="Clipped" stroke={C.clip} dot={false} strokeWidth={2} />
                  <Line dataKey="filt" name="Clipped + Filtered" stroke={C.filt} dot={false} strokeWidth={2} />
                </LineChart>
              </Chart>
            </Panel>

            <Panel title="BER vs SNR" note="Filtering only removes out-of-band energy, so in-band BER of clipped and clipped+filtered signals is nearly identical — the BER floor comes from clipping noise.">
              <Chart>
                <LineChart data={sim.ber}>
                  <CartesianGrid stroke={C.grid} />
                  <XAxis dataKey="snr" {...axisProps} label={{ value: "Es/N0 (dB)", position: "insideBottom", offset: -4, fill: C.axis, fontSize: 11 }} />
                  <YAxis scale="log" domain={[1e-6, 1]} allowDataOverflow tickFormatter={sci} {...axisProps} />
                  <Tooltip {...tip} formatter={(v: number) => sci(v)} />
                  <Legend />
                  <Line dataKey="orig" name="Original" stroke={C.orig} strokeWidth={2} />
                  <Line dataKey="clip" name="Clipped" stroke={C.clip} strokeWidth={2} strokeDasharray="5 4" />
                  <Line dataKey="filt" name="Clipped + Filtered" stroke={C.filt} strokeWidth={2} />
                </LineChart>
              </Chart>
            </Panel>

            <Panel title="Time-domain envelope |x(n)|" note="First OFDM symbol. Dashed line = clipping threshold. Filtering regrows some peaks.">
              <Chart>
                <LineChart data={sim.waveform}>
                  <CartesianGrid stroke={C.grid} />
                  <XAxis dataKey="n" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip {...tip} formatter={(v: number) => f2(v)} />
                  <Legend />
                  <ReferenceLine y={sim.waveform[0]?.thr ?? 0} stroke={C.thr} strokeDasharray="6 4" />
                  <Line dataKey="orig" name="Original" stroke={C.orig} dot={false} strokeWidth={1.5} />
                  <Line dataKey="clip" name="Clipped" stroke={C.clip} dot={false} strokeWidth={1.5} />
                  <Line dataKey="filt" name="Clipped + Filtered" stroke={C.filt} dot={false} strokeWidth={1.5} />
                </LineChart>
              </Chart>
            </Panel>

            <Panel title="Power spectrum" note="Clipping spreads energy out of band (spectral regrowth); the filter removes it.">
              <Chart>
                <LineChart data={sim.spectrum}>
                  <CartesianGrid stroke={C.grid} />
                  <XAxis dataKey="f" type="number" domain={["dataMin", "dataMax"]} {...axisProps} label={{ value: "Normalized frequency (× bandwidth)", position: "insideBottom", offset: -4, fill: C.axis, fontSize: 11 }} />
                  <YAxis domain={[-80, 5]} {...axisProps} />
                  <Tooltip {...tip} formatter={(v: number) => `${f2(v)} dB`} />
                  <Legend />
                  <Line dataKey="orig" name="Original" stroke={C.orig} dot={false} strokeWidth={1} />
                  <Line dataKey="clip" name="Clipped" stroke={C.clip} dot={false} strokeWidth={1} />
                  <Line dataKey="filt" name="Clipped + Filtered" stroke={C.filt} dot={false} strokeWidth={1} />
                </LineChart>
              </Chart>
            </Panel>

            <Panel title="PAPR distribution" note="Histogram of per-symbol PAPR (0.5 dB bins).">
              <Chart>
                <BarChart data={sim.hist}>
                  <CartesianGrid stroke={C.grid} />
                  <XAxis dataKey="x" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip {...tip} />
                  <Legend />
                  <Bar dataKey="orig" name="Original" fill={C.orig} />
                  <Bar dataKey="clip" name="Clipped" fill={C.clip} />
                  <Bar dataKey="filt" name="Clipped + Filtered" fill={C.filt} />
                </BarChart>
              </Chart>
            </Panel>

            {sw && (
              <Panel title="Clipping ratio trade-off" note="Lower CR → lower PAPR but higher BER (at 20 dB). Right axis: BER.">
                <Chart>
                  <LineChart data={sw.cr}>
                    <CartesianGrid stroke={C.grid} />
                    <XAxis dataKey="cr" {...axisProps} />
                    <YAxis yAxisId="l" {...axisProps} />
                    <YAxis yAxisId="r" orientation="right" scale="log" domain={[1e-5, 1]} allowDataOverflow tickFormatter={sci} {...axisProps} />
                    <Tooltip {...tip} formatter={(v: number) => (v < 0.5 ? sci(v) : f2(v))} />
                    <Legend />
                    <Line yAxisId="l" dataKey="orig" name="PAPR original" stroke={C.orig} />
                    <Line yAxisId="l" dataKey="filt" name="PAPR clip+filter" stroke={C.filt} />
                    <Line yAxisId="r" dataKey="berFilt" name="BER clip+filter" stroke={C.clip} strokeDasharray="5 4" />
                  </LineChart>
                </Chart>
              </Panel>
            )}

            {sw && (
              <Panel title="Effect of number of subcarriers" note="Average PAPR grows with N.">
                <Chart>
                  <BarChart data={sw.sc}>
                    <CartesianGrid stroke={C.grid} />
                    <XAxis dataKey="N" {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip {...tip} formatter={(v: number) => `${f2(v)} dB`} />
                    <Legend />
                    <Bar dataKey="orig" name="Original" fill={C.orig} />
                    <Bar dataKey="filt" name="Clipped + Filtered" fill={C.filt} />
                  </BarChart>
                </Chart>
              </Panel>
            )}

            {sw && (
              <Panel title="Effect of modulation order" note="PAPR barely depends on modulation; higher orders are far more sensitive to clipping noise (BER at 20 dB).">
                <div className="overflow-x-auto">
                  <table className="w-full font-mono text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr>{["Modulation", "PAPR orig", "PAPR C+F", "BER orig", "BER C+F"].map((h) => <th key={h} className="border-b border-border px-3 py-2 font-normal">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {sw.mod.map((r) => (
                        <tr key={r.mod} className="border-b border-border/50">
                          <td className="px-3 py-2 text-primary">{r.mod}</td>
                          <td className="px-3 py-2">{f2(r.orig)} dB</td>
                          <td className="px-3 py-2">{f2(r.filt)} dB</td>
                          <td className="px-3 py-2">{sci(r.berOrig)}</td>
                          <td className="px-3 py-2">{sci(r.berFilt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function Answer({ q, big, sub }: { q: string; big: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{q}</p>
      <p className="mt-2 font-mono text-3xl font-semibold text-primary">{big}</p>
      <p className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground">{sub}</p>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {note && <p className="mb-4 mt-1 text-xs text-muted-foreground">{note}</p>}
      {children}
    </section>
  );
}

function Chart({ children }: { children: ReactNode }) {
  return <div className="h-72"><ResponsiveContainer width="100%" height="100%">{children as never}</ResponsiveContainer></div>;
}

function Sel({ label, value, opts, on }: { label: string; value: string | number; opts: (string | number)[]; on: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
      {label}
      <select value={value} onChange={(e) => on(e.target.value)} className="rounded-md border border-input bg-background px-2 py-2 text-sm text-foreground">
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function Num({ label, value, step, min, max, on }: { label: string; value: number; step: number; min: number; max: number; on: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
      {label}
      <input type="number" value={value} step={step} min={min} max={max} onChange={(e) => on(Math.min(max, Math.max(min, +e.target.value)))} className="rounded-md border border-input bg-background px-2 py-2 text-sm text-foreground" />
    </label>
  );
}
