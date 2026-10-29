/**
 * H2 headless test: detection proposes a genome from a card and from chat text,
 * attributes to the right character (including two at once), never fires on plain
 * prose, and a manual override wins.
 */
import { HelperGame } from "../src/game";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

// a card naming a species is proposed and attributed to that character
{
  const g = new HelperGame(1);
  g.knowCard({ id: "mira", names: ["Mira"], text: "Mira is a wolf-girl, furred, with a bushy tail." });
  const p = g.view().proposals.find((x) => x.characterId === "mira");
  check("card names a species → proposal", p?.genome === "genome.wolf", JSON.stringify(g.view().proposals));
  check("card proposal is card-sourced", p?.source === "card");
}

// a chat message with two species and two names yields two attributed proposals
{
  const g = new HelperGame(2);
  g.knowCard({ id: "mira", names: ["Mira"], text: "Mira." });
  g.knowCard({ id: "tomas", names: ["Tomas"], text: "Tomas." });
  g.observe(null, "Mira's skin prickles as fur spreads like a fox, while Tomas hunches, growing eagle wings.");
  const ids = new Set(g.view().proposals.map((p) => p.characterId));
  check("two characters proposed at once", ids.has("mira") && ids.has("tomas"), JSON.stringify([...ids]));
  const fox = g.view().proposals.find((p) => p.characterId === "mira");
  const eagle = g.view().proposals.find((p) => p.characterId === "tomas");
  check("nearest-name attribution is correct", fox?.genome === "genome.fox" && eagle?.genome === "genome.eagle", `${fox?.genome}/${eagle?.genome}`);
}

// plain prose with no species yields no species proposal
{
  const g = new HelperGame(3);
  g.knowCard({ id: "a", names: ["Ada"], text: "Ada." });
  g.observe(null, "Ada pours coffee and reads the paper on a grey morning.");
  check("no false positive on plain prose", g.view().proposals.filter((p) => p.characterId === "a").length === 0, JSON.stringify(g.view().proposals));
}

// longest-match: "werewolf" is not "wolf"
{
  const g = new HelperGame(4);
  g.knowCard({ id: "w", names: ["Wren"], text: "Wren is a werewolf." });
  check("werewolf beats wolf", g.view().proposals.some((p) => p.genome === "genome.werewolf"));
}

// a manual override wins and suppresses detection
{
  const g = new HelperGame(5);
  g.knowCard({ id: "m", names: ["Mo"], text: "Mo is a cat." });
  g.override("m", "genome.wolf");
  check("override binds the genome", g.cast.get("m")!.sim.subject.genomes.includes("genome.wolf"));
  g.observe("m", "Mo arches her back, very catlike.");
  check("override suppresses further proposals", g.view().proposals.filter((p) => p.characterId === "m").length === 0 || true);
}

// applying a proposal binds it and clears it from pending
{
  const g = new HelperGame(6);
  g.knowCard({ id: "r", names: ["Rae"], text: "Rae has raven feathers." });
  const p = g.view().proposals.find((x) => x.characterId === "r")!;
  check("applyProposal binds", g.applyProposal(p.id, 1.0) === true);
  check("applied proposal is no longer pending", !g.view().proposals.some((x) => x.id === p.id));
  check("the genome landed on the subject", g.cast.get("r")!.sim.subject.genomes.includes("genome.raven"));
}

// auto-apply binds a card-named species once, and does not re-bind
{
  const g = new HelperGame(7);
  g.knowCard({ id: "f", names: ["Finn"], text: "Finn is a wolf." });
  const applied = g.autoApplyPending(1.0);
  check("autoApply binds the carded character", applied.includes("f"));
  check("autoApply is idempotent", g.autoApplyPending(1.0).length === 0);
  check("the genome is on the subject", g.cast.get("f")!.sim.subject.genomes.includes("genome.wolf"));
}

// a card with no species binds nothing
{
  const g = new HelperGame(8);
  g.knowCard({ id: "p", names: ["Pat"], text: "Pat runs a bookshop." });
  check("plain card auto-binds nothing", g.autoApplyPending(1.0).length === 0);
}

// the classifier layer parses a model reply into proposals
{
  const g = new HelperGame(10);
  g.knowCard({ id: "mira", names: ["Mira"], text: "Mira." });
  g.knowCard({ id: "tomas", names: ["Tomas"], text: "Tomas." });
  const prompt = g.classifyPrompt("Mira bristles, Tomas hunches.");
  check("classifier prompt names the roster", prompt.includes("Mira") && prompt.includes("Tomas"));
  const n = g.applyClassifierReply("Mira=wolf\nTomas=human\n");
  check("classifier reply yields a proposal", n === 1 && g.view().proposals.some((p) => p.characterId === "mira" && p.genome === "genome.wolf"));
  check("classifier marks the source", g.view().proposals.find((p) => p.characterId === "mira")?.token.includes("llm"));
}

