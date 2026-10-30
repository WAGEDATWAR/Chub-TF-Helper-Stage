/** Stage state and config. Kept tiny and branch-local (per-message save). */

export interface InitStateType {
  seed: number;
}

/** Chat-wide (across branches): the tracked roster's identity + playstyle choices. */
export interface ChatStateType {
  cast: Array<{ id: string; name: string }>;
  /** Per-character playstyle for a coupled genome (H3): moon-only, emotional, etc. */
  playstyles?: Record<string, Record<string, string>>;
  /** Per-character genital policy (H23): preserve | replace | additive | swap. */
  genital?: Record<string, string>;
  /** Durable pane controls (H24): overrides, snapshots, moon, pace. Chat-wide. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control?: any;
}

/** Branch-local: the authoritative save after this message (shape owned by the game). */
export interface MessageStateType {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  save: any | null;
  day: number;
}

export interface ConfigType {
  seed?: number;
  /** Minutes advanced per message (wins over `ticksPerMessage`; 60 = an hour). */
  minutesPerMessage?: number;
  ticksPerMessage?: number;
  lunarCycleDays?: number;
  /** Append a compact status line after each bot message. Default on. */
  statusMessage?: boolean;
  /** Replace the bot's prose with the facts floor when it contradicts them. Default on. */
  guardProse?: boolean;
  /** How fast a transformation settles: slow | normal | fast | quick | instant. */
  transformationPace?: string;
  /** Default genital policy for every character: preserve | replace | additive | swap. */
  genitalPolicy?: string;
  /** Require name/cue evidence before auto-binding a chat species. Default on. */
  detectEvidenceOnly?: boolean;
  /** Ask the chat model for a species second-opinion on ambiguous prose. Default on. */
  useClassifier?: boolean;
}
