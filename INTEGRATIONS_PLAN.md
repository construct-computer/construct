# Integrations Roadmap

> Priority-ordered implementation plan for external service integrations.
> Generated from codebase analysis of `redo/` and `production/` projects.

---

## Priority Order

| # | Integration | Effort | Why this order |
|---|-------------|--------|----------------|
| 1 | **TinyFish API** | Small | Marked IMPORTANT. Gives the agent reliable web scraping without captchas. Foundational — every other integration benefits from robust web access. Simplest to implement (API wrapper). |
| 2 | **Google Drive** | Medium | Already built in `../production/`. Port, don't rebuild. Gives users persistent file storage that survives container restarts. |
| 3 | **Email (AgentMail)** | Medium | Unlocks external communication — the agent can send messages, receive replies, sign up for services. Required for crypto (exchange signups). BYOK model (user provides AgentMail API key). |
| 4 | **Telegram** | Medium | Config fields already exist in `boneclaw.yaml`. Real-time alerts + remote commands from trusted users. BYOK (user provides bot token). |
| 5 | **Slack** | Medium | Same architecture as Telegram. For business users who want alerts/commands in Slack instead. |
| 6 | **Crypto Wallets** | Large | Most complex, highest security risk. Self-custody (agent generates keys). Depends on email being available for exchange signups. |

---

## 1. TinyFish API

**Goal:** Give the agent a `web` tool that uses TinyFish for scraping/captcha-heavy sites. The system chooses between the local browser and TinyFish based on context. Results render in the same frontend browser viewer.

**API:** `https://agent.tinyfish.ai/v1/automation/run` (sync) or `run-sse` (streaming)
**Auth:** `X-API-Key` header. BYOK — user provides their TinyFish API key in Settings.
**Docs:** https://docs.tinyfish.ai/llms.txt

### Implementation Steps

#### 1.1 Backend: Store TinyFish API Key
- Add `tinyfish_api_key` to the `agent_configs` table (or reuse the encrypted key storage pattern from OpenRouter keys)
- Add `tinyfish` section to `boneclaw.yaml` template:
  ```yaml
  tinyfish:
    api_key: ""
  ```
- Extend `PUT /api/instances/:id/agent/config` in `backend/src/routes/instances.ts` to accept and persist `tinyfishApiKey`
- Write the key into the container's boneclaw config YAML on save

#### 1.2 Frontend: Settings UI
- Add "TinyFish API Key" field to the API Keys section in `SettingsWindow.tsx` (same pattern as OpenRouter key)
- Show masked key + connection status

#### 1.3 Boneclaw: `web` Tool
- Create `boneclaw/src/tools/web.ts` — new tool that wraps the TinyFish sync API
- Tool definition:
  ```
  web(url: string, goal: string, options?: { stealth?: boolean, proxy?: string })
  ```
- Implementation: `POST https://agent.tinyfish.ai/v1/automation/run` with:
  - `url` — target URL
  - `goal` — natural language instruction (e.g. "Extract all product prices")
  - `stealth: true` for anti-bot sites
- Read API key from boneclaw config (`config.tinyfish.api_key`)
- Returns structured result (TinyFish returns JSON in `resultJson`)
- Register in `boneclaw/src/tools/registry.ts`
- Add `web` to `boneclaw.yaml` `tools.enabled` list

#### 1.4 Smart Routing (Browser vs TinyFish)
- Update the agent's system prompt in `boneclaw.yaml` to explain when to use `web` vs `browser_*`:
  - Use `web` (TinyFish) for: scraping data, captcha-protected sites, rate-limited sites, sites that block headless browsers
  - Use `browser_*` (local) for: interactive browsing the user is watching, multi-step workflows with visual feedback, any site that works fine locally
- The LLM decides based on context — no hard routing rules needed

#### 1.5 Results in Frontend Browser
- When `web` tool returns HTML content or screenshots, pipe the result through the browser viewer:
  - Option A: Write result to a temp HTML file in the container workspace, then `browser_navigate` to it
  - Option B: Return the result as tool output text (simpler, the agent can summarize)
- For now, start with Option B (text results). Enhance to Option A later if visual rendering is needed.

#### Files to modify:
- `container/boneclaw.yaml` — add tinyfish config section
- `boneclaw/src/tools/web.ts` — **new file**
- `boneclaw/src/tools/registry.ts` — register web tool
- `boneclaw/src/config/index.ts` — add tinyfish config schema
- `backend/src/routes/instances.ts` — extend config API for tinyfish key
- `frontend/src/components/apps/SettingsWindow.tsx` — add TinyFish key field

