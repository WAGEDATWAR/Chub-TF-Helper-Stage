import { useEffect, useState } from "react";
import type { HelperGame } from "../game";
import { bandRead, moonRead, speciesLabel, confidenceBand, proposalReason } from "../view/format";

/** Persisted UI prefs (localStorage): the pane can be hidden to reclaim chat space. */
const PREF_HIDDEN = "chrysalis.pane.hidden";
const PREF_TAB = "chrysalis.pane.tab";

function readPref(key: string): string | null {
  try { return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null; } catch { return null; }
}
function writePref(key: string, value: string): void {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(key, value); } catch { /* ignore */ }
}

/**
 * Dev convenience: `?cast=A,b,c&genome=…&days=N` drives a run for screenshots.
 * `?card=Mira=wolf,Tomas=eagle` registers cards so detection has something to find.
 */
function useAutoDrive(game: HelperGame, refresh: () => void): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    for (const spec of (q.get("card") ?? "").split(",").filter(Boolean)) {
      const [name, species] = spec.split("=");
      if (name) game.knowCard({ id: name.toLowerCase(), names: [name], text: `${name} is ${species ?? "human"}.` });
    }
    const names = (q.get("cast") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    // drop the dev placeholder once real characters are named
    if (names.length > 0) game.untrack("subject");
    for (const n of names) game.track(n.toLowerCase().replace(/\s+/g, "_"), n);
    const genomes = (q.get("genome") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    genomes.forEach((g, i) => {
      const target = game.cast.list()[i % Math.max(1, game.tracked)];
      if (target) game.bestow(target.id, `genome.${g.replace(/^genome\./, "")}`, Number(q.get("dose") ?? 2));
    });
    for (const spec of (q.get("playstyle") ?? "").split(",").filter(Boolean)) {
      const [who, style] = spec.split(":");
      const char = game.cast.list().find((c) => c.id === who.toLowerCase());
      const genome = char?.sim.subject.genomes[0];
      if (char && genome && style) game.setPlaystyle(char.id, genome, style);
    }
    const days = Number(q.get("days") ?? 0);
    if (days > 0) game.advance(24 * days);
    refresh();
  }, []);
}

type Tab = "cast" | "detect" | "tools";

/** H8: a rendered image's state for one character (never authoritative). */
export interface VisualState {
  url: string;
  prompt: string;
  pending: boolean;
  error: string | null;
  key: string;
}

const TONE: Record<string, string> = { calm: "#6fd0b0", warm: "#e6c07a", hot: "#e69a6a", wild: "#e06a9a" };

/** Confidence-band fills for detection markers (H9). */
const BAND_FILL: Record<string, string> = { sure: "rgba(230,169,192,0.85)", likely: "rgba(230,169,192,0.5)", maybe: "rgba(140,160,175,0.55)" };

/** The H5 instrument pane: a legible cast read with a detection feed and tools. */
export function Pane({
  game,
  getGuard,
  getSaveKb,
  getVisual,
  onVisualize,
  onClearVisual,
}: {
  game: HelperGame;
  getGuard?: () => string[];
  getSaveKb?: () => number;
  getVisual?: (id: string) => VisualState | undefined;
  onVisualize?: (id: string, seed?: number) => void;
  onClearVisual?: (id: string) => void;
}) {
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);
  useAutoDrive(game, refresh);

  const [tab, setTab] = useState<Tab>(() => (readPref(PREF_TAB) as Tab) ?? "cast");
  const [hidden, setHidden] = useState(() => readPref(PREF_HIDDEN) === "1");
  const run = (fn: () => void) => { fn(); refresh(); };
  const view = game.view();

  const pick = (t: Tab) => { setTab(t); writePref(PREF_TAB, t); };
  const toggle = () => { setHidden((h) => { const next = !h; writePref(PREF_HIDDEN, next ? "1" : "0"); return next; }); };

  // a one-line summary of the cast, shown while collapsed so the pane still informs
  const summary = view.frames.length === 0
    ? "no one tracked"
    : view.frames.map((f) => `${f.name} ${f.exposure}%`).join(" · ");
  const alerts = (view.proposals.length > 0 ? ` ●${view.proposals.length}` : "") + (view.coupling.some((c) => c.shifted) ? " ⚡" : "");

  if (hidden) {
    return (
      <div style={css.collapsed}>
        <button style={css.toggle} onClick={toggle} title="Show the pane" aria-expanded={false}>▸ chrysalis</button>
        <span style={css.collapsedSummary} onClick={toggle}>{summary}{alerts}</span>
        <span style={css.moonShort}>{moonRead(view.moon).replace(/, full in .*/, "")}</span>
      </div>
    );
  }
  return (
    <div style={css.root}>
      <div style={css.head}>
        <button style={css.toggle} onClick={toggle} title="Hide the pane" aria-expanded={true}>▾</button>
        <span style={css.title}>Chrysalis</span>
        {alerts && <span style={css.alerts}>{alerts}</span>}
        <span style={css.spacer} />
        <span style={css.moon}>{moonRead(view.moon)}</span>
      </div>

      <div style={css.tabs}>
        {(["cast", "detect", "tools"] as Tab[]).map((t) => (
          <button key={t} style={{ ...css.tab, ...(tab === t ? css.tabOn : {}) }} onClick={() => pick(t)}>
            {t}{t === "detect" && view.proposals.length > 0 ? ` (${view.proposals.length})` : ""}
          </button>
        ))}
      </div>

      <div style={css.body}>
        {tab === "cast" && <CastTab game={game} run={run} refresh={refresh} getVisual={getVisual} onVisualize={onVisualize} onClearVisual={onClearVisual} />}
        {tab === "detect" && <DetectTab game={game} run={run} />}
        {tab === "tools" && <ToolsTab game={game} run={run} getGuard={getGuard} getSaveKb={getSaveKb} />}
      </div>
    </div>
  );
}

