import { memo, type PointerEvent, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import type { Skill } from "./types";
import { avatarUrl, formatStars, installCmd, isCaution, skillHref } from "./skills";
import { CheckBadge, CopyIcon, StarIcon } from "./icons";

export function highlight(text: string, terms: string[]): ReactNode {
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

export function Avatar({ owner, size = 20 }: { owner: string; size?: number }) {
  return (
    <img className="avatar" src={avatarUrl(owner, size * 2)} width={size} height={size} alt="" loading="lazy"
      onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
  );
}

export function Publisher({ skill: s }: { skill: Skill }) {
  return (
    <span className="publisher">
      <Avatar owner={s.r.split("/")[0]} />
      <span className="publisher-name">{s.repo.pub}</span>
      {s.repo.o ? <span className="verified" title="Official publisher" aria-label="Official publisher"><CheckBadge /></span> : null}
    </span>
  );
}

interface Props {
  skill: Skill;
  terms: string[];
  onCopy: (text: string) => void;
  index: number;
}

const TILT = 6; // degrees at the card's edge
const tiltSpring = { stiffness: 260, damping: 22 };

function SkillCard({ skill: s, terms, onCopy, index }: Props) {
  const caution = isCaution(s.license);
  const reduce = useReducedMotion();
  const rotateX = useSpring(useMotionValue(0), tiltSpring);
  const rotateY = useSpring(useMotionValue(0), tiltSpring);

  // Feeds the cursor position to CSS for the glow, and tilts the card toward it (mouse only).
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    e.currentTarget.style.setProperty("--mx", `${x}px`);
    e.currentTarget.style.setProperty("--my", `${y}px`);
    if (reduce || e.pointerType !== "mouse") return;
    rotateY.set((x / r.width - 0.5) * TILT * 2);
    rotateX.set((0.5 - y / r.height) * TILT * 2);
  };
  const onPointerLeave = () => { rotateX.set(0); rotateY.set(0); };

  return (
    <motion.article className="card" layout="position" onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      initial={{ opacity: 0, y: 18, scale: .98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: Math.min(index % 48, 16) * 0.025 } }}
      exit={{ opacity: 0, scale: .96, transition: { duration: .15 } }}>
      <span className="card-glow" aria-hidden="true" />
      <div className="card-top">
        <Publisher skill={s} />
        <span className="stars" title={`${s.repo.s.toLocaleString()} GitHub stars`}>
          <StarIcon /> {formatStars(s.repo.s)}
        </span>
      </div>
      <h3 className="card-title">
        <a href={skillHref(s)} className="card-link">{highlight(s.n, terms)}</a>
      </h3>
      <p className="card-desc">{highlight(s.d, terms)}</p>
      <div className="card-foot">
        <span className="tag">{s.c}</span>
        {caution && <span className="tag tag-warn" title="Check the license before reusing">{s.license}</span>}
        {s.repo.a && <span className="tag tag-warn">Archived</span>}
        <button type="button" className="icon-btn card-copy" onClick={() => onCopy(installCmd(s))}
          aria-label={`Copy install command for ${s.n}`} title="Copy install command">
          <CopyIcon size={16} />
        </button>
      </div>
    </motion.article>
  );
}

export default memo(SkillCard);

export function SkeletonCard() {
  return (
    <div className="card skeleton" aria-hidden="true">
      <div className="sk sk-line" style={{ width: "45%" }} />
      <div className="sk sk-title" />
      <div className="sk sk-line" />
      <div className="sk sk-line" />
      <div className="sk sk-line" style={{ width: "70%" }} />
    </div>
  );
}
