# TikTok app review — demo video shot list

Products shown: **Login Kit** and **Content Posting API (Direct Post)**.
Scopes shown: **`user.info.basic`** (sign-in, name and avatar) and **`video.publish`** (direct post).

Before you submit, remove every other product and scope from the app in the TikTok Developer Portal (for example Display API, Share Kit, `video.upload`, `user.info.profile`, `video.list`). Anything selected that isn't shown in the video slows down the review.

## Before recording

1. In the Developer Portal, switch the app to **Sandbox**. Under Sandbox → **Target users**, add the TikTok account you'll sign in with.
2. Set that TikTok account to **Private** in the TikTok app (Settings → Privacy → Private account). Until the app is audited, TikTok only accepts "Only me" posts from private accounts.
3. In KlipForge, open the accounts drawer and delete the mock `@klipforge_tiktok` *sandbox* account, so only the real TikTok connection appears.
4. Use **one browser origin for the whole video.** TikTok sends you back to `TIKTOK_REDIRECT_URI` (`http://localhost:5173/...`). If you start at `192.168.1.68:5173`, the address changes halfway through and you may land logged out. Either record everything on `http://localhost:5173`, or change the redirect URI, both in the portal and in `apps/api/.env`, to the address you record on.
5. Sign out of TikTok in the browser, so the video shows the full TikTok sign-in page.
6. Use a clean Chrome window at full size, with the address bar visible. Close other tabs and hide your bookmarks.

## Recording (about 3–4 minutes)

Press **⌘⇧5**, choose **Record Selected Portion** around the Chrome window, then click **Record**. Pause about 2 seconds on each screen so reviewers can read it.

| # | What to show | What to do |
|---|---|---|
| 1 | Developer Portal | Show the app with the **Sandbox** toggle, **Products** (Login Kit, Content Posting API) and **Scopes** (`user.info.basic`, `video.publish`). Show the redirect URI. |
| 2 | KlipForge website | Open the KlipForge `/workspace` URL with the address bar visible. Briefly show the home page so it's clear what the app does. |
| 3 | Login Kit | Go to **Calendar** → **accounts** button (top right of Planner) → under TikTok, click **Connect real account**. |
| 4 | TikTok consent | On tiktok.com, sign in with the sandbox target user. Hold on the consent screen that lists the permissions (`user.info.basic`, `video.publish`), then click **Authorize**. |
| 5 | Back in KlipForge | The new TikTok account appears in **Connected accounts** with its **display name and avatar**. This shows `user.info.basic` in use. |
| 6 | Create a post | **Create post** → choose a clip from **Project clips** (or **Upload** an .mp4) → under **Publish to**, select the TikTok account → write a caption. |
| 7 | TikTok post settings | Scroll to the TikTok panel and stop on each part: **"Posting to TikTok as"** with name and avatar · **Who can view this video** (no default; open the dropdown and pick **Only me**) · **Allow users to** Comment / Duet / Stitch (tick one or two) · turn **Disclose video content** on and show the **Your brand / Branded content** choices and the label text, then turn it off again · the **Music Usage Confirmation** line. |
| 8 | Preview | Point at the preview on the right showing the video and caption. |
| 9 | Direct Post (`video.publish`) | Click **Post now**. Show the "Sent to TikTok — may take a few minutes to process" notice and the post's status in the calendar or list. |
| 10 | Result on TikTok | Open tiktok.com, or the TikTok app on your phone, on that profile. Show the new video posted as **Only me** with the same caption. |
| 11 | (Optional) Disconnect | Remove the account from Connected accounts to show the user can revoke access. |

## After recording

Convert the recording to an .mp4 under 50 MB:

```bash
docs/tiktok-review/compress.sh ~/Desktop/"Screen Recording ….mov"
```

That writes `klipforge-tiktok-demo.mp4` next to the original. If the video runs longer than about 6 minutes, split it into parts. TikTok allows up to 5 files.
