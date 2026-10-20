import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Skill } from "./types";
import { loadIndex, score } from "./skills";
import SkillCard, { Avatar, SkeletonCard } from "./SkillCard";
import Viewer from "./Viewer";
import FilterPanel, { DEFAULT_FILTERS, type Facet, type Filters, type Sort } from "./Filters";
import { COFFEE_URL, Hero, TopBar } from "./Header";
import { CloseIcon, FilterIcon, ShieldIcon } from "./icons";
import { copyText } from "./copy";
import { AnimatePresence, motion } from "motion/react";
import CursorFX from "./CursorFX";

const PAGE = 48;
const SORTS: Record<Sort, string> = { relevance: "Best match", stars: "Most stars", updated: "Recently updated", name: "Name (A–Z)" };

type Data = { skills: Skill[]; generated: string; repoCount: number };

// Search and filters live in the URL so any view can be bookmarked or shared.
function readUrl(): { q: string; filters: Filters } {
  const p = new URLSearchParams(location.search);
  const sort = p.get("sort") as Sort | null;
  return {
    q: p.get("q") ?? "",
    filters: {
      cat: p.get("cat") ?? "All",
      pub: p.get("pub") ?? "All",
      lic: p.get("lic") ?? "All",
      off: p.get("official") === "1",
      sort: sort && sort in SORTS ? sort : "relevance",
    },
  };
}