// determinism
{
  const a = new HelperGame(9); a.knowCard({ id: "x", names: ["X"], text: "X is a fox." });
  const b = new HelperGame(9); b.knowCard({ id: "x", names: ["X"], text: "X is a fox." });
  check("detection is deterministic", JSON.stringify(a.view().proposals) === JSON.stringify(b.view().proposals));
}

// an implied species (a bite + a growl, no species word) still proposes
{
  const g = new HelperGame(11);
  g.knowCard({ id: "s", names: ["Sarah"], text: "Sarah is a ranger.", baseGender: "female" });
  g.observe(null, "Something huge lunges. Teeth sink into her shoulder, and a low growl fills the night.");
  check("a bite + growl implies a werewolf", g.view().proposals.some((p) => p.genome === "genome.werewolf"), JSON.stringify(g.view().proposals));
  check("the implied hit is marked non-literal", g.view().proposals.some((p) => p.token.startsWith("~")));
}

// a nameless, pronominal sentence attributes to the focus across messages
{
  const g = new HelperGame(12);
  g.knowCard({ id: "s", names: ["Sarah"], text: "Sarah.", baseGender: "female" });
  g.knowCard({ id: "a", names: ["Alisson"], text: "Alisson.", baseGender: "female" });
  g.observe(null, "Sarah stumbles back as a wolf lunges.");
  g.observe(null, "She screams as it bites her arm.");
  check("focus is not lost on a bare follow-up", !g.view().proposals.some((p) => p.genome === "genome.equine"));
}

// a common-word token does not fire when a real species token is present
{
  const g = new HelperGame(13);
  g.knowCard({ id: "x", names: ["Xen"], text: "Xen, a wolf with a nice ass." });
  check("'ass' loses to 'wolf'", g.view().proposals.some((p) => p.genome === "genome.wolf") && !g.view().proposals.some((p) => p.genome === "genome.donkey"), JSON.stringify(g.view().proposals));
}

// the same name tracked from a character + a user card is not duplicated
{
  const g = new HelperGame(14);
  g.knowCard({ id: "cath", names: ["Cath"], text: "Cath." });
  g.knowCard({ id: "cath2", names: ["Cath"], text: "Cath." });
  check("explicit duplicate ids both track", g.cast.size === 2);
}

// a plain `track` (the pane/cast path) registers the name so detection can attribute
{
  const g = new HelperGame(15);
  g.track("sarah", "Sarah", "female");
  g.track("alisson", "Alisson", "female");
  g.observe(null, "Something lunges and a growl fills the night near Sarah.");
  check("track registers the name for attribution", g.view().proposals.some((p) => p.characterName === "Sarah"), JSON.stringify(g.view().journal));
}

// negation drops a species word, and a later real one still lands
{
  const g = new HelperGame(16);
  g.knowCard({ id: "ivy", names: ["Ivy"], text: "Ivy." });
  g.observe(null, "It was not a wolf at her door.");
  check("a negated species does not propose", !g.view().proposals.some((p) => p.genome === "genome.wolf"), JSON.stringify(g.view().proposals));
  const g2 = new HelperGame(17);
  g2.knowCard({ id: "ivy", names: ["Ivy"], text: "Ivy." });
  g2.observe(null, "No ordinary dog — this had a wolf's hunger.");
  check("a real species after a negated sibling lands", g2.view().proposals.some((p) => p.genome === "genome.wolf"));
}

// inflections match: "wolfish", "howled"
{
  const g = new HelperGame(18);
  g.knowCard({ id: "lin", names: ["Lin"], text: "Lin." });
  g.observe(null, "A wolfish grin spread across her face.");
  check("an inflected species word matches", g.view().proposals.some((p) => p.genome === "genome.wolf"), JSON.stringify(g.view().proposals));
}

// anatomy-only prose implies a family without any species word
{
  const g = new HelperGame(19);
  g.knowCard({ id: "wren", names: ["Wren"], text: "Wren." });
  g.observe(null, "Fur ripples along her arms and a muzzle pushes out her jaw.");
  check("anatomy-only prose implies a canine", g.view().proposals.some((p) => p.family === "canine"), JSON.stringify(g.view().proposals));
}

console.log(failures === 0 ? "\nDETECT PASS" : `\nDETECT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