function CastTab({
  game,
  run,
  refresh,
  getVisual,
  onVisualize,
  onClearVisual,
}: {
  game: HelperGame;
  run: (fn: () => void) => void;
  refresh: () => void;
  getVisual?: (id: string) => VisualState | undefined;
  onVisualize?: (id: string, seed?: number) => void;
  onClearVisual?: (id: string) => void;
}) {
  const view = game.view();
  const [newName, setNewName] = useState("");
  return (
    <>
      <div style={css.row}>
        <input style={{ ...css.input, flex: 1 }} placeholder="track a character" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button style={css.btn} disabled={game.full || !newName.trim()} onClick={() => run(() => { game.track(newName.trim().toLowerCase().replace(/\s+/g, "_"), newName.trim()); setNewName(""); })}>track</button>
      </div>

      {view.frames.length === 0 && <div style={css.dim}>Nobody tracked. Cards and chat are read for species once someone is.</div>}

      {view.frames.map((f) => {
        const b = bandRead(f);
        const c = view.coupling.find((x) => x.characterId === f.id);
        const v = getVisual?.(f.id);
        return (
          <div key={f.id} style={css.castCard}>
            <div style={css.row}>
              <b style={css.name}>{f.name}</b>
              <span style={css.tag}>{speciesLabel(f.genome)}</span>
              {c?.shifted && <span style={css.shifted}>SHIFTED</span>}
              {f.realized && <span style={css.tag}>REALIZED</span>}
              <span style={css.spacer} />
              {onVisualize && (
                <button style={{ ...css.btn, padding: "2px 7px" }} disabled={v?.pending} onClick={() => { onVisualize(f.id); refresh(); }}>
                  {v?.pending ? "…" : "see"}
                </button>
              )}
              <button style={{ ...css.btn, padding: "2px 7px" }} onClick={() => run(() => game.untrack(f.id))}>×</button>
            </div>
            <div style={css.row}>
              <span style={css.pip}><span style={{ ...css.pipFill, width: `${b.pct}%`, background: TONE[b.tone] }} /></span>
              <span style={{ ...css.dim, color: TONE[b.tone] }}>{f.exposure}% · {b.state} — {b.phrase}</span>
            </div>
            {f.awareness > 0 && (
              <div style={css.row}>
                <span style={css.attr}>aware {f.awareness}%{f.realized ? " · realized" : ""}</span>
              </div>
            )}
            {c && (
              <div style={css.row}>
                <span style={css.attr}>{c.kind} pressure {Math.round(c.pressure * 100)}%{c.cues.length ? ` · ${c.cues.slice(0, 2).join(", ")}` : ""}</span>
              </div>
            )}
            {v && (v.url || v.pending || v.error) && (
              <div style={css.visual}>
                {v.pending && <div style={css.dim}>rendering…</div>}
                {v.error && <div style={{ ...css.dim, color: "#e0a06a" }}>{v.error}</div>}
                {v.url && <img src={v.url} alt={`${f.name}, ${b.state}`} style={css.visualImg} />}
                {v.url && (
                  <div style={css.row}>
                    {onVisualize && (
                      <button style={{ ...css.btn, padding: "2px 7px" }} disabled={v.pending} onClick={() => { onVisualize(f.id, (v.key.length + 7) * 13); refresh(); }}>reroll</button>
                    )}
                    {onClearVisual && (
                      <button style={{ ...css.btn, padding: "2px 7px" }} onClick={() => { onClearVisual(f.id); refresh(); }}>remove</button>
                    )}
                  </div>
                )}
              </div>
            )}
            {f.parts.length > 0 ? (
              <div style={css.parts}>
                {f.parts.map((p, i) => (
                  <span key={i} style={css.part}>
                    {p.label}{p.count > 1 ? <span style={css.partCount}> ×{p.count}</span> : null} <span style={css.partPct}>({p.pct}%)</span>
                  </span>
                ))}
              </div>
            ) : (
              <div style={css.dim}>no changes yet</div>
            )}
            <details style={css.details}>
              <summary style={css.summary}>full body</summary>
              <div style={css.describe}>{f.describe || "(unchanged)"}</div>
            </details>
          </div>
        );
      })}
    </>
  );
}

