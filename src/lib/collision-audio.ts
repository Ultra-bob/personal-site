import { Body, Box } from "p2-es";
import type { ContactEquation, Shape } from "p2-es";

const MIN_IMPACT_SPEED = 40; // Screen pixels per second, independent of physics scale.
const FULL_IMPACT_SPEED = 1400;
const PAIR_COOLDOWN = 0.075;
const MAX_VOICES = 12;

export type CollisionImpact = {
  pair: string;
  strength: number;
  frequency: number;
  decay: number;
  pan: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function bodySize(body: Body, shape: Shape, scale: number): number | null {
  // Walls and the fixed footer must not determine the pitch of the moving card.
  if (body.type !== Body.DYNAMIC) return null;
  const size =
    shape instanceof Box ? Math.sqrt(shape.width * shape.height) : shape.boundingRadius * 2;
  return Number.isFinite(size) ? clamp(size * scale, 40, 600) : 120;
}

export function getCollisionImpact(
  contacts: ContactEquation[],
  scale: number,
  viewportLeft: number,
  viewportWidth: number,
): CollisionImpact | null {
  let strongest: ContactEquation | null = null;
  let speed = MIN_IMPACT_SPEED;

  for (const contact of contacts) {
    if (!contact.enabled || !contact.bodyA.collisionResponse || !contact.bodyB.collisionResponse)
      continue;
    // In p2, positive means closing. This includes angular velocity at the
    // contact point and excludes sliding motion and separating contacts.
    const closingSpeed = contact.getVelocityAlongNormal() * scale;
    if (Number.isFinite(closingSpeed) && closingSpeed > speed) {
      strongest = contact;
      speed = closingSpeed;
    }
  }

  if (!strongest) return null;
  const { bodyA, bodyB, shapeA, shapeB, contactPointA, contactPointB } = strongest;
  const sizeA = bodySize(bodyA, shapeA, scale);
  const sizeB = bodySize(bodyB, shapeB, scale);
  if (sizeA === null && sizeB === null) return null;
  const size = sizeA !== null && sizeB !== null ? Math.sqrt(sizeA * sizeB) : (sizeA ?? sizeB)!;
  const strength = Math.pow(
    clamp((speed - MIN_IMPACT_SPEED) / (FULL_IMPACT_SPEED - MIN_IMPACT_SPEED), 0, 1),
    0.65,
  );
  const worldX = (bodyA.position[0] + contactPointA[0] + bodyB.position[0] + contactPointB[0]) / 2;

  return {
    pair: `${Math.min(bodyA.id, bodyB.id)}:${Math.max(bodyA.id, bodyB.id)}`,
    strength,
    frequency: clamp(120 * Math.sqrt(120 / size), 60, 210) * (1 + 0.05 * strength),
    decay: 0.07 + 0.2 * strength + 0.035 * (size / 600),
    pan: clamp(
      (((worldX - viewportLeft) * scale) / Math.max(1, viewportWidth)) * 2 - 1,
      -0.85,
      0.85,
    ),
  };
}

type Voice = { stop: () => void };

export class CollisionAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = new Set<Voice>();
  private lastImpacts = new Map<string, number>();

  // Called directly from a mouse/touch gesture; no context or buffer is needed
  // during page loading or the silent initial physics settling.
  unlock() {
    try {
      if (!this.context) {
        const context = new AudioContext();
        this.context = context;
        this.output = context.createGain();
        this.output.gain.value = 0.8;
        this.compressor = context.createDynamicsCompressor();
        this.compressor.threshold.value = -12;
        this.compressor.knee.value = 12;
        this.compressor.ratio.value = 4;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.12;
        this.output.connect(this.compressor).connect(context.destination);

        this.noise = context.createBuffer(
          1,
          Math.ceil(context.sampleRate * 0.08),
          context.sampleRate,
        );
        const samples = this.noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      }
      // A later gesture can retry if the browser temporarily denies playback.
      void this.context.resume().catch(() => {});
    } catch {
      // Audio support is optional; dragging must still work if it is unavailable.
      this.destroy();
    }
  }

  play(impact: CollisionImpact) {
    const context = this.context;
    if (!context || context.state !== "running" || !this.output || !this.noise) return;
    const now = context.currentTime;

    // Bound both the number of live voices and cooldown bookkeeping. Cooldowns
    // are per body pair so simultaneous hits on different cards still sound.
    for (const [pair, time] of this.lastImpacts) {
      if (now - time >= PAIR_COOLDOWN) this.lastImpacts.delete(pair);
    }
    if (this.lastImpacts.has(impact.pair) || this.voices.size >= MAX_VOICES) return;
    this.lastImpacts.set(impact.pair, now);

    const { strength, frequency, decay, pan } = impact;
    const level = 0.36 * strength;
    const sources: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [];
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.output);
    nodes.push(panner);

    const envelope = (peak: number, duration: number) => {
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(peak, now + 0.002);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.000001, peak * 0.001), now + duration);
      gain.gain.linearRampToValueAtTime(0, now + duration + 0.008);
      gain.connect(panner);
      nodes.push(gain);
      return gain;
    };

    const tone = (hz: number, weight: number, duration: number, bend = 1) => {
      const oscillator = context.createOscillator();
      oscillator.frequency.setValueAtTime(hz * bend, now);
      oscillator.frequency.exponentialRampToValueAtTime(hz, now + 0.025);
      oscillator.connect(envelope(level * weight, duration));
      oscillator.start(now);
      oscillator.stop(now + duration + 0.01);
      sources.push(oscillator);
      nodes.push(oscillator);
    };

    // Emphasize the deep body thud, with a short, inharmonic metallic ring.
    // Hard hits still excite the upper modes without becoming a bright clang.
    tone(frequency, 0.68, decay, 1.16);
    tone(frequency * 2.37, 0.16 * (0.3 + 0.7 * strength), decay * 0.75);
    tone(frequency * 4.13, 0.07 * strength, decay * 0.5);
    tone(frequency * 6.79, 0.03 * strength, decay * 0.3);

    const strike = context.createBufferSource();
    strike.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.5;
    filter.frequency.setValueAtTime(450 + 3500 * strength, now);
    const strikeDuration = 0.01 + 0.025 * strength;
    filter.frequency.exponentialRampToValueAtTime(250 + 700 * strength, now + strikeDuration);
    strike.connect(filter).connect(envelope(level * 0.06, strikeDuration));
    strike.start(now);
    strike.stop(now + strikeDuration + 0.01);
    sources.push(strike);
    nodes.push(strike, filter);

    let disposed = false;
    const voice: Voice = {
      stop: () => {
        if (disposed) return;
        disposed = true;
        for (const source of sources) {
          source.onended = null;
          source.stop();
        }
        for (const node of nodes) node.disconnect();
        this.voices.delete(voice);
      },
    };
    this.voices.add(voice);
    // The body resonance has the longest tail. Disconnect the entire graph
    // when it ends, including the already finished strike and upper modes.
    sources[0].onended = voice.stop;
  }

  destroy() {
    for (const voice of this.voices) voice.stop();
    this.lastImpacts.clear();
    this.output?.disconnect();
    this.compressor?.disconnect();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.output = null;
    this.compressor = null;
    this.noise = null;
  }
}