function writeUrl(q: string, f: Filters) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (f.cat !== "All") p.set("cat", f.cat);
  if (f.pub !== "All") p.set("pub", f.pub);
  if (f.lic !== "All") p.set("lic", f.lic);
  if (f.off) p.set("official", "1");
  if (f.sort !== "relevance") p.set("sort", f.sort);
  const qs = p.toString();
  history.replaceState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`);
}

const skillFromHash = () => {
  const m = location.hash.match(/^#\/skill\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
};

export default function App() {
  const initial = useMemo(readUrl, []);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState(initial.q);
  const query = useDeferredValue(q);
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(skillFromHash);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [heroVisible, setHeroVisible] = useState(true);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<number>();
  const heroRef = useRef<HTMLDivElement>(null);
  const heroInput = useRef<HTMLInputElement>(null);
  const topInput = useRef<HTMLInputElement>(null);
  const browseRef = useRef<HTMLElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  useEffect(() => { loadIndex().then(setData, () => setError(true)); }, []);
  useEffect(() => writeUrl(query, filters), [query, filters]);
  useEffect(() => setShown(PAGE), [query, filters]);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setHeroVisible(e.isIntersecting), { rootMargin: "-64px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onHash = () => {
      const id = skillFromHash();
      if (id) lastFocus.current = document.activeElement as HTMLElement;
      setOpenId(id);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (e.key === "/" && !typing && !openId) {
        e.preventDefault();
        (heroVisible ? heroInput : topInput).current?.focus();
      }
      if (e.key === "Escape" && sheetOpen) setSheetOpen(false);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [openId, heroVisible, sheetOpen]);

  useEffect(() => {
    if (!sheetOpen) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [sheetOpen]);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(""), 1800);
  }, []);
  const onCopy = useCallback(
    (text: string) => copyText(text).then((ok) => toast(ok ? "Install command copied" : "Couldn't copy — open the skill to select it")),
    [toast],
  );

  const set = useCallback(<K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v })), []);
  const scrollToResults = () => browseRef.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });

  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const view = useMemo(() => {
    if (!data) return null;
    const scores = new Map<Skill, number>();
    const base: Skill[] = [];
    for (const s of data.skills) {
      const sc = score(s, terms);
      if (sc) { scores.set(s, sc); base.push(s); }
    }
    const pass = (s: Skill, skip?: keyof Filters) =>
      (skip === "cat" || filters.cat === "All" || s.c === filters.cat) &&
      (skip === "pub" || filters.pub === "All" || s.repo.pub === filters.pub) &&
      (skip === "lic" || filters.lic === "All" || s.license === filters.lic) &&
      (!filters.off || s.repo.o === 1);
    const facet = (skip: keyof Filters, key: (s: Skill) => string): Facet => {
      const counts = new Map<string, number>();
      let all = 0;
      for (const s of base) if (pass(s, skip)) { all++; counts.set(key(s), (counts.get(key(s)) ?? 0) + 1); }
      return { all, counts };
    };
    const rank = (s: Skill) => s.repo.o * 1e9 + s.repo.s;
    const cmp: Record<Sort, (a: Skill, b: Skill) => number> = {
      relevance: (a, b) => scores.get(b)! - scores.get(a)! || rank(b) - rank(a) || a.nl.localeCompare(b.nl),
      stars: (a, b) => b.repo.s - a.repo.s || a.nl.localeCompare(b.nl),
      updated: (a, b) => b.repo.u.localeCompare(a.repo.u) || a.nl.localeCompare(b.nl),
      name: (a, b) => a.nl.localeCompare(b.nl),
    };
    return {
      list: base.filter((s) => pass(s)).sort(cmp[filters.sort]),
      cats: facet("cat", (s) => s.c),
      pubs: facet("pub", (s) => s.repo.pub),
      lics: facet("lic", (s) => s.license),
    };
  }, [data, terms, filters]);

  const meta = useMemo(() => {
    if (!data) return null;
    const pubs = new Map<string, { owner: string; count: number; official: boolean }>();
    for (const s of data.skills) {
      const p = pubs.get(s.repo.pub) ?? { owner: s.r.split("/")[0], count: 0, official: !!s.repo.o };
      p.count++;
      pubs.set(s.repo.pub, p);
    }
    const official = [...pubs].filter(([, p]) => p.official).sort((a, b) => b[1].count - a[1].count);
    return { publishers: pubs.size, official };
  }, [data]);

  const open = data && openId ? data.skills.find((s) => s.id === openId) ?? null : null;
  const closeSkill = useCallback(() => {
    history.replaceState(null, "", location.pathname + location.search);
    setOpenId(null);
    lastFocus.current?.focus();
  }, []);

  const active: { label: string; clear: () => void }[] = [];
  if (query) active.push({ label: `“${query}”`, clear: () => setQ("") });
  if (filters.off) active.push({ label: "Official only", clear: () => set("off", false) });
  if (filters.cat !== "All") active.push({ label: filters.cat, clear: () => set("cat", "All") });
  if (filters.pub !== "All") active.push({ label: filters.pub, clear: () => set("pub", "All") });
  if (filters.lic !== "All") active.push({ label: filters.lic, clear: () => set("lic", "All") });
  const filterCount = active.length - (query ? 1 : 0);
  const clearAll = () => { setQ(""); setFilters((f) => ({ ...DEFAULT_FILTERS, sort: f.sort })); };

  const search = { q, setQ, onSubmit: scrollToResults };

  return (
    <>
      <CursorFX />
      <a className="skip-link" href="#browse">Skip to results</a>
      <TopBar {...search} inputRef={topInput} showSearch={!heroVisible} />

      <main>
        <Hero {...search} inputRef={heroInput} heroRef={heroRef}
          stats={data && meta ? { skills: data.skills.length, repos: data.repoCount, publishers: meta.publishers, generated: data.generated } : null} />

        {meta && meta.official.length > 0 && (
          <section className="container publishers" aria-labelledby="pub-title">
            <h2 id="pub-title" className="section-label">Official publishers</h2>
            <ul className="pub-strip">
              {meta.official.slice(0, 16).map(([name, p]) => (
                <li key={name}>
                  <button type="button" className="pub-chip" aria-pressed={filters.pub === name}
                    onClick={() => { set("pub", filters.pub === name ? "All" : name); scrollToResults(); }}>
                    <Avatar owner={p.owner} size={24} />
                    <span>{name}</span>
                    <span className="pub-count">{p.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section ref={browseRef} id="browse" className="container browse" aria-labelledby="results-title" tabIndex={-1}>
          <aside className="sidebar" aria-label="Filters">
            {view && <FilterPanel filters={filters} set={set} cats={view.cats} pubs={view.pubs} lics={view.lics} />}
          </aside>

          <div className="results">
            <div className="toolbar">
              <div>
                <h2 id="results-title" className="results-title">{query ? <>Results for “{query}”</> : "All skills"}</h2>
                <p className="results-count" aria-live="polite">
                  {view ? `${view.list.length.toLocaleString()} ${view.list.length === 1 ? "skill" : "skills"}` : error ? "" : "Loading the index…"}
                </p>
              </div>
              <div className="toolbar-actions">
                <button type="button" className="btn btn-secondary filters-btn" onClick={() => setSheetOpen(true)}>
                  <FilterIcon size={16} /> Filters{filterCount ? <span className="badge">{filterCount}</span> : null}
                </button>
                <label className="sort">
                  <span className="sr-only">Sort by</span>
                  <select value={filters.sort} onChange={(e) => set("sort", e.target.value as Sort)}>
                    {Object.entries(SORTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
            </div>

            {active.length > 0 && (
              <div className="active-filters" aria-label="Active filters">
                {active.map((a) => (
                  <button key={a.label} type="button" className="active-chip" onClick={a.clear} aria-label={`Remove filter ${a.label}`}>
                    {a.label} <CloseIcon size={14} />
                  </button>
                ))}
                <button type="button" className="link-btn" onClick={clearAll}>Clear all</button>
              </div>
            )}

            {error && (
              <div className="empty">
                <h3>The skill index didn't load</h3>
                <p>Check your connection and try again.</p>
                <button type="button" className="btn btn-primary" onClick={() => location.reload()}>Reload</button>
              </div>
            )}

            {!data && !error && <div className="grid" aria-busy="true">{Array.from({ length: 9 }, (_, i) => <SkeletonCard key={i} />)}</div>}

            {view && view.list.length > 0 && (
              <>
                <div className="grid">
                  <AnimatePresence initial={false}>
                    {view.list.slice(0, shown).map((s, i) => <SkillCard key={s.id} skill={s} terms={terms} onCopy={onCopy} index={i} />)}
                  </AnimatePresence>
                </div>
                <div className="pager">
                  <p>Showing {Math.min(shown, view.list.length).toLocaleString()} of {view.list.length.toLocaleString()}</p>
                  {view.list.length > shown && (
                    <button className="btn btn-secondary" type="button" onClick={() => setShown(shown + PAGE)}>Show more skills</button>
                  )}
                </div>
              </>
            )}

            {view && !view.list.length && (
              <div className="empty">
                <h3>No skills match</h3>
                <p>Try a broader word, like “document” or “test”, or remove a filter.</p>
                <button type="button" className="btn btn-secondary" onClick={clearAll}>Clear search and filters</button>
              </div>
            )}
          </div>
        </section>

        <section id="how" className="how" aria-labelledby="how-title">
          <div className="container">
            <h2 id="how-title" className="section-title">How it works</h2>
            <ol className="steps">
              <li>
                <span className="step-n">1</span>
                <h3>Find a skill</h3>
                <p>A nightly crawl searches GitHub for skill repos, reads every <code>SKILL.md</code>, and merges identical copies so each skill appears once.</p>
              </li>
              <li>
                <span className="step-n">2</span>
                <h3>Read it first</h3>
                <p>Open any skill to read its instructions and browse its files. Check the license: “Unspecified” means no license file was found.</p>
              </li>
              <li>
                <span className="step-n">3</span>
                <h3>Install with one command</h3>
                <p>Copy the command to put the folder in <code>.claude/skills/</code>. For Codex, use <code>.agents/skills/</code>. It's pinned to the commit you read, so later changes upstream don't reach your agent until you choose to update.</p>
                <code className="step-code">npx giget@3 gh:owner/repo/path#commit .claude/skills/name</code>
              </li>
            </ol>
            <div className="callout">
              <ShieldIcon size={20} />
              <p><strong>Review before you install.</strong> Skills can include scripts your agent will run. Most of this index is community-published and unreviewed, so read the SKILL.md and any bundled scripts first.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <span>Skillo · an open index of Agent Skills</span>
          <span>Not affiliated with the listed publishers. Skills belong to their authors.</span>
          <a className="footer-link" href={COFFEE_URL} target="_blank" rel="noopener">Buy me a coffee ☕</a>
        </div>
      </footer>

      <AnimatePresence>
      {sheetOpen && view && (
        <>
          <motion.div key="sheet-scrim" className="scrim" onClick={() => setSheetOpen(false)}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div key="sheet" className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}>
            <div className="sheet-head">
              <h2 id="sheet-title">Filters</h2>
              <button type="button" className="icon-btn" aria-label="Close filters" onClick={() => setSheetOpen(false)}><CloseIcon /></button>
            </div>
            <div className="sheet-body">
              <FilterPanel filters={filters} set={set} cats={view.cats} pubs={view.pubs} lics={view.lics} />
            </div>
            <div className="sheet-foot">
              <button type="button" className="btn btn-secondary" onClick={clearAll}>Clear all</button>
              <button type="button" className="btn btn-primary" onClick={() => setSheetOpen(false)}>
                Show {view.list.length.toLocaleString()} skills
              </button>
            </div>
          </motion.div>
        </>
      )}
      </AnimatePresence>

      <AnimatePresence>{open && <Viewer key="viewer" skill={open} onClose={closeSkill} onCopy={onCopy} />}</AnimatePresence>
      <div className={`toast${toastMsg ? " show" : ""}`} role="status" aria-live="polite">{toastMsg}</div>
    </>
  );
}
