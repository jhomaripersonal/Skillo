import { useState } from "react";
import { CATEGORIES } from "./skills";
import { SearchIcon } from "./icons";

export interface Filters { cat: string; pub: string; lic: string; off: boolean; sort: Sort }
export type Sort = "relevance" | "stars" | "updated" | "name";
export const DEFAULT_FILTERS: Filters = { cat: "All", pub: "All", lic: "All", off: false, sort: "relevance" };

export interface Facet { all: number; counts: Map<string, number> }

interface Props {
  filters: Filters;
  set: <K extends keyof Filters>(k: K, v: Filters[K]) => void;
  cats: Facet;
  pubs: Facet;
  lics: Facet;
}

const byCount = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

function Option({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="facet-opt" aria-pressed={active} onClick={onClick}>
        <span className="facet-label">{label}</span>
        <span className="facet-count">{count.toLocaleString()}</span>
      </button>
    </li>
  );
}

export default function FilterPanel({ filters, set, cats, pubs, lics }: Props) {
  const [pubQuery, setPubQuery] = useState("");
  const [allLics, setAllLics] = useState(false);

  const pubList = byCount(pubs.counts).filter(([p]) => p.toLowerCase().includes(pubQuery.trim().toLowerCase()));
  const shownPubs = pubList.slice(0, 8);
  if (filters.pub !== "All" && !shownPubs.some(([p]) => p === filters.pub)) shownPubs.unshift([filters.pub, pubs.counts.get(filters.pub) ?? 0]);
  const licList = byCount(lics.counts);
  const shownLics = allLics ? licList : licList.slice(0, 6);
  if (filters.lic !== "All" && !shownLics.some(([l]) => l === filters.lic)) shownLics.push([filters.lic, lics.counts.get(filters.lic) ?? 0]);

  return (
    <div className="filters">
      <label className="switch">
        <span>
          <span className="switch-title">Official publishers only</span>
          <span className="switch-hint">Skills published by the company behind the tool</span>
        </span>
        <input type="checkbox" role="switch" checked={filters.off} onChange={(e) => set("off", e.target.checked)} />
      </label>

      <fieldset className="facet">
        <legend>Category</legend>
        <ul>
          <Option label="All categories" count={cats.all} active={filters.cat === "All"} onClick={() => set("cat", "All")} />
          {CATEGORIES.map((c) => {
            const n = cats.counts.get(c) ?? 0;
            if (!n && filters.cat !== c) return null;
            return <Option key={c} label={c} count={n} active={filters.cat === c} onClick={() => set("cat", c)} />;
          })}
        </ul>
      </fieldset>

      <fieldset className="facet">
        <legend>Publisher</legend>
        <label className="facet-search">
          <SearchIcon size={15} />
          <input type="search" value={pubQuery} onChange={(e) => setPubQuery(e.target.value)}
            placeholder={`Search ${pubs.counts.size.toLocaleString()} publishers`} aria-label="Search publishers" />
        </label>
        <ul>
          {!pubQuery && <Option label="All publishers" count={pubs.all} active={filters.pub === "All"} onClick={() => set("pub", "All")} />}
          {shownPubs.map(([p, n]) => (
            <Option key={p} label={p} count={n} active={filters.pub === p} onClick={() => set("pub", filters.pub === p ? "All" : p)} />
          ))}
          {!pubList.length && <li className="facet-empty">No publishers match</li>}
        </ul>
      </fieldset>

      <fieldset className="facet">
        <legend>License</legend>
        <ul>
          <Option label="Any license" count={lics.all} active={filters.lic === "All"} onClick={() => set("lic", "All")} />
          {shownLics.map(([l, n]) => (
            <Option key={l} label={l} count={n} active={filters.lic === l} onClick={() => set("lic", filters.lic === l ? "All" : l)} />
          ))}
        </ul>
        {licList.length > 6 && (
          <button type="button" className="link-btn" onClick={() => setAllLics(!allLics)}>
            {allLics ? "Show fewer" : `Show all ${licList.length} licenses`}
          </button>
        )}
      </fieldset>
    </div>
  );
}
