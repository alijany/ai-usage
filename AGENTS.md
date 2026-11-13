# AGENTS.md

VS Code extension that shows Claude Code and Codex usage limits and a daily budget in the status bar. Plain CommonJS JavaScript, no runtime dependencies, no build step. User-facing details are in [README.md](README.md); keep it in sync with behavior changes.

## Files

- `extension.js`: activation, one status bar item per provider, tooltip (Markdown with inline SVG bars), commands, refresh timing.
- `usage.js`: reads each client's credential file and fetches usage. Read-only.
- `budget.js`: pure daily budget function. No VS Code imports, so it can be tested with plain `node`.
- `package.json`: manifest (commands, settings). Publisher `Alijany`, id `ai-usage-alijany`.
- `build.py`: packages a local VSIX without npm. Its `files` list must include every file the extension ships.
- `.github/workflows/publish.yml`: publishes to the Marketplace when a `v*` tag is pushed.

## Rules

- No dependencies and no `node_modules`. Use Node built-ins (`https`, `fs`) only.
- Never write to, refresh, or log the credential files (`~/.claude/.credentials.json`, `~/.codex/auth.json`). The clients rotate refresh tokens; refreshing here would sign the user out. Send each token only to the service that issued it.
- The daily budget is stateless by design: it is computed from the current weekly reading and reset time only. Do not add `globalState` baselines or history; the owner decided against storing anything. Formula and its limits are documented in `budget.js` and the README "Daily budget" section.
- Status bar text stays compact: product codicons (`$(claude)`, `$(openai)`), `H`/`W`/`D` segments separated by ` │ `, times in the largest unit only (`short()`). Details go in the tooltip.
- Respect the `aiUsage.timeZone` setting when formatting times (`tzOpt()`).

## Build, test, install

```powershell
node --check extension.js
node -e "const {budget}=require('./budget'); console.log(budget(31, new Date(Date.now()+4.9*864e5)))"
python build.py
code --install-extension ai-usage-alijany.vsix --force
```

There is no test suite; check `budget.js` changes with small `node -e` cases. Bump `version` in `package.json` for every installed build, otherwise VS Code keeps the cached one. Then run **Developer: Reload Window**.

## Release

1. Bump `version` in `package.json` and commit.
2. Push `main`, then push a tag matching the version: `git tag v0.7.4 && git push origin v0.7.4`.
3. The workflow checks that the tag equals `v<version>` and runs `vsce publish --oidc` (Marketplace Trusted Publishing; no token secret).

Files excluded from the Marketplace package are listed in `.vscodeignore`.
