#!/usr/bin/env node
// Builds public/skills.json: every Agent Skill (a folder with a SKILL.md) we can find on GitHub.
//
// Discovery: seed repos + repository search (topics, names, READMEs) sharded so each query
// stays under GitHub's 1,000-result cap. Raw `filename:SKILL.md` code search is not used:
// it returns millions of hits, nearly all personal copies of the same skills.
//
// Each run is incremental. data/crawl-state.json remembers every repo checked and its
// pushed_at, so unchanged repos are not re-fetched and a large first crawl finishes over
// several runs (MAX_TREES per run).
//
// Env: GITHUB_TOKEN (required), MIN_STARS (default 10), MAX_TREES (default 3000),
//      SEEDS_ONLY=1 to skip search, CONCURRENCY (default 12).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "skills.json");
const STATE = path.join(ROOT, "data", "crawl-state.json");
const TOKEN = process.env.GITHUB_TOKEN;
const MIN_STARS = +(process.env.MIN_STARS ?? 10);
const MAX_TREES = +(process.env.MAX_TREES ?? 3000);
const SEEDS_ONLY = process.env.SEEDS_ONLY === "1";
const CONCURRENCY = +(process.env.CONCURRENCY ?? 12);
const MAX_SKILLS_PER_REPO = 2000;
const DESC_MAX = 400;
const FORGET_AFTER_DAYS = 45;

if (!TOKEN) {
  console.error("Set GITHUB_TOKEN (for example: GITHUB_TOKEN=$(gh auth token) npm run crawl)");
  process.exit(1);
}

const readJson = async (f, fallback) => {
  try { return JSON.parse(await fs.readFile(f, "utf8")); } catch { return fallback; }
};
const seeds = await readJson(path.join(ROOT, "scripts", "seeds.json"), { repos: [], topics: [] });
const publishers = await readJson(path.join(ROOT, "scripts", "publishers.json"), {});
const prevIndex = await readJson(OUT, { repos: {}, skills: [] });
const state = await readJson(STATE, { repos: {} });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- GitHub API ----------

async function api(url, { accept = "application/vnd.github+json" } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url.startsWith("http") ? url : `https://api.github.com${url}`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "skillo-crawler",
      },
    });
    if (res.ok) return res.json();
    const retryable = res.status === 403 || res.status === 429 || res.status >= 500;
    if (retryable && attempt < 8) {
      const retryAfter = +res.headers.get("retry-after");
      const reset = +res.headers.get("x-ratelimit-reset");
      let wait = 2 ** attempt * 4000;
      if (retryAfter) wait = retryAfter * 1000;
      else if (res.headers.get("x-ratelimit-remaining") === "0" && reset) wait = reset * 1000 - Date.now() + 1000;
      log(`  ${res.status} on ${url.slice(0, 90)}; waiting ${Math.round(wait / 1000)}s`);
      await sleep(Math.max(wait, 1000));
      continue;
    }
    const err = new Error(`${res.status} ${url}`);
    err.status = res.status;
    throw err;
  }
}

// Search allows 30 requests/minute.
let lastSearch = 0;
async function search(q, page) {
  const wait = lastSearch + 2100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastSearch = Date.now();
  const params = new URLSearchParams({ q, per_page: "100", page: String(page), sort: "stars", order: "desc" });
  return api(`/search/repositories?${params}`);
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        await fn(items[k], k);
      }
    }),
  );
}

// ---------- Parsing ----------

// Reads top-level scalar keys from YAML frontmatter, including folded (>) and literal (|) blocks.
function parseFrontmatter(md) {
  const m = md.match(/^﻿?---\s*\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/);
  if (!m) return { fm: {}, body: md };
  const fm = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      fm[key] = /^[>|][-+]?$/.test(kv[2]) ? "" : kv[2];
    } else if (key && /^\s+\S/.test(line) && !/^\s+[\w-]+:\s/.test(line)) {
      fm[key] = (fm[key] + " " + line.trim()).trim();
    }
  }
  for (const k in fm) fm[k] = fm[k].replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
  return { fm, body: md.slice(m[0].length) };
}