---

## 2. Google Drive

**Goal:** Persistent cloud file storage integrated into the file explorer. Users connect their Google Drive, browse files in a "Cloud" tab, and copy/sync files between the container and Drive.

**Reference:** Fully implemented in `../production/`. Port the backend service + sync engine + frontend hooks.

### Implementation Steps

#### 2.1 Backend: Drive Service
- Port `production/apps/backend/src/drive-service.ts` to `backend/src/services/drive-service.ts`
  - OAuth2 flow (consent URL generation, callback handler, token exchange)
  - Token refresh with encrypted storage
  - CRUD: listFiles, readFile, downloadFile, uploadFile, createFolder, deleteFile
  - Auto-create `ConstructWorkspace` folder on first access
- Dependencies: add `googleapis` and `google-auth-library` to `backend/package.json`

#### 2.2 Backend: Drive Sync Engine
- Port `production/apps/backend/src/drive-sync.ts` to `backend/src/services/drive-sync.ts`
  - Two-way sync: compare by relative path + modified time
  - Newer file wins, container wins on conflict
  - Returns sync report (downloaded, uploaded, conflicts)

#### 2.3 Database: Token Storage
- Add `drive_tokens` table to `backend/src/db/schema.ts`:
  ```sql
  CREATE TABLE IF NOT EXISTS drive_tokens (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    access_token TEXT NOT NULL,    -- encrypted
    refresh_token TEXT NOT NULL,   -- encrypted
    expiry TEXT,
    email TEXT,
    last_sync TEXT
  )
  ```
- Add CRUD functions in `backend/src/db/client.ts`

#### 2.4 Backend: Drive API Routes
- Create `backend/src/routes/drive.ts` with these endpoints (port from production):
  - `GET /api/drive/configured` — check if Google creds are set
  - `GET /api/drive/auth-url` — get OAuth consent URL
  - `GET /api/drive/callback` — OAuth redirect handler
  - `GET /api/drive/status` — connection status + email + last sync
  - `DELETE /api/drive/disconnect` — revoke token
  - `GET /api/drive/files` — list files in folder
  - `GET /api/drive/files/:fileId/content` — read file as text
  - `GET /api/drive/files/:fileId/download` — download binary
  - `POST /api/drive/upload` — upload file
  - `POST /api/drive/mkdir` — create folder
  - `DELETE /api/drive/files/:fileId` — trash file
  - `POST /api/instances/:id/drive/copy-to-drive` — container -> Drive
  - `POST /api/instances/:id/drive/copy-to-local` — Drive -> container
  - `POST /api/instances/:id/drive/sync` — full two-way sync
- Register in `backend/src/index.ts`

#### 2.5 Environment Config
- Add to `backend/src/config.ts`:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REDIRECT_URI` (defaults to `{API_BASE}/api/drive/callback`)
- Add to `docker-compose.yml` environment section

#### 2.6 Frontend: Drive Hooks
- Port `production/apps/web/src/hooks/useDriveSync.ts` to `frontend/src/hooks/useDriveSync.ts`
  - `connect()`, `disconnect()`, `sync()`, `status`, `isConfigured`
- Port `production/apps/web/src/hooks/useDriveFiles.ts` to `frontend/src/hooks/useDriveFiles.ts`
  - Mirrors `useContainerFiles` API for browsing Drive

#### 2.7 Frontend: File Explorer Integration
- Modify `FilesWindow.tsx`:
  - Add sidebar toggle: "Local Storage" / "Google Drive"
  - When "Cloud" is selected, use `useDriveFiles` hook for all operations
  - Add "Copy to Drive" / "Copy to Local" actions in context menu
  - Add "Sync" button in toolbar
- Add Google Drive section to `SettingsWindow.tsx`:
  - Connect/disconnect button
  - Shows connected email
  - Manual sync trigger + last sync timestamp

#### Files to create:
- `backend/src/services/drive-service.ts`
- `backend/src/services/drive-sync.ts`
- `backend/src/routes/drive.ts`
- `frontend/src/hooks/useDriveSync.ts`
- `frontend/src/hooks/useDriveFiles.ts`

#### Files to modify:
- `backend/src/db/schema.ts` — drive_tokens table
- `backend/src/db/client.ts` — token CRUD
- `backend/src/services.ts` — instantiate DriveService, DriveSync
- `backend/src/index.ts` — mount drive routes
- `backend/src/config.ts` — Google env vars
- `backend/package.json` — googleapis dependency
- `docker-compose.yml` — env vars
- `frontend/src/components/apps/FilesWindow.tsx` — cloud tab
- `frontend/src/components/apps/SettingsWindow.tsx` — Drive settings
- `frontend/src/services/api.ts` — Drive API functions

---

## 3. Email (AgentMail)

**Goal:** The agent gets its own email address and can send/receive email. Users provide their AgentMail API key (BYOK). The agent can use email for communication, signups, and receiving verification codes.

**API:** `https://api.agentmail.to/v1/` — REST API
**Auth:** `Authorization: Bearer <api_key>` header. BYOK.
**Docs:** https://docs.agentmail.to/llms.txt

