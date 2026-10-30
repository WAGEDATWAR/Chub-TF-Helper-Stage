/**
 * Local control mirror (H25). Snapshots/overrides mirror to localStorage so a
 * chat-state revert — which a failed generation (e.g. a Venice "empty response")
 * can trigger — never wipes them. Locks the per-chat key, the union merge, and the
 * authoritative delete.
 */

// a minimal localStorage shim (the modules are browser-safe and no-op without it)
const backing = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => { backing.set(k, v); },
  removeItem: (k: string) => { backing.delete(k); },
  clear: () => backing.clear(),
  key: (i: number) => [...backing.keys()][i] ?? null,
  get length() { return backing.size; },
} as Storage;

import { chatKey, readMirror, writeMirror, forgetSnapshot, capMirror } from "../src/stage/mirror";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

// the key is stable per chat, distinct across chats, and order-independent
{
  const a = chatKey(["mira", "tomas"], ["user1"]);
  const a2 = chatKey(["tomas", "mira"], ["user1"]);
  const b = chatKey(["wren"], ["user1"]);
  check("chat key is stable regardless of order", a === a2, `${a} vs ${a2}`);
  check("chat key differs across chats", a !== b);
}

// a written snapshot round-trips
{
  const chat = chatKey(["mira"], []);
  writeMirror(chat, { snapshots: [{ id: "s1", label: "day 3", atTick: 4320, payload: { x: 1 }, roster: [] }], overrides: [["mira", null]], seq: 1 });
  const m = readMirror(chat);
  check("a snapshot round-trips", m?.snapshots?.length === 1 && m!.snapshots![0]!.label === "day 3");
  check("an override round-trips", m?.overrides?.[0]?.[1] === null);
}

// an authoritative write replaces (so a delete is not resurrected)
{
  const chat = chatKey(["mira"], []);
  writeMirror(chat, { snapshots: [{ id: "s1", label: "one", atTick: 1, payload: {}, roster: [] }] });
  writeMirror(chat, { snapshots: [{ id: "s2", label: "two", atTick: 2, payload: {}, roster: [] }] });
  check("authoritative write replaces the set", readMirror(chat)?.snapshots?.length === 1 && readMirror(chat)!.snapshots![0]!.id === "s2");
}

// a non-authoritative write unions (a partial restore does not drop others)
{
  const chat = chatKey(["union"], []);
  writeMirror(chat, { snapshots: [{ id: "a", label: "a", atTick: 1, payload: {}, roster: [] }] });
  writeMirror(chat, { snapshots: [{ id: "b", label: "b", atTick: 2, payload: {}, roster: [] }] }, false);
  check("a union write keeps both", readMirror(chat)?.snapshots?.length === 2);
}

// forgetSnapshot drops just one
{
  const chat = chatKey(["drop"], []);
  writeMirror(chat, { snapshots: [{ id: "a", label: "a", atTick: 1, payload: {}, roster: [] }, { id: "b", label: "b", atTick: 2, payload: {}, roster: [] }] });
  forgetSnapshot(chat, "a");
  check("forgetSnapshot drops one", readMirror(chat)?.snapshots?.length === 1 && readMirror(chat)!.snapshots![0]!.id === "b");
}

// capMirror keeps the newest
{
  const chat = chatKey(["cap"], []);
  const snaps = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, label: `d${i}`, atTick: i, payload: {}, roster: [] }));
  writeMirror(chat, { snapshots: snaps });
  capMirror(chat, 12);
  const kept = readMirror(chat)?.snapshots ?? [];
  check("capMirror keeps the newest 12", kept.length === 12 && kept[11]!.id === "s19", String(kept.length));
}

// the mirror is per chat: another chat is unaffected
{
  const a = chatKey(["one"], []);
  const b = chatKey(["two"], []);
  writeMirror(a, { snapshots: [{ id: "x", label: "x", atTick: 1, payload: {}, roster: [] }] });
  check("another chat has its own mirror", (readMirror(b)?.snapshots?.length ?? 0) === 0);
  check("the first chat keeps its mirror", readMirror(a)?.snapshots?.length === 1);
}

console.log(failures === 0 ? "\nMIRROR PASS" : `\nMIRROR FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