function DetectTab({ game, run }: { game: HelperGame; run: (fn: () => void) => void }) {
  const view = game.view();
  const [feedText, setFeedText] = useState("");
  return (
    <>
      <div style={css.label}>Pending proposals</div>
      {view.proposals.length === 0 && <div style={css.dim}>none — cards and chat are read for species; an override wins.</div>}
      {view.proposals.map((p) => (
        <div key={p.id} style={css.card}>
          <div style={css.row}>
            <b>{p.characterName}</b>
            <span style={css.tag}>{speciesLabel(p.genome)}</span>
            <span style={{ ...css.band, background: BAND_FILL[confidenceBand(p.confidence)] }}>{confidenceBand(p.confidence)}</span>
            <span style={css.dim}>· {proposalReason(p.source, p.token)}</span>
            <span style={css.spacer} />
            <button style={css.btn} onClick={() => run(() => game.applyProposal(p.id, 1.0))}>apply</button>
            <button style={css.btn} onClick={() => run(() => game.dismissProposal(p.id))}>dismiss</button>
          </div>
        </div>
      ))}

      <div style={css.label}>Simulate chat prose</div>
      <textarea style={css.textarea} rows={3} placeholder="Mira's skin prickles as fur spreads like a fox; Tomas grows eagle wings." value={feedText} onChange={(e) => setFeedText(e.target.value)} />
      <div style={css.row}>
        <button style={css.btn} disabled={!feedText.trim()} onClick={() => run(() => { game.observe(null, feedText); setFeedText(""); })}>observe as chat</button>
      </div>

      {view.journal.length > 0 && (
        <>
          <div style={css.label}>Detection journal</div>
          <div style={css.mono}>{view.journal.slice(-14).map((j) => `${j.kind}: ${j.text}`).join("\n")}</div>
        </>
      )}
    </>
  );
}

