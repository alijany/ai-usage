const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

test("Claude local export and reader never use credentials or the network", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ai-usage-test-"));
  const originalHome = os.homedir;
  const originalRequest = https.request;
  const originalRead = fs.readFileSync;
  try {
    os.homedir = () => temporary;
    https.request = () => { throw new Error("Network access forbidden"); };
    fs.readFileSync = (file, ...args) => {
      assert.doesNotMatch(String(file), /credentials\.json|auth\.json/);
      return originalRead(file, ...args);
    };
    const { snapshotFile, installBridge, rateWindow } = require("../claude-local");
    const { providers } = require("../usage");
    assert.equal(providers.claude.local, true);
    await assert.rejects(providers.claude.fetch(), /No local usage received/);
    const { directory: installed } = installBridge();
    const module = await import(path.join(installed, "hooks/register.mjs").replace(/\\/g, "/").replace(/^([A-Z]:)/i, "file:///$1"));
    const hooks = {};
    module.register((name, handler) => { hooks[name] = handler; });
    const now = Date.now();
    const reset = new Date(now + 86400000).toISOString();
    const $ = {
      env: { get: async () => temporary },
      clock: { now: async () => now },
      fs: { write: async (file, data) => { assert.equal(path.resolve(file), snapshotFile); fs.writeFileSync(file, data); } },
    };
    const e = { rateLimits: [
      { kind: "five_hour", percentUsed: 23.5, resetsAt: reset },
      { kind: "seven_day", percentUsed: 41.2, resetsAt: reset },
    ], transcript: "must never be exported" };
    let calls = 0;
    const next = async (event) => { assert.equal(event, e); calls++; return "continued"; };
    assert.equal(await hooks["session.measure"]($, e, next), "continued");
    assert.equal(calls, 1);
    const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
    assert.deepEqual(Object.keys(snapshot).sort(), ["five_hour", "receivedAt", "seven_day", "version"]);
    assert.equal(snapshot.five_hour.resets_at, Date.parse(reset) / 1000);
    const reading = await providers.claude.fetch();
    assert.equal(reading.session.percent, 23.5);
    assert.equal(reading.weekly.percent, 41.2);
    assert.equal(reading.receivedAt.getTime(), now);
    await hooks["session.measure"]($, { rateLimits: [] }, async () => {});
    assert.deepEqual(JSON.parse(fs.readFileSync(snapshotFile, "utf8")), snapshot);
    // A failed local export must still continue the conversation exactly once.
    await hooks["session.measure"]({ ...$, fs: { write: async () => { throw new Error("denied"); } } }, e, next);
    assert.equal(calls, 2);
    snapshot.five_hour.resets_at = (now - 1000) / 1000;
    snapshot.seven_day.used_percentage = "invalid";
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot));
    const expired = await providers.claude.fetch();
    assert.equal(expired.session, null);
    assert.equal(expired.weekly, null);
    fs.writeFileSync(snapshotFile, "{");
    await assert.rejects(providers.claude.fetch(), /Could not read local/);
    fs.writeFileSync(snapshotFile, JSON.stringify({ ...snapshot, receivedAt: "invalid" }));
    await assert.rejects(providers.claude.fetch(), /Invalid local/);
    assert.equal(rateWindow({ used_percentage: Infinity, resets_at: now }), null);
    assert.equal(rateWindow({ used_percentage: -1, resets_at: now }), null);
  } finally {
    os.homedir = originalHome;
    https.request = originalRequest;
    fs.readFileSync = originalRead;
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith("ai-usage-test-"));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("status bar marks stale data and excludes expired budgets even after a read error", async () => {
  const vm = require("vm");
  class MarkdownString {
    constructor() { this.value = ""; }
    appendMarkdown(text) { this.value += text; }
  }
  const fakeVscode = {
    StatusBarAlignment: { Right: 1 },
    window: { createStatusBarItem: () => ({ show() {}, dispose() {} }) },
    MarkdownString,
    ThemeColor: class { constructor(id) { this.id = id; } },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => fallback }) },
  };
  const sandbox = {
    require: (name) => name === "vscode" ? fakeVscode
      : name === "./claude-local" ? { bridgeInstalled: () => false }
      : require("../" + name),
    module: { exports: {} }, Buffer, Date,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../extension.js"), "utf8") + "\nmodule.exports.Provider = Provider;", sandbox);
  const now = Date.now();
  let fails = false;
  const reading = {
    session: { percent: 20, resetsAt: new Date(now + 3600000) },
    weekly: { percent: 40, resetsAt: new Date(now + 86400000) },
    receivedAt: new Date(now - 20 * 60000),
  };
  const provider = new sandbox.module.exports.Provider("claude", {
    label: "Claude", local: true,
    fetch: async () => { if (fails) throw new Error("partial write"); return reading; },
  }, 100, { subscriptions: [] });
  assert.match(provider.item.tooltip.value, /Enable Claude usage/);
  await provider.refresh(true, 180000);
  assert.match(provider.item.text, /H 20%/);
  assert.match(provider.item.tooltip.value, /older than 15 minutes/);
  assert.equal(provider.lastOk.getTime(), reading.receivedAt.getTime());
  assert.ok(provider.budget);
  reading.session.resetsAt = new Date(now - 1);
  reading.weekly.resetsAt = new Date(now - 1);
  fails = true;
  await provider.refresh(false, 180000);
  assert.equal(provider.budget, null);
  assert.doesNotMatch(provider.item.text, /20%|40%|D /);
  assert.match(provider.item.tooltip.value, /Expired windows are hidden/);
});

