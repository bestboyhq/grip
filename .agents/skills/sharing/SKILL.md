---
name: sharing
description: Shareable links, accounts, and collaboration. Use when changing uploads, sign-in, the link page, private links, comments, view counts, upload limits, or project sharing.
---

# Sharing

Links and collaboration, hosted by the Bestboy platform at bestboy.dev (the private `bestboyhq/platform` repo).
Its `docs/api.md` is the contract; a change to what Grip sends or reads changes it there too, in step.

- One click uploads to a shareable link, resumable and with progress, while the user keeps working.
- The link page streams with fast start in any browser and supports private links, timestamped comments, and view counts that exclude the team.
- Share a whole editable project as a link.
- Sharing needs a free account: sign-in runs in the browser (Google or an email code) and hands Grip a token through `grip://auth` (`electron/account.ts`).
  Viewers and commenters never need one.
- Usage, not seats: a team's plan limits uploads a month, file size, and how long links live; teammates, viewers, comments, and plays are unlimited.
  The server owns the numbers, and Grip shows what `/api/me` reports.

Done when a link starts playing in under 2 s in a phone browser on 4G, and a private link stays private.
