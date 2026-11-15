// Reads local Claude mod data and fetches Codex usage. No dependencies.
// Only Codex credentials are read, fresh for each request, and sent to ChatGPT.
// Tokens are never refreshed here: that would interfere with the client's login.

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const USER_AGENT = "ai-usage-statusbar/0.1";
const home = os.homedir();

const { snapshotFile, rateWindow } = require("./claude-local");
const CODEX_AUTH = path.join(home, ".codex", "auth.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fileStamp(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function getJson(host, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host, path: urlPath, method: "GET", timeout: 15000,
        headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...headers } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            const err = new Error(`HTTP ${res.statusCode}`);
            err.status = res.statusCode;
            return reject(err);
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("response was not JSON"));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

function windowOf(percent, resetsAt) {
  if (typeof percent !== "number") return null;
  return { percent, resetsAt: resetsAt ? new Date(resetsAt) : null };
}

// Codex: the ID token stored by Codex carries the current period's dates.
// It is decoded locally; nothing is sent. It updates when Codex renews its sign-in.
function codexSubscription(tokens) {
  try {
    const payload = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8"));
    const a = payload["https://api.openai.com/auth"] || {};
    const date = (v) => (v ? new Date(v) : null);
    return { status: null, since: date(a.chatgpt_subscription_active_start), until: date(a.chatgpt_subscription_active_until) };
  } catch {
    return null;
  }
}

// First billing date after `now`: `since` itself, or a later one stepping
// `months` at a time (day clamped to the month's length, as card billing does).
function nextAnniversary(since, months, now = Date.now()) {
  const day = since.getUTCDate();
  for (let n = 0; n <= 1200; n += months) {
    const d = new Date(since.getTime());
    d.setUTCDate(1);
    d.setUTCMonth(since.getUTCMonth() + n);
    const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, daysInMonth));
    if (d.getTime() > now) return d;
  }
  return null;
}

// Claude: read only the latest snapshot emitted by the official mod hook.
async function fetchClaude() {
  let d;
  try { d = readJson(snapshotFile); }
  catch (error) {
    if (error.code === "ENOENT") throw new Error("No local usage received from Claude Code yet");
    throw new Error("Could not read local Claude usage data");
  }
  const receivedAt = new Date(d.receivedAt);
  if (d.version !== 1 || !Number.isFinite(receivedAt.getTime()) || receivedAt.getTime() > Date.now() + 60000) {
    throw new Error("Invalid local Claude usage data");
  }
  const current = (value) => {
    const v = rateWindow(value);
    return v && v.resets_at * 1000 > Date.now() ? windowOf(v.used_percentage, v.resets_at * 1000) : null;
  };
  return {
    session: current(d.five_hour),
    weekly: current(d.seven_day),
    receivedAt,
    subscription: { status: null, until: null },
  };
}

// Codex: the endpoint the ChatGPT/Codex extension polls. Undocumented.
async function fetchCodex() {
  const tokens = readJson(CODEX_AUTH).tokens;
  if (!tokens || !tokens.access_token) throw Object.assign(new Error("not logged in"), { auth: true });
  const headers = { Authorization: "Bearer " + tokens.access_token };
  if (tokens.account_id) headers["ChatGPT-Account-Id"] = tokens.account_id;
  const d = await getJson("chatgpt.com", "/backend-api/wham/usage", headers);
  const rl = d.rate_limit || {};
  const w = (x) => x && windowOf(x.used_percent, typeof x.reset_at === "number" ? x.reset_at * 1000 : null);
  return {
    plan: d.plan_type || null,
    session: w(rl.primary_window),
    weekly: w(rl.secondary_window),
    subscription: codexSubscription(tokens),
  };
}

module.exports = {
  providers: {
    claude: { label: "Claude", fetch: fetchClaude, local: true, source: snapshotFile },
    codex: { label: "Codex", fetch: fetchCodex, credentials: CODEX_AUTH },
  },
  fileStamp,
  nextAnniversary,
};
