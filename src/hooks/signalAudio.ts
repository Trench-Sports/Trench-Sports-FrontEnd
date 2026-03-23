// src/hooks/signalAudio.ts
// Synthesised audio cues for reaction and volume mode signals.
// Uses Web Audio API — no dependencies, works in browser and Capacitor WebView.
// Mobile audio context is unlocked automatically after the first user gesture
// (the "Start Session" button tap satisfies this requirement).

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

function createContext(): AudioContext | null {
  try {
    return new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch (e) {
    console.warn("[signalAudio] AudioContext unavailable", e);
    return null;
  }
}

export function useSignalAudio() {
  function playSignal(type: SignalType) {
    const ctx = createContext();
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

      // Close context after all tones have finished
      const longestDuration =
        type === "reaction" ? 0.35 :
        type === "volume"   ? 0.45 :
        0.35;
      setTimeout(() => ctx.close(), (longestDuration + 0.1) * 1000);

    } catch (e) {
      console.warn("[signalAudio] playSignal failed", e);
      ctx.close();
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

  return { playSignal, playZoneCue };
}