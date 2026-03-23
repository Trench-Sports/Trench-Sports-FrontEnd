// src/components/strikeCompass.tsx
//
// 3-D strike angle visualiser.
// The bag is a flat 2-D rectangle tilted in 3-D space.
// An arrow animates in from the angle_deg direction and lands on the bag.
// While the replay is paused (isReplaying=false) the arrow stays visible
// indefinitely — it only clears when a new event fires.
// Drag to orbit. Snap buttons: Front · ← Side · Side → · Top.
//
// Dashboard change: add  isReplaying={isReplaying}  to the <StrikeCompass> mount.

import React, { useRef, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReplayCell  { r: number; c: number; mv: number; }
interface ReplayEvent {
  cells:      ReplayCell[];
  angleDeg:   number | null;
  si:         number | null;
  cellCount:  number;
  durationMs: number | null;
}
interface StrikeCompassProps {
  activeEvent:  ReplayEvent | null;
  activeAngle:  number | null;
  anglesDeg?:   any;
  isReplaying:  boolean;          // ← new: keeps arrow alive when paused
  modeAccent:   string;
  modeGlow:     string;
  isDark:       boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ANIM_MS  = 400;   // arrow travel
const FADE_MS  = 360;   // fade-out when replay is running and linger expires
const LINGER_MS = 1800; // how long to hold before auto-fade (only while playing)

// Flat bag rectangle in 3-D (half-extents)
const BAG_HW = 0.80;   // half-width  (X axis)
const BAG_HH = 1.30;   // half-height (Y axis)
// Bag sits at Z = 0, facing +Z (toward camera by default)

// Camera
const FOV     = 320;
const CAM_DST = 5.0;

// ─── Vec3 ─────────────────────────────────────────────────────────────────────

type V3 = [number, number, number];

function rotY(v: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c*v[0]+s*v[2], v[1], -s*v[0]+c*v[2]];
}
function rotX(v: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0], c*v[1]-s*v[2], s*v[1]+c*v[2]];
}
function project(p: V3, ry: number, rx: number, W: number, H: number): [number, number, number] {
  let v = rotY(p, ry);
  v     = rotX(v, rx);
  const z = v[2] + CAM_DST;
  const s = FOV / Math.max(z, 0.01);
  return [W/2 + v[0]*s, H/2 - v[1]*s, z];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#","");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function clamp01(t: number) { return Math.max(0,Math.min(1,t)); }
function easeOut(t: number) { return 1-Math.pow(1-clamp01(t),3); }
function easeIn(t: number)  { return Math.pow(clamp01(t),2); }
function lerp(a: number, b: number, t: number) { return a+(b-a)*t; }

// ─── Camera & animation state ─────────────────────────────────────────────────

interface Cam { rotY: number; rotX: number; tY: number; tX: number; }

type Phase = "idle" | "in" | "hold" | "out";
interface AnimState {
  angleDeg:    number | null;
  si:          number | null;
  startTs:     number;
  phase:       Phase;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

function renderFrame(
  canvas:      HTMLCanvasElement,
  cam:         Cam,
  anim:        AnimState,
  accent:      string,
  glow:        string,
  isDark:      boolean,
  isReplaying: boolean,
  ts:          number,
) {
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth;
  const H   = canvas.offsetHeight;
  if (!W || !H) return;

  if (canvas.width  !== Math.round(W*dpr) || canvas.height !== Math.round(H*dpr)) {
    canvas.width  = Math.round(W*dpr);
    canvas.height = Math.round(H*dpr);
  }

  // Smooth camera ease
  cam.tY    = Math.max(-Math.PI/2, Math.min(Math.PI/2, cam.tY));
  cam.rotY += (cam.tY - cam.rotY) * 0.11;
  cam.rotX += (cam.tX - cam.rotX) * 0.11;

  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const [acR, acG, acB] = hexToRgb(accent);
  const ink = isDark ? "255,255,255" : "20,20,40";
  const ry  = cam.rotY, rx = cam.rotX;
  const proj = (p: V3) => project(p, ry, rx, W, H);

  // ── Flat bag rectangle in 3-D ─────────────────────────────────────────────
  // Four corners of the rectangle (Z=0 plane, facing +Z)
  const corners: V3[] = [
    [-BAG_HW, -BAG_HH, 0],
    [ BAG_HW, -BAG_HH, 0],
    [ BAG_HW,  BAG_HH, 0],
    [-BAG_HW,  BAG_HH, 0],
  ];

  // Bag face normal — tells us if we're looking at front or back
  let bagNorm: V3 = [0, 0, 1];
  bagNorm = rotY(bagNorm, ry);
  bagNorm = rotX(bagNorm, rx);
  const facingCamera = bagNorm[2] > 0;

  const projCorners = corners.map(c => proj(c));
  const [c0,c1,c2,c3] = projCorners;

  // Always draw as front face — rotation is locked so back is never visible
  const bagAlpha = 0.92;
  const bgR = isDark ? 38 : 110;
  const bgG = isDark ? 24 : 80;
  const bgB = isDark ? 48 : 100;

  ctx.beginPath();
  ctx.moveTo(c0[0],c0[1]);
  ctx.lineTo(c1[0],c1[1]);
  ctx.lineTo(c2[0],c2[1]);
  ctx.lineTo(c3[0],c3[1]);
  ctx.closePath();

  // Subtle gradient across the face
  const grad = ctx.createLinearGradient(c3[0],c3[1],c1[0],c1[1]);
  if (isDark) {
    grad.addColorStop(0, `rgba(${bgR+12},${bgG+8},${bgB+16},${bagAlpha})`);
    grad.addColorStop(1, `rgba(${Math.max(0,bgR-8)},${Math.max(0,bgG-4)},${Math.max(0,bgB-8)},${bagAlpha})`);
  } else {
    grad.addColorStop(0, `rgba(${bgR+20},${bgG+14},${bgB+18},${bagAlpha})`);
    grad.addColorStop(1, `rgba(${Math.max(0,bgR-10)},${Math.max(0,bgG-8)},${Math.max(0,bgB-10)},${bagAlpha})`);
  }
  ctx.fillStyle = grad;
  ctx.fill();

  // Border
  ctx.strokeStyle = `rgba(${ink},${isDark?"0.30":"0.22"})`;
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // Centre cross on front face only
  if (facingCamera) {
    const [ctr]   = [proj([0,0,0] as V3)];
    const [ctrL]  = [proj([-BAG_HW*0.06,0,0] as V3)];
    const [ctrR]  = [proj([ BAG_HW*0.06,0,0] as V3)];
    const [ctrT]  = [proj([0, BAG_HH*0.06,0] as V3)];
    const [ctrB]  = [proj([0,-BAG_HH*0.06,0] as V3)];
    ctx.strokeStyle = `rgba(${ink},${isDark?"0.14":"0.10"})`;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(ctrL[0],ctrL[1]); ctx.lineTo(ctrR[0],ctrR[1]);
    ctx.moveTo(ctrT[0],ctrT[1]); ctx.lineTo(ctrB[0],ctrB[1]);
    ctx.stroke();
  }

  // Back face is never reachable — no label needed

  // ── "Trench Sports" label on top edge of bag ────────────────────────────────
  // Project the top-left and top-right corners to screen space, then draw
  // text along that line so it sticks to the bag as you orbit.
  {
    const topL = proj([-BAG_HW, BAG_HH, 0] as V3);
    const topR = proj([ BAG_HW, BAG_HH, 0] as V3);

    const tx    = (topL[0] + topR[0]) / 2;   // screen centre of top edge
    const ty    = (topL[1] + topR[1]) / 2;
    const edgeW = Math.hypot(topR[0]-topL[0], topR[1]-topL[1]); // projected width

    // Angle the text follows the top edge as the bag rotates
    const edgeAngle = Math.atan2(topR[1]-topL[1], topR[0]-topL[0]);

    // Font size scales with projected width so it always fits
    const fontSize = Math.max(7, Math.round(edgeW * 0.095));

    ctx.save();
    ctx.translate(tx, ty - fontSize * 0.5);  // sit just above the top edge
    ctx.rotate(edgeAngle);

    ctx.font         = `800 ${fontSize}px 'SF Mono','JetBrains Mono',monospace`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "bottom";
    ctx.letterSpacing = "0.12em";

    // Subtle shadow for legibility against the bag
    ctx.shadowColor  = isDark ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.8)";
    ctx.shadowBlur   = 4;
    ctx.fillStyle    = `rgba(${ink},${isDark ? "0.55" : "0.45"})`;
    ctx.fillText("TRENCH SPORTS", 0, 0);

    ctx.restore();
  }

  // ── Phase advancement ─────────────────────────────────────────────────────
  // While paused (isReplaying=false), freeze the phase in "hold" — never fade.
  // While playing, let it run the normal in→hold→out lifecycle.
  if (anim.phase !== "idle" && anim.startTs > 0) {
    const elapsed = ts - anim.startTs;
    if (anim.phase === "in" && elapsed >= ANIM_MS) {
      anim.phase   = "hold";
      anim.startTs = ts;
    }
    // Only advance hold→out when replay is actively running
    if (anim.phase === "hold" && isReplaying && elapsed >= LINGER_MS) {
      anim.phase   = "out";
      anim.startTs = ts;
    }
    if (anim.phase === "out" && elapsed >= FADE_MS) {
      anim.phase = "idle";
    }
  }

  // ── Arrow ─────────────────────────────────────────────────────────────────
  if (anim.phase !== "idle" && anim.angleDeg != null && anim.startTs > 0) {
    const elapsed = ts - anim.startTs;
    let arrowT = 0, alpha = 1;

    if      (anim.phase === "in")   arrowT = easeOut(elapsed / ANIM_MS);
    else if (anim.phase === "hold") arrowT = 1;
    else if (anim.phase === "out")  { arrowT = 1; alpha = 1 - easeIn(elapsed / FADE_MS); }

    if (alpha > 0) {
      const aRad   = (anim.angleDeg * Math.PI) / 180;
      const siNorm = anim.si != null ? clamp01(anim.si / 1000) : 0.5;

      // Impact point: centre of bag face
      const impactP: V3 = [0, 0, 0];

      // Arrow tail is in FRONT of the bag — negative Z (camera sits at -CAM_DST).
      // angle_deg maps to horizontal spread (X) of where the punch originates.
      // Z is always negative so the tail is on the camera side of the bag,
      // and the arrow always travels TOWARD the bag face (Z=0), never from behind.
      //   0°  = straight on  → tail is directly in front, centred (X=0, Z=-tailLen)
      //   90° = hard right   → tail is far right  (+X) and slightly in front
      //  -90° = hard left    → tail is far left   (-X) and slightly in front
      const rawX    =  Math.sin(aRad);            // left/right spread
      const rawZ    = -(Math.abs(Math.cos(aRad)) + 0.35); // always negative (in front)
      const tailLen = 3.5;
      const tailMag = Math.sqrt(rawX*rawX + rawZ*rawZ);
      const tailP: V3 = [(rawX/tailMag)*tailLen, 0, (rawZ/tailMag)*tailLen];

      // Animated tip
      const tipP: V3 = [
        lerp(tailP[0], impactP[0], arrowT),
        lerp(tailP[1], impactP[1], arrowT),
        lerp(tailP[2], impactP[2], arrowT),
      ];

      const [impSx, impSy, impSz] = proj(impactP);
      const [tipSx, tipSy, tipSz] = proj(tipP);
      const [tailSx, tailSy]      = proj(tailP);

      if (impSz > 0 && tipSz > 0) {
        ctx.save();
        ctx.globalAlpha = alpha;

        const lineW    = 2.5 + siNorm * 2;
        const shaftLen = Math.hypot(tipSx-tailSx, tipSy-tailSy);

        // ── Shaft ────────────────────────────────────────────────────────────
        if (shaftLen > 3) {
          ctx.shadowColor = glow;
          ctx.shadowBlur  = 14 + siNorm*10;
          const g = ctx.createLinearGradient(tailSx,tailSy,tipSx,tipSy);
          g.addColorStop(0,    `rgba(${acR},${acG},${acB},0)`);
          g.addColorStop(0.28, `rgba(${acR},${acG},${acB},0.22)`);
          g.addColorStop(0.72, `rgba(${acR},${acG},${acB},0.85)`);
          g.addColorStop(1,    `rgba(${acR},${acG},${acB},1)`);
          ctx.strokeStyle = g;
          ctx.lineWidth   = lineW;
          ctx.lineCap     = "round";
          ctx.beginPath(); ctx.moveTo(tailSx,tailSy); ctx.lineTo(tipSx,tipSy); ctx.stroke();
        }

        // ── Arrowhead ────────────────────────────────────────────────────────
        const headVis = arrowT > 0.5 ? clamp01((arrowT-0.5)/0.5) : 0;
        if (headVis > 0 && shaftLen > 6) {
          const totalS = Math.hypot(impSx-tailSx, impSy-tailSy) || 1;
          const nx = (impSx-tailSx)/totalS, ny = (impSy-tailSy)/totalS;
          const hLen = Math.min(18, shaftLen*0.22);
          const hw   = hLen * 0.46;
          ctx.globalAlpha = alpha * headVis;
          ctx.shadowBlur  = 10;
          ctx.fillStyle   = accent;
          ctx.beginPath();
          ctx.moveTo(tipSx, tipSy);
          ctx.lineTo(tipSx - nx*hLen + (-ny)*hw, tipSy - ny*hLen + nx*hw);
          ctx.lineTo(tipSx - nx*hLen - (-ny)*hw, tipSy - ny*hLen - nx*hw);
          ctx.closePath();
          ctx.fill();
        }

        // ── Impact burst ──────────────────────────────────────────────────────
        if (arrowT >= 1) {
          const burstT = anim.phase==="hold" ? clamp01(elapsed/350) : 1;

          // Expanding ring (fades as it grows)
          ctx.globalAlpha = alpha * clamp01(1 - Math.max(burstT-0.5,0)/0.5) * 0.55;
          ctx.shadowBlur  = 20;
          ctx.strokeStyle = accent;
          ctx.lineWidth   = 1.5;
          ctx.beginPath(); ctx.arc(impSx, impSy, 4+burstT*18, 0, Math.PI*2); ctx.stroke();

          // Core dot
          ctx.globalAlpha = alpha * clamp01(burstT*2.5);
          ctx.shadowBlur  = 20 + siNorm*14;
          ctx.fillStyle   = accent;
          ctx.beginPath(); ctx.arc(impSx, impSy, 3+siNorm*3.5, 0, Math.PI*2); ctx.fill();

          // White inner core
          ctx.shadowBlur  = 0;
          ctx.globalAlpha = alpha * clamp01(burstT*2.5) * 0.85;
          ctx.fillStyle   = "rgba(255,255,255,0.95)";
          ctx.beginPath(); ctx.arc(impSx, impSy, 1.8, 0, Math.PI*2); ctx.fill();
        }

        ctx.restore();

        // ── Angle pill ────────────────────────────────────────────────────────
        const pillVis = arrowT > 0.45 ? clamp01((arrowT-0.45)/0.45) : 0;
        if (pillVis > 0) {
          const totalS = Math.hypot(impSx-tailSx, impSy-tailSy) || 1;
          const nx = (impSx-tailSx)/totalS, ny = (impSy-tailSy)/totalS;
          const M  = 24;
          const lx = Math.max(M, Math.min(W-M, tailSx + ny*26));
          const ly = Math.max(M, Math.min(H-M, tailSy - nx*26));

          ctx.save();
          ctx.globalAlpha = alpha * pillVis;
          ctx.shadowColor = glow;
          ctx.shadowBlur  = 8;
          const pW = 42, pH = 20;
          ctx.fillStyle   = `rgba(${acR},${acG},${acB},0.18)`;
          ctx.strokeStyle = `rgba(${acR},${acG},${acB},0.45)`;
          ctx.lineWidth   = 1;
          ctx.beginPath(); ctx.roundRect(lx-pW/2, ly-pH/2, pW, pH, 6); ctx.fill(); ctx.stroke();
          ctx.font         = "800 11px 'SF Mono','JetBrains Mono',monospace";
          ctx.fillStyle    = accent;
          ctx.textAlign    = "center";
          ctx.textBaseline = "middle";
          ctx.shadowBlur   = 4;
          ctx.fillText(`${anim.angleDeg!.toFixed(0)}°`, lx, ly);
          ctx.restore();
        }
      }
    }
  }

  // ── Idle hint ─────────────────────────────────────────────────────────────
  if (anim.phase === "idle") {
    ctx.font         = `500 ${Math.max(9,Math.round(W*0.042))}px system-ui,sans-serif`;
    ctx.fillStyle    = `rgba(${ink},0.24)`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Play or scrub · drag to orbit", W/2, H-14);
  }

  // ── Paused badge — shown when arrow is held because replay is paused ───────
  if (anim.phase === "hold" && !isReplaying && anim.angleDeg != null) {
    ctx.font         = `700 9px 'SF Mono','JetBrains Mono',monospace`;
    ctx.fillStyle    = `rgba(${ink},0.30)`;
    ctx.textAlign    = "right";
    ctx.textBaseline = "top";
    ctx.fillText("PAUSED", W-10, 10);
  }

  // ── View label ────────────────────────────────────────────────────────────
  const normY = ((cam.rotY % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
  const absX  = Math.abs(cam.rotX);
  let viewLabel = "";
  if      (absX > 1.1)                              viewLabel = cam.rotX > 0 ? "BOTTOM" : "TOP";
  else if (normY < 0.3 || normY > Math.PI*2-0.3)   viewLabel = "FRONT";
  else if (Math.abs(normY - Math.PI/2) < 0.3)      viewLabel = "LEFT SIDE";
  // "BACK" view no longer reachable — Y rotation is clamped to ±π/2
  else if (Math.abs(normY - Math.PI*1.5) < 0.3)    viewLabel = "RIGHT SIDE";

  if (viewLabel) {
    ctx.font      = `700 9px 'SF Mono','JetBrains Mono',monospace`;
    ctx.fillStyle = `rgba(${ink},0.28)`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(viewLabel, 10, 10);
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StrikeCompass({
  activeEvent,
  activeAngle,
  isReplaying,
  modeAccent,
  modeGlow,
  isDark,
}: StrikeCompassProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camRef    = useRef<Cam>({ rotY: 0.25, rotX: 0.22, tY: 0.25, tX: 0.22 });
  const animRef   = useRef<AnimState>({ angleDeg: null, si: null, startTs: 0, phase: "idle" });
  const dragRef   = useRef({ active: false, lastX: 0, lastY: 0 });
  const rafRef    = useRef(0);

  // Stable prop refs
  const accentRef      = useRef(modeAccent);
  const glowRef        = useRef(modeGlow);
  const darkRef        = useRef(isDark);
  const replayingRef   = useRef(isReplaying);
  useEffect(() => { accentRef.current    = modeAccent;   }, [modeAccent]);
  useEffect(() => { glowRef.current      = modeGlow;     }, [modeGlow]);
  useEffect(() => { darkRef.current      = isDark;       }, [isDark]);
  useEffect(() => { replayingRef.current = isReplaying;  }, [isReplaying]);

  // ── RAF loop — runs continuously so camera + paused arrow always render ───
  const loop = useCallback((ts: number) => {
    const canvas = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(loop); return; }

    const anim = animRef.current;

    // Record startTs on very first tick of a new event
    if (anim.phase !== "idle" && anim.startTs === 0) anim.startTs = ts;

    renderFrame(
      canvas, camRef.current, anim,
      accentRef.current, glowRef.current, darkRef.current,
      replayingRef.current, ts,
    );

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  // ── Mount / unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loop]);

  // ── New event ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const angle = activeEvent?.angleDeg ?? activeAngle ?? null;

    if (angle == null) {
      animRef.current = { angleDeg: null, si: null, startTs: 0, phase: "idle" };
      return;
    }

    // Always restart the arrow animation on a new event
    animRef.current = { angleDeg: angle, si: activeEvent?.si ?? null, startTs: 0, phase: "in" };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEvent]);

  // ── Pointer drag ──────────────────────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
    const cam = camRef.current;
    cam.tY  = Math.max(-Math.PI/2, Math.min(Math.PI/2, cam.tY + dx * 0.013));
    cam.tX  = Math.max(-Math.PI/2+0.05, Math.min(Math.PI/2-0.05, cam.tX + dy*0.010));
  }, []);

  const onPointerUp = useCallback(() => { dragRef.current.active = false; }, []);

  // ── Snap presets ──────────────────────────────────────────────────────────
  const snap = useCallback((preset: "front"|"side-l"|"side-r"|"top") => {
    const cam = camRef.current;
    const presets = {
      "front":  { tY: 0,            tX: 0.18 },
      "side-l": { tY:  Math.PI/2 - 0.01, tX: 0.12 },
      "side-r": { tY: -Math.PI/2 + 0.01, tX: 0.12 },
      "top":    { tY: 0,            tX: -Math.PI/2 + 0.06 },
    };
    cam.tY = presets[preset].tY;
    cam.tX = presets[preset].tX;
  }, []);

  const ink = isDark ? "255,255,255" : "20,20,40";
  const btnStyle: React.CSSProperties = {
    flex: "1 1 0",
    padding: "5px 4px",
    borderRadius: 7,
    border: `1px solid rgba(${ink},${isDark?"0.12":"0.13"})`,
    background: `rgba(${ink},${isDark?"0.04":"0.035"})`,
    color: `rgba(${ink},0.60)`,
    font: "inherit",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.04em",
    cursor: "pointer",
    textTransform: "uppercase" as const,
    transition: "background 120ms ease, color 120ms ease",
  };

  return (
    <div style={{ marginTop: 14 }}>

      {/* Header */}
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
        textTransform: "uppercase", opacity: 0.40, marginBottom: 8,
      }}>
        Strike Angle — 3D
      </div>

      {/* Canvas */}
      <div
        style={{
          position:    "relative",
          width:       "100%",
          aspectRatio: "1 / 1",
          borderRadius: 12,
          overflow:    "hidden",
          border:      `1px solid rgba(${ink},${isDark?"0.10":"0.12"})`,
          background:  isDark
            ? "radial-gradient(ellipse at 50% 40%, rgba(24,14,40,1) 0%, rgba(7,5,13,1) 100%)"
            : "radial-gradient(ellipse at 50% 40%, rgba(238,232,252,1) 0%, rgba(210,205,228,1) 100%)",
          cursor:     "grab",
          userSelect: "none",
          touchAction:"none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <canvas ref={canvasRef} style={{ display:"block", width:"100%", height:"100%" }} />
      </div>

      {/* Snap buttons */}
      <div style={{ display:"flex", gap:4, marginTop:5 }}>
        {([
          { label: "Front",   key: "front"  },
          { label: "← Side",  key: "side-l" },
          { label: "Side →",  key: "side-r" },
          { label: "Top",     key: "top"    },
        ] as const).map(({ label, key }) => (
          <button
            key={key}
            type="button"
            style={btnStyle}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = `rgba(${ink},${isDark?"0.10":"0.09"})`;
              (e.currentTarget as HTMLButtonElement).style.color      = `rgba(${ink},0.92)`;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = `rgba(${ink},${isDark?"0.04":"0.035"})`;
              (e.currentTarget as HTMLButtonElement).style.color      = `rgba(${ink},0.60)`;
            }}
            onClick={() => snap(key)}
          >
            {label}
          </button>
        ))}
      </div>


    </div>
  );
}