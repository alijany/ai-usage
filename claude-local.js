// Local data only. Claude credentials are never opened here.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const snapshotFile = path.join(os.homedir(), ".claude", "ai-usage.json");
const PLUGIN_ID = "ai-usage-bridge@skills-dir";
const OWNER = "Alijany.ai-usage-alijany";
const bridgeFiles = ["hooks/hooks.json", "hooks/register.mjs", ".claude-plugin/plugin.json"];
const bridgeDirectory = () => path.join(os.homedir(), ".claude", "skills", "ai-usage-bridge");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const object = (value) => value && typeof value === "object" && !Array.isArray(value);

function bridgeOwned() {
  try {
    return readJson(path.join(bridgeDirectory(), ".ai-usage-owner.json")).owner === OWNER;
  } catch { return false; }
}

function bridgeInstalled() {
  try {
    return bridgeOwned() && readJson(path.join(bridgeDirectory(), ".claude-plugin", "plugin.json")).name === "ai-usage-bridge";
  } catch { return false; }
}

function atomicWrite(file, contents) {
  const temporary = file + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(temporary, contents, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function rateWindow(value) {
  if (!value || !Number.isFinite(value.used_percentage) || value.used_percentage < 0 ||
      value.used_percentage > 100 || !Number.isFinite(value.resets_at) ||
      value.resets_at <= 0 || !Number.isFinite(new Date(value.resets_at * 1000).getTime())) return null;
  return { used_percentage: value.used_percentage, resets_at: value.resets_at };
}

function installBridge({ enable = true } = {}) {
  // Official skills-directory plugins load next session without a marketplace.
  // Never open credentials, installation registries, or managed settings.
  const destination = bridgeDirectory();
  const settingsFile = path.join(os.homedir(), ".claude", "settings.json");
  let before = null, after = null;
  if (enable) {
    let settings = {};
    try {
      before = fs.readFileSync(settingsFile, "utf8");
      settings = JSON.parse(before.replace(/^\uFEFF/, ""));
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("Could not read Claude settings. Fix settings.json before enabling usage.");
    }
    if (!object(settings) || (settings.enabledPlugins !== undefined && !object(settings.enabledPlugins))) {
      throw new Error("Claude settings or enabledPlugins has an invalid format; nothing was changed.");
    }
    const plugins = { ...settings.enabledPlugins, [PLUGIN_ID]: true };
    // Migrate the previous manual installation if it was explicitly enabled.
    if (Object.hasOwn(plugins, "ai-usage-bridge@ai-usage-local")) plugins["ai-usage-bridge@ai-usage-local"] = false;
    if (JSON.stringify(settings.enabledPlugins) !== JSON.stringify(plugins)) {
      after = JSON.stringify({ ...settings, enabledPlugins: plugins }, null, 2) + "\n";
    }
  }
  if (fs.existsSync(destination) && !bridgeOwned()) {
    // This name may belong to the user's own plugin. Do not overwrite it.
    throw new Error("A different or incomplete ai-usage-bridge folder already exists in Claude's skills directory.");
  }
  if (!enable && !bridgeInstalled()) return null;
  const contents = bridgeFiles.map((name) => [name, fs.readFileSync(path.join(__dirname, "claude-bridge", "plugin", name))]);
  fs.mkdirSync(destination, { recursive: true });
  if (!bridgeOwned()) atomicWrite(path.join(destination, ".ai-usage-owner.json"), JSON.stringify({ owner: OWNER }) + "\n");
  // Install hooks first and publish the manifest last.
  for (const [name, content] of contents) {
    const target = path.join(destination, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(content)) atomicWrite(target, content);
  }
  let backup = null;
  if (after !== null) {
    // Protect unrelated changes made while setup was preparing the bridge.
    const current = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, "utf8") : null;
    if (current !== before) throw new Error("Claude settings changed during setup. Click Enable Claude Usage again.");
    if (before !== null) {
      backup = settingsFile + ".ai-usage-" + crypto.randomBytes(8).toString("hex") + ".bak";
      fs.writeFileSync(backup, before, { flag: "wx", mode: 0o600 });
    }
    atomicWrite(settingsFile, after);
  }
  return { directory: destination, backup };
}

module.exports = { snapshotFile, rateWindow, installBridge, bridgeInstalled };
