---
name: sharing
description: Shareable links, accounts, and collaboration. Use when changing uploads, sign-in, the link page, private links, comments, view counts, upload limits, or project sharing.
---

# Sharing

Links and collaboration, hosted by the Bestboy platform at bestboy.dev (the private `bestboyhq/platform` repo).
Its `docs/api.md` is the contract; a change to what Grip sends or reads changes it there too, in step.

- One click uploads to a shareable link, resumable and with progress, while the user keeps working.
  The link is on the clipboard once the server creates the item, before the first byte goes up (`created` in `electron/share.ts`): a link that waits for the whole upload is what makes sharing feel slow.
  An agent's share (`exportWithoutAsking`, record_demo) leaves the clipboard alone: the user may have copied something since.
- The link page streams with fast start in any browser and supports private links, timestamped comments, and view counts that exclude the team.
- Share a whole editable project as a link.
- A new version puts a new video behind a ready video's link (`versionOf` on `POST /api/items`, set from `electron/upload.ts`), so every place the link was posted shows it with no new post; record_demo's `link` uses it.
  A version is an upload like any other and counts as one; it keeps its link's privacy, and the link page lists every version.
- A video share sends its GIF, when it has one, for places that show images but play no video (a pull request's description).
  It goes after the video's bytes and before finalize; a refused GIF, too big or on a platform without GIFs, costs only the image, as a refused poster does.
- Sharing needs an account: sign-in runs in the browser (Google or an email code) and hands Grip a token through `grip://auth` (`electron/account.ts`).
  Viewers and commenters never need one.
- Signing in accepts the current Terms and Privacy Policy; a change to them reaches people in place, never by email.
  While `/api/me`'s `user.terms` differs from its `terms`, the Share popover says "Sharing accepts the Terms and Privacy Policy" under the button that shares, and that share sends `terms`.
  The platform counts nobody's account events until they accept.
- Usage, not seats: uploads a month, file size, and how long links live are limited; teammates, viewers, comments, and plays are not.
  A shared project counts as an upload too.
  The server owns the numbers.
- Grip stays quiet about uploads: no count, meter, or "left" anywhere, so nobody weighs whether a recording is worth sharing.
  Usage lives in the web app at bestboy.dev, next to the views and comments the links drew.
  Grip speaks only when a share is refused (402 at item creation): why, and the day (UTC) uploads open again, with no retry until then.

Gotchas:

- A version still uploading is dropped when a newer one starts or after a week, and the link then reads as another version: a resumed upload checks the version number before it sends a byte.
- A 409 when a version starts has no offset to resume from (the link's first version still uploads): it ends the share, where retrying would never end.

Done when a link starts playing in under 2 s in a phone browser on 4G, and a private link stays private.
