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

  return <div style={{ width: "100vw", height: "100vh" }}>{stage.render()}</div>;
}