### Implementation Steps

#### 3.1 Backend: Store AgentMail API Key
- Add `agentmail` section to `boneclaw.yaml`:
  ```yaml
  agentmail:
    api_key: ""
    inbox_id: ""   # auto-created on first use
    address: ""    # e.g. "agent-abc@agentmail.to"
  ```
- Extend `PUT /api/instances/:id/agent/config` to accept `agentmailApiKey`
- On config save, write to container's boneclaw YAML

#### 3.2 Boneclaw: Email Tools
- Create `boneclaw/src/tools/email.ts` with these tools:

  **`email_send`** — Send an email
  ```
  email_send(to: string, subject: string, body: string, reply_to_message_id?: string)
  ```
  - POST `https://api.agentmail.to/v1/inboxes/{inbox_id}/messages`

  **`email_check`** — Check inbox for new messages
  ```
  email_check(limit?: number, unread_only?: boolean)
  ```
  - GET `https://api.agentmail.to/v1/inboxes/{inbox_id}/messages`

  **`email_read`** — Read a specific message
  ```
  email_read(message_id: string)
  ```
  - GET `https://api.agentmail.to/v1/inboxes/{inbox_id}/messages/{message_id}`

  **`email_reply`** — Reply to a message
  ```
  email_reply(message_id: string, body: string)
  ```
  - POST `https://api.agentmail.to/v1/inboxes/{inbox_id}/messages/{message_id}/reply`

- Register all in `boneclaw/src/tools/registry.ts`

#### 3.3 Auto-Provision Inbox
- On first use (when API key is set but no inbox_id exists):
  - POST `https://api.agentmail.to/v1/inboxes` to create a new inbox
  - Store the returned `inbox_id` and email address in config
  - Update boneclaw.yaml with the inbox details

#### 3.4 Frontend: Settings UI
- Add "Email (AgentMail)" section to `SettingsWindow.tsx`:
  - API key input field
  - Shows provisioned email address when connected
  - "Test" button to verify the key works

#### 3.5 Frontend: Email Viewer (stretch)
- Optional: Add an "Email" desktop app window (`EmailWindow.tsx`) that shows inbox/sent messages
- Could be a simple list view with message preview
- This is a nice-to-have — the agent can operate email via tools without a dedicated UI

#### Files to create:
- `boneclaw/src/tools/email.ts`

#### Files to modify:
- `container/boneclaw.yaml` — agentmail config section
- `boneclaw/src/tools/registry.ts` — register email tools
- `boneclaw/src/config/index.ts` — agentmail config schema
- `backend/src/routes/instances.ts` — extend config API
- `frontend/src/components/apps/SettingsWindow.tsx` — email settings

---

## 4. Telegram

**Goal:** The agent sends alerts and receives commands from trusted Telegram users. Users provide their own Telegram bot token (BYOK) and configure allowed user IDs.

**Config already exists** in `boneclaw.yaml`:
```yaml
telegram:
  token: ""
  allowed_users: []
```

### Implementation Steps

#### 4.1 Boneclaw: Telegram Client
- Create `boneclaw/src/integrations/telegram.ts`:
  - Uses Telegram Bot API (`https://api.telegram.org/bot<token>/...`)
  - Long-polling via `getUpdates` (simpler than webhooks for containers)
  - Starts polling when `telegram.token` is set and non-empty
  - Filters messages to only `allowed_users` list
  - Routes incoming messages to `AgentLoop.run()` as if they were chat messages
  - Sends tool to allow the agent to proactively message Telegram

#### 4.2 Boneclaw: Telegram Tools
- Add to `boneclaw/src/tools/telegram.ts`:

  **`telegram_send`** — Send a message to a Telegram user
  ```
  telegram_send(user_id: string, message: string, parse_mode?: "Markdown" | "HTML")
  ```
  - POST `sendMessage` to Telegram Bot API

  **`telegram_send_file`** — Send a file/image
  ```
  telegram_send_file(user_id: string, file_path: string, caption?: string)
  ```
  - POST `sendDocument` or `sendPhoto` based on file type

