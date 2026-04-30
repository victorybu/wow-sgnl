# Signal — Roadmap (next 2 weeks)

## Operating principles

- Internal-only tool. No client will ever see this. Optimize for operator velocity, not polish.
- **Strict rule: NO push notifications. NO emails. NO inbound interruptions.** Every "alert" or "you should know" surface must be PULL-based — visible only when I open Signal, never delivered to me elsewhere.

## Goals over 2 weeks

- Onboard **Drift** as a 2nd drafting client + **Polymarket** as a 1st intelligence-mode client
- Voice loop tightens enough that Khanna drafts ship with **<10% edit rate by week 2**
- **15 shipped Khanna posts** feeding back into voice_examples
- **~150–300 historical Khanna gold tweets** seeded into voice_examples (auto-imported by engagement performance, not manual)
- Score 7+ becomes rare again (top **5–10%** of events, not 30%)
- Mobile PWA so I can triage from phone

## Pace target

- Items 1–3 by end of weekend
- Items 4–6 by end of week 1
- Items 7–9 by end of week 2

## How Claude Code works from this backlog

Every session:

1. Read `/wowsgnl-work/BACKLOG.md`
2. Find next item with status `queued` or `in-progress`
3. If nothing in progress, pick the top queued item and flip to `in-progress` with today's date
4. Build it
5. Mark `shipped` with today's date when verified
6. **PAUSE** and ask me to verify before moving on

I add items via the GitHub mobile editor or laptop anytime — Claude picks them up next session.

---

## Build order & status

- [x] **Item 1 — Multi-client with modes (foundation)** — `in-progress` since 2026-04-30
- [ ] Item 2 — Recalibrate scoring — `queued`
- [ ] Item 3 — Auto-seed voice from historical performance — `queued`
- [ ] Item 4 — Automated engagement capture post-ship — `queued`
- [ ] Item 5 — Mobile PWA — `queued`
- [ ] Item 6 — Topic clustering on Top Picks — `queued`
- [ ] Item 7 — Anti-voice examples — `queued`
- [ ] Item 8 — Intelligence-mode briefing page — `queued`
- [ ] Item 9 — Standing Brief on homepage — `queued`

---

## Item 1 — Multi-client with modes (foundation)

Status: `in-progress` (started 2026-04-30)

Add a `mode` column to the `clients` table: `'drafting' | 'intelligence'`.

- **Khanna** = drafting mode (current behavior preserved)
- **Drift** = drafting mode (new client, separate voice profile, watchlist will come later)
- **Polymarket** = intelligence mode (no drafting; just monitoring + briefing)

### UI changes

- **Client switcher** in top nav (dropdown showing all clients, current selection persisted via cookie)
- All existing pages scope by current client: `/`, `/triage`, `/drafts`, `/ratings`, `/voice`, `/watchlist`
- For intelligence-mode clients, hide drafting controls:
  - No "Generate angles" buttons
  - `/drafts` shows "Not applicable for intelligence-mode client"
  - No `/voice` page (redirects)
  - Event card shows **"Add to briefing"** instead of "Draft posts"
  - New page `/briefing` (built in Item 8 — stub for now)

Don't break the current Khanna setup. After this item, switching to Khanna in the dropdown should look identical to current UX.

### Verification

Add Drift as a placeholder drafting client (no voice_profile yet, empty watchlist). Add Polymarket as an intelligence-mode placeholder. Show: dropdown working + intelligence-mode UI hides drafting controls.

---

## Item 2 — Recalibrate scoring (fix the 7+ inflation)

Status: `queued`

Current state: 30+ events scored 7+ in a single day. That's noise — 7+ should be rare and meaningful.

### Rewrite the scoring prompt with a harder rubric

- **9–10:** Drop everything to respond NOW. Once-a-month event for this principal.
- **7–8:** Worth drafting against today. Should happen 2–5x per week max.
- **5–6:** On-topic but not urgent. Reference material.
- **3–4:** Tangentially relevant.
- **0–2:** Not for this principal.

### Anti-criteria

- Penalize generic political content (-2)
- Penalize stale takes / news older than 24h (-2)
- Penalize content from low-credibility messengers regardless of topic (-1)
- Reward proximity to principal's named priority topics (+2)
- Reward time-sensitivity (breaking news within 4h: +1)

