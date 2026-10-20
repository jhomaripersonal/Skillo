import type { Index, Skill } from "./types";

export const CATEGORIES = [
  "App Automation", "Agent Workflow", "Cloud & DevOps", "Science & Data", "Security", "Frontend & Mobile",
  "Documents", "Testing", "Writing & Comms", "Payments & Commerce", "Other",
];

export async function loadIndex(): Promise<{ skills: Skill[]; generated: string; repoCount: number }> {
  const res = await fetch(`${import.meta.env.BASE_URL}skills.json`);
  if (!res.ok) throw new Error(`skills.json: ${res.status}`);
  const index: Index = await res.json();
  const skills = index.skills.map((s): Skill => {
    const repo = index.repos[s.r];
    return {
      ...s,
      id: `${s.r}/${s.p}`,
      repo,
      license: s.l ?? repo.l,
      nl: s.n.toLowerCase(),
      dl: s.d.toLowerCase(),
      hay: `${repo.pub} ${s.r} ${s.c}`.toLowerCase(),
    };
  });
  return { skills, generated: index.generated, repoCount: Object.keys(index.repos).length };
}

export function score(s: Skill, terms: string[]): number {
  if (!terms.length) return 1;
  let total = 0;
  for (const t of terms) {
    let sc = 0;
    if (s.nl === t) sc += 25;
    else if (s.nl.startsWith(t)) sc += 14;
    else if (s.nl.includes(t)) sc += 10;
    if (s.hay.includes(t)) sc += 5;
    if (s.dl.includes(t)) sc += 3;
    if (!sc) return 0;
    total += sc;
  }
  return total + (s.repo.o ? 2 : 0) + Math.min(3, Math.log10(s.repo.s + 1));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
const dirPrefix = (s: Skill) => (s.p === "." ? "" : `${s.p}/`);

export const installCmd = (s: Skill) =>
  `npx degit ${s.r}${s.p === "." ? "" : `/${s.p}`} .claude/skills/${slug(s.n)}`;
export const treeUrl = (s: Skill) => `https://github.com/${s.r}/tree/${s.repo.b}/${s.p === "." ? "" : s.p}`;
export const blobUrl = (s: Skill, file: string) => `https://github.com/${s.r}/blob/${s.repo.b}/${dirPrefix(s)}${file}`;
export const rawUrl = (s: Skill, file: string) =>
  `https://raw.githubusercontent.com/${s.r}/${s.repo.b}/${dirPrefix(s)}${file}`;
export const isCaution = (license: string) => !/^(MIT|Apache-2.0|BSD-|MPL-2.0|ISC|CC-BY|CC0|Unlicense)/.test(license);

export const skillHref = (s: Skill) => `#/skill/${encodeURIComponent(s.id)}`;
export const avatarUrl = (owner: string, size: number) => `https://github.com/${owner}.png?size=${size}`;

export const formatStars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