- Register in registry

#### 4.3 Inbound Message Handling
- When a message arrives from an allowed user:
  1. Forward to `AgentLoop.run()` with context: `"[Telegram from @username] <message>"`
  2. The agent's response text is automatically sent back to the Telegram user
  3. If the agent uses tools (browser, exec, etc.), the user sees results in the response

#### 4.4 Alert System
- Add a lightweight alert function the agent (or backend) can call:
  ```typescript
  sendAlert(level: 'info' | 'warning' | 'error', message: string)
  ```
- Examples: container reboot, long-running task complete, error in autonomous mode
- The agent's system prompt should mention it can proactively notify via Telegram

#### 4.5 Frontend: Settings UI
- Add "Telegram" section to `SettingsWindow.tsx`:
  - Bot token input
  - Allowed user IDs (comma-separated or chip input)
  - "Test Connection" button (sends a test message)
  - Status indicator (connected/polling)

#### 4.6 Backend: Config Persistence
- Extend `PUT /api/instances/:id/agent/config` to accept `telegramToken` and `telegramAllowedUsers`
- Write to container's boneclaw YAML `telegram` section
- Restart boneclaw after config change (already handled by existing rewrite flow)

#### Files to create:
- `boneclaw/src/integrations/telegram.ts`
- `boneclaw/src/tools/telegram.ts`

#### Files to modify:
- `boneclaw/src/main.ts` — start Telegram polling on init
- `boneclaw/src/tools/registry.ts` — register telegram tools
- `boneclaw/src/config/index.ts` — telegram config schema (already partially there)
- `backend/src/routes/instances.ts` — extend config API
- `frontend/src/components/apps/SettingsWindow.tsx` — Telegram settings

---

## 5. Slack

**Goal:** Same as Telegram but for Slack — alerts + inbound commands for business users. Uses Slack Bot Token (BYOK).

**API:** Slack Web API + Socket Mode (no webhook URL needed — good for containers)

### Implementation Steps

#### 5.1 Config
- Add `slack` section to `boneclaw.yaml`:
  ```yaml
  slack:
    bot_token: ""        # xoxb-...
    app_token: ""        # xapp-... (for Socket Mode)
    allowed_channels: [] # channel IDs the bot responds in
  ```

#### 5.2 Boneclaw: Slack Client
- Create `boneclaw/src/integrations/slack.ts`:
  - Uses `@slack/web-api` and `@slack/socket-mode` packages
  - Socket Mode = real-time connection without needing a public URL (perfect for containers)
  - Listens for `message` and `app_mention` events
  - Filters to `allowed_channels`
  - Routes messages to `AgentLoop.run()`
  - Sends agent responses back to the channel as threaded replies
- Dependencies: add `@slack/web-api` and `@slack/socket-mode` to `boneclaw/package.json`

#### 5.3 Boneclaw: Slack Tools
- Create `boneclaw/src/tools/slack.ts`:

  **`slack_send`** — Send a message to a Slack channel
  ```
  slack_send(channel: string, message: string, thread_ts?: string)
  ```

  **`slack_send_file`** — Upload a file to a channel
  ```
  slack_send_file(channel: string, file_path: string, title?: string)
  ```

#### 5.4 Frontend: Settings UI
- Add "Slack" section to `SettingsWindow.tsx`:
  - Bot Token input (`xoxb-...`)
  - App Token input (`xapp-...`)
  - Allowed channels list
  - Connection status

#### 5.5 Backend: Config
- Same pattern as Telegram — extend config API, write to boneclaw YAML

#### Files to create:
- `boneclaw/src/integrations/slack.ts`
- `boneclaw/src/tools/slack.ts`

#### Files to modify:
- `container/boneclaw.yaml` — slack config
- `boneclaw/src/main.ts` — start Slack socket on init
- `boneclaw/src/tools/registry.ts` — register slack tools
- `boneclaw/src/config/index.ts` — slack config schema
- `boneclaw/package.json` — Slack SDK dependencies
- `backend/src/routes/instances.ts` — config API
- `frontend/src/components/apps/SettingsWindow.tsx` — Slack settings

---

## 6. Crypto Wallets

**Goal:** The agent can generate and manage self-custody crypto wallets, hold funds, and make transactions. Private keys are stored securely inside the container.

**Scope:** Start with Ethereum (EVM chains) since they have the broadest DeFi/service ecosystem. Expand to Solana later.