### After deploying

- Reset `relevance_score=NULL` on all events from past 48h
- Re-run scoring on the backlog
- Show the new score distribution: how many 9s, 8s, 7s, 6s, etc.
- Target: 9–10 = <1%, 7–8 = ~5%, 5–6 = ~15%, rest below 5

### Verification

Show the score histogram before and after. If 7+ is still >10% of events, tighten further and re-run.

---

## Item 3 — Auto-seed voice from historical performance

Status: `queued`

Don't make me manually import tweets — pull Khanna's history via twitterapi.io and auto-seed `voice_examples` based on actual engagement performance.

### Build `/voice/seed` page

1. Input: `client_id` (current selected) + X handle (e.g. `@RepRoKhanna`) + how many pages back to fetch (default 50 pages = ~1000 tweets)
2. Hit twitterapi.io `/twitter/user/tweets`, paginate cursor-based, store all results
3. Filter:
   - Drop retweets (`is_retweet=true`)
   - Drop replies (content starts with `@`)
   - Keep original tweets + quote tweets
   - Drop tweets older than 18 months (voice drifts over time)
4. Calculate **engagement velocity** per tweet: `(like_count + 2*retweet_count + 0.5*reply_count) / hours_since_post` — capped at 168h to avoid normalizing very recent tweets unfairly. Compute median.
5. **Auto-classify** into voice_examples weights:
   - Top 5% by velocity → `weight=3` (gold)
   - Top 5–25% → `weight=2` (boosted, default canon)
   - 25–50% → `weight=1` (canon, low priority)
   - Bottom 50% → **SKIP** (don't import — these aren't gold-standard voice)
6. For each imported tweet, in a single batched Anthropic call (chunk of 20–30 tweets), tag with style descriptors: `anaphora / naming / attack / framing / calibrated-length / narrative / contrarian / multi-issue`. Store in `voice_examples.notes`.
7. Insert all into `voice_examples` with `source='auto_canon'`, `engagement_24h=JSONB({likes, retweets, replies, quotes})`, `context=NULL`, `angle=NULL`, `content=tweet text`, `original_draft=NULL`.
8. Show progress UI as it runs (page X of Y, Z tweets imported, A skipped).

### Schema additions to `voice_examples`

- `engagement_24h JSONB`
- `source` can now be `'manual_canon' | 'auto_canon' | 'shipped_post' | 'rejected_angle'` (rejected_angle for Item 7)

### Verification

I run it for `@RepRoKhanna` with default settings, ~150–300 tweets land in voice_examples with weights distributed properly, `/voice` shows them, composeVoiceBlock disclosure shows top 8 by weight injected into the prompt.

---

## Item 4 — Automated engagement capture post-ship

Status: `queued`

When I mark a post variant shipped, capture engagement automatically.

### Schema additions to `voice_examples`

- `shipped_tweet_id TEXT`
- `engagement_24h JSONB ({likes, retweets, replies, quotes, impressions})`
- `engagement_7d JSONB`
- `engagement_fetched_at TIMESTAMP`

### Workflow

- When I click "Mark shipped" on a post variant, prompt me with "Paste shipped tweet URL or ID"
- Parse the tweet ID from the URL
- Schedule fetches at +24h and +7d via twitterapi.io
- Store results in `voice_examples.engagement_24h / engagement_7d`

### Daily cron at 9am ET

Walk `voice_examples WHERE shipped_tweet_id IS NOT NULL AND engagement is older than 24h or 7d`, fetch fresh engagement, update.

### Auto-weight adjustment based on engagement (works for `shipped_post` AND `auto_canon`)

- If 24h engagement > 2x median for the principal's account → auto-boost weight from 2 to 3 (gold)
- If 24h engagement < 0.25x median → auto-set weight=1 (canon, not boosted)
- **Never auto-set weight=0** — only I can exclude

Show on `/voice`: each example card displays engagement metrics + auto-weight reasoning ("auto-boosted to gold: 4.2x median engagement").

### Verification

I ship one test post, paste URL, after 24h engagement appears on the voice example card. Auto-canon imports from Item 3 also get re-checked here.

---

## Item 5 — Mobile PWA

Status: `queued`

Make Signal installable as a PWA on iPhone home screen so I can triage from phone in spare moments.

### Build

