# AI Team Chat — Personalised "Slack for you + your AI team"

A local-first web app where you chat with a team of AI agents, each with a distinct
personality and role. Think Slack, but your coworkers are AIs that can actually do
work for you: post to social media, send emails, manage your calendar, build
websites, generate leads, draft legal docs, and more.

---

## 1. Goals

- A personal Slack-like UI built around **chats**: individual DMs with each agent
  and group chats with selected agents.
- **Default chats (auto-created on first run):**
  - 7 individual DMs — one per agent (Maya, Leo, Sally, Sally, Evie, Evie, Lex)
  - 1 "All Team" group chat containing all 7 agents
- **Custom chats:** you can create a new chat and pick which agents are in it
  (e.g. "Marketing squad" = Maya + Sally, "Web build" = Sally + Sally + Evie).
- 7 named AI agents, each with a personality, role, and a real tool set.
- Agents can use tools to take real actions (post, email, schedule, search, code).
- @mention an agent to address them; agents can talk to each other in a group chat.
- Per-chat routing mode (configurable when creating a chat):
  - **"Only @mentioned"** — only agents you @mention respond (default for "All Team")
  - **"All members respond"** — every agent in the chat responds to each message
    (default for small focused chats; can get noisy in big groups)
- Streaming replies (you see them typing).
- Message history persisted locally.
- Runs locally on `localhost:3000`. Can be deployed later with minimal changes.
- All API keys live in `.env.local` — code is written as if keys already exist
  (placeholders in `.env.example`).

## 2. Non-goals (v1)

- Multi-tenant / many human users. v1 is single-user (you) with optional simple
  password auth. Multi-user is a later concern.
- Mobile native app. v1 is a responsive web app + installable PWA. Capacitor/Tauri
  wrapper is a later option.
