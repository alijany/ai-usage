const vscode = require("vscode");
const { providers, fileStamp, nextAnniversary } = require("./usage");
const { budget } = require("./budget");

const MIN_GAP_MS = 60 * 1000; // never auto-fetch one provider more often than this

const COLOR = {
  ok: "#3794ff",
  warn: "#cca700",
  bad: "#f14c4c",
  good: "#89d185",
  track: "#8080804d",
  marker: "#a0a0a0",
};

class Provider {
  constructor(key, def, priority, context) {
    this.key = key;
    this.def = def;
    this.context = context;
    this.last = null;        // last successful result
    this.budget = null;      // daily budget derived from the weekly window
    this.lastOk = null;      // Date of last success
    this.error = null;       // last error
    this.lastAttempt = 0;
    this.authStamp = null;   // credential file mtime when an auth error happened
    this.item = vscode.window.createStatusBarItem(`aiUsage.${key}`, vscode.StatusBarAlignment.Right, priority);
    this.item.name = `${def.label} usage`;
    this.item.command = "aiUsage.refresh";
    context.subscriptions.push(this.item);
    this.render();
    this.item.show();
  }

  dueAt(intervalMs) {
    const resets = [this.last?.session?.resetsAt, this.last?.weekly?.resetsAt]
      .filter(Boolean).map((d) => d.getTime() + 5000);
    return Math.min(this.lastAttempt + intervalMs, ...resets);
  }

  async refresh(force, intervalMs) {
    const now = Date.now();
    if (now - this.lastAttempt < (force ? 10 * 1000 : MIN_GAP_MS)) return;
    if (!force && now < this.dueAt(intervalMs)) return;
    // After an auth error, wait until the client rewrites its credentials.
    if (this.error?.auth && fileStamp(this.def.credentials) === this.authStamp && !force) return;
    this.lastAttempt = now;
    try {
      this.last = await this.def.fetch();
      this.lastOk = new Date();
      this.error = null;
      this.updateBudget();
    } catch (err) {
      const auth = err.auth || err.status === 401 || err.status === 403;
      this.error = { message: err.message, auth };
      if (auth) this.authStamp = fileStamp(this.def.credentials);
    }
    this.render();
  }

  updateBudget() {
    const w = this.last?.weekly;
    this.budget = w?.resetsAt ? budget(w.percent, w.resetsAt) : null;
  }

  render() {
    const s = this.last?.session, w = this.last?.weekly;
    const label = this.def.label;

    // [icon] H [5h %] [time to reset] │ W [week %] [time to reset] │ D [% of today's budget] [time to day end]
    const icon = ICON[this.key] || label;
    if (this.error?.auth) this.item.text = `${icon} $(key)`;
    else if (!this.last) this.item.text = `${icon} $(sync~spin)`;
    else {
      const b = this.budget;
      const parts = [`H ${pct(s)} ${short(s?.resetsAt)}`, `W ${pct(w)} ${short(w?.resetsAt)}`];
      if (b) parts.push(`D ${Math.round(shareOf(b))}% ${short(b.dayEnd)}`);
      this.item.text = `${icon} ${parts.join(" │ ")}` + (this.error ? " $(warning)" : "");
    }

    // Text color = today's budget: green within, yellow near (90%+), red over.
    // A limit warning background (below) takes precedence over this color.
    const b = this.budget;
    const share = b ? shareOf(b) : null;
    this.item.color = share === null || this.error ? undefined
      : new vscode.ThemeColor(share > 100 ? "charts.red" : share >= 90 ? "charts.yellow" : "charts.green");

    const worst = Math.max(s?.percent ?? 0, w?.percent ?? 0);
    this.item.backgroundColor =
      worst >= 95 ? new vscode.ThemeColor("statusBarItem.errorBackground")
      : worst >= 80 ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;

    this.item.tooltip = this.tooltip(s, w, this.budget);
  }

  // Time left in the current subscription period. Codex states the end date.
  // Claude does not, so its renewal date comes from settings and rolls forward.
  subscription() {
    const sub = this.last?.subscription;
    if (!sub) return null;
    if (sub.status && sub.status !== "active") return { text: esc(sub.status) };
    let until = sub.until;
    if (!until && this.key === "claude") {
      const cfg = vscode.workspace.getConfiguration("aiUsage");
      const on = parseDate(cfg.get("claude.renewsOn", ""));
      if (!on) return { text: "[set renewal date](command:aiUsage.setClaudeRenewal)" };
      until = nextAnniversary(on, cfg.get("claude.billingCycle", "monthly") === "yearly" ? 12 : 1);
    }
    if (!until) return null;
    const date = until.toLocaleDateString([], { month: "short", day: "numeric", ...tzOpt() });
    if (until.getTime() <= Date.now()) return { text: `period ended ${date}` };
    return { text: `${left(until)} left (${date})` };
  }

