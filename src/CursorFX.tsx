import { useEffect, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";

// Only for a real mouse: touch screens have no hover position to follow.
const finePointer = () => matchMedia("(hover: hover) and (pointer: fine)").matches;

// The page backdrop: drifting aurora that leans away from the cursor, plus a soft light that trails it.
export default function CursorFX() {
  const reduce = useReducedMotion();
  const [enabled] = useState(finePointer);
  const live = enabled && !reduce;

  const mx = useMotionValue(innerWidth / 2);
  const my = useMotionValue(innerHeight / 3);
  const gx = useSpring(mx, { stiffness: 140, damping: 22, mass: 0.6 });
  const gy = useSpring(my, { stiffness: 140, damping: 22, mass: 0.6 });
  const px = useSpring(useTransform(mx, (v) => (v / innerWidth - 0.5) * -60), { stiffness: 60, damping: 20 });
  const py = useSpring(useTransform(my, (v) => (v / innerHeight - 0.5) * -40), { stiffness: 60, damping: 20 });

  useEffect(() => {
    if (!live) return;
    const move = (e: PointerEvent) => { mx.set(e.clientX); my.set(e.clientY); };
    addEventListener("pointermove", move, { passive: true });
    return () => removeEventListener("pointermove", move);
  }, [live, mx, my]);

  return (
    <div className="backdrop" aria-hidden="true">
      <motion.div className="backdrop-layer" style={live ? { x: px, y: py } : undefined}>
        <span /><span /><span />
      </motion.div>
      {live && <motion.div className="cursor-glow" style={{ x: gx, y: gy }} />}
    </div>
  );
}
