// Shape of public/skills.json, written by scripts/crawl.mjs. Keys are short to keep the file small.
export interface Repo {
  s: number; // stars
  b: string; // default branch
  l: string; // license
  u: string; // last push, YYYY-MM-DD
  pub: string; // publisher display name
  o: 0 | 1; // official publisher
  a?: 1; // archived
}

export interface RawSkill {
  n: string; // name
  d: string; // description
  r: string; // owner/repo
  p: string; // folder in repo, "." for root
  c: string; // category
  l?: string; // license, when it differs from the repo's
  m?: string; // SKILL.md filename, when not exactly "SKILL.md"
  f?: number; // file count
  x?: number; // identical copies found in other repos
}

export interface Index {
  v: number;
  generated: string;
  repos: Record<string, Repo>;
  skills: RawSkill[];
}

export interface Skill extends RawSkill {
  id: string;
  repo: Repo;
  license: string;
  nl: string;
  dl: string;
  hay: string;
}
