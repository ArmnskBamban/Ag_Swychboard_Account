# AG Multi-Account Switchboard

**The missing control panel for Antigravity IDE â€” switch accounts instantly, monitor AI quotas in real time, drill into token budgets, and track usage costs across every conversation you've ever had.**

<table align="center">
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/ArmnskBamban/Ag_Swychboard_Account/main/assets/preview.png" alt="Accounts" width="400"/><br/><sub><b>Accounts</b></sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/ArmnskBamban/Ag_Swychboard_Account/main/assets/token-budget.png" alt="Token Budget" width="176"/><br/><sub><b>Token Budget</b></sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/ArmnskBamban/Ag_Swychboard_Account/main/assets/usage-sidebar.png" alt="Usage Stats" width="177"/><br/><sub><b>Usage Stats</b></sub></td>
  </tr>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/ArmnskBamban/Ag_Swychboard_Account/main/assets/context-detail.png" alt="Context Detail" width="280"/><br/><sub><b>Context Detail</b></sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/ArmnskBamban/Ag_Swychboard_Account/main/assets/usage-panel-1.png" alt="Dashboard Top" width="282"/><br/><sub><b>Dashboard Top</b></sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/ArmnskBamban/Ag_Swychboard_Account/main/assets/usage-panel-2.png" alt="Dashboard Bottom" width="282"/><br/><sub><b>Dashboard Bottom</b></sub></td>
  </tr>
</table>

<p align="center">
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?logo=apple"/>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue"/>
  <img alt="Version" src="https://img.shields.io/badge/version-3.2.3-green"/>
</p>

> **ðŸ–¥ï¸ Platform Support** â€” macOS is fully tested. Linux and Windows paths are included based on standard Antigravity installation locations and have not been validated yet.

---

## What's New in This Fork

- **Collect accounts from an email list** â€” Select a `.txt` / `.csv` file with one email per line, approve each official Google OAuth login, and the accounts are added directly to Switchboard.
- **Bulk token import** â€” Import many existing refresh tokens from `refresh_token` or `email|refresh_token` lines.
- **Ready-to-install VSIX release** â€” Download the packaged extension from GitHub Releases, or run from source for development.
- **No password file flow** â€” This fork does not read or type Google passwords; it uses the official OAuth consent flow and stores tokens in VS Code SecretStorage.

---

## âœ¨ Features at a Glance

The panel has **three tabs** in the sidebar â€” Accounts, Token Budget, and Usage Stats â€” plus a full-width **Context Window Detail** editor panel accessible via "See All â†’".

---

### ðŸ“Š Accounts â€” Live Quota Dashboard

Monitor all your AI model quotas at a glance. Each account shows color-coded progress bars, usage percentages, and reset timers â€” updated automatically on a configurable schedule (30s / 1m / 2m / 5m).

- **Multi-account tracking** â€” Unlimited Google accounts monitored simultaneously
- **One-click switching** â€” Instantly switch your active IDE account from the panel, no menus or dialogs
- **Pinned model** â€” Star your most-used model to always show it in the collapsed account header
- **Status bar toggles** â€” Choose which quotas appear in the IDE status bar
- **AI Credits & Plan Info** â€” See your tier (Ultra, Premium, Free), AI credits, prompt credits, and flow credits
- **Auto-sync** â€” Detects external account switches from the IDE's profile menu within ~1 second
- **Proactive token renewal** â€” Automatic access_token refresh before expiry, preventing 401s during long sessions

---

### ðŸ”‘ Token Budget â€” Context Window Intelligence

See exactly what's consuming your context window â€” live, per-category, with drill-down to individual items.

<p align="center">
  <img src="https://raw.githubusercontent.com/ArmnskBamban/Ag_Swychboard_Account/main/assets/token-budget.png" alt="Token Budget Panel" width="380"/>
</p>

**Context Budget** â€” Donut chart showing customization token usage (MCP Tools, Rules, Workflows, Skills) with collapsible category breakdowns. MCP servers expand to show per-tool token costs.

**Active Context** â€” Real-time view of the current conversation's context window:

- Donut chart with used/total tokens and percentage
- Category-colored stacked bar (System Prompt, Tools, MCP, User Input, Model Response, File Reads, etc.)
- Per-category breakdown with item counts, token values, and percentages
- Completion config badges: Max Output, Temperature, TopK, TopP
- **"See All â†’"** button opens the full Context Window Detail panel

**Workspace Context** â€” All `.agent/` items loaded in the current session: rules, skills, and workflows with trigger modes (`always-on`, `model-decision`, `manual`) and estimated token footprints. Click any item to open it in the editor.

---

### ðŸ” Context Window Detail â€” Full Editor Panel

A dedicated editor tab for deep context window analysis. Click **"See All â†’"** from the sidebar to open.

<p align="center">
  <img src="https://raw.githubusercontent.com/ArmnskBamban/Ag_Swychboard_Account/main/assets/context-detail.png" alt="Context Window Detail" width="700"/>
</p>