  tooltip(s, w, b) {
    const md = new vscode.MarkdownString("", true);
    md.isTrusted = { enabledCommands: ["aiUsage.refresh", "aiUsage.setClaudeRenewal"] };
    const sub = this.subscription();
    md.appendMarkdown(`**${this.def.label}**${this.last?.plan ? ` · ${this.last.plan}` : ""}${sub ? ` · ${sub.text}` : ""}\n\n`);

    if (this.last) {
      md.appendMarkdown(`**5 hours** · ${pct(s)} · resets ${when(s?.resetsAt)}\n\n`);
      md.appendMarkdown(`${svgBar(s?.percent)}\n\n`);
      md.appendMarkdown(`**Week** · ${pct(w)} · resets ${when(w?.resetsAt)}\n\n`);
      md.appendMarkdown(`${svgBar(w?.percent, { marker: b?.allowance })}\n\n`);
      if (b) md.appendMarkdown(`<small>Marker = allowance through today (${num(b.allowance)}%).</small>\n\n`);
    }

    if (b) {
      const share = shareOf(b);
      md.appendMarkdown(`---\n\n**Day ${b.day} of 7** · ends ${when(b.dayEnd)}\n\n`);
      md.appendMarkdown(`**Today** · ${Math.round(share)}% of budget used · `);
      md.appendMarkdown(share <= 100 ? `**${Math.round(100 - share)}% left**\n\n` : `**${Math.round(share - 100)}% over**\n\n`);
      md.appendMarkdown(`${svgBar(share, { color: share > 100 ? COLOR.bad : share >= 90 ? COLOR.warn : COLOR.good })}\n\n`);
      md.appendMarkdown(`<small>Budget ${num(b.today)}% of the week = (100 − ${num(b.earlier)}% for earlier days) ÷ ${b.daysRemaining} days left · ${num(b.usedToday)}% used today</small>\n\n`);
    }

    if (this.error) {
      md.appendMarkdown(`---\n\n$(warning) ${esc(this.error.message)}`);
      if (this.error.auth) md.appendMarkdown(` — renews when you next use ${this.def.label}`);
      else if (this.last) md.appendMarkdown(" — showing the last good numbers");
      md.appendMarkdown("\n\n");
    }

    md.appendMarkdown(`---\n\n${this.lastOk ? `Updated ${clock(this.lastOk)}` : "Not fetched yet"}`);
    if (TZ) md.appendMarkdown(` · ${esc(TZ)}`);
    if (TZ === null) md.appendMarkdown(` · $(warning) unknown time zone, using system time`);
    md.appendMarkdown(` · [$(refresh) Refresh](command:aiUsage.refresh)`);
    md.supportHtml = true;
    return md;
  }
}

// Built-in product icons (codicons); the tooltip still names the tool.
const ICON = { claude: "$(claude)", codex: "$(openai)" };
const pct = (w) =>(w ? `${Math.round(w.percent)}%` : "–");
// Percent of today's budget used.
const shareOf = (b) => (b.today > 0 ? (b.usedToday / b.today) * 100 : b.usedToday > 0 ? 101 : 0);
const num = (x) => (Math.abs(x) < 10 ? x.toFixed(1) : String(Math.round(x)));
// Display time zone from settings: undefined = system, null = invalid name.
let TZ;
function readTimeZone() {
  const name = vscode.workspace.getConfiguration("aiUsage").get("timeZone", "").trim();
  if (!name) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return name;
  } catch {
    return null;
  }
}
const tzOpt = () => (TZ ? { timeZone: TZ } : {});
const clock = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...tzOpt() });

