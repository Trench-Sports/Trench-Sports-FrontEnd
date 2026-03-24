// src/hooks/signalAudio.ts
// Synthesised audio cues for reaction and volume mode signals.
//
// Platform strategy:
//   Native (Capacitor iOS/Android) — speechSynthesis for all cues.
//     WKWebView's OscillatorNode is unreliable outside a gesture handler, but
//     speechSynthesis works everywhere (same path as the zone label cues).
//   Web (desktop/mobile browser) — Web Audio API oscillators as before.
//
// Call `unlock()` inside your "Start Session" tap handler in both cases.

import { useRef } from "react";
import { platform } from "../platform";

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
  // tap). It creates the AudioContext, resumes it, and — critically — starts an
  // inaudible oscillator SYNCHRONOUSLY within the same gesture call stack.
  //
  // Why synchronous matters: WKWebView (Capacitor iOS) requires that an audio
  // node's .start() is called during the synchronous execution of the gesture
  // handler. Running .start() inside a .then() callback is async — iOS has
  // already closed the gesture window by then, so the pipeline never warms up
  // and subsequent OscillatorNode calls produce no sound.
  function unlock(): void {
    try {
      let ctx: AudioContext;

      if (ctxRef.current && ctxRef.current.state !== "closed") {
        ctx = ctxRef.current;
        if (ctx.state === "suspended") {
          ctx.resume().catch(() => {});
        }
      } else {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        ctx = new AudioCtx() as AudioContext;
        ctxRef.current = ctx;
        ctx.resume().catch(() => {}); // kick off resume; don't await
      }

      // Synchronously start a 1ms, nearly-inaudible oscillator.
      // This must happen here — in the same synchronous call stack as the tap —
      // to satisfy WKWebView's gesture-gating requirement for OscillatorNode.
      const warmOsc  = ctx.createOscillator();
      const warmGain = ctx.createGain();
      warmGain.gain.value = 0.001; // inaudible in practice
      warmOsc.connect(warmGain);
      warmGain.connect(ctx.destination);
      warmOsc.frequency.value = 440;
      warmOsc.start(ctx.currentTime);
      warmOsc.stop(ctx.currentTime + 0.001);

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

  // ─── speakCue ──────────────────────────────────────────────────────────────
  // Uses speechSynthesis to deliver a short cue word — the same audio path
  // as zone labels, which already work reliably on native.
  function speakCue(word: string, rate: number, pitch: number): void {
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utt   = new SpeechSynthesisUtterance(word);
      utt.rate    = rate;
      utt.pitch   = pitch;
      utt.volume  = 1.0;
      window.speechSynthesis.speak(utt);
    } catch (e) {
      console.warn("[signalAudio] speakCue failed", e);
    }
  }

  // ─── playSignal ────────────────────────────────────────────────────────────
  function playSignal(type: SignalType) {
    // ── Native path: use speechSynthesis (same mechanism as zone labels) ──────
    // OscillatorNode is unreliable in WKWebView outside a gesture handler, but
    // speechSynthesis works consistently on both iOS and Android native.
    if (platform.isNative) {
      switch (type) {
        case "reaction":
          // "Go!" — energetic, rising-pitch feel to match the original two-pulse alarm
          speakCue("Go!", 1.5, 1.4);
          break;
        case "volume":
          // "Go!" — same "start now" read as the triple beep
          speakCue("Go!", 1.5, 1.4);
          break;
        case "early":
          // "Early!" — tells the athlete exactly what went wrong, lower pitch reads as "stop"
          speakCue("Early!", 1.3, 0.8);
          break;
      }
      return;
    }

    // ── Web path: Web Audio API oscillators ───────────────────────────────────
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
  function playZoneCue(zone: ZoneTarget): void {
    if (!("speechSynthesis" in window)) return;

    if (platform.isNative) {
      // On native, speechSynthesis is the only reliable audio path.
      // Speak the zone label directly — no pre-beep needed since the voice
      // itself is the alert. A leading "Go" utterance would be cancelled by
      // the zone label's cancel() call 180ms later before it finishes.
      try {
        window.speechSynthesis.cancel();
        const label = `${zone.row} ${zone.col}`;
        const utt   = new SpeechSynthesisUtterance(label);
        utt.rate    = 1.15;
        utt.pitch   = 1.1;
        utt.volume  = 1.0;
        window.speechSynthesis.speak(utt);
      } catch (e) {
        console.warn("[signalAudio] playZoneCue speech failed", e);
      }
      return;
    }

    // Web path: fire the tone first, then speak the zone label after the beep.
    playSignal("reaction");
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