function ToolsTab({ game, run, getGuard, getSaveKb }: { game: HelperGame; run: (fn: () => void) => void; getGuard?: () => string[]; getSaveKb?: () => number }) {
  const view = game.view();
  const [selected, setSelected] = useState("genome.wolf");
  const switchChar = (id: string) => run(() => game.setActive(id));
  const active = game.activeId() ?? game.cast.list()[0]?.id ?? null;
  return (
    <>
      {view.coupling.length > 0 && (
        <>
          <div style={css.label}>Coupling</div>
          {view.coupling.map((c, i) => (
            <div key={i} style={css.card}>
              <div style={css.row}>
                <b>{game.cast.get(c.characterId)?.name ?? c.characterId}</b>
                <span style={css.tag}>{c.kind}</span>
                {c.shifted && <span style={css.shifted}>SHIFTED</span>}
                <span style={css.dim}>pressure {Math.round(c.pressure * 100)}%</span>
              </div>
              <div style={css.attr}>{c.breakdown.map((b) => `${b.source} ${b.value}`).join(" · ") || "no pressure"}</div>
              <div style={css.row}>
                <span style={css.dim}>playstyle</span>
                <select style={css.input} value={c.playstyle} onChange={(e) => run(() => game.setPlaystyle(c.characterId, c.genome, e.target.value))}>
                  {c.playstyles.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
                </select>
              </div>
              <div style={css.attr}>{c.playstyles.find((s) => s.id === c.playstyle)?.note}</div>
              <div style={css.row}>
                <span style={css.dim}>force a feeling</span>
                {(["fear", "anger", "desire"] as const).map((e) => (
                  <button key={e} style={{ ...css.btn, padding: "2px 6px" }} onClick={() => run(() => game.feel(c.characterId, e, 90))}>{e}</button>
                ))}
                {c.canCall && (
                  <button style={{ ...css.btn, ...css.btnSel, padding: "2px 6px" }} onClick={() => run(() => game.callShift(c.characterId))}>call shift</button>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      <div style={css.label}>Force a genome on {game.cast.get(active ?? "")?.name ?? "—"}</div>
      <select style={css.input} value={selected} onChange={(e) => setSelected(e.target.value)}>
        <option value="">— human —</option>
        {game.genomes().map((g) => <option key={g} value={g}>{speciesLabel(g)}</option>)}
      </select>
      <div style={css.row}>
        {game.cast.list().map((c) => (
          <button key={c.id} style={{ ...css.btn, ...(c.id === active ? css.btnSel : {}), padding: "3px 8px" }} onClick={() => switchChar(c.id)}>{c.name}</button>
        ))}
      </div>
      <div style={css.row}>
        <button style={css.btn} disabled={!active} onClick={() => run(() => active && game.override(active, selected || null))}>override</button>
        <button style={css.btn} disabled={!active} onClick={() => run(() => active && game.bestow(active, selected || "genome.wolf", 3.0))}>bestow ×3</button>
      </div>

      <div style={css.label}>Time</div>
      <div style={css.row}>
        <button style={css.btn} onClick={() => run(() => game.advance(1))}>+1h</button>
        <button style={css.btn} onClick={() => run(() => game.advance(24))}>+1d</button>
        <button style={css.btn} onClick={() => run(() => game.advance(24 * 7))}>+1w</button>
      </div>

      <div style={css.label}>Transformation pace</div>
      <div style={css.row}>
        {game.paces().map((p) => (
          <button
            key={p.id}
            style={{ ...css.btn, ...(game.paceId() === p.id ? css.btnSel : {}), padding: "3px 8px" }}
            title={p.note}
            onClick={() => run(() => game.setPace(p.id))}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div style={css.attr}>{game.paces().find((p) => p.id === game.paceId())?.note} · ~{game.paces().find((p) => p.id === game.paceId())?.approxDays}d to settle</div>

      {getGuard && getGuard().length > 0 && (
        <>
          <div style={css.label}>Guard (last message)</div>
          <div style={css.mono}>{getGuard().join(", ")} — drifted; replaced by the floor.</div>
        </>
      )}

      {getSaveKb && (
        <>
          <div style={css.label}>Save budget</div>
          <div style={css.mono}>{getSaveKb()} KB per message · {Math.round(getSaveKb() / Math.max(1, game.tracked))} KB/character · cap 40 KB/char</div>
        </>
      )}
    </>
  );
}

const css: Record<string, React.CSSProperties> = {
  // the page is transparent (the chat shows through); only our own panels paint,
  // so a collapsed or short pane reveals the chat behind it
  root: { width: "100%", height: "100%", boxSizing: "border-box", fontFamily: "system-ui, sans-serif", color: "#d8e0e6", display: "flex", flexDirection: "column", overflow: "hidden" },
  collapsed: { display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", boxSizing: "border-box", fontFamily: "system-ui, sans-serif", color: "#d8e0e6", background: "rgba(14,22,32,0.9)", borderBottom: "1px solid rgba(120,200,220,0.25)", flexWrap: "nowrap", minHeight: 34 },
  collapsedSummary: { fontSize: 12, color: "#9fb4be", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer", minWidth: 0, flex: 1 },
  head: { display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid rgba(120,200,220,0.3)", background: "rgba(14,22,32,0.9)" },
  toggle: { font: "inherit", fontSize: 13, lineHeight: 1, padding: "2px 7px", borderRadius: 4, border: "1px solid rgba(120,200,220,0.3)", background: "rgba(30,45,55,0.6)", color: "#cfe6ee", cursor: "pointer", whiteSpace: "nowrap" },
  title: { fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#7fd4e6" },
  alerts: { fontSize: 11, color: "#e6a9c0" },
  moon: { fontVariantNumeric: "tabular-nums", fontSize: 11, color: "#8fa3ad", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  moonShort: { fontVariantNumeric: "tabular-nums", fontSize: 11, color: "#8fa3ad", whiteSpace: "nowrap", flexShrink: 0 },
  tabs: { display: "flex", gap: 2, padding: "4px 10px", borderBottom: "1px solid rgba(120,200,220,0.15)", background: "rgba(14,22,32,0.9)" },
  tab: { font: "inherit", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", padding: "6px 10px", borderRadius: 4, border: "1px solid transparent", background: "transparent", color: "#6b8794", cursor: "pointer" },
  tabOn: { color: "#7fd4e6", border: "1px solid rgba(120,200,220,0.4)", background: "rgba(30,45,55,0.5)" },
  body: { flex: 1, minHeight: 0, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 6, WebkitOverflowScrolling: "touch", background: "rgba(14,22,32,0.9)" },
  castCard: { border: "1px solid rgba(120,200,220,0.18)", borderLeft: "3px solid rgba(120,200,220,0.4)", borderRadius: 6, padding: 7, background: "rgba(18,27,37,0.92)", display: "flex", flexDirection: "column", gap: 4 },
  card: { border: "1px solid rgba(120,200,220,0.15)", borderRadius: 5, padding: 6, background: "rgba(16,24,33,0.92)", display: "flex", flexDirection: "column", gap: 4 },
  name: { fontSize: 15 },
  label: { fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#6b8794", marginTop: 4 },
  row: { display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" },
  spacer: { flex: 1 },
  btn: { font: "inherit", fontSize: 12, padding: "7px 11px", borderRadius: 5, border: "1px solid rgba(120,200,220,0.35)", background: "rgba(30,45,55,0.6)", color: "#cfe6ee", cursor: "pointer", minHeight: 32 },
  btnSel: { border: "1px solid rgba(230,169,192,0.7)", background: "rgba(60,40,55,0.6)" },
  input: { font: "inherit", fontSize: 12, padding: "5px 7px", borderRadius: 4, border: "1px solid rgba(120,200,220,0.35)", background: "rgba(20,30,40,0.6)", color: "#cfe6ee" },
  textarea: { font: "inherit", fontSize: 12, padding: "5px 7px", borderRadius: 4, border: "1px solid rgba(120,200,220,0.35)", background: "rgba(20,30,40,0.6)", color: "#cfe6ee", resize: "vertical" },
  mono: { fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#9fb4be", whiteSpace: "pre-wrap" },
  tag: { fontSize: 11, color: "#e6a9c0", border: "1px solid rgba(230,169,192,0.4)", borderRadius: 4, padding: "1px 5px" },
  shifted: { fontSize: 10, letterSpacing: 1, color: "#0e1620", background: "#e6a9c0", borderRadius: 3, padding: "1px 5px" },
  band: { fontSize: 10, letterSpacing: 0.5, color: "#0e1620", borderRadius: 3, padding: "1px 5px", textTransform: "uppercase" },
  pip: { display: "inline-block", width: 90, height: 7, borderRadius: 4, background: "rgba(120,200,220,0.15)", verticalAlign: "middle", overflow: "hidden" },
  pipFill: { display: "inline-block", height: 7, borderRadius: 4 },
  parts: { display: "flex", flexWrap: "wrap", gap: "2px 4px" },
  part: { fontSize: 11, color: "#bcd3dc", background: "rgba(120,200,220,0.1)", border: "1px solid rgba(120,200,220,0.2)", borderRadius: 4, padding: "1px 6px" },
  partPct: { color: "#7fd4e6", fontVariantNumeric: "tabular-nums" },
  partCount: { color: "#8fa3ad" },
  details: { marginTop: 2 },
  summary: { fontSize: 11, color: "#6b8794", cursor: "pointer" },
  describe: { fontFamily: "ui-monospace, monospace", fontSize: 11, whiteSpace: "pre-wrap", color: "#8fb0bc", marginTop: 4 },
  attr: { fontSize: 10, color: "#6b8794" },
  dim: { color: "#6b8794", fontSize: 12 },
  visual: { display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start", marginTop: 2 },
  visualImg: { width: "100%", maxWidth: 260, borderRadius: 6, border: "1px solid rgba(120,200,220,0.25)", display: "block" },
};