// Compact time until a reset: 4h43m, 6d18h, 12m.
function left(date) {
  if (!date) return "–";
  const m = Math.max(0, Math.round((date.getTime() - Date.now()) / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d${h}h` : h ? `${h}h${String(mm).padStart(2, "0")}m` : `${mm}m`;
}

// Largest unit only, for the status bar: 4d, 3h, 12m.
function short(date) {
  if (!date) return "–";
  const m = Math.max(0, Math.round((date.getTime() - Date.now()) / 60000));
  return m >= 1440 ? `${Math.floor(m / 1440)}d` : m >= 60 ? `${Math.floor(m / 60)}h` : `${m}m`;
}

function when(date) {
  if (!date) return "–";
  if (date.getTime() <= Date.now()) return "now";
  const day = date.toLocaleDateString([], { weekday: "short", ...tzOpt() });
  return `in ${left(date)} (${day} ${clock(date)})`;
}

// A rounded progress bar as an inline SVG image; optional marker line.
function svgBar(percent, { marker, color } = {}) {
  const W = 260, H = 14, BH = 8, y = (H - BH) / 2;
  const p = typeof percent === "number" ? Math.min(100, Math.max(0, percent)) : 0;
  const fill = color || (p >= 95 ? COLOR.bad : p >= 80 ? COLOR.warn : COLOR.ok);
  const fw = p > 0 ? Math.max(BH, (W * p) / 100) : 0;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect x="0" y="${y}" width="${W}" height="${BH}" rx="${BH / 2}" fill="${COLOR.track}"/>`;
  if (fw) svg += `<rect x="0" y="${y}" width="${fw.toFixed(1)}" height="${BH}" rx="${BH / 2}" fill="${fill}"/>`;
  if (typeof marker === "number") {
    const x = Math.min(W - 2, Math.max(0, (W * marker) / 100 - 1));
    svg += `<rect x="${x.toFixed(1)}" y="0" width="2" height="${H}" rx="1" fill="${COLOR.marker}"/>`;
  }
  svg += "</svg>";
  return `![bar](data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")})`;
}

function offsetOf(zone) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

async function pickTimeZone() {
  const cfg = vscode.workspace.getConfiguration("aiUsage");
  const current = cfg.get("timeZone", "").trim();
  const system = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const item = (zone) => ({ label: zone, description: offsetOf(zone) + (zone === current ? " · current" : "") });
  const common = ["Asia/Tehran", system, "UTC"].filter((z, i, a) => a.indexOf(z) === i);
  const all = (Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : []).filter((z) => !common.includes(z));
  const items = [
    { label: "$(globe) System time zone", description: `${system} ${offsetOf(system)}${current ? "" : " · current"}`, zone: "" },
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    ...common.map(item),
    { label: "All time zones", kind: vscode.QuickPickItemKind.Separator },
    ...all.map(item),
  ];
  const picked = await vscode.window.showQuickPick(items, { placeHolder: "Time zone for the times shown in AI Usage", matchOnDescription: true });
  if (!picked) return;
  try {
    await cfg.update("timeZone", picked.zone ?? picked.label, vscode.ConfigurationTarget.Global);
  } catch {
    const reload = "Reload Window";
    const choice = await vscode.window.showWarningMessage(
      "AI Usage was updated; reload the window before changing its settings.", reload);
    if (choice === reload) vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

// "YYYY-MM-DD" as local midnight, or null.
function parseDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text).trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
}

async function setClaudeRenewal() {
  const cfg = vscode.workspace.getConfiguration("aiUsage");
  const value = await vscode.window.showInputBox({
    title: "Claude renewal date",
    prompt: "From claude.ai → Settings → Billing (\"auto renew on …\"). Later dates follow automatically.",
    placeHolder: "YYYY-MM-DD",
    value: cfg.get("claude.renewsOn", ""),
    validateInput: (v) => (!v.trim() || parseDate(v) ? null : "Use YYYY-MM-DD, e.g. 2026-11-26"),
  });
  if (value === undefined) return;
  try {
    await cfg.update("claude.renewsOn", value.trim(), vscode.ConfigurationTarget.Global);
  } catch {
    const reload = "Reload Window";
    const choice = await vscode.window.showWarningMessage(
      "AI Usage was updated; reload the window before changing its settings.", reload);
    if (choice === reload) vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

function esc(s) {
  return String(s).replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}

function activate(context) {
  const cfg = () => vscode.workspace.getConfiguration("aiUsage");
  // Earlier versions stored daily baselines; the budget no longer needs them.
  for (const key of Object.keys(providers)) {
    context.globalState.update(`aiUsage.daily.${key}`, undefined);
    context.globalState.update(`aiUsage.day.${key}`, undefined);
  }

  const list = [];
  let priority = 100;
  for (const [key, def] of Object.entries(providers)) {
    if (cfg().get(`${key}.enabled`, true)) list.push(new Provider(key, def, priority--, context));
  }
  const intervalMs = () => Math.max(60, cfg().get("intervalSeconds", 180)) * 1000;
  const tick = (force) => list.forEach((p) => p.refresh(force, intervalMs()));

  TZ = readTimeZone();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("aiUsage")) return;
      TZ = readTimeZone();
      list.forEach((p) => p.render());
    }),
    vscode.commands.registerCommand("aiUsage.refresh", () => tick(true)),
    vscode.commands.registerCommand("aiUsage.setTimeZone", pickTimeZone),
    vscode.commands.registerCommand("aiUsage.setClaudeRenewal", setClaudeRenewal),
    vscode.commands.registerCommand("aiUsage.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Alijany.ai-usage-alijany")),
    vscode.window.onDidChangeWindowState((s) => s.focused && tick(false))
  );
  // Re-render every minute so the countdowns and day boundaries stay current.
  const timer = setInterval(() => {
    list.forEach((p) => { if (p.last) { p.updateBudget(); p.render(); } });
    if (vscode.window.state.focused) tick(false);
  }, 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  tick(true);
}

function deactivate() {}

module.exports = { activate, deactivate };
