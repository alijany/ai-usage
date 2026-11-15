// Official Claude Code Mods API. No imports, processes, model calls or HTTP calls.
// https://code.claude.com/docs/en/plugins/mods/reference
async function save($, usage) {
  const windows = usage.rateLimits;
  if (!Array.isArray(windows) || !windows.some((w) => w.kind === "five_hour" || w.kind === "seven_day")) return;
  const windowOf = (kind) => {
    const w = windows.find((value) => value.kind === kind);
    const reset = w?.resetsAt ? Date.parse(w.resetsAt) : NaN;
    if (!w || !Number.isFinite(w.percentUsed) || w.percentUsed < 0 || w.percentUsed > 100 || !Number.isFinite(reset)) return null;
    return { used_percentage: w.percentUsed, resets_at: reset / 1000 };
  };
  const home = (await $.env.get("USERPROFILE")) || (await $.env.get("HOME"));
  if (!home) return;
  const snapshot = {
    version: 1,
    receivedAt: new Date(await $.clock.now()).toISOString(),
    five_hour: windowOf("five_hour"),
    seven_day: windowOf("seven_day"),
  };
  await $.fs.write(home.replace(/\\/g, "/") + "/.claude/ai-usage.json", JSON.stringify(snapshot) + "\n");
}

export function register(on) {
  on("session.measure", async ($, e, next) => {
    try { await save($, e); } catch { /* A failed export must not interrupt Claude. */ }
    return next(e);
  });
}
