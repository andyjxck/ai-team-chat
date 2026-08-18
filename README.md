# AI Team Chat

Your personalised AI team in a Slack-like chat app. Chat with 7 AI agents — each with a personality, role, and real tools — individually or in group chats.

## Quick start

```bash
# 1. Install deps
pnpm install

# 2. Copy env template
cp .env.example .env.local

# 3. Generate a password hash
pnpm hash-password
# Copy the output. In .env.local, set LOCAL_USER_PASSWORD_HASH
# IMPORTANT: escape $ as \$ in the hash, and wrap in double quotes:
# LOCAL_USER_PASSWORD_HASH="\$2a\$10\$abc..."

# 4. Set your email in LOCAL_USER_EMAIL

# 5. Add at least a Gemini API key (free tier):
#    https://aistudio.google.com/apikey
#    GEMINI_API_KEY=your_key_here

# 6. Generate AUTH_SECRET:
#    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 7. Push DB schema + seed
pnpm db:push && pnpm db:seed

# 8. Run
pnpm dev
# Open http://localhost:3000
# Login with your email + password
```

## Default login

- Email: whatever you set in `LOCAL_USER_EMAIL`
- Password: whatever you used with `pnpm hash-password`

## Default chats (auto-created)

- 7 DMs — one per agent (Maya, Leo, Wade, Sage, Eve, Ray, Lex)
- "All Team" — group chat with all 7 agents (@mention to address someone)

## Creating custom chats

Click "New Chat" in the sidebar. Pick a name, select agents, choose routing mode:
- **@Mentioned only**: only @mentioned agents respond
- **All members**: every agent in the chat responds to each message

## Agents

| Agent | Role | Tools |
|---|---|---|
| Maya 📱 | Social Media Manager | search, web fetch, image gen, social posting (X/LinkedIn/IG/FB), files |
| Leo 🎯 | Lead Generator | search, web fetch, CRM (leads table), files |
| Wade 🔧 | Website Builder | search, web fetch, files, code execution |
| Sage 🔍 | SEO Expert | search, web fetch, files |
| Eve 📋 | Executive Assistant | Google Calendar, Gmail, reminders, memory, files, search |
| Ray 👋 | Receptionist | contacts, memory, inter-agent messaging, reminders |
| Lex ⚖️ | Legal Assistant | search, web fetch, files, memory (always disclaims) |

## API keys needed

| Key | Where to get it | Free tier |
|---|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey | Yes (1500 req/day) |
| `SERPER_API_KEY` | https://serper.dev | Yes (2500 searches) |
| `GOOGLE_CLIENT_ID` + `SECRET` | Google Cloud Console (OAuth 2.0) | Yes |
| `X_API_KEY` etc. | https://developer.x.com | Limited free |
| `LINKEDIN_CLIENT_ID` + `SECRET` | LinkedIn Developer Portal | Yes (testing mode) |
| `INSTAGRAM_ACCESS_TOKEN` | Meta App Dashboard | Yes (testing mode) |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Meta App Dashboard | Yes (testing mode) |

Only `GEMINI_API_KEY` is required for basic chat. Other keys enable specific tools.

## Swapping LLM provider

Change `AI_MODEL_ID` in `.env.local`:
- `google/gemini-2.0-flash-exp` (default, free)
- `openai/gpt-4o-mini` (cheap)
- `groq/llama-3.3-70b` (free, fast)
- `anthropic/claude-3-5-haiku` (cheap)

Set the corresponding API key env var.

## Tech stack

- Next.js 15 (App Router) + TypeScript
- SQLite + Drizzle ORM
- Vercel AI SDK (streaming, tool use)
- NextAuth.js (credentials auth)
- Tailwind CSS + shadcn/ui
- Server-Sent Events for streaming

## Project structure

See `DESIGN.md` for the full architecture and design doc.