- `manifest.json`: name, icons (180/192/512), `theme_color`, `background_color`, `display: standalone`, `start_url: /triage`
- Viewport meta tag for iOS
- `apple-touch-icon` link tags
- Service worker for offline shell (cache `/triage` page shell so it loads instantly on bad mobile network)
- Optimize `/triage` for mobile:
  - Larger touch targets on the 3 buttons (44pt minimum)
  - Native swipe gestures: swipe left = noise, swipe right = signal, swipe down = skip
  - Haptic feedback via `navigator.vibrate` on each action (10ms pulse)
  - Bottom-anchored buttons (thumb-reachable)
  - Hide the homepage stats bar on mobile triage — focus is one card

### Verification

I install on my iPhone, open `/triage` from home screen, can rate 20 cards comfortably with thumb only.

---

## Item 6 — Topic clustering on Top Picks

Status: `queued`

Currently if 5 watchers post about the same news, Top Picks shows 5 redundant cards.

### Implementation

Before rendering Top Picks:
- Group score≥7 events from last 6h into clusters via a single Anthropic call
- Send all qualifying events with their content + author
- Anthropic returns clusters: `[{cluster_topic, primary_event_id, related_event_ids}]`
- Render one card per cluster, with the primary event's content + a small "+3 from @author2, @author3" expansion below

Cache the clustering result for 30 min to avoid re-clustering on every refresh. Re-cluster only when new score≥7 events come in.

### Verification

When 3+ accounts post about same news, Top Picks shows one consolidated card.

---

## Item 7 — Anti-voice examples (compound the 👎)

Status: `queued`

Currently 👎 ratings are stored but not used in generation.

### Schema

New column `anti_voice_active BOOLEAN DEFAULT TRUE` on `drafts` and `posts` tables.

### Behavior

When I 👎 a draft angle or post variant with a reason:
- Save the rated content to `voice_examples` with `source='rejected_angle'` or `'rejected_post'`, weight set as `-1` (anti-voice marker), reason and note copied from feedback fields.

In `composeVoiceBlock`, after the positive examples section, add:

```
Do NOT sound like these — these were generated and rejected:
- [content] — rejected because: [reason] [note if exists]
- [content] — rejected because: [reason]
```

Pull top 5 most recent active anti-voice examples by `added_at DESC where weight=-1 and active`.

### Verification

I 👎 three angles, generate a new angle for a different event, the prompt now contains my rejected examples as "do not sound like this".

---

## Item 8 — Intelligence-mode briefing page (Polymarket)

Status: `queued`

For intelligence-mode clients, build `/briefing` — a daily-digest page.

### For Polymarket specifically

- Top 5 score≥7 events from last 24h grouped by topic cluster
- "DC sentiment" section: events where author tagged `audience_role='staffer' | 'journalist' | 'official'`
- "Liberal influencer activity" section: events from creators tagged `audience_role='creator'`
- Once a day at 8am ET, briefing **locks** (snapshot to `briefings` table)

### Schema

- `watchlist.audience_role TEXT NULL` (`'staffer' | 'journalist' | 'official' | 'creator' | 'politician' | NULL`) — manually tag for now
- `briefings` table: `id, client_id, briefing_date, content JSONB (full snapshot), created_at`

### Verification

Switch to Polymarket client, `/briefing` renders today's snapshot. Switch to Khanna, `/briefing` redirects to `/` (drafting-mode default).

---

## Item 9 — Standing Brief on homepage

Status: `queued`

When I open Signal after being away (>2 hours), homepage shows a "Standing Brief" hero at the top BEFORE the regular Top Picks:

- Time window summary: "While you were away (12h): X events, Y scored 7+, Z hit 9+"
- Any 9+ events from the window inlined as cards with auto-generated angles ready
- Topic clusters from the window: "3 watchers posted about Iran in last 6h"
- Top 5 events from the window sorted by score
- "Show me only events since last visit" filter chip
- "Mark all caught up" button — resets `lastSeenAt` to now

Track `lastSeenAt` per device in localStorage. If <2h since last visit, hide Standing Brief and just show Top Picks.

This is the "I'm back at my laptop, what did I miss" view. Pure pull, no notifications.

### Verification

Close laptop, wait 2h, open `/` — Standing Brief panel populated with what changed.
