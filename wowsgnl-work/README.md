# wowsgnl-work — Signal v1

Internal rapid response engine.

## Setup
1. Push to GitHub, import to Vercel
2. Add Vercel Postgres integration
3. Add env vars: `ANTHROPIC_API_KEY`, `TWITTERAPI_KEY`
4. Deploy
5. Hit `/api/setup` once to create tables
6. Add a client at `/clients`, add watch items at `/watchlist`
7. Hit `/api/poll` to test, or wait for cron