function firstParagraph(body) {
  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    const t = block.trim();
    if (t && !/^(#|```|<|!\[|\||-{3,})/.test(t)) return t.replace(/\s+/g, " ");
  }
  return "";
}

// Free-text licenses in frontmatter ("MIT license", "3-clause BSD") mapped to SPDX ids.
const LICENSE_PATTERNS = [
  [/proprietary|complete terms|all rights reserved/i, "Source-available"],
  [/^mit\b/i, "MIT"],
  [/apache/i, "Apache-2.0"],
  [/bsd.?3|3.?clause/i, "BSD-3-Clause"],
  [/bsd.?2|2.?clause/i, "BSD-2-Clause"],
  [/agpl/i, "AGPL-3.0"],
  [/lgpl/i, "LGPL-3.0"],
  [/gpl.?v?3|gpl-3/i, "GPL-3.0"],
  [/gpl.?v?2|gpl-2/i, "GPL-2.0"],
  [/mpl|mozilla/i, "MPL-2.0"],
  [/cc.?by.?nc.?sa/i, "CC-BY-NC-SA-4.0"],
  [/cc.?by.?sa/i, "CC-BY-SA-4.0"],
  [/cc.?by/i, "CC-BY-4.0"],
  [/cc0/i, "CC0-1.0"],
  [/unlicense/i, "Unlicense"],
  [/^isc\b/i, "ISC"],
];

function normLicense(fmLicense, repoLicense) {
  if (fmLicense) {
    const hit = LICENSE_PATTERNS.find(([re]) => re.test(fmLicense));
    if (hit) return hit[1];
  }
  if (!repoLicense) return "Unspecified";
  if (repoLicense === "NOASSERTION") return "Other";
  return repoLicense;
}

const CATEGORY_RULES = [
  ["App Automation", /\bautomat\w*|\bzapier\b|\bcomposio\b|\bcrm\b|\bhubspot\b|\bsalesforce\b|\bairtable\b|\bjira\b|\btrello\b|\basana\b|\bnotion\b/g],
  ["Security", /\bsecur\w*|\bvulnerab\w*|\bexploit\w*|\bfuzz\w*|\bcve\b|\bmalware\b|\bpentest\w*|\bthreat\w*|\bsemgrep\b|\bcodeql\b|\bcrypto\w*|\bsast\b|\bsecrets?\b/g],
  ["Testing", /\btests?\b|\btesting\b|\btdd\b|\be2e\b|\bplaywright\b|\bcypress\b|\bjest\b|\bpytest\b|\bvitest\b|\bqa\b|\bcoverage\b/g],
  ["Payments & Commerce", /\bstripe\b|\bpayments?\b|\bcheckout\b|\bbilling\b|\binvoic\w*|\bcommerce\b|\bshopify\b|\bsubscriptions?\b/g],
  ["Documents", /\bpdfs?\b|\bdocx\b|\bxlsx\b|\bpptx\b|\bspreadsheets?\b|\bexcel\b|\bpowerpoint\b|\bword documents?\b|\bdocuments?\b/g],
  ["Science & Data", /\bscien\w*|\bbiolog\w*|\bchemi\w*|\bgenom\w*|\bprotein\w*|\bbioinf\w*|\bdatasets?\b|\bdata analy\w*|\bpandas\b|\bstatistic\w*|\bmachine learning\b|\bresearch\b|\bmolecul\w*|\bclinical\b|\bphysics\b|\bmodel training\b|\bfine-?tun\w*/g],
  ["Cloud & DevOps", /\bcloud\w*|\baws\b|\bazure\b|\bgcp\b|\bkubernetes\b|\bk8s\b|\bdocker\w*|\bterraform\b|\bdeploy\w*|\bci\/cd\b|\bdevops\b|\binfrastructure\b|\bserverless\b|\bdatabases?\b|\bsql\b|\bpostgres\w*|\bmonitoring\b|\bobservability\b/g],
  ["Frontend & Mobile", /\breact\b|\bfrontend\b|\bcss\b|\bui\b|\bux\b|\bdesign\w*|\btailwind\b|\bmobile\b|\bios\b|\bandroid\b|\bexpo\b|\bnext\.?js\b|\bvue\b|\bsvelte\b|\banimation\w*|\bvideo\b|\bcanvas\b|\bfigma\b/g],
  ["Writing & Comms", /\bwrit\w*|\bblog\w*|\bemails?\b|\bcopywrit\w*|\bnewsletter\w*|\bslack\b|\bcommunicat\w*|\btranslat\w*|\bsocial media\b|\blinkedin\b|\bseo\b/g],
  ["Agent Workflow", /\bagents?\b|\bsubagents?\b|\bworkflows?\b|\bplan\w*|\bbrainstorm\w*|\bprompt\w*|\bmcp\b|\bmemory\b|\bgit\b|\bcode review\b|\brefactor\w*|\bdebug\w*/g],
];

function categorize(name, desc) {
  const n = name.toLowerCase().replace(/[-_]/g, " ");
  const d = desc.toLowerCase();
  let best = "Other", bestScore = 0;
  for (const [cat, re] of CATEGORY_RULES) {
    const score = (n.match(re)?.length ?? 0) * 3 + (d.match(re)?.length ?? 0);
    if (score > bestScore) { best = cat; bestScore = score; }
  }
  return best;
}

function toSkill(md, repo, dir, fileName) {
  const { fm, body } = parseFrontmatter(md);
  const name = (fm.name || (dir === "." ? repo.r.split("/")[1] : path.posix.basename(dir))).slice(0, 80);
  let desc = fm.description || firstParagraph(body);
  if (!desc) return null;
  if (desc.length > DESC_MAX) desc = desc.slice(0, DESC_MAX - 1).trimEnd() + "…";
  const skill = {
    n: name,
    d: desc,
    r: repo.r,
    p: dir,
    c: prevCategory.get(`${repo.r}/${dir}`) ?? categorize(name, desc),
  };
  const l = normLicense(fm.license, repo.l);
  if (l !== normLicense(null, repo.l)) skill.l = l;
  if (fileName !== "SKILL.md") skill.m = fileName;
  return skill;
}

// ---------- Discovery ----------

const candidates = new Map(); // full_name -> repo info

function addRepo(r) {
  if (r.fork) return;
  candidates.set(r.full_name, {
    r: r.full_name,
    s: r.stargazers_count,
    b: r.default_branch,
    l: r.license?.spdx_id ?? null,
    u: r.pushed_at,
    owner: r.owner.login,
    archived: r.archived,
  });
}

// Splits a query by star range, then by creation date, until each piece has <= 1,000 results.
async function searchAll(base, lo = MIN_STARS, hi = 1_000_000, from = null, to = null) {
  const dates = from ? ` created:${from.toISOString().slice(0, 10)}..${to.toISOString().slice(0, 10)}` : "";
  const q = `${base} stars:${lo}..${hi} fork:false${dates}`;
  let first;
  try { first = await search(q, 1); } catch (e) { log(`  search failed: ${q} (${e.message})`); return; }
  const total = first.total_count;
  if (total > 1000) {
    if (lo < hi) {
      const mid = Math.max(lo, Math.min(hi - 1, Math.floor(Math.sqrt(lo * hi))));
      await searchAll(base, lo, mid);
      await searchAll(base, mid + 1, hi);
      return;
    }
    const start = from ?? new Date("2008-01-01");
    const end = to ?? new Date();
    if (end - start > 86400000) {
      const mid = new Date((+start + +end) / 2);
      await searchAll(base, lo, hi, start, mid);
      await searchAll(base, lo, hi, new Date(+mid + 86400000), end);
      return;
    }
    log(`  ${q} still has ${total} results; keeping the first 1,000`);
  }
  first.items.forEach(addRepo);
  const pages = Math.min(10, Math.ceil(Math.min(total, 1000) / 100));
  for (let p = 2; p <= pages; p++) {
    try { (await search(q, p)).items.forEach(addRepo); } catch (e) { log(`  page ${p} failed: ${e.message}`); }
  }
}

log(`Seeds: ${seeds.repos.length} repos`);
await pool(seeds.repos, 6, async (full) => {
  try { addRepo(await api(`/repos/${full}`)); } catch (e) { log(`  seed ${full}: ${e.message}`); }
});

if (!SEEDS_ONLY) {
  const queries = [
    ...seeds.topics.map((t) => `topic:${t}`),
    "skills in:name,description,topics",
    "skill in:name,description,topics",
    '"SKILL.md" in:readme',
  ];
  for (const q of queries) {
    const before = candidates.size;
    log(`Searching: ${q} (stars >= ${MIN_STARS})`);
    await searchAll(q);
    log(`  +${candidates.size - before} repos (${candidates.size} total)`);
  }
}

// ---------- Fetch skills ----------

const now = new Date().toISOString();
const seedSet = new Set(seeds.repos.map((r) => r.toLowerCase()));
const prevSkills = new Map();
for (const s of prevIndex.skills) {
  if (!prevSkills.has(s.r)) prevSkills.set(s.r, []);
  prevSkills.get(s.r).push(s);
}
// Keep earlier (possibly hand-fixed) categories, but let "Other" be re-classified as the rules improve.
const prevCategory = new Map(prevIndex.skills.filter((s) => s.c !== "Other").map((s) => [`${s.r}/${s.p}`, s.c]));

const queue = [...candidates.values()]
  .filter((c) => {
    const st = state.repos[c.r];
    return !st || st.u !== c.u || (st.n > 0 && !prevSkills.has(c.r));
  })
  .sort((a, b) => seedSet.has(b.r.toLowerCase()) - seedSet.has(a.r.toLowerCase()) || b.s - a.s);
const todo = queue.slice(0, MAX_TREES);
log(`${candidates.size} candidate repos; ${queue.length} new or changed; checking ${todo.length} this run`);

const fresh = new Map(); // repo -> skills fetched this run

await pool(todo, CONCURRENCY, async (c, k) => {
  if (k && k % 250 === 0) log(`  checked ${k}/${todo.length}`);
  let tree;
  try {
    tree = await api(`/repos/${c.r}/git/trees/${encodeURIComponent(c.b)}?recursive=1`);
  } catch (e) {
    if (e.status === 404 || e.status === 409) state.repos[c.r] = { u: c.u, n: 0, seen: now };
    else log(`  tree ${c.r}: ${e.message}`);
    return;
  }
  const blobs = tree.tree.filter((t) => t.type === "blob");
  const skillFiles = blobs
    .filter((t) => /(^|\/)skill\.md$/i.test(t.path) && !/(^|\/)node_modules\//.test(t.path))
    .slice(0, MAX_SKILLS_PER_REPO);
  const skills = [];
  await pool(skillFiles, 6, async (file) => {
    const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ".";
    const md = await raw(c.r, c.b, file.path);
    if (md == null) return;
    const skill = toSkill(md, c, dir, path.posix.basename(file.path));
    if (!skill) return;
    skill.f = dir === "." ? blobs.length : blobs.filter((b) => b.path.startsWith(dir + "/")).length;
    skills.push(skill);
  });
  state.repos[c.r] = { u: c.u, n: skills.length, seen: now };
  if (skills.length) fresh.set(c.r, skills);
});

async function raw(repo, branch, file) {
  const url = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${file.split("/").map(encodeURIComponent).join("/")}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.text();
      if (res.status === 404) return null;
    } catch {}
    await sleep(2 ** attempt * 1500);
  }
  return null;
}