- **Collapsible tree view** â€” Every token group (System Prompt, Tools, MCP Tools, Chat Messages) with children and sub-children, each showing token count and percentage
- **Step preview** â€” Click any chat step (User Input, Model Response, Command, Code Edit, MCP Tool call) to preview its content inline
- **Filter toolbar** â€” Quick filters for All, User, Model, Tools, Files
- **Expand / Collapse All** â€” Toggle the entire tree in one click
- **Export Markdown** â€” One-click conversation export with Copy to Clipboard and Save As options
- **Live updates** â€” Auto-refreshes during active model execution via LiveStream watcher
- **ðŸ”¥ badges** â€” Heaviest token consumers are flagged for quick identification

---

### ðŸ›¡ï¸ Conversation Guard â€” Lost Conversation Recovery

Antigravity can silently lose conversations from the sidebar after crashes or multi-window usage. The Conversation Guard detects these orphaned conversations by comparing `.pb` files on disk against the sidebar index, and offers a one-click fix.

- **Automatic detection** â€” Runs 15 seconds after startup, comparing disk state vs. sidebar index
- **Expandable warning banner** â€” Shows exactly which conversations are missing, with resolved titles and dates
- **One-click fix** â€” Spawns a detached worker that rebuilds the sidebar index after AG quits, then auto-relaunches the IDE
- **Title resolution** â€” Recovers conversation titles from LS trajectory data, brain markdown files, or transcript logs
- **Safe** â€” Creates a backup before modifying the index. Existing metadata (titles, timestamps) is preserved.

---

### ðŸ“ˆ Usage Stats â€” Deep Token Analytics

Track token usage and estimated costs across **every** Antigravity conversation you've ever had. Data is cached to disk for instant load, with response-aware deduplication so totals stay stable when Antigravity reports the same model response through multiple local telemetry streams.

**Sidebar (compact dashboard):**

<p align="center">
  <img src="https://raw.githubusercontent.com/ArmnskBamban/Ag_Swychboard_Account/main/assets/usage-sidebar.png" alt="Usage Stats Sidebar" width="380"/>
</p>

- Hero KPIs: Total Tokens + Estimated Cost
- Token breakdown chips: Input, Cache, Output, Reasoning
- Response-aware cache rebuilds for accurate all-time totals after telemetry schema changes
- Time range selector (24h / 7d / 30d / All Time)
- Activity heatmap (GitHub contribution style) or hourly pattern (24h mode)
- Top models with stacked token bars
- Monthly cost breakdown with Input/Cache/Output bars

**Full dashboard (editor tab) â€” click "Open Full Dashboard â†’":**

<p align="center">
  <img src="https://raw.githubusercontent.com/ArmnskBamban/Ag_Swychboard_Account/main/assets/usage-panel-1.png" alt="Usage Stats Full Dashboard â€” Top" width="700"/>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/ArmnskBamban/Ag_Swychboard_Account/main/assets/usage-panel-2.png" alt="Usage Stats Full Dashboard â€” Bottom" width="700"/>
</p>

- 9 KPI cards: Input, Cache, Output, Total, API Calls, Est. Cost, Days Active, Avg/Call, Cache Rate
- Model distribution with per-model token breakdowns
- Activity contribution grid with peak day indicator
- Weekly pattern (Monâ€“Sun) with weekday/weekend split
- Monthly stacked bar chart with yearly cost totals
- Estimated API cost table per model (Input, Cache, Output, Reasoning, Total)
- Top conversations ranked by cost

---

## ðŸ—ï¸ Architecture

The extension communicates with **two local Language Server instances** that the Antigravity IDE runs:

| Component | Source | Data |
|-----------|--------|------|
| **Workspace LS** | `--workspace_id` process | Quota, token budget, workspace context |
| **Global LS** | No workspace_id | Cascade trajectory, context window, stream updates |

Server discovery uses PID-based process scanning with `lsof` port resolution (macOS/Linux) or `PowerShell`/`netstat` (Windows). Workspace isolation via `--workspace_id` filtering prevents wrong-LS contamination.

For account switching, the extension uses a **Readiness Gate** (Kubernetes-style probe) to ensure the LS has reconnected its USS IPC channel before sending `registerGdmUser`, preventing silent stale-credential issues.

---

## ðŸš€ Getting Started

### Requirements

- **Antigravity IDE** (reads data from the local Language Server)
- A Google account with Antigravity access
- macOS, Linux, or Windows

### Google OAuth Credentials

This fork does not commit Google OAuth credentials to source control. Before using account add/import/collector flows, configure your OAuth credentials in **User Settings**:

```json
{
  "ag-switchboard.oauthClientId": "your-google-oauth-client-id",
  "ag-switchboard.oauthClientSecret": "your-google-oauth-client-secret"
}
```

You can also provide them through environment variables before launching Antigravity / VS Code:

```txt
AG_SWITCHBOARD_GOOGLE_CLIENT_ID
AG_SWITCHBOARD_GOOGLE_CLIENT_SECRET
```

### Option 1: Install the Ready-to-Use VSIX

This is the recommended path for normal users.

