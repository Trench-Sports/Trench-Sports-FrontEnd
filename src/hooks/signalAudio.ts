// src/hooks/signalAudio.ts
// Synthesised audio cues for reaction and volume mode signals.
// Uses Web Audio API — no dependencies, works in browser and Capacitor WebView.
//
// ⚠️ iOS / Android mobile audio unlock requirement:
//   AudioContext MUST be created AND resumed inside a synchronous user-gesture
//   handler (e.g. a tap). Tones that fire later from setTimeout callbacks reuse
//   the same pre-unlocked context, which stays runnable without needing another
//   gesture. Call `unlock()` inside your "Start Session" tap handler so every
//   subsequent playSignal / playZoneCue call works reliably on mobile.

import { useRef } from "react";

type SignalType = "reaction" | "volume" | "early";

// ─── Zone target type ─────────────────────────────────────────────────────────
export type ZoneRow = "top" | "middle" | "bottom";
export type ZoneCol = "left" | "center" | "right";
export type ZoneTarget = { row: ZoneRow; col: ZoneCol };

function playTone(opts: {
  frequency: number;
  endFrequency?: number;
  gain: number;
  duration: number;
  type?: OscillatorType;
  ctx: AudioContext;
  startAt?: number;
}) {
  const { ctx, startAt = 0 } = opts;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.frequency, ctx.currentTime + startAt);
  if (opts.endFrequency) {
    osc.frequency.exponentialRampToValueAtTime(
      opts.endFrequency,
      ctx.currentTime + startAt + opts.duration
    );
  }

  // Hard attack, fast decay — punchy alarm character
  gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
  gain.gain.linearRampToValueAtTime(opts.gain, ctx.currentTime + startAt + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + opts.duration);

  osc.start(ctx.currentTime + startAt);
  osc.stop(ctx.currentTime + startAt + opts.duration);
}

export function useSignalAudio() {
  // Persistent context ref — created once per hook instance and reused for the
  // lifetime of the session so iOS never sees a fresh (suspended) context.
  const ctxRef = useRef<AudioContext | null>(null);

  // ─── unlock ────────────────────────────────────────────────────────────────
  // Call this synchronously inside a user-gesture handler (e.g. "Start Session"
  // tap). It creates the AudioContext, immediately resumes it (satisfying iOS's
  // gesture requirement), and fires a silent 1ms buffer to fully warm it up.
  // It also pre-warms Speech Synthesis so zone-cue speech works on iOS.
  function unlock(): void {
    try {
      // Reuse existing context if it's still open
      if (ctxRef.current && ctxRef.current.state !== "closed") {
        if (ctxRef.current.state === "suspended") {
          ctxRef.current.resume().catch(() => {});
        }
      } else {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx() as AudioContext;
        ctxRef.current = ctx;

        // Resume immediately — this is the gesture unlock for iOS
        ctx.resume().then(() => {
          // Play a 1ms silent buffer to fully unblock the audio pipeline
          const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          src.start(0);
        }).catch(() => {});
      }
    } catch (e) {
      console.warn("[signalAudio] unlock failed", e);
    }

    // Pre-warm Speech Synthesis — iOS requires a speak() call during a gesture
    // before it will honour later calls from timeouts.
    try {
      if ("speechSynthesis" in window) {
        const warmup = new SpeechSynthesisUtterance("");
        warmup.volume = 0;
        window.speechSynthesis.speak(warmup);
      }
    } catch (_) {}
  }

  // ─── getContext ────────────────────────────────────────────────────────────
  // Returns the pre-unlocked context, creating one if needed (fallback for web
  // where the gesture restriction doesn't apply).
  function getContext(): AudioContext | null {
    try {
      if (ctxRef.current && ctxRef.current.state !== "closed") {
        // Resume in case the browser auto-suspended it (e.g. tab switch)
        if (ctxRef.current.state === "suspended") {
          ctxRef.current.resume().catch(() => {});
        }
        return ctxRef.current;
      }
      // Fallback: create a fresh context (works on desktop/web)
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx() as AudioContext;
      ctxRef.current = ctx;
      ctx.resume().catch(() => {});
      return ctx;
    } catch (e) {
      console.warn("[signalAudio] getContext failed", e);
      return null;
    }
  }

  // ─── playSignal ────────────────────────────────────────────────────────────
  function playSignal(type: SignalType) {
    const ctx = getContext();
    if (!ctx) return;

    try {
      switch (type) {

        case "reaction": {
          // Two-pulse alarm: short high beep, tiny gap, longer higher beep
          // Designed to cut through ambient noise and read as "GO NOW"
          const freq1 = 1046; // C6
          const freq2 = 1318; // E6 — a major third up, reads as urgent/rising
          // Pulse 1
          playTone({ ctx, frequency: freq1, endFrequency: freq2, gain: 0.7, duration: 0.10, type: "square", startAt: 0 });
          // Pulse 2 — slightly louder and longer for emphasis
          playTone({ ctx, frequency: freq2, endFrequency: 1568, gain: 0.85, duration: 0.18, type: "square", startAt: 0.13 });
          // Subtle sine layer under pulse 2 for body/warmth
          playTone({ ctx, frequency: freq2, gain: 0.25, duration: 0.18, type: "sine", startAt: 0.13 });
          break;
        }

        case "volume": {
          // Triple rapid beep — classic "start now" alarm cadence
          const freq = 880; // A5
          [0, 0.14, 0.28].forEach(startAt => {
            playTone({ ctx, frequency: freq, gain: 0.75, duration: 0.10, type: "square", startAt });
            // Sine layer for warmth under each pulse
            playTone({ ctx, frequency: freq, gain: 0.20, duration: 0.10, type: "sine", startAt });
          });
          break;
        }

        case "early": {
          // Descending buzz — unmistakably "wrong/stop"
          playTone({ ctx, frequency: 320, endFrequency: 160, gain: 0.55, duration: 0.28, type: "sawtooth", startAt: 0 });
          break;
        }
      }
    } catch (e) {
      console.warn("[signalAudio] playSignal failed", e);
    }
  }

  // ─── Zone cue — plays the alert tone then speaks the zone label ──────────────
  // The alert beep fires immediately; speech is queued ~180ms later so it lands
  // cleanly after the tone rather than overlapping with it.
  function playZoneCue(zone: ZoneTarget): void {
    // 1. Fire the same sharp reaction alert tone
    playSignal("reaction");

    // 2. Speak the zone label after the beep finishes
    if (!("speechSynthesis" in window)) return;
    setTimeout(() => {
      try {
        window.speechSynthesis.cancel();
        const label = `${zone.row} ${zone.col}`;
        const utt   = new SpeechSynthesisUtterance(label);
        utt.rate    = 1.15;   // slightly faster — punchy, not robotic
        utt.pitch   = 1.1;    // slightly higher — easier to hear over gym noise
        utt.volume  = 1.0;
        window.speechSynthesis.speak(utt);
      } catch (e) {
        console.warn("[signalAudio] playZoneCue speech failed", e);
      }
    }, 180);
  }

  // ─── cleanup ───────────────────────────────────────────────────────────────
  // Call when the session ends to free the audio context.
  function closeAudio(): void {
    try {
      if (ctxRef.current && ctxRef.current.state !== "closed") {
        ctxRef.current.close().catch(() => {});
      }
      ctxRef.current = null;
    } catch (_) {}
  }

  return { unlock, playSignal, playZoneCue, closeAudio };
}