// ---------- Assemble index ----------

const cutoff = Date.now() - FORGET_AFTER_DAYS * 86400000;
for (const c of candidates.values()) if (state.repos[c.r]) state.repos[c.r].seen = now;
for (const [r, st] of Object.entries(state.repos)) {
  if (Date.parse(st.seen) < cutoff && !seedSet.has(r.toLowerCase())) delete state.repos[r];
}

const repos = {};
const all = [];
const repoNames = new Set([...fresh.keys(), ...prevSkills.keys()]);
for (const r of repoNames) {
  if (!state.repos[r] || !state.repos[r].n) continue;
  const c = candidates.get(r);
  const prev = prevIndex.repos[r];
  const owner = (c?.owner ?? r.split("/")[0]).toLowerCase();
  const pub = publishers[owner];
  repos[r] = {
    s: c?.s ?? prev?.s ?? 0,
    b: c?.b ?? prev?.b ?? "HEAD",
    l: c ? normLicense(null, c.l) : prev?.l ?? "Unspecified",
    u: (c?.u ?? prev?.u ?? "").slice(0, 10),
    pub: pub?.name ?? (c?.owner ?? r.split("/")[0]),
    o: pub?.official ? 1 : 0,
  };
  if (c?.archived) repos[r].a = 1;
  all.push(...(fresh.get(r) ?? prevSkills.get(r) ?? []));
}

