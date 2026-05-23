import { ArrowLeft, ArrowRight, Check, Download, ThumbsDown, ThumbsUp } from "lucide-react";
import { marked } from "marked";
import { quorumContent } from "virtual:quorum-content";
import { CorvoCloudAdapter, LocalBrowserAdapter } from "./lib/adapters";
import { getAnonymousId } from "./lib/identity";
import { projectToken, storageAdapterName } from "./lib/env";
import type { QuorumConfig, ReviewOption, Vote } from "./lib/types";
import { useMemo, useState } from "react";

const defaults: QuorumConfig = {
  title: "Quorum review",
  showRanking: true,
  maxRankingPicks: 3,
  collectName: "off",
  collectEmail: "off",
  showThumbnails: true,
  reviewsDir: "./content/reviews",
  hideBranding: false,
  unsafeAllowSameOrigin: false
};

type Step = "welcome" | "review" | "ranking" | "thanks";

export function App() {
  const config = { ...defaults, ...quorumContent.config };
  const reviews = quorumContent.reviews;
  const adapter = useMemo(() => storageAdapterName === "local-sqlite" ? new LocalBrowserAdapter() : new CorvoCloudAdapter(), []);
  const [step, setStep] = useState<Step>("welcome");
  const [sessionId, setSessionId] = useState("");
  const [index, setIndex] = useState(0);
  const [identity, setIdentity] = useState({ name: "", email: "" });
  const [responses, setResponses] = useState<Record<string, { vote?: Vote; note?: string }>>({});
  const [picks, setPicks] = useState<string[]>([]);
  const [overallNote, setOverallNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canStart = modeOk(config.collectName, identity.name) && modeOk(config.collectEmail, identity.email);
  const current = reviews[index];

  async function start() {
    setBusy(true);
    setError("");
    try {
      const token = projectToken || "local-preview-token";
      const session = await adapter.createSession({ projectToken: token, anonymousId: getAnonymousId(), ...identity });
      setSessionId(session.sessionId);
      setStep(reviews.length ? "review" : "thanks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start review.");
    } finally {
      setBusy(false);
    }
  }

  async function save(option: ReviewOption, next: { vote?: Vote; note?: string }) {
    const merged = { ...responses[option.id], ...next };
    setResponses((prev) => ({ ...prev, [option.id]: merged }));
    if (sessionId) await adapter.saveResponse({ sessionId, optionId: option.id, ...merged });
  }

  async function finish() {
    setBusy(true);
    setError("");
    try {
      if (config.showRanking) await adapter.saveRanking({ sessionId, picks, overallNote });
      await adapter.completeSession(sessionId);
      setStep("thanks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete review.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="review-frame">
        <header className="topbar">
          <div>
            <span className="eyebrow">Quorum</span>
            <h1>{config.title}</h1>
          </div>
          {step === "review" && <span className="progress">{index + 1} / {reviews.length}</span>}
        </header>

        {step === "welcome" && (
          <div className="copy-panel">
            <Markdown source={quorumContent.welcome} />
            <IdentityFields config={config} identity={identity} onChange={setIdentity} />
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={!canStart || busy} onClick={start}>
              {busy ? "Starting..." : config.welcome?.cta || "Start Reviewing"}
              <ArrowRight size={18} />
            </button>
          </div>
        )}

        {step === "review" && current && (
          <div className="review-grid">
            <article className="artifact">
              <h2>{current.name}</h2>
              {current.kind === "html" ? (
                <iframe title={current.name} src={current.url} sandbox={config.unsafeAllowSameOrigin ? "allow-scripts allow-same-origin" : "allow-scripts"} />
              ) : (
                <img src={current.url} alt={current.name} />
              )}
            </article>
            <aside className="feedback">
              <div className="vote-row" aria-label={`Vote on ${current.name}`}>
                <button className={responses[current.id]?.vote === "up" ? "vote active up" : "vote"} onClick={() => save(current, { vote: "up" })}><ThumbsUp /> Pass</button>
                <button className={responses[current.id]?.vote === "down" ? "vote active down" : "vote"} onClick={() => save(current, { vote: "down" })}><ThumbsDown /> Fail</button>
              </div>
              <label>
                Note
                <textarea value={responses[current.id]?.note || ""} onChange={(event) => save(current, { note: event.target.value })} placeholder="What should the team know?" />
              </label>
              <div className="nav-row">
                <button className="secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}><ArrowLeft size={18} /> Back</button>
                <button className="primary" onClick={() => index + 1 < reviews.length ? setIndex(index + 1) : setStep(config.showRanking ? "ranking" : "thanks")}>
                  {index + 1 < reviews.length ? "Next" : config.showRanking ? "Rank" : "Finish"}
                  <ArrowRight size={18} />
                </button>
              </div>
            </aside>
          </div>
        )}

        {step === "ranking" && (
          <div className="ranking">
            <h2>Pick your top {config.maxRankingPicks}</h2>
            <div className="ranking-list">
              {reviews.map((option) => {
                const selected = picks.includes(option.id);
                return (
                  <button key={option.id} className={selected ? "rank-card selected" : "rank-card"} onClick={() => setPicks(togglePick(picks, option.id, config.maxRankingPicks))}>
                    {config.showThumbnails && option.thumbnailUrl ? <img src={option.thumbnailUrl} alt="" /> : <span className="text-thumb">{option.name}</span>}
                    <span>{selected ? `${picks.indexOf(option.id) + 1}. ` : ""}{option.name}</span>
                    {selected && <Check size={18} />}
                  </button>
                );
              })}
            </div>
            <label>
              Overall note
              <textarea value={overallNote} onChange={(event) => setOverallNote(event.target.value)} />
            </label>
            {error && <p className="error">{error}</p>}
            <div className="nav-row">
              <button className="secondary" onClick={() => setStep("review")}><ArrowLeft size={18} /> Back</button>
              <button className="primary" disabled={busy} onClick={finish}>{busy ? "Saving..." : "Complete"} <Download size={18} /></button>
            </div>
          </div>
        )}

        {step === "thanks" && (
          <div className="copy-panel">
            <Markdown source={quorumContent.thankyou} />
          </div>
        )}
      </section>
      {!config.hideBranding && <footer>Powered by <a href="https://quorum.corvolabs.com">Quorum</a> · Corvo Labs</footer>}
    </main>
  );
}

function modeOk(mode: string, value: string) {
  return mode !== "required" || value.trim().length > 0;
}

function togglePick(picks: string[], id: string, max: number) {
  if (picks.includes(id)) return picks.filter((pick) => pick !== id);
  if (picks.length >= max) return picks;
  return [...picks, id];
}

function Markdown({ source }: { source: string }) {
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: marked.parse(source) }} />;
}

function IdentityFields({ config, identity, onChange }: { config: QuorumConfig; identity: { name: string; email: string }; onChange: (next: { name: string; email: string }) => void }) {
  if (config.collectName === "off" && config.collectEmail === "off") return null;
  return (
    <div className="identity-grid">
      {config.collectName !== "off" && <label>Name{config.collectName === "required" && <span> required</span>}<input value={identity.name} onChange={(event) => onChange({ ...identity, name: event.target.value })} /></label>}
      {config.collectEmail !== "off" && <label>Email{config.collectEmail === "required" && <span> required</span>}<input type="email" value={identity.email} onChange={(event) => onChange({ ...identity, email: event.target.value })} /></label>}
    </div>
  );
}
