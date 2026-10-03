# GS Baseball Scorebook

Score games pitch by pitch, keep box scores and season stats, chart spray charts, and scout opponents. It runs at **https://scorebook.stingerz-baseball.com**, with coach logins and view-only access for families.

## Who can do what

| | Coaches (admins) | Families |
|---|---|---|
| Score games, edit rosters, scan rosters | Yes | No |
| Follow games live, box scores, stats, scouting | Yes | Yes |
| Watch the live video with the scoreboard on top | Yes | Yes |
| Approve families, add coaches, change who can watch | Yes | No |

- The **owner** is the first account created on the site. The owner is always an admin.
- Coaches approve families, or make another account a coach, on **Team → Families & coaches**.
- **Who can watch** (same screen): **Approved families**, where parents create an account and a coach approves it, or **Anyone with the link**, with no sign-in needed to watch.
- The database itself enforces these rules (`firestore.rules`). Hiding buttons isn't the only protection.

## First-time setup

1. **Turn on GitHub Pages.** In this repo: **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, **main**, **/ (root)**, then **Save**. The custom domain should fill in as `scorebook.stingerz-baseball.com` from the `CNAME` file.
2. **Point the address at GitHub.** In GoDaddy: **My Products → stingerz-baseball.com → DNS → Add New Record**:
   - Type **CNAME**, Name **scorebook**, Value **keubanks16.github.io**, TTL default.
   Wait until GitHub's Pages settings shows the DNS check passed (minutes to an hour), then tick **Enforce HTTPS**.
3. **Publish the security rules.** In Firebase: **Databases & Storage → Firestore → Rules**. Replace everything with the contents of [`firestore.rules`](firestore.rules) and tap **Publish**.
4. **Create the admin account.** Open the scorebook and tap **Create the admin account**. Do this before sharing the address, because the first account becomes the owner.
5. **Bring over existing games** (optional). In the old copy, **Team → Export backup**. Here, **Team → Import backup**.

## Live video

During a live game, families see your YouTube stream on the Live tab with the scoreboard (score, inning, count, outs) on top of the video. YouTube runs 10 to 30 seconds behind real life, so each viewer can set **Score delay** under the video to hold the scoreboard back and avoid spoilers. Coaches always see the live score and can tap **Show video** on the Live tab.

**One-time setup**

1. **Get your channel ID.** In YouTube Studio: **Settings → Channel → Advanced settings**. It starts with `UC`. An `@name` link won't work for embedding.
2. **Add it to the scorebook.** **Team → Live video → Set up**, paste the channel ID or `youtube.com/channel/UC…` link, and save.
3. **Get your stream key.** In YouTube Studio on a computer: **Create → Go live → Stream**. Copy the **Stream URL** and **Stream key**. The key stays the same from game to game.
4. **Set up a streaming app on the phone.** In an RTMP streaming app such as Larix Broadcaster, add a connection with the Stream URL and key (in Larix, the URL is the Stream URL followed by `/` and the key). Streaming this way doesn't need 50 subscribers; going live from the YouTube app does.

**Each game:** start the stream from the streaming app. If the stream is **Public**, it shows up in the scorebook automatically. If it's **Unlisted**, the channel link can't find it, so paste that game's video link under the game's **Edit details**. That field is also where to put the replay link after the game.

## Claude connection

Roster photo scanning and scouting reports use your own Claude API key, kept in a Cloudflare Worker ([`worker.js`](worker.js)) so it never sits on this public site. If you set up the Worker for the earlier GitHub copy, add this site to it: in the Worker, **Settings → Variables and Secrets**, add a **Text** variable `ALLOWED_ORIGIN` with the value

```
https://scorebook.stingerz-baseball.com,https://keubanks16.github.io
```

then deploy. In the scorebook, a coach opens **Team → Claude connection → Set up**, pastes the Worker address and access code, taps **Test connection**, then **Save**. This is saved per phone.

New Worker from scratch:

1. Get an API key at [console.anthropic.com](https://console.anthropic.com) (add credit and set a monthly spend limit under Billing).
2. In [Cloudflare](https://dash.cloudflare.com), create a Worker from "Hello World", then **Edit code** and paste [`worker.js`](worker.js). Deploy.
3. In the Worker's **Settings → Variables and Secrets**, add secrets `ANTHROPIC_API_KEY` (your key) and `ACCESS_CODE` (any passphrase).

## Put it on a phone's home screen

- **iPhone:** open the address in Safari → **Share** → **Add to Home Screen**.
- **Android:** open it in Chrome → **⋮** → **Add to Home screen**.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole app in one page, including the Firebase settings |
| `firestore.rules` | Database security rules: owner, coaches, families, who can watch |
| `worker.js` | Cloudflare Worker that holds the Claude API key |
| `CNAME` | Tells GitHub Pages to serve this at scorebook.stingerz-baseball.com |
| `icons/`, `manifest.webmanifest` | Home-screen icon and app settings |

The Firebase settings in `index.html` (apiKey and the rest) identify the project and are meant to be public. The security rules are what protect the data.