- Voice / video. Text + images only for v1.

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14 (App Router) | One codebase for frontend + API routes; easy to deploy later |
| Language | TypeScript (strict) | Type safety across the whole stack |
| LLM abstraction | Vercel AI SDK | Streams replies, swaps providers with one line |
| LLM provider | Google Gemini 2.0 Flash (default) | Free tier, 1M context, good quality. Swappable to GPT-4o-mini / Groq / Claude |
| Web search | Serper.dev | 2,500 free searches, then cheap. Google results |
| Database | SQLite + Drizzle ORM | Zero-config local DB, type-safe queries |
| Auth | NextAuth.js (Credentials provider) | Single-password local auth for now |
| Realtime | Server-Sent Evients (SSE) | Simpler than WebSockets for v1, native streaming support |
| UI | Tailwind CSS + shadcn/ui | Fast, consistent, good-looking by default |
| Image gen | Pollinations.ai (default) + Gemini image gen | Pollinations is free, no key. Gemini for higher quality |
| Code exec | Sandboxed subprocess (Python/Node) with timeout + working dir isolation | For Sally (Website Builder) |
| Social posting | X API v2, LinkedIn API, Instagram Graph API, Facebook Graph API | Real posting via official APIs |
| Calendar | Google Calendar API (OAuth 2.0) | Read/create/edit events |
| Email | Gmail API (OAuth 2.0) | Read/send email |
| Package manager | pnpm | Fast, disk-efficient |

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (you)                         │
│   Next.js app — chats (DMs + groups), streaming, @mentions   │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP + SSE
┌───────────────────────────▼─────────────────────────────────┐
│                    Next.js (App Router)                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  /app pages │  │ /app/api/*   │  │  SSE streaming     │  │
│  │  (React)    │  │ (route fns)  │  │  endpoints         │  │
│  └─────────────┘  └──────┬───────┘  └────────────────────┘  │
│                          │                                  │
│  ┌───────────────────────▼────────────────────────────────┐  │
│  │              Agent Orchestrator (lib/agents)           │  │
│  │  - Routes message → which agent(s) respond             │  │
│  │  - Manages agent-to-agent turns (max N)                │  │
│  │  - Calls Vercel AI SDK with tool definitions           │  │
│  │  - Streams tokens back via SSE                         │  │
│  └───────┬────────────────────────────────────┬───────────┘  │
│          │                                    │              │
│  ┌───────▼─────────┐                ┌────────▼─────────┐     │
│  │  Tools (lib/tools)│              │  LLM (AI SDK)    │     │
│  │  - serper_search │               │  - Gemini Flash  │     │
│  │  - web_fetch     │               │  (swappable)     │     │
│  │  - calendar_*    │               └──────────────────┘     │
│  │  - gmail_*       │                                        │
│  │  - social_post_* │                                        │
│  │  - file_*, code  │                                        │
│  │  - memory, etc.  │                                        │
│  └───────┬──────────┘                                        │
│          │                                                    │
│  ┌───────▼────────────────────────────────────────────────┐  │
│  │  External APIs (via .env.local keys)                   │  │
│  │  Serper · Google Calendar · Gmail · X · LinkedIn ·     │  │
│  │  Instagram · Facebook · Pollinations · Gemini          │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  SQLite (drizzle) — messages, channels, agents,        │  │
│  │  memory, leads, contacts, reminders, files index       │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. Project structure

```
ai-team-chat/
├── .env.example                  # All required env vars (placeholders)
├── .env.local                    # Your real keys (gitignored)
├── .gitignore
├── package.json
├── pnpm-lock.yaml
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
├── drizzle.config.ts
├── DESIGN.md                     # This file
├── README.md                     # Setup + run instructions
│
├── db/
│   ├── schema.ts                 # Drizzle schema (all tables)
│   ├── client.ts                 # SQLite connection
│   └── migrations/               # Generated migrations
│
├── agents/
│   ├── config.ts                 # Agent roster: name, role, persona, tools
│   ├── personas/                 # One file per agent's system prompt
│   │   ├── maya.ts               # Social Media Manager
│   │   ├── leo.ts                # Lead Generator
│   │   ├── wade.ts               # Website Builder
│   │   ├── sage.ts               # SEO Expert
│   │   ├── eve.ts                # Executive Assistant
│   │   ├── ray.ts                # Receptionist
│   │   └── lex.ts                # Legal Assistant
│   └── orchestrator.ts           # Routes messages, manages turns, calls LLM
│
├── lib/
│   ├── llm.ts                    # Vercel AI SDK client (model from env)
│   ├── auth.ts                   # NextAuth config
│   ├── tools/                    # Tool implementations (one file per tool)
│   │   ├── index.ts              # Exports all tools, grouped by agent
│   │   ├── serper.ts             # web search
│   │   ├── web-fetch.ts          # fetch URL + extract text
│   │   ├── memory.ts             # agent notes (SQLite)
│   │   ├── files.ts              # read/write workspace files
│   │   ├── code-exec.ts          # sandboxed subprocess
│   │   ├── image-gen.ts          # Pollinations / Gemini image gen
│   │   ├── calendar.ts           # Google Calendar API
│   │   ├── gmail.ts              # Gmail API
│   │   ├── social-x.ts           # X/Twitter posting
│   │   ├── social-linkedin.ts    # LinkedIn posting
│   │   ├── social-instagram.ts   # Instagram posting
│   │   ├── social-facebook.ts    # Facebook posting
│   │   ├── leads.ts              # CRM (SQLite leads table)
│   │   ├── contacts.ts           # contact book (SQLite)
│   │   └── reminders.ts          # reminders (SQLite)
│   ├── google/                   # Google OAuth + API clients
│   │   ├── auth.ts               # OAuth 2.0 token management
│   │   └── tokens.ts             # token storage/refresh
│   └── utils.ts                  # misc helpers
│
├── app/
│   ├── layout.tsx                # Root layout, auth provider
│   ├── page.tsx                  # Redirect to /chat/all-team
│   ├── login/
│   │   └── page.tsx              # Password login
│   ├── chat/
│   │   ├── layout.tsx            # Chat shell (sidebar + main)
│   │   ├── new/
│   │   │   └── page.tsx          # Create a custom chat: pick name + agents + routing mode
│   │   └── [chatId]/
│   │       └── page.tsx          # Chat view (DM or group)
│   ├── settings/
│   │   └── page.tsx              # Agent config, persona tweaking, API key status
│   └── api/
│       ├── auth/[...nextauth]/
│       │   └── route.ts
│       ├── chats/
│       │   ├── route.ts          # GET chats, POST create chat
│       │   └── [id]/route.ts     # GET/PATCH/DELETE a chat
│       ├── messages/
│       │   └── route.ts          # GET messages by chatId
│       ├── chat/
│       │   └── route.ts          # POST message → SSE stream of agent replies
│       ├── google/
│       │   ├── connect/route.ts  # Start OAuth flow
│       │   └── callback/route.ts # OAuth callback
│       └── workspace/
│           └── [...path]/route.ts # Serve files from workspace/
│
├── components/
│   ├── ui/                       # shadcn/ui primitives
│   ├── sidebar.tsx               # Chats list (DMs + groups) + "new chat" button
│   ├── new-chat-dialog.tsx       # Pick name + agents + routing mode
│   ├── message-list.tsx          # Scrollable message history
│   ├── message-input.tsx         # Composer with @mention autocomplete
│   ├── message-bubble.tsx        # One message (human or agent)
│   ├── agent-avatar.tsx
│   ├── tool-call-card.tsx        # Renders tool calls + results inline
│   ├── streaming-text.tsx        # Renders streamed tokens
│   └── settings/
│       ├── agent-editor.tsx
│       └── key-status.tsx
│
├── workspace/                    # Agent file I/O sandbox (gitignored)
│   ├── websites/                 # Sally's output
│   ├── social-posts/             # Maya's drafted posts
│   ├── seo-reports/              # Sally's reports
│   ├── legal-docs/               # Lex's drafts
│   └── leads/                    # Leo's exports
│
└── public/
    └── avatars/                  # Agent avatar images
```

---

## 6. Data model (SQLite via Drizzle)

```
users
  id            text PK
  name          text
  email         text unique
  passwordHash  text          -- only for the local human user
  isHuman       integer       -- 1 = human, 0 = AI agent
  agentId       text          -- references agents.id if isHuman=0
  createdAt     integer

agents
  id            text PK       -- 'maya', 'leo', etc.
  name          text          -- 'Maya'
  role          text          -- 'Social Media Manager'
  avatar        text          -- path or emoji
  persona       text          -- full system prompt (editable in UI)
  tools         text          -- JSON array of tool names
  model         text          -- optional per-agent model override
  createdAt     integer
  updatedAt     integer

chats
  id            text PK
  name          text          -- 'All Team', 'Maya', 'Marketing squad'
  type          text          -- 'dm' | 'group'
  routingMode   text          -- 'mentioned_only' | 'all_members'
  isDefault     integer       -- 1 = auto-created on first run (the 7 DMs + All Team)
  createdAt     integer

chat_members                   -- which agents are in each chat
  chatId        text FK -> chats.id
  agentId       text FK -> agents.id
  PRIMARY KEY (chatId, agentId)

messages
  id            text PK
  chatId        text FK -> chats.id
  senderId      text FK -> users.id
  senderType    text          -- 'human' | 'agent'
  content       text          -- the message text
  mentions      text          -- JSON array of agent ids mentioned
  parentMessageId text        -- for threaded replies (nullable)
  toolCalls     text          -- JSON array of tool calls made during this message
  createdAt     integer

memory                          -- per-agent persistent notes
  id            text PK
  agentId       text FK -> agents.id
  key           text          -- e.g. 'user_preferences', 'lead_42'
  value         text          -- JSON
  createdAt     integer
  updatedAt     integer

leads                           -- Leo's CRM
  id            text PK
  name          text
  email         text
  phone         text
  company       text
  source        text          -- where the lead came from
  notes         text
  status        text          -- 'new', 'contacted', 'qualified', 'won', 'lost'
  createdAt     integer
  updatedAt     integer

contacts                        -- Evie's contact book
  id            text PK
  name          text
  email         text
  phone         text
  notes         text
  createdAt     integer

reminders                       -- Evie's reminders
  id            text PK
  agentId       text
  title         text
  dueAt         integer        -- unix timestamp
  done          integer
  createdAt     integer

social_posts                    -- log of posts made by Maya
  id            text PK
  platform      text          -- 'x', 'linkedin', 'instagram', 'facebook'
  content       text
  mediaUrl      text
  externalId    text          -- platform's post id
  status        text          -- 'draft', 'posted', 'failed'
  createdAt     integer

google_tokens                   -- OAuth tokens for Google APIs
  id            text PK
  accessToken   text
  refreshToken  text
  expiresAt     integer
  updatedAt     integer
```

---

## 7. Agent roster

Each agent has: id, name, role, avatar, persona (system prompt), tools.

### Maya — Social Media Manager
- **Personality**: Energetic, trend-aware, casual but on-brand. Thinks in hooks and
  engagement. Always asks about the target platform and audience before posting.
- **Tools**: `serper_search`, `web_fetch`, `image_gen`, `social_post_x`,
  `social_post_linkedin`, `social_post_instagram`, `social_post_facebook`,
  `file_write`, `memory`
- **In default chats**: her DM + "All Team"
- **System prompt outline**:
  - You are Maya, a social media manager.
  - Before posting, confirm the platform, copy, and any media with the user.
  - Draft to `workspace/social-posts/` first; only post when explicitly told to.
  - Track what's posted in the `social_posts` table.
  - Match tone to platform (LinkedIn = professional, X = punchy, Instagram = visual+hashtags).

### Leo — Lead Generator
- **Personality**: Persistent, data-driven, salesy but not pushy. Loves a pipeline.
- **Tools**: `serper_search`, `web_fetch`, `leads_create`, `leads_update`,
  `leads_list`, `memory`, `file_write`
- **In default chats**: his DM + "All Team"
- **System prompt outline**:
  - You are Leo, a lead generator.
  - Find prospects via search, enrich with web_fetch, save to the leads table.
  - Never fabricate contact info — only save what you can verify from a source.
  - Summarise pipeline status on request.

### Sally — Website Builder
- **Personality**: Practical, detail-oriented, ships fast. Talks in components and
  file paths. Asks clarifying questions about scope before building.
- **Tools**: `serper_search`, `web_fetch`, `file_read`, `file_write`,
  `code_exec`, `memory`
- **In default chats**: his DM + "All Team"
- **System prompt outline**:
  - You are Sally, a website builder.
  - Write files to `workspace/websites/<project>/`.
  - Use `code_exec` to run build commands and verify output.
  - Prefer modern, minimal stacks (Next.js, Tailwind) unless told otherwise.
  - Show the user the file tree and a preview plan before writing lots of files.

### Sally — SEO Expert
- **Personality**: Analytical, patient, evidence-based. Cites sources. Thinks in
  keywords, intent, and search volume.
- **Tools**: `serper_search`, `web_fetch`, `file_write`, `memory`
- **In default chats**: her DM + "All Team"
- **System prompt outline**:
  - You are Sally, an SEO expert.
  - Use Serper to check rankings and research keywords.
  - Use web_fetch to audit on-page SEO of a URL.
  - Write reports to `workspace/seo-reports/`.
  - Always cite the source URL for any data point.

### Evie — Executive Assistant
- **Personality**: Calm, organised, anticipates needs. Concise. Proactive about
  reminders and follow-ups.
- **Tools**: `calendar_list`, `calendar_create`, `calendar_update`,
  `calendar_delete`, `gmail_send`, `gmail_search`, `gmail_read`,
  `reminder_create`, `reminder_list`, `memory`, `file_read`, `serper_search`
- **In default chats**: her DM + "All Team"
- **System prompt outline**:
  - You are Evie, an executive assistant.
  - Manage the user's calendar and email via Google APIs.
  - Create reminders for follow-ups.
  - Summarise emails and propose replies; never send without confirmation unless
    told to auto-send.
  - Keep notes in memory about the user's preferences.

### Evie — Receptionist
- **Personality**: Friendly, welcoming, efficient. First point of contact. Routes
  requests to the right agent.
- **Tools**: `contacts_create`, `contacts_search`, `memory`,
  `message_agent` (forward to another agent), `reminder_create`
- **In default chats**: his DM + "All Team"
- **System prompt outline**:
  - You are Evie, a receptionist.
  - Greet incoming requests, figure out who should handle them, and forward.
  - Maintain the contact book.
  - Take messages when the user is "away".

### Lex — Legal Assistant
- **Personality**: Cautious, precise, cites sources. Always disclaims. Never gives
  definitive legal advice — frames as information for review by a qualified lawyer.
- **Tools**: `serper_search`, `web_fetch`, `file_read`, `file_write`, `memory`
- **In default chats**: his DM + "All Team"
- **System prompt outline**:
  - You are Lex, a legal assistant — NOT a lawyer.
  - Always include the disclaimer: "I'm an AI, not your lawyer. This is
    information, not legal advice. Consult a qualified attorney for your situation."
  - Cite source URLs for any legal claim.
  - Draft documents to `workspace/legal-docs/` for human review.

---

## 8. Tools catalog

Each tool is a function the LLM can call. Implemented with the Vercel AI SDK's
`tool()` helper. Tools return structured results that get fed back to the LLM and
also rendered inline in the chat UI.

### Search & web
- **`serper_search(query, num?)`** — Serper.dev Google search. Returns titles,
  URLs, snippets. Env: `SERPER_API_KEY`.
- **`web_fetch(url)`** — Fetches a URL, extracts readable text (using
  `@mozilla/readability` + a fetch). No key needed.

### Memory
- **`memory_save(agentId, key, value)`** — persist a note.
- **`memory_load(agentId, key?)`** — recall notes.
- **`memory_delete(agentId, key)`** — forget a note.

### Files
- **`file_read(path)`** — read a file under `workspace/`.
- **`file_write(path, content)`** — write a file under `workspace/`.
- **`file_list(path?)`** — list files under `workspace/`.

### Code execution
- **`code_exec(language, code)`** — run Python or Node in a sandboxed subprocess
  with a timeout (default 30s), working dir under `workspace/`, no network by
  default (configurable). Returns stdout/stderr/exit code.

### Image generation
- **`image_gen(prompt, width?, height?)`** — Pollinations.ai (free, no key) by
  default. Optional Gemini image gen if `GEMINI_API_KEY` set and quality needed.
  Returns a URL saved under `workspace/social-posts/media/`.

### Google Calendar
- **`calendar_list(timeMin, timeMax, maxResults?)`** — list events.
- **`calendar_create(summary, start, end, attendees?, description?)`** — create event.
- **`calendar_update(eventId, fields)`** — update event.
- **`calendar_delete(eventId)`** — delete event.
- OAuth 2.0 via Google. Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI`. Tokens stored in `google_tokens` table, auto-refreshed.

### Gmail
- **`gmail_send(to, subject, body, cc?, bcc?)`** — send email.
- **`gmail_search(query, maxResults?)`** — search inbox.
- **`gmail_read(messageId)`** — read a message.
- Same Google OAuth as calendar (scope includes gmail.send + gmail.readonly).

### Social posting
- **`social_post_x(text, mediaUrl?)`** — X API v2. Env: `X_API_KEY`,
  `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`.
- **`social_post_linkedin(text, mediaUrl?)`** — LinkedIn API. Env:
  `LINKEDIN_ACCESS_TOKEN` (OAuth 2.0, refresh flow in `lib/tools/social-linkedin.ts`).
- **`social_post_instagram(caption, mediaUrl)`** — Instagram Graph API. Env:
  `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`. Requires a public
  image URL (we serve from `workspace/` via the `/api/workspace` route or upload
  to a host).
- **`social_post_facebook(text, mediaUrl?)`** — Facebook Graph API. Env:
  `FACEBOOK_PAGE_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID`.

All social posts log to the `social_posts` table with status + external id.

### CRM / contacts / reminders
- **`leads_create`, `leads_update`, `leads_list`** — Leo's CRM (SQLite).
- **`contacts_create`, `contacts_search`** — Evie's contact book (SQLite).
- **`reminder_create`, `reminder_list`** — Evie's reminders (SQLite).

### Inter-agent
- **`message_agent(agentId, message)`** — Evie (or any agent) can send a message
  to another agent in a channel, triggering that agent to respond. Implemented by
  inserting a message and invoking the orchestrator for the target agent.

---

## 9. API routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/[...nextauth]` | NextAuth handler |
| GET | `/api/chats` | List all chats (DMs + groups) |
| POST | `/api/chats` | Create a custom chat (name + agentIds + routingMode) |
| GET/PATCH/DELETE | `/api/chats/[id]` | Get / rename / delete a chat |
| GET | `/api/messages?chatId=` | Fetch message history (paginated) |
| POST | `/api/chat` | Send a message; returns SSE stream of agent replies + tool calls |
| GET | `/api/agents` | List agents + config |
| PATCH | `/api/agents/[id]` | Update agent persona/tools (settings page) |
| GET | `/api/workspace/[...path]` | Serve a file from `workspace/` (for media URLs etc.) |
| GET | `/api/google/connect` | Start Google OAuth flow |
| GET | `/api/google/callback` | OAuth callback, store tokens |
| GET | `/api/health` | Liveness + which API keys are configured (boolean only, never the key) |

### `/api/chat` SSE stream format
Each SSE event is one of:
- `{"type":"token","agentId":"maya","text":"..."}` — streamed token
- `{"type":"tool_call","agentId":"maya","tool":"serper_search","args":{...}}`
- `{"type":"tool_result","agentId":"maya","tool":"serper_search","result":{...}}`
- `{"type":"message_end","agentId":"maya","messageId":"..."}`
- `{"type":"agent_start","agentId":"leo"}` — when another agent starts replying
- `{"type":"error","message":"..."}`

---

## 10. Orchestrator logic

When a human message arrives in a chat:
1. Load the chat's members (which agents are in it) and its `routingMode`.
2. Parse @mentions → list of addressed agent ids.
3. Decide who responds:
   - **DM chat** (`type='dm'`): the single member agent always responds. No routing.
   - **Group chat, `routingMode='mentioned_only'`**: only @mentioned agents respond.
     If no @mention, no agent responds (the UI hints "mention someone to get a reply").
   - **Group chat, `routingMode='all_members'`**: every agent in the chat responds
     (in sequence, oldest-defined-agent first, or in parallel — configurable).
4. For each responding agent:
   a. Build the prompt: persona + recent chat history + the new message + which
      other agents are present (so it knows who it's talking alongside).
   b. Call the Vercel AI SDK `streamText` with the agent's tools.
   c. Stream tokens + tool calls back via SSE.
   d. If the agent calls `message_agent`, enqueue a follow-up turn for that agent
      (subject to a max-turns-per-message limit, default 6, to prevent loops).
5. Persist all agent messages + tool calls to the `messages` table.

### Default chat seeding (first run)
On first boot (empty `chats` table), seed:
- 7 DM chats: one per agent, named after the agent (e.g. "Maya"), `type='dm'`,
  member = that agent.
- 1 group chat: "All Team", `type='group'`, `routingMode='mentioned_only'`,
  members = all 7 agents.

---

## 11. Auth

- NextAuth.js with the Credentials provider.
- Single user: email + password set via env (`LOCAL_USER_EMAIL`,
  `LOCAL_USER_PASSWORD_HASH` — bcrypt hash).
- Sessions are JWT-based (no DB session store needed for single user).
- Google OAuth tokens are stored separately in the `google_tokens` table and are
  per-user (just you). The `/api/google/connect` flow runs after you're logged in.

---

## 12. `.env.example` (placeholder template)

```bash
# ─── App ───
AUTH_SECRET=replace_with_random_32_char_string
LOCAL_USER_EMAIL=you@example.com
LOCAL_USER_PASSWORD_HASH=replace_with_bcrypt_hash

# ─── LLM (Vercel AI SDK) ───
# Default provider: Google Gemini. Swap by changing AI_MODEL_ID + the provider client in lib/llm.ts
GEMINI_API_KEY=replace_with_gemini_key
# Optional alternatives (uncomment to use):
# OPENAI_API_KEY=replace_with_openai_key
# ANTHROPIC_API_KEY=replace_with_anthropic_key
# GROQ_API_KEY=replace_with_groq_key
AI_MODEL_ID=google/gemini-2.0-flash-exp   # or openai/gpt-4o-mini, groq/llama-3.3-70b, etc.

# ─── Web search ───
SERPER_API_KEY=replace_with_serper_key

# ─── Google Calendar + Gmail (OAuth 2.0) ───
GOOGLE_CLIENT_ID=replace_with_google_client_id
GOOGLE_CLIENT_SECRET=replace_with_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback

# ─── X / Twitter ───
X_API_KEY=replace_with_x_api_key
X_API_SECRET=replace_with_x_api_secret
X_ACCESS_TOKEN=replace_with_x_access_token
X_ACCESS_TOKEN_SECRET=replace_with_x_access_token_secret

# ─── LinkedIn ───
LINKEDIN_CLIENT_ID=replace_with_linkedin_client_id
LINKEDIN_CLIENT_SECRET=replace_with_linkedin_client_secret
LINKEDIN_REDIRECT_URI=http://localhost:3000/api/linkedin/callback

# ─── Instagram (Graph API) ───
INSTAGRAM_ACCESS_TOKEN=replace_with_instagram_access_token
INSTAGRAM_BUSINESS_ACCOUNT_ID=replace_with_instagram_business_account_id

# ─── Facebook (Graph API) ───
FACEBOOK_PAGE_ID=replace_with_facebook_page_id
FACEBOOK_PAGE_ACCESS_TOKEN=replace_with_facebook_page_access_token

# ─── Image gen (optional — Pollinations needs no key) ───
# GEMINI_API_KEY above is reused for Gemini image gen

# ─── Paths ───
WORKSPACE_DIR=./workspace
DB_PATH=./db/local.db
```

---

## 13. Build sequence

Evien though everything is v1, the build is sequenced so we always have something
working end-to-end:

1. **Scaffold**: Next.js + Tailwind + shadcn/ui + Drizzle + SQLite + NextAuth.
   `.env.example` + `.env.local` with placeholders. App boots, login works.
2. **Core chat**: 2 agents (Evie + Maya), their DMs + 1 group chat, streaming
   replies, message history persisted. No tools yet — proves the orchestrator +
   SSE + DB + chat routing.
3. **All 7 agents + default chat seeding (7 DMs + "All Team") + @mentions +
   custom chat creation UI.**
4. **Tool framework**: `serper_search` + `web_fetch` + `memory` + `files` for all
   agents that need them.
5. **Code exec + image gen** (Sally + Maya).
6. **CRM / contacts / reminders** (Leo + Evie + Evie).
7. **Google OAuth flow + Calendar + Gmail** (Evie).
8. **Social posting**: X, LinkedIn, Instagram, Facebook (Maya).
9. **Settings page**: edit agent personas/tools, see which keys are configured.
10. **Polish**: PWA manifest, mobile responsive, avatars, tool-call UI cards.

---

## 14. Setup (will be in README.md)

```bash
# 1. Install deps
pnpm install

# 2. Copy env template and fill in keys
cp .env.example .env.local
# edit .env.local with your real keys

# 3. Generate the local user password hash
pnpm hash-password    # helper script, prompts for password, prints bcrypt hash

# 4. Push DB schema
pnpm db:push

# 5. Run dev server
pnpm dev
# open http://localhost:3000
```

---

## 15. Known limitations & risks

- **Instagram/Facebook posting** requires a Meta app with review for public posts.
  For personal/testing use, you can use a developer-mode app + test users. I'll
  code it to work with whatever tokens you provide and surface clear errors if
  permissions are missing.
- **LinkedIn posting** requires the `w_member_social` scope and a verified app
  for public posts; developer mode works for testing on your own profile.
- **X API free tier** allows posting (1,500 posts/month at time of writing) but
  limited read. Fine for Maya's use case.
- **Google OAuth** requires a Google Cloud project with Calendar + Gmail scopes.
  I'll walk you through creating one. For personal use you can keep the app in
  "testing" mode with your own email as a test user — no verification needed.
- **Code execution** is sandboxed (subprocess + timeout + working dir) but is
  still local execution. Sally runs code on your machine. We restrict network by
  default and cap memory/CPU. Don't let Sally run untrusted code from the web
  without review.
- **Legal Assistant** always disclaims; UI also shows a persistent disclaimer in
  `#legal`.
- **Cost**: Gemini 2.0 Flash free tier covers ~1500 req/day. Serper covers 2,500
  searches/month free. Social APIs have their own free tiers. Real costs only
  appear if you swap to paid LLMs or exceed free tiers.
