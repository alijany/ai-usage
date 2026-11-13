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

Hovering shows progress bars for both limits, when each one resets, today's budget, and the time left in the current subscription period. Clicking refreshes.

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

Both tools must be installed and signed in with a subscription (Claude Pro/Max, ChatGPT Plus/Pro). The extension reads each tool's own stored sign-in and asks that tool's service for current usage. These requests do not run a model and do not use any of your limits.

| | Credentials read | Request |
| --- | --- | --- |
| Claude | `~/.claude/.credentials.json` (`claudeAiOauth.accessToken`) | `GET https://api.anthropic.com/api/oauth/usage` with `anthropic-beta: oauth-2025-04-20` |
| Codex | `~/.codex/auth.json` (`tokens.access_token`, `tokens.account_id`) | `GET https://chatgpt.com/backend-api/wham/usage` with `ChatGPT-Account-Id` |

These are the endpoints that Claude Code's `/usage` and the Codex extension use.

### Subscription period

- **Codex**: the end of the current period comes from the `id_token` that Codex stores in `~/.codex/auth.json` (`chatgpt_subscription_active_until`). It is decoded locally and nothing is sent. It updates when Codex renews its sign-in, so just after a renewal it can briefly show "period ended".
- **Claude**: no renewal date is available to tools. `GET https://api.anthropic.com/api/oauth/profile` gives only the subscription status and a start date, and that start date is not the billing date. Enter the date shown at claude.ai → Settings → Billing once, with **AI Usage: Set Claude Renewal Date** or `aiUsage.claude.renewsOn`. Later renewals are then rolled forward monthly (or yearly, see `aiUsage.claude.billingCycle`). The profile is still read, at most every 6 hours, so a status other than `active` is shown. **Neither one is documented**, so either may change without notice. When that happens, a warning icon appears next to the name and the last good numbers stay visible.

### Security

- Read-only. The extension never writes to either credentials file.
- It **never refreshes tokens**. Both clients rotate refresh tokens, so refreshing them here could sign the real client out. When a token expires, the item shows a key icon and stops requesting until the client renews its own credentials, which happens the next time you use it.
- Each token is sent only to the service that issued it, over HTTPS. There is no telemetry and nothing else leaves the machine.
- Credential files are re-read before every request and are never cached.

## Refreshing

- Every 3 minutes while the window is focused (`aiUsage.intervalSeconds`, minimum 60).
- When the window regains focus, and just after a limit resets.
- When you click the item or run **AI Usage: Refresh**. Manual refreshes are limited to one every 10 seconds.

## Commands and settings

| Command | |
| --- | --- |
| AI Usage: Refresh | Fetch now |
| AI Usage: Set Time Zone | Pick the time zone for displayed times |
| AI Usage: Set Claude Renewal Date | Enter the renewal date from Claude's billing page |
| AI Usage: Open Settings | Open this extension's settings |

| Setting | Default | |
| --- | --- | --- |
| `aiUsage.intervalSeconds` | `180` | Fetch interval while focused (minimum 60) |
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
| `usage.js` | Reads credentials and fetches usage from both services |
| `budget.js` | Daily budget calculation |
| `package.json` | Extension manifest: commands and settings |
| `icon.png` | Extension icon |
| `build.py` | Packages the extension as a VSIX without npm or `vsce` |

## Limitations

- Undocumented endpoints, as above.
- Subscription accounts only. API-key accounts have no plan limits to show.
- Each open VS Code window polls on its own.
- The bars in the hover use fixed colors chosen to read on both light and dark themes.

## License

[MIT](LICENSE)

## Credits

Designed and written by [Claude Code](https://claude.com/claude-code) (Claude Opus 5.5) in a single session, from investigating how each tool reports its limits to the code and this README, with the owner steering the design and testing it in VS Code.
