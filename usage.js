// Reads Claude Code and Codex usage limits. No dependencies, no writes.
// Each token is read fresh from the client's own credential file and sent
// only to the service that issued it. Tokens are never refreshed here:
// the clients rotate refresh tokens, so refreshing would break their login.

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const USER_AGENT = "ai-usage-statusbar/0.1";
const home = os.homedir();

const CLAUDE_CREDENTIALS = path.join(home, ".claude", ".credentials.json");
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

// Claude: the endpoint behind /usage in Claude Code. Undocumented.
async function fetchClaude() {
  const oauth = readJson(CLAUDE_CREDENTIALS).claudeAiOauth;
  if (!oauth || !oauth.accessToken) throw Object.assign(new Error("not logged in"), { auth: true });
  if (oauth.expiresAt && oauth.expiresAt < Date.now()) {
    throw Object.assign(new Error("token expired; use Claude once to renew it"), { auth: true });
  }
  const d = await getJson("api.anthropic.com", "/api/oauth/usage", {
    Authorization: "Bearer " + oauth.accessToken,
    "anthropic-beta": "oauth-2025-04-20",
  });
  return {
    plan: oauth.subscriptionType || null,
    session: windowOf(d.five_hour && d.five_hour.utilization, d.five_hour && d.five_hour.resets_at),
    weekly: windowOf(d.seven_day && d.seven_day.utilization, d.seven_day && d.seven_day.resets_at),
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
  };
}

module.exports = {
  providers: {
    claude: { label: "Claude", fetch: fetchClaude, credentials: CLAUDE_CREDENTIALS },
    codex: { label: "Codex", fetch: fetchCodex, credentials: CODEX_AUTH },
  },
  fileStamp,
};
