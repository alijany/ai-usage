# Claude & Codex Usage Budget

A small, local VS Code extension that keeps your **Claude Code** and **Codex** usage limits in the status bar, with a daily budget so the weekly limit lasts the whole week.

```
[Claude icon] H 7% 4h │ W 12% 6d │ D 35% 21h    [OpenAI icon] H 5% 4h │ W 17% 6d │ D 20% 19h
```

- **H**: the 5-hour limit: percent used, then time until it resets.
- **W**: the weekly limit: percent used, then time until it resets.
- **D**: percent of today's budget used, then time until the day ends.
- Times show only the largest unit (`6d`, `4h`, `12m`); the hover has exact times. The icons are VS Code's built-in `claude` and `openai` codicons.
- **Text color**: today's budget (see below). Green is within it, yellow means 90% or more of it is used, red is over it.
- **Background**: yellow when either limit reaches 80%, red at 95%. This takes precedence over the text color.

Hovering shows progress bars for each available provider's limits, when each one resets, today's budget, and the time left in the current subscription period. Clicking opens the provider's usage page (Codex opens [ChatGPT usage](https://chatgpt.com/settings/usage?tab=overview)); refresh from the hover link or **AI Usage: Refresh**.

It has no runtime dependencies. The included `build.py` creates a local test VSIX; Marketplace releases are packaged with `vsce`.

## Daily budget

The weekly window is split into seven equal 24-hour days, counted from the start of the window (the weekly reset minus seven days). The budget is calculated from the current reading alone; nothing is stored. Earlier days are allotted their even share, 100/7 ≈ 14.3% each, and weekly use beyond that counts as today's. If earlier days used less, the saving is spread over today and the days that remain:

```
earlier days   = min(weekly % used, days passed × 14.3%)
today's budget = (100 − earlier days) ÷ days remaining, today included
used today     = weekly % used − earlier days
```

For example, on day 3 with 31% used: earlier days = min(31, 28.6) = 28.6, today's budget = 71.4 ÷ 5 = 14.3%, used today = 2.4%. With 20% used: earlier days = 20, today's budget = 80 ÷ 5 = 16%, used today = 0.

Below the even pace, today's use cannot be told apart from earlier days' use, so it lowers the budget for today and the remaining days instead of showing as used today. Above it, everything beyond the even pace counts as today's.

The status bar shows `D`, the percent of today's budget used (100% = the whole budget), and the time until the day ends, for example `D 60% 5h12m`. Its text color follows today's budget: green within, yellow at 90% or more, red when over. The marker on the weekly bar in the hover is the weekly % allowed through the end of today.

Days follow each tool's own weekly window, so a "day" may end at a different clock time for Claude and for Codex. The hover shows when the current one ends.

## Where the numbers come from

The Claude status item appears only when the official Claude Code extension (`anthropic.claude-code`) is installed and available to VS Code. It updates visibility when that extension is added or removed. Old bridge files or cached usage alone do not make the item appear.

Claude usage comes from a small local plugin running inside the official Claude Code client, including its VS Code chat panel. The plugin observes the documented `session.measure` event and writes only the latest five-hour and weekly percentages, reset times, and received time to `~/.claude/ai-usage.json`. AI Usage reads that file every 5 seconds. No Claude credentials are read and no Claude API requests are made by this extension or bridge.

Codex is shown when `~/.codex/auth.json` exists at startup. Its usage still comes from `GET https://chatgpt.com/backend-api/wham/usage`, using `tokens.access_token` and `tokens.account_id` from that file. This endpoint is undocumented. Requests do not run a model.

### Set up Claude local usage

Click the Claude item in the status bar, choose **Enable Claude usage** in its tooltip, or run **AI Usage: Enable Claude Usage** from the Command Palette. The extension installs and enables its bundled local bridge for you. Restart Claude Code (the success message has a **Reload Window** button), then send a normal message. Usage appears within 5 seconds of a measurement. No terminal commands or marketplace registration are needed.

