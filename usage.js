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

// Claude's profile gives the subscription status and start date, but no end
// date. It changes rarely, so it is fetched at most every 6 hours.
const PROFILE_TTL = 6 * 60 * 60 * 1000;
let claudeProfile = { at: 0, value: null };

async function claudeSubscription(token) {
  if (Date.now() - claudeProfile.at < PROFILE_TTL) return claudeProfile.value;
  try {
    const p = await getJson("api.anthropic.com", "/api/oauth/profile", {
      Authorization: "Bearer " + token,
      "anthropic-beta": "oauth-2025-04-20",
    });
    const org = p.organization || {};
    claudeProfile = {
      at: Date.now(),
      value: {
        status: org.subscription_status || null,
        since: org.subscription_created_at ? new Date(org.subscription_created_at) : null,
        // No end date is provided, and the start date is not the billing
        // anchor, so the renewal date comes from the aiUsage.claude.renewsOn setting.
        until: null,
      },
    };
  } catch {
    claudeProfile.at = Date.now() - PROFILE_TTL + 10 * 60 * 1000; // retry in 10 minutes
  }
  return claudeProfile.value;
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
    subscription: await claudeSubscription(oauth.accessToken),
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
    claude: { label: "Claude", fetch: fetchClaude, credentials: CLAUDE_CREDENTIALS },
    codex: { label: "Codex", fetch: fetchCodex, credentials: CODEX_AUTH },
  },
  fileStamp,
  nextAnniversary,
};