### Implementation Steps

#### 6.1 Container: Install ethers.js
- Add `ethers` to the container's global npm packages (Dockerfile):
  ```dockerfile
  RUN npm install -g ethers
  ```
- Also available to boneclaw tools via require/import

#### 6.2 Boneclaw: Wallet Management Tool
- Create `boneclaw/src/tools/wallet.ts`:

  **`wallet_create`** — Generate a new HD wallet
  ```
  wallet_create(name: string, chain?: "ethereum" | "polygon" | "base")
  ```
  - Uses `ethers.Wallet.createRandom()`
  - Saves encrypted keystore JSON to `/home/sandbox/.boneclaw/wallets/<name>.json`
  - Encryption password derived from a user-provided passphrase (set in Settings)
  - Returns: address (public), NEVER returns private key in output

  **`wallet_list`** — List all wallets
  ```
  wallet_list()
  ```
  - Returns: [{name, address, chain, balance}]

  **`wallet_balance`** — Check balance
  ```
  wallet_balance(name: string)
  ```
  - Connects to public RPC (Infura/Alchemy or public endpoints)
  - Returns: ETH balance + top ERC-20 token balances

  **`wallet_send`** — Send a transaction
  ```
  wallet_send(from_wallet: string, to: string, amount: string, token?: string)
  ```
  - Requires explicit confirmation from the user (agent asks "Confirm send X ETH to 0x...?")
  - Builds, signs, and broadcasts transaction
  - Returns: transaction hash + explorer link

  **`wallet_sign`** — Sign a message (for dApp authentication)
  ```
  wallet_sign(wallet: string, message: string)
  ```

#### 6.3 Security Considerations
- **Private keys never leave the container** — stored in encrypted keystore files
- **Wallet passphrase** — user sets a passphrase in Settings, passed to container as env var
- **Transaction confirmation** — the agent's system prompt MUST instruct it to always ask for user confirmation before sending funds
- **Spending limits** — optional: config for max transaction amount per send
- **Backup** — Google Drive sync can back up encrypted keystores (requires Drive integration to be done first)

#### 6.4 Config
- Add `wallet` section to `boneclaw.yaml`:
  ```yaml
  wallet:
    enabled: false          # must be explicitly enabled
    passphrase: ""          # keystore encryption passphrase
    default_rpc:
      ethereum: "https://eth.llamarpc.com"
      polygon: "https://polygon-rpc.com"
      base: "https://mainnet.base.org"
    max_send_amount: "0.1"  # ETH, safety limit
    require_confirmation: true
  ```

#### 6.5 Frontend: Wallet UI (stretch)
- Optional `WalletWindow.tsx` desktop app:
  - Shows wallets with addresses and balances
  - QR code for receiving
  - Transaction history
  - This is a nice-to-have — the agent can manage wallets via tools alone

#### 6.6 Frontend: Settings
- Add "Crypto Wallet" section to `SettingsWindow.tsx`:
  - Enable/disable toggle
  - Wallet passphrase input
  - Custom RPC URLs (optional)
  - Max send amount safety limit

#### Files to create:
- `boneclaw/src/tools/wallet.ts`

#### Files to modify:
- `container/Dockerfile` — install ethers.js
- `container/boneclaw.yaml` — wallet config
- `boneclaw/src/tools/registry.ts` — register wallet tools
- `boneclaw/src/config/index.ts` — wallet config schema
- `backend/src/routes/instances.ts` — config API
- `frontend/src/components/apps/SettingsWindow.tsx` — wallet settings

---

## Shared Infrastructure

### Settings UI Redesign
The Settings window will grow significantly with 6 new integrations. Group into tabs:
- **AI Model** — OpenRouter key, model selection (existing)
- **Integrations** — TinyFish, Google Drive, Email, Telegram, Slack, Crypto

Use a sidebar or tab layout to keep it navigable.

### Boneclaw Config Flow (all integrations follow this)
1. User enters API key/token in Settings UI
2. Frontend calls `PUT /api/instances/:id/agent/config` with the new key
3. Backend reads current YAML from container, merges new values, writes back
4. Backend restarts boneclaw via `supervisorctl restart boneclaw`
5. Boneclaw picks up new config on startup, initializes integration

### Security
- All API keys encrypted at rest in SQLite (existing `crypto.service.ts` AES-256-GCM)
- Keys masked in API responses (existing `****<last4>` pattern)
- Wallet private keys never exposed outside the container
- Telegram/Slack filter messages to explicitly allowed users/channels