The bridge is installed as a documented [skills-directory plugin](https://code.claude.com/docs/en/plugins/create#make-a-plugin-load-in-every-session) in `~/.claude/skills/ai-usage-bridge`. Setup adds only `enabledPlugins["ai-usage-bridge@skills-dir"] = true` to your personal Claude settings, preserving other settings and saving an exact backup beside `settings.json` before a change. If the previous manually installed `ai-usage-bridge@ai-usage-local` is listed in your personal settings, setup disables that copy so the new bridge can load. Invalid settings and unrelated folders are left intact and setup reports the problem.

Normal extension updates refresh an already installed bridge's code automatically; they do not enable a disabled bridge or change Claude settings. Claude picks up the updated code when restarted. To enable a bridge you previously disabled, click **Enable Claude Usage** again. Organization policies and project overrides still apply.

Requires Claude Code with Mods support (v2.1.299 or newer); update the official extension if the plugin cannot load. The bridge works through the documented [Mods API](https://code.claude.com/docs/en/plugins/mods/reference), whose hooks run in the [VS Code chat panel as well as the CLI](https://code.claude.com/docs/en/plugins/mods/overview#where-mods-run). It does not need a terminal status line or Node.js on PATH. Your organization's plugin policy can prevent it from loading.

Install the bridge in the same environment as AI Usage: a remote or WSL Claude session writes on that remote machine, not to your Windows home directory. Project or session plugin settings may also disable the bridge. Until it receives data, the Claude item offers activation or explains that it is waiting for Claude Code. The extension cannot confirm that the bridge is running until it receives a measurement.

This is a last-reading display, not live polling. Usage changes elsewhere appear only once Claude Code supplies a new measurement. The tooltip shows the received date and time, and marks readings older than 15 minutes. Expired windows disappear rather than displaying zero usage or contributing to the daily budget. Missing readings are never treated as zero. No baselines or usage history are stored; the one local snapshot is replaced with each reading. To stop exporting, disable or uninstall `ai-usage-bridge` in Claude Code's Plugins dialog. If you used the older manual marketplace setup, you can remove `ai-usage-local` from that dialog's Marketplaces tab.

### Subscription period

- **Codex**: the end of the current period comes from the `id_token` that Codex stores in `~/.codex/auth.json` (`chatgpt_subscription_active_until`). It is decoded locally and nothing is sent. It updates when Codex renews its sign-in, so just after a renewal it can briefly show "period ended".
- **Claude**: renewal dates and subscription status are not exported. Enter the date shown at claude.ai ? Settings ? Billing once, with **AI Usage: Set Claude Renewal Date** or `aiUsage.claude.renewsOn`. Later renewals roll forward monthly (or yearly, see `aiUsage.claude.billingCycle`). The extension does not request the OAuth profile endpoint.

### Security

- Claude: no credential access, token refresh, HTTP calls, model calls, or transcript storage. The bridge observes measurements without changing the conversation. It writes only `~/.claude/ai-usage.json`; enabling the bridge installs its code and updates only its own entries in personal Claude settings, with a backup.
- Codex: credentials are read-only and re-read before every request. The extension never refreshes tokens. It sends the access token only to ChatGPT over HTTPS. When credentials expire, automatic requests stop until Codex updates them.
- No telemetry. Claude's bridge exports data locally; Codex usage requests go only to its service.

## Refreshing

- Claude: read the local snapshot every 5 seconds, including while unfocused. **Refresh** re-reads that file; it does not ask Anthropic for fresh data.
- Codex: every 3 minutes while focused (`aiUsage.intervalSeconds`, minimum 60), on focus, and after a limit resets. Manual requests are limited to one every 10 seconds.
- Each window reads the same Claude snapshot. Each open VS Code window polls Codex independently.

## Commands and settings

| Command | |
| --- | --- |
| AI Usage: Refresh | Re-read Claude locally and fetch Codex |
| AI Usage: Enable Claude Usage | Install and enable the local bridge automatically |
| AI Usage: Set Time Zone | Pick the time zone for displayed times |
| AI Usage: Set Claude Renewal Date | Enter the renewal date from Claude's billing page |
| AI Usage: Open Settings | Open this extension's settings |

| Setting | Default | |
| --- | --- | --- |
| `aiUsage.intervalSeconds` | `180` | Codex fetch interval while focused (minimum 60) |
| `aiUsage.timeZone` | `""` | IANA time zone for displayed times, e.g. `Asia/Tehran`. Empty uses the system's. It does not affect the budget. |
| `aiUsage.claude.renewsOn` | `""` | Next Claude renewal date, `YYYY-MM-DD`, from the billing page |
| `aiUsage.claude.billingCycle` | `monthly` | `monthly` or `yearly`; rolls the renewal date forward |
| `aiUsage.claude.enabled` | `true` | Show Claude |
| `aiUsage.codex.enabled` | `true` | Show Codex |

## Install and update

After publication, search for **Claude & Codex Usage Budget** in the VS Code Extensions view or install it with:

```powershell
code --install-extension Alijany.ai-usage-alijany
```

For a local test build, Python 3 and the `code` command are required:

```powershell
python build.py
code --install-extension ai-usage-alijany.vsix --force
```

Then run **Developer: Reload Window**. VS Code reads new commands and settings only after a reload. Bump `version` in `package.json` for each change so VS Code picks up the new build.

### Automated Marketplace releases

The GitHub Actions workflow publishes when a pushed tag matches the version in `package.json`, for example `v0.6.2`. Before using it, create a **Trusted Publishing** policy for the `Alijany` publisher with repository owner `alijany`, repository `ai-usage`, and workflow `publish.yml`. Then update the package version, push the commit, and push the matching tag. The workflow uses OIDC; no publishing token is stored in GitHub.

The Marketplace release package is marked public and includes the icon as a Marketplace asset. If an existing listing still shows Private, change its Availability in the Marketplace publisher management page; then publish a new version.

## Files

| File | |
| --- | --- |
| `extension.js` | Entry point: status bar items, hover, commands, refresh schedule |
| `usage.js` | Reads the local Claude snapshot and fetches Codex usage |
| `claude-local.js` | Validates local usage windows and installs the bridge |
| `claude-bridge/` | Claude Code mod that exports usage readings |
| `budget.js` | Daily budget calculation |
| `package.json` | Extension manifest: commands and settings |
| `icon.png` | Extension icon |
| `build.py` | Packages the extension as a VSIX without npm or `vsce` |

## Limitations

- Codex uses an undocumented endpoint. Claude requires a separately enabled local bridge plugin.
- Subscription accounts only. Claude exports available five-hour and weekly plan windows; API-key accounts have no such plan limits to show.
- Claude data may be stale while the client is idle or when another device is used. The received time is not an independent server freshness guarantee.
- The bars in the hover use fixed colors chosen to read on both light and dark themes.

## License

[MIT](LICENSE)

## Credits

Designed and written by [Claude Code](https://claude.com/claude-code) (Claude Opus 5.5) in a single session, from investigating how each tool reports its limits to the code and this README, with the owner steering the design and testing it in VS Code.
