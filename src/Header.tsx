import { useEffect, useState, type FormEvent, type RefObject } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { CoffeeIcon, GitHubIcon, MoonIcon, SearchIcon, SunIcon } from "./icons";

const THEME_KEY = "skillo-theme";
export const COFFEE_URL = "https://buymeacoffee.com/skillo.io";
const SUGGESTIONS = ["pdf", "testing", "mcp", "deploy", "security", "react", "data analysis"];

function currentTheme(): "light" | "dark" {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className="icon-btn" aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem(THEME_KEY, next); } catch {}
        setTheme(next);
      }}>
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

interface SearchProps {
  q: string;
  setQ: (q: string) => void;
  inputRef: RefObject<HTMLInputElement>;
  onSubmit?: () => void;
}

function SearchBox({ q, setQ, inputRef, onSubmit, size, id }: SearchProps & { size: "lg" | "sm"; id: string }) {
  const submit = (e: FormEvent) => { e.preventDefault(); inputRef.current?.blur(); onSubmit?.(); };
  return (
    <form role="search" className={`searchbox searchbox-${size}`} onSubmit={submit}>
      <SearchIcon size={size === "lg" ? 22 : 18} />
      <label htmlFor={id} className="sr-only">Search skills</label>
      <input ref={inputRef} id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={size === "lg" ? "What should your agent be able to do?" : "Search skills"}
        autoComplete="off" spellCheck={false} enterKeyHint="search" />
      <kbd className="kbd" aria-hidden="true">/</kbd>
    </form>
  );
}

export function TopBar({ showSearch, ...search }: SearchProps & { showSearch: boolean }) {
  return (
    <div className="topbar">
      <div className="container topbar-inner">
        <a className="brand" href="./" aria-label="Skillo home">
          <img className="brand-mark" src={`${import.meta.env.BASE_URL}logo-mark.png`} width={36} height={36} alt="" />
          <span className="brand-name">Skillo</span>
        </a>
        <div className={`topbar-search${showSearch ? " visible" : ""}`} aria-hidden={!showSearch}>
          {showSearch && <SearchBox {...search} size="sm" id="q-top" />}
        </div>
        <nav className="topbar-nav" aria-label="Main">
          <a href="#browse" className="nav-link">Browse</a>
          <a href="#how" className="nav-link">How it works</a>
          <a href="https://github.com/topics/agent-skills" className="icon-btn" target="_blank" rel="noopener" aria-label="Agent Skills on GitHub" title="Agent Skills on GitHub"><GitHubIcon /></a>
          <a href={COFFEE_URL} className="icon-btn" target="_blank" rel="noopener" aria-label="Buy me a coffee" title="Buy me a coffee"><CoffeeIcon /></a>
          <ThemeToggle />
        </nav>
      </div>
    </div>
  );
}

function CountUp({ to }: { to: number }) {
  const reduce = useReducedMotion();
  const n = useMotionValue(reduce ? to : 0);
  const text = useTransform(n, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    const ctl = animate(n, to, { duration: reduce ? 0 : 1.4, ease: EASE });
    return () => ctl.stop();
  }, [n, to, reduce]);
  return <motion.span>{text}</motion.span>;
}

const EASE = [0.16, 1, 0.3, 1] as const;

// Counts each browser once via api/visits.ts. Stays null, and the stat hidden, where that isn't served (e.g. `vite` dev).
const VISITED_KEY = "skillo-visited";
function useVisitors() {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let seen = true;
    try { seen = localStorage.getItem(VISITED_KEY) === "1"; } catch {}
    fetch("/api/visits", { method: seen ? "GET" : "POST" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { visitors: number }) => {
        setN(d.visitors);
        if (!seen) try { localStorage.setItem(VISITED_KEY, "1"); } catch {}
      }, () => {});
  }, []);
  return n;
}

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 24, filter: "blur(8px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: { delay, duration: 0.7, ease: EASE } },
});

interface HeroProps extends SearchProps {
  heroRef: RefObject<HTMLDivElement>;
  stats: { skills: number; repos: number; publishers: number; generated: string } | null;
}

export function Hero({ heroRef, stats, ...search }: HeroProps) {
  const updated = stats?.generated
    ? new Date(stats.generated).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : null;
  const visitors = useVisitors();
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="container hero-inner">
        <motion.p className="eyebrow" {...rise(0)}><span className="pulse" aria-hidden="true" /> Open index · updated nightly from GitHub</motion.p>
        <motion.h1 id="hero-title" {...rise(0.08)}>Find the right skill for your&nbsp;<span className="hero-glow">agent.</span></motion.h1>
        <motion.p className="hero-sub" {...rise(0.16)}>
          Search every open-source <code>SKILL.md</code> we can find — the folders Claude Code, Codex, Copilot and Gemini CLI
          load on demand. Read it, then install it with one command.
        </motion.p>
        <motion.div ref={heroRef} {...rise(0.24)}>
          <SearchBox {...search} size="lg" id="q-hero" />
        </motion.div>
        <motion.div className="suggest" aria-label="Popular searches" {...rise(0.3)}>
          <span className="suggest-label">Popular:</span>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="suggest-chip" onClick={() => { search.setQ(s); search.onSubmit?.(); }}>{s}</button>
          ))}
        </motion.div>
        <motion.dl className="stats" {...rise(0.36)}>
          <div><dt>Skills</dt><dd>{stats ? <CountUp to={stats.skills} /> : "—"}</dd></div>
          <div><dt>Repositories</dt><dd>{stats ? <CountUp to={stats.repos} /> : "—"}</dd></div>
          <div><dt>Publishers</dt><dd>{stats ? <CountUp to={stats.publishers} /> : "—"}</dd></div>
          {visitors != null && <div><dt>Visitors</dt><dd><CountUp to={visitors} /></dd></div>}
          <div><dt>Last updated</dt><dd>{updated ?? "—"}</dd></div>
        </motion.dl>
      </div>
    </section>
  );
}
