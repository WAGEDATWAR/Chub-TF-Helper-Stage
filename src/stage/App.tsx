import { ReactRunner } from "@chub-ai/stages-ts";
import { Stage } from "./Stage";
import { TestRunner } from "./TestRunner";
import type { InitialData, StageBase } from "@chub-ai/stages-ts";

type Factory = (data: InitialData<never, never, never, never>) => StageBase<never, never, never, never>;

/**
 * Development (`vite dev`) uses the inline test runner; staging (`vite --mode
 * staging`, for the chat's Staging URL) and production use the iframe runner, so a
 * live chat drives the stage.
 */
export function App() {
  const isDev = import.meta.env.MODE === "development" || import.meta.env.MODE === "test";
  const factory = ((data: unknown) => new Stage(data as never)) as unknown as Factory;
  return isDev ? <TestRunner factory={factory} /> : <ReactRunner factory={factory} />;
}
