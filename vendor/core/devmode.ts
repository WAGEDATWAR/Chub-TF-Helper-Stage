/**
 * Developer mode (PLAN.md agreement 2/5): a runtime toggle that gates dev
 * inspectors and overlay panels. Pure — the flag is injected, never read from
 * `process` or the DOM (blueprint §3).
 */
export interface DevConfig {
  enabled: boolean;
  verbose: boolean;
}

export const DEFAULT_DEV_CONFIG: DevConfig = { enabled: false, verbose: false };

/** Parse a dev-config from simple `key=value` strings (e.g. `CHRYSALIS_DEV=1`). */
export function devConfigFrom(env: Record<string, string | undefined>): DevConfig {
  const truthy = (v: string | undefined): boolean => v === "1" || v === "true" || v === "on";
  return {
    enabled: truthy(env.CHRYSALIS_DEV) || truthy(env.DEV),
    verbose: truthy(env.CHRYSALIS_DEV_VERBOSE),
  };
}

export interface DevMode {
  readonly config: DevConfig;
  readonly lines: readonly string[];
  log(line: string): void;
  logVerbose(line: string): void;
}

export function createDevMode(config: DevConfig = DEFAULT_DEV_CONFIG): DevMode {
  const lines: string[] = [];
  return {
    config,
    lines,
    log(line) {
      if (config.enabled) lines.push(line);
    },
    logVerbose(line) {
      if (config.enabled && config.verbose) lines.push(line);
    },
  };
}
