# Skillo

A searchable index of open-source Agent Skills (`SKILL.md` folders) from across GitHub, built with React and Vite.

## How it works

- `scripts/crawl.mjs` finds skill repos through GitHub repository search (topics such as `agent-skills` and `claude-skills`, repo names and descriptions, and READMEs that mention `SKILL.md`) plus the repos in `scripts/seeds.json`. It reads every `SKILL.md` in each repo, merges identical copies, and writes `public/skills.json`.
- The crawl is incremental. `data/crawl-state.json` records each repo checked and when it was last pushed, so unchanged repos are skipped. A first full crawl takes several runs (`MAX_TREES` repos per run, most-starred first).
- The app loads `skills.json` once and searches it in the browser. A skill's full SKILL.md is fetched from `raw.githubusercontent.com` only when you open it.
- Raw `filename:SKILL.md` code search isn't used: it returns millions of results, almost all personal copies of the same skills.

## Develop

```sh
npm install
npm run dev
```

## Crawl

```sh
GITHUB_TOKEN=$(gh auth token) npm run crawl
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `MIN_STARS` | `10` | Ignore discovered repos with fewer stars (seed repos are always included) |
| `MAX_TREES` | `3000` | Repos to check per run |
| `SEEDS_ONLY` | unset | `1` skips search and only crawls `scripts/seeds.json` |
| `CONCURRENCY` | `12` | Repos checked in parallel |

Mark first-party publishers in `scripts/publishers.json`.

## Deploy

`.github/workflows/crawl-and-deploy.yml` crawls nightly, commits the updated index, and deploys to GitHub Pages. To set it up:

1. Push to a GitHub repo with `main` as the default branch.
2. Settings → Pages → Source: **GitHub Actions**.
3. Add a repository secret `CRAWLER_TOKEN`: a fine-grained personal access token with read-only access to public repositories.
4. Optionally set a repository variable `MIN_STARS`.

`legacy/` holds the original single-file page.
