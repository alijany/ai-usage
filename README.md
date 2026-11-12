# AI Usage

A small, local VS Code extension that keeps your **Claude Code** and **Codex** usage limits in the status bar, with a daily budget so the weekly limit lasts the whole week.

```
Claude H 7% 4h28m · W 12% 6d18h    Codex H 5% 4h30m · W 17% 6d16h
```

- **H**: the 5-hour limit: percent used, then time until it resets.
- **W**: the weekly limit: percent used, then time until it resets.
- **Text color**: today's budget (see below). Green is within it, yellow means 90% or more of it is used, red is over it.
- **Background**: yellow when either limit reaches 80%, red at 95%. This takes precedence over the text color.

Hovering shows progress bars for both limits, when each one resets, today's budget, and the time left in the current subscription period. Clicking refreshes.

It has no dependencies and no build step beyond zipping. It is not published to the Marketplace.

## Daily budget

The weekly window is split into seven equal 24-hour days, counted from the start of the window (the weekly reset minus seven days). Each day adds 100/7 ≈ 14.3% to the allowance:

```
allowance through today = day number × 14.3%
left today              = allowance through today − weekly % used
```

What earlier days saved or overspent carries into today. The calculation needs only the current reading, so nothing is stored. The marker on the weekly bar in the hover is the allowance through today.

The hover also shows an alternative: what is left of the week, spread evenly over the remaining days.

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

Requires Python 3 (for packaging) and the `code` command.

```powershell
python build.py
code --install-extension ai-usage.vsix --force
```

Then run **Developer: Reload Window**. VS Code reads new commands and settings only after a reload. Bump `version` in `package.json` for each change so VS Code picks up the new build.

## Files

| File | |
| --- | --- |
| `extension.js` | Entry point: status bar items, hover, commands, refresh schedule |
| `usage.js` | Reads credentials and fetches usage from both services |
| `budget.js` | Daily budget calculation |
| `package.json` | Extension manifest: commands and settings |
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
