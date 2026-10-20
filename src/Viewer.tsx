import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Skill } from "./types";
import { blobUrl, installCmd, isCaution, rawUrl, treeUrl } from "./skills";
import { Publisher } from "./SkillCard";
import { CloseIcon, CopyIcon, ExternalIcon, StarIcon } from "./icons";
import { motion } from "motion/react";

type Tab = "doc" | "raw" | "files";
interface Entry { name: string; type: "file" | "dir"; size: number; html_url: string }

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function splitFrontmatter(md: string) {
  const m = md.match(/^﻿?---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!m) return { rows: [], body: md };
  const rows: { k: string; v: string }[] = [];
  let cur: { k: string; v: string } | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) rows.push((cur = { k: kv[1], v: kv[2] }));
    else if (cur) cur.v += " " + line.trim();
  }
  rows.forEach((r) => (r.v = r.v.replace(/^[>|][-+]?\s*/, "").replace(/^(["'])(.*)\1$/, "$2").trim()));
  return { rows, body: md.slice(m[0].length) };
}

// Renders markdown safely and points relative links and images back at the skill's folder on GitHub.
function renderMarkdown(s: Skill, body: string) {
  const tpl = document.createElement("template");
  tpl.innerHTML = DOMPurify.sanitize(marked.parse(body, { gfm: true, async: false }) as string);
  const isAbsolute = (h: string) => /^([a-z]+:)?\/\//i.test(h) || h.startsWith("mailto:") || h.startsWith("data:");
  tpl.content.querySelectorAll("a[href]").forEach((a) => {
    const h = a.getAttribute("href")!;
    if (h.startsWith("#")) return;
    if (!isAbsolute(h)) a.setAttribute("href", blobUrl(s, h.replace(/^\.\//, "")));
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener");
  });
  tpl.content.querySelectorAll("img[src]").forEach((img) => {
    const src = img.getAttribute("src")!;
    if (!isAbsolute(src)) img.setAttribute("src", rawUrl(s, src.replace(/^\.\//, "")));
    img.setAttribute("loading", "lazy");
  });
  return tpl.innerHTML;
}

interface Props { skill: Skill; onClose: () => void; onCopy: (text: string) => void }

export default function Viewer({ skill: s, onClose, onCopy }: Props) {
  const [tab, setTab] = useState<Tab>("doc");
  const [md, setMd] = useState<string | null>(null);
  const [mdErr, setMdErr] = useState(false);
  const [files, setFiles] = useState<Entry[] | "error" | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const cmd = installCmd(s);

  useEffect(() => {
    setTab("doc"); setMd(null); setMdErr(false); setFiles(null);
    let live = true;
    fetch(rawUrl(s, s.m ?? "SKILL.md"))
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => live && setMd(t), () => live && setMdErr(true));
    return () => { live = false; };
  }, [s]);

  // GitHub's unauthenticated API allows 60 requests an hour, so only list files when asked.
  useEffect(() => {
    if (tab !== "files" || files) return;
    let live = true;
    const path = s.p === "." ? "" : s.p.split("/").map(encodeURIComponent).join("/");
    fetch(`https://api.github.com/repos/${s.r}/contents/${path}?ref=${encodeURIComponent(s.repo.b)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((list: Entry[]) => live && setFiles([...list].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1))),
        () => live && setFiles("error"));
    return () => { live = false; };
  }, [tab, files, s]);

  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    addEventListener("keydown", onKey, true);
    return () => { document.body.style.overflow = prev; removeEventListener("keydown", onKey, true); };
  }, [onClose]);

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [tab, s]);

  const doc = useMemo(() => (md == null ? null : splitFrontmatter(md)), [md]);
  const html = useMemo(() => (doc ? renderMarkdown(s, doc.body) : ""), [doc, s]);

  let body;
  if (tab === "files") {
    body = files === null ? <p className="vnote">Loading files…</p>
      : files === "error" ? <p className="vnote">Couldn't list files (GitHub limits anonymous requests to 60 an hour). <a href={treeUrl(s)} target="_blank" rel="noopener">Browse the folder on GitHub</a></p>
      : <ul className="files">{files.map((f) => (
          <li key={f.name}><a href={f.html_url} target="_blank" rel="noopener">{f.name}{f.type === "dir" ? "/" : ""}</a><span className="sz">{f.type === "dir" ? "folder" : kb(f.size)}</span></li>
        ))}</ul>;
  } else if (!doc) {
    body = mdErr
      ? <p className="vnote">This skill's SKILL.md didn't load. <a href={blobUrl(s, s.m ?? "SKILL.md")} target="_blank" rel="noopener">Read it on GitHub</a></p>
      : <div aria-busy="true"><div className="sk sk-title" /><div className="sk sk-line" /><div className="sk sk-line" /><div className="sk sk-line" style={{ width: "60%" }} /></div>;
  } else if (tab === "raw") {
    body = <pre className="raw">{md}</pre>;
  } else {
    body = (
      <>
        {doc.rows.length > 0 && <dl className="fm">{doc.rows.map((r) => <div key={r.k}><dt>{r.k}</dt><dd>{r.v}</dd></div>)}</dl>}
        <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
      </>
    );
  }

  const tabs: [Tab, string][] = [["doc", "Overview"], ["raw", "Source"], ["files", s.f != null ? `Files (${s.f})` : "Files"]];

  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside className="viewer" role="dialog" aria-modal="true" aria-labelledby="vname"
        initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 60, opacity: 0, transition: { duration: .18 } }}>
        <div className="vhead">
          <div className="vtop">
            <Publisher skill={s} />
            <button ref={closeRef} className="icon-btn" type="button" aria-label="Close" onClick={onClose}><CloseIcon /></button>
          </div>
          <h2 id="vname">{s.n}</h2>
          <div className="vmeta">
            <span className="stars"><StarIcon /> {s.repo.s.toLocaleString()}</span>
            <span className="tag">{s.c}</span>
            <span className={`tag${isCaution(s.license) ? " tag-warn" : ""}`}>{s.license}</span>
            {s.x ? <span className="tag" title="Identical copies found in other repos">+{s.x} {s.x === 1 ? "copy" : "copies"}</span> : null}
            {s.repo.a && <span className="tag tag-warn">Archived</span>}
          </div>
          <div className="install">
            <code>{cmd}</code>
            <button className="btn btn-primary" type="button" onClick={() => onCopy(cmd)}><CopyIcon size={16} /> Copy</button>
          </div>
          <a className="vrepo" href={treeUrl(s)} target="_blank" rel="noopener">
            {s.r}{s.p === "." ? "" : `/${s.p}`} <ExternalIcon />
          </a>
          <div className="tabs" role="tablist" aria-label="Skill details">
            {tabs.map(([t, label]) => (
              <button key={t} className="tab" role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}>
                {label}
                {tab === t && <motion.span className="tab-ink" layoutId="tab-ink" />}
              </button>
            ))}
          </div>
        </div>
        <motion.div className="vbody" ref={bodyRef} role="tabpanel" key={tab}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>{body}</motion.div>
      </motion.aside>
    </>
  );
}