1. Open the [latest release](https://github.com/ArmnskBamban/Ag_Swychboard_Account/releases/latest)
2. Download the `.vsix` file
3. In Antigravity / VS Code, open Command Palette with `Ctrl + Shift + P`
4. Run `Extensions: Install from VSIX...`
5. Select the downloaded `.vsix`
6. Reload Antigravity / VS Code if asked
7. Open the **AG Switchboard** icon in the Activity Bar

### Option 2: Run Manually From Source

Use this path if you want to develop, modify, or debug the extension.

```bash
git clone https://github.com/ArmnskBamban/Ag_Swychboard_Account.git
cd Ag_Swychboard_Account
npm ci
npm run compile
```

Then open the folder in Antigravity / VS Code and press `F5`. Choose:

```txt
Run AG Switchboard Extension
```

This opens an **Extension Development Host** window where you can test the extension without installing a VSIX.

### Build a VSIX Yourself

```bash
npm run package
```

The generated file will be:

```txt
ag-multi-account-switchboard-<version>.vsix
```

### Adding Accounts

| Button | Action |
|--------|--------|
| **`+`** | Add account via Google OAuth |
| **`ðŸ”‘`** | Add account by pasting a refresh token |
| **Import File** | Bulk import many accounts from a token file |

### Bulk Token Import

Use **AG Switchboard: Import Accounts from Token File** or the **Import File** button in the Accounts panel. The file can be `.txt` or `.csv`, with one account per line:

```txt
refresh_token
email@example.com|refresh_token
# comments and blank lines are ignored
```

When an email is provided, the importer checks that the token belongs to that email before storing it. Imported tokens are saved with the same VS Code SecretStorage flow as manually added accounts.

### Collect Accounts From Email List

If you do not have refresh tokens yet, use **AG Switchboard: Collect Accounts from Email List** from the Command Palette. Select a `.txt` or `.csv` file with one Google email per line:

```txt
# emails.txt
account1@gmail.com
account2@gmail.com
account3@gmail.com
```

For each email, the extension opens the official Google OAuth page in an incognito/private browser window with that email as the login hint. Complete the sign-in/consent in the browser; the extension stores the account directly in VS Code SecretStorage. If the file is pipe/comma-delimited, only the first column is used as the email.

---

## ðŸ“‹ Quick Reference

### Panel Controls

| Symbol | Meaning |
|--------|---------|
| ðŸŸ¢ Green dot | Quota > 50% remaining |
| ðŸŸ¡ Yellow dot | Quota 20â€“50% remaining |
| ðŸ”´ Red dot | Quota < 20% remaining |
| â˜… Gold star | Pinned model â€” shown in collapsed header |
| â˜† Outline star | Click to pin this model |
| â— Blue toggle | Model visible in status bar |

### Commands

| Command | Description |
|---------|-------------|
| `AG Switchboard: Refresh Quota` | Manually trigger a quota refresh |
| `AG Switchboard: Add Account` | Add via Google OAuth |
| `AG Switchboard: Add Account via Token` | Add by pasting a refresh token |
| `AG Switchboard: Collect Accounts from Email List` | Open OAuth for each email and add accounts directly |
| `AG Switchboard: Import Accounts from Token File` | Bulk import accounts from `refresh_token` or `email|refresh_token` lines |
| `AG Switchboard: Remove Account` | Remove a tracked account |
| `AG Switchboard: Open Usage Statistics` | Open the full usage dashboard |
| `AG Switchboard: Fix Missing Conversations` | Detect and fix orphaned conversations |

### Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| Refresh interval | Set via header buttons (30s / 1m / 2m / 5m) | `1m` |
| Pinned model | Click â˜† on any model row | none |
| Status bar models | Toggle â— switch on each model | off |
| `ag-switchboard.modelPricing` | Per-model pricing for cost estimation (per 1M tokens) | Built-in defaults |

---

## ðŸ”’ Privacy & Security

- **OAuth tokens** stored in VS Code's encrypted `SecretStorage` (macOS Keychain / Windows Credential Store / Linux libsecret)
- Quota data fetched directly from Google's Antigravity API using your own credentials
- Token budget, context window, and workspace context read from the **local** Language Server â€” no network requests leave your machine
- Usage stats aggregated from local conversation data on disk
- **No telemetry. No external servers. All data stays local.**

---

## ðŸ› Troubleshooting

| Issue | Fix |
|-------|-----|
| **"Request timed out"** on a tracked account | Remove and re-add the account to refresh OAuth tokens |
| **"Server Not Found"** | Ensure the Antigravity Language Server is running. Tracked account quotas work independently |
| **Account switch not reflected** | The panel watches for changes automatically. If delayed, click â†º |
| **Context window empty** | The Dual-LS discovery may need a moment. Click Refresh or wait for auto-sync |
| **Windows: token budget not showing** | Ensure LS is running. The extension uses PowerShell for process discovery |
| **Missing conversations** | The Conversation Guard auto-detects this. Click "Fix Now" in the warning banner, or run `AG Switchboard: Fix Missing Conversations` from the command palette |

---

## ðŸ“ Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

---

## ðŸ“„ License

MIT Â© [Eren](https://github.com/erennyuksell) â€” see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built for the Antigravity IDE ecosystem.<br/>
  Made with â˜• by <a href="https://github.com/erennyuksell">Eren</a>
</p>

