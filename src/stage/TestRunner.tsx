import { useEffect, useState } from "react";
import { DEFAULT_INITIAL, StageBase, type InitialData } from "@chub-ai/stages-ts";

type AnyInit = InitialData<never, never, never, never>;
type AnyStage = StageBase<never, never, never, never>;

/** Minimal in-page runner for `vite dev` (no live chat needed). */
export function TestRunner({ factory }: { factory: (data: AnyInit) => AnyStage }) {
  const [stage] = useState(() => factory({ ...DEFAULT_INITIAL, environment: "development" } as AnyInit));
  const [, force] = useState(0);

  useEffect(() => {
    stage.load().then((res) => {
      force((n) => n + 1);
      if (!res.success) console.error("stage load failed", res.error);
    });
  }, []);

  // in dev there is no chat behind the stage, so paint a chat-ish backdrop to make
  // the transparency (which lets the real chat show through) legible here too
  return <div style={{ width: "100vw", height: "100vh", background: "linear-gradient(160deg, #1b2430, #2a3542)" }}>{stage.render()}</div>;
}