// The same skill is often copied into many repos. Keep one copy: official first, then most stars.
const rank = (s) => repos[s.r].o * 1e9 + repos[s.r].s;
const byKey = new Map();
for (const s of all) {
  const key = s.n.toLowerCase() + "|" + s.d.slice(0, 160).toLowerCase();
  const cur = byKey.get(key);
  if (!cur) byKey.set(key, { s, copies: 1 });
  else {
    cur.copies++;
    if (rank(s) > rank(cur.s)) cur.s = s;
  }
}
const skills = [...byKey.values()].map(({ s: { x, ...s }, copies }) => (copies > 1 ? { ...s, x: copies - 1 } : s));
skills.sort((a, b) => rank(b) - rank(a) || a.n.localeCompare(b.n));

const used = new Set(skills.map((s) => s.r));
for (const r of Object.keys(repos)) if (!used.has(r)) delete repos[r];

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.mkdir(path.dirname(STATE), { recursive: true });
await fs.writeFile(OUT, JSON.stringify({ v: 1, generated: now, repos, skills }));
await fs.writeFile(STATE, JSON.stringify(state));
log(`Wrote ${skills.length} skills from ${Object.keys(repos).length} repos (${all.length - skills.length} duplicate copies merged)`);
if (queue.length > todo.length) log(`${queue.length - todo.length} repos still queued for the next run`);