test("one-click install preserves settings, backs them up, migrates the old bridge and respects disabled updates", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ai-usage-test-"));
  const originalHome = os.homedir;
  try {
    os.homedir = () => temporary;
    const { installBridge, bridgeInstalled } = require("../claude-local");
    const directory = path.join(temporary, ".claude");
    fs.mkdirSync(directory);
    const settingsFile = path.join(directory, "settings.json");
    const originalSettings = {
      model: "test-model", permissions: { deny: ["Bash(test)"] },
      enabledPlugins: { "another@market": false, "ai-usage-bridge@ai-usage-local": true },
    };
    const original = "\uFEFF" + JSON.stringify(originalSettings, null, 4);
    fs.writeFileSync(settingsFile, original);
    assert.equal(bridgeInstalled(), false);
    const installed = installBridge();
    assert.equal(bridgeInstalled(), true);
    assert.equal(fs.readFileSync(installed.backup, "utf8"), original);
    const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    assert.equal(settings.model, originalSettings.model);
    assert.deepEqual(settings.permissions, originalSettings.permissions);
    assert.deepEqual(settings.enabledPlugins, {
      "another@market": false,
      "ai-usage-bridge@ai-usage-local": false,
      "ai-usage-bridge@skills-dir": true,
    });
    assert.equal(installBridge().backup, null);
    assert.equal(fs.readdirSync(directory).filter((name) => name.endsWith(".bak")).length, 1);
    settings.enabledPlugins["ai-usage-bridge@skills-dir"] = false;
    const disabled = JSON.stringify(settings);
    fs.writeFileSync(settingsFile, disabled);
    installBridge({ enable: false });
    assert.equal(fs.readFileSync(settingsFile, "utf8"), disabled);
    installBridge();
    assert.equal(JSON.parse(fs.readFileSync(settingsFile, "utf8")).enabledPlugins["ai-usage-bridge@skills-dir"], true);
    // A damaged owned install is repairable without touching other skills.
    fs.unlinkSync(path.join(installed.directory, ".claude-plugin", "plugin.json"));
    assert.equal(bridgeInstalled(), false);
    installBridge();
    assert.equal(bridgeInstalled(), true);
    fs.writeFileSync(settingsFile, "{ invalid");
    assert.throws(() => installBridge(), /Could not read Claude settings/);
    assert.equal(fs.readFileSync(settingsFile, "utf8"), "{ invalid");
  } finally {
    os.homedir = originalHome;
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith("ai-usage-test-"));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("setup refuses an unrelated plugin directory before changing settings", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ai-usage-test-"));
  const originalHome = os.homedir;
  try {
    os.homedir = () => temporary;
    const { installBridge } = require("../claude-local");
    const directory = path.join(temporary, ".claude", "skills", "ai-usage-bridge");
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "my-code.js");
    fs.writeFileSync(file, "keep me");
    assert.throws(() => installBridge(), /already exists/);
    assert.equal(fs.readFileSync(file, "utf8"), "keep me");
    assert.equal(fs.existsSync(path.join(temporary, ".claude", "settings.json")), false);
  } finally {
    os.homedir = originalHome;
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith("ai-usage-test-"));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("activation offers a clickable setup and only installs after the user enables it", async () => {
  const vm = require("vm");
  const commands = new Map();
  const items = [];
  const timers = [];
  const notices = [];
  let installed = false, installs = 0, reloads = 0;
  let officialInstalled = false, onExtensionsChanged;
  class MarkdownString {
    constructor() { this.value = ""; }
    appendMarkdown(value) { this.value += value; }
  }
  const fakeVscode = {
    StatusBarAlignment: { Right: 1 }, MarkdownString,
    ThemeColor: class {},
    extensions: {
      getExtension: (id) => { assert.equal(id, "anthropic.claude-code"); return officialInstalled ? {} : undefined; },
      onDidChange: (callback) => { onExtensionsChanged = callback; return { dispose() {} }; },
    },
    window: {
      state: { focused: true },
      createStatusBarItem: () => { const item = { show() {}, dispose() { this.disposed = true; } }; items.push(item); return item; },
      onDidChangeWindowState: () => ({ dispose() {} }),
      showInformationMessage: async (message, action) => { notices.push(message); return action; },
      showErrorMessage: (message) => { throw new Error(message); },
    },
    workspace: {
      getConfiguration: () => ({ get: (key, fallback) => fallback }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    commands: {
      registerCommand: (id, callback) => { commands.set(id, callback); return { dispose() {} }; },
      executeCommand: async (id) => { assert.equal(id, "workbench.action.reloadWindow"); reloads++; },
    },
  };
  const sandbox = {
    require: (name) => name === "vscode" ? fakeVscode
      : name === "./claude-local" ? {
        bridgeInstalled: () => installed,
        installBridge: () => { installed = true; installs++; },
      }
      : name === "./usage" ? {
        providers: { claude: { label: "Claude", local: true, fetch: async () => { throw new Error("Waiting"); } } },
      } : require("../" + name),
    module: { exports: {} }, Buffer, Date,
    setInterval: (callback, ms) => { timers.push({ callback, ms }); return timers.length; },
    clearInterval() {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../extension.js"), "utf8"), sandbox);
  sandbox.module.exports.activate({ subscriptions: [], globalState: { update() {} } });
  assert.equal(installs, 0);
  assert.equal(items.length, 0, "no Claude item without the official extension");
  officialInstalled = true;
  onExtensionsChanged();
  assert.equal(items[0].command.command, "aiUsage.setupClaude");
  assert.match(items[0].tooltip.value, /Enable Claude usage/);
  await commands.get("aiUsage.setupClaude")();
  assert.equal(installs, 1);
  assert.equal(reloads, 1);
  assert.match(notices[0], /Restart Claude Code/);
  assert.match(items[0].tooltip.value, /Waiting for Claude Code/);
  assert.ok(timers.some((timer) => timer.ms === 5000));
  officialInstalled = false;
  onExtensionsChanged();
  assert.equal(items[0].disposed, true, "removing Claude Code hides the item");
  await assert.rejects(commands.get("aiUsage.setupClaude")(), /Install the official Claude Code extension/);
  assert.equal(installs, 1, "setup cannot install a bridge without Claude Code");
  officialInstalled = true;
  onExtensionsChanged();
  assert.equal(items.length, 2, "reinstalling Claude Code restores the item");
});
