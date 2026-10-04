# GS Baseball Hub

The team's hub: score games pitch by pitch, keep box scores and season stats, chart spray charts, scout opponents, stream games, and chat as a team. It runs at **https://scorebook.stingerz-baseball.com**, with coach logins and view-only access for families.

## Who can do what

| | Coaches (admins) | Camera operators | Families |
|---|---|---|---|
| Score games, edit rosters, scan rosters | Yes | No | No |
| Import a spray chart (your team or an opponent) | Yes | No | No |
| Follow games live, box scores, stats, scouting | Yes | Yes | Yes |
| Watch the live video with the scoreboard on top | Yes | Yes | Yes |
| Stream from the built-in camera, upload game video | Yes | Yes | No |
| Team chat (read and post) | Yes | Yes | Yes |
| Pay their own player's tournament fees | Yes | Yes | Yes (once linked to their player) |
| See the fee list and who has paid | Owner, plus anyone the owner turns on | Only if turned on | Only if turned on |
| Send photos in the team chat | Yes | Yes | Yes |
| Delete anyone's chat message | Yes | No | No |
| Approve families, add coaches and camera operators, change who can watch | Yes | No | No |

- The **owner** is the first account created on the site. The owner is always an admin.
- New people tap **Request access**. A coach approves them on **Team → Families & coaches**, then taps their name to make them a coach or a **camera operator** if needed.
- **Who can watch** (same screen): **Approved families**, where parents create an account and a coach approves it, or **Anyone with the link**, with no sign-in needed to watch.
- The database itself enforces these rules (`firestore.rules`). Hiding buttons isn't the only protection. After updating `firestore.rules` here, paste it into Firebase again and **Publish**.

## Tournament fees

Families pay tournament fees from the app with **Venmo** or **Cash App**. There's no cash option.

- **Families** see their own player's fee on the Team tab (and a reminder on the Games tab) with a button for each way to pay. Venmo opens with the amount and note filled in; Cash App opens with the amount (they type the note). After paying they tap **I paid**, and the Hub also asks when they come back to it.
- **You** see every tournament under **Team → Fees**: who has paid and how, who says they paid (tap **Confirm** after you see it in your Venmo or Cash App), and who hasn't. Tap a player to mark them paid with Venmo or Cash App, mark them not paid, or send a reminder. **Remind everyone who hasn't paid** sends a phone notification to linked families who turned notifications on.
- **Who can see fees:** only you (the owner) and the people you turn on under **Team → Fees → Who can see fees**. Other coaches don't see fees unless you turn them on. Families only ever see their own player.

**Setup**

1. In Firebase, paste the latest `firestore.rules` and **Publish** (required for fees).
2. Paste the latest `worker.js` into your Cloudflare Worker and **Deploy** (needed for fee reminders).
3. In the Hub: **Team → Fees → How families pay → Set up**. Enter your Venmo username and/or Cash App $cashtag.
4. Link each family to their player: **Team → Families & coaches**, tap the family, then tap their player.
5. Add a tournament: **Team → Fees → + Tournament** (name, amount per player, due date, who owes it).

## Scouting and imported spray charts

The **Scout** tab builds each opponent's spray charts, direction split and positioning tips from every ball in play you chart while scoring. The **Stats** tab has the same kind of spray charts for your own hitters, under **Spray charts** below the batting table, and each player's card shows theirs. You can also import a spray chart someone else made, such as a season report from another app, for your team or an opponent:

1. For your team, tap **+ Spray chart** in the Stats tab's Spray charts section. For an opponent, tap **+ Spray chart** on the Scout tab, or open their roster under **Team → Opponent rosters** and tap **Import** in the Spray chart box. The import screen's **Whose chart?** switch flips between your team and an opponent.
2. Pick the screenshot(s). Long screenshots are fine: the Hub cuts them between rows of hitters so every name and number stays sharp.
3. Check the review. Each hitter shows their balls in play on a small field in the Hub's style, the left/center/right split, the ground ball/line drive/pop up mix, and the roster player they were matched to ("Brigham F" on the chart matches "Brigham" on the roster). A check mark means the dots add up to the chart's own ball-in-play total. Change a match, add a hitter as a new player, or skip one, then tap **Save to scouting**. On your own team, a name that isn't on your roster starts as **Don't import** (it's usually a spelling difference); pick the right player or choose **Add to your roster**.

Dot colors are read as contact type: **green = pop up, red = ground ball, gold = line drive**, unless the chart has its own color key. These charts don't say whether a ball was a hit or an out, so imported balls show as navy dots marked **Imported chart** instead of the hit, out and error markers. Each dot's spot becomes one of nine places (pitcher, catcher, first, second, short, third, left, center, right). A spot with more than 10 imported balls shows as one bubble with the count; **Heat** still uses every ball.

Long charts are read one piece at a time, so a big team reads as well as a small one. If part of a screenshot can't be read, the review says which part; save what was read and import that part again, or start over.

Imported balls add to scouting; they never replace the games you score. The spray chart, direction split, contact mix (grounders, liners, pop ups) and the tips use both. The batting line (hits, walks, strikeouts) and outfield distances still come only from games you score, because spray charts don't include them. Importing again replaces the earlier import for the same hitters. Imported balls never change batting stats. To remove an opponent's import, open their roster and tap **Remove** in the Spray chart box; for your team, tap **Remove** under the Stats tab's spray chart.

## Baseball Instincts

The **Instincts** tab is for the players: game situations they solve on a field diagram that shows the runners, the outs, where the ball is hit and where **YOU** are. They pick what they'd do, then see the play drawn on the field and a short reason why.

- **Where's the play?** (13 plays): force outs, the lead runner, the base in front of the runner, covering and backing up.
- **Run smart** (9 plays): running through 1st, 2 outs means run on contact, halfway on fly balls, freeze on line drives, tag up, ball in front of you or behind you, and following your base coach.
- **Think first** (6 plays): knowing outs and runners before the pitch, the ready position, calling the ball, and shaking off errors.
- **All-Star challenge:** 10 random plays from everything.

Each round ends with 1 to 3 stars and a review of the plays they missed. Best scores are kept on that phone. The page also has a **Before every pitch** checklist and **Know these words** (force out, tag, tag up and more). Anyone who can open the Hub can use it, and it works with no signal.

## Scoring with no signal

The scoring phone keeps working when the field has no service:

- **Keep scoring.** Every pitch and play is saved on the phone the moment you tap it. The status at the top turns yellow and says **Saved on phone**; tap it for a reminder of what's happening.
- **It syncs on its own.** When service comes back, everything goes up in order and the status turns green (**Synced**). Families' Live screens jump to the current score and notifications go out then.
- **Closing the app is safe.** If the Hub gets closed or the phone restarts with no signal, open GS Hub again: it opens from the copy saved on the phone, picks up the unsynced plays, and you keep scoring.
- **Before game day,** open the Hub once with signal on each scoring phone (after any update) so the phone has its saved copy. Viewing works offline too, but families see the last score that reached them.
- Live video, chat photos, roster scanning and scouting reports need signal.

## Team chat

The **Chat** tab is one group conversation for everyone with an approved account: coaches, families and camera operators. People watching through "Anyone with the link" without signing in don't see it. Coaches' messages show a **Coach** tag. To delete a message, tap it and then tap **Delete message**. Anyone can delete their own messages; coaches can delete any message. A hint under the latest message says so until you've deleted a message or muted someone. A red dot on the Chat tab means there are new messages. The chat keeps the latest 300 messages on screen.

### Muting someone

Anyone can mute anyone in the chat, anytime. Tap one of their messages, then **Mute**. Their messages fold into a quiet "messages from … (muted)" line you can open with **Show**, and you stop getting notifications when they post. Muting only changes what *you* see. They aren't told, they can still post, and everyone else still sees their messages. To unmute, tap one of their messages after **Show**, or go to **Team → Account → Muted in team chat → Manage**. Your mute list follows your account to every phone you sign in on. It needs the latest `firestore.rules` published (and the latest `worker.js` for the notification part).

### Photos in the chat

Tap the camera button next to the message box to take a photo or pick one from the phone, add a caption if you like, and tap **Send**. The Hub shrinks each photo (to about 1600 pixels on the long side) before sending, so it goes quickly on a weak signal at the field. Tap a photo to see it full screen; press and hold it there to save it to your phone. Whoever sent a photo can delete it from the full-screen view, and coaches can delete any photo. Deleting a photo removes the picture itself, not just the message.

Photos are private to the team. They're stored in your Cloudflare account (R2), not on this public website, and the Worker only shows them to signed-in, approved members, using viewing links that expire within two days. The camera button appears once a coach has saved the Worker under **Team → Cloudflare Worker**.

**Setting up photo storage (one time):**

1. In [Cloudflare](https://dash.cloudflare.com), open **R2 Object Storage** and choose **Create bucket**. Name it `gs-hub-photos` and keep the default location. (If Cloudflare asks you to turn on R2 first, do that. The free tier covers 10 GB of storage a month, roughly 30,000 chat photos.)
2. Open your Worker, then **Settings → Bindings → Add → R2 bucket**. Set the variable name to `PHOTOS`, pick `gs-hub-photos`, and deploy.
3. Open the Worker's **Edit code**, paste the latest [`worker.js`](worker.js), and **Deploy**.

Photos also need the `FIREBASE_SERVICE_ACCOUNT` secret, which the Worker already uses for notifications.

## Notifications

Anyone with an approved account can get phone notifications, even when the Hub is closed: new chat messages, game starts, every run, and final scores. Each game update replaces the one before it, so the lock screen works like a live scoreboard. Each person turns them on under **Team → Notifications** and picks what they want: team chat on or off, and game updates for **Runs & final**, **Every half-inning**, or **Off**.

- **iPhone (iOS 16.4 or later):** notifications only work from the Home Screen app. Open the Hub in Safari → **Share** → **Add to Home Screen**, open **GS Hub** from the Home Screen, sign in, then turn notifications on.
- **Android:** works in Chrome. Adding it to the home screen is optional.

A true live scoreboard on the iPhone lock screen or Dynamic Island (a Live Activity) needs an App Store app, so the Hub uses replacing notifications instead.

The Cloudflare Worker sends the notifications. It needs:

1. **`FIREBASE_SERVICE_ACCOUNT`** secret: in Firebase, **Project settings → Service accounts → Generate new private key**, then paste the whole downloaded file as the secret's value. Treat that file like a password: don't email it or put it anywhere else.
2. **A Cron Trigger:** in the Worker, **Settings → Trigger events → Add → Cron Triggers**, every minute (`* * * * *`). The scorebook also nudges the Worker the moment a coach scores a pitch or someone sends a chat message, so most notifications arrive within a few seconds; the cron check catches anything missed.
3. A coach has saved the Worker under **Team → Cloudflare Worker** at least once, so families' phones know where to nudge it.

## First-time setup

1. **Turn on GitHub Pages.** In this repo: **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, **main**, **/ (root)**, then **Save**. The custom domain should fill in as `scorebook.stingerz-baseball.com` from the `CNAME` file.
2. **Point the address at GitHub.** In GoDaddy: **My Products → stingerz-baseball.com → DNS → Add New Record**:
   - Type **CNAME**, Name **scorebook**, Value **keubanks16.github.io**, TTL default.
   Wait until GitHub's Pages settings shows the DNS check passed (minutes to an hour), then tick **Enforce HTTPS**.
3. **Publish the security rules.** In Firebase: **Databases & Storage → Firestore → Rules**. Replace everything with the contents of [`firestore.rules`](firestore.rules) and tap **Publish**.
4. **Create the admin account.** Open the scorebook and tap **Create the admin account**. Do this before sharing the address, because the first account becomes the owner.
5. **Bring over existing games** (optional). In the old copy, **Team → Export backup**. Here, **Team → Import backup**.

## Live video

During a live game, families see the video on the Live tab with the scoreboard (score, inning, count, outs) on top. There are two ways to stream.

### Built-in camera (Cloudflare Stream)

A second phone streams straight from the scorebook. Families watch inside the scorebook less than a second behind real life, so the video and the score always match. The video only plays in the scorebook, so your "who can watch" setting covers it.

**One-time setup**

1. In Cloudflare, open **Images & Stream** and turn Stream on (pick the cheapest plan if it asks). Viewing costs about $1 per 1,000 minutes watched, roughly $2.40 for a 2-hour game with 20 families.
2. Create an API token: profile icon → **My Profile → API Tokens → Create Token → Create Custom Token**, permission **Account · Stream · Edit**.
3. In your Worker's **Settings → Variables and Secrets**, add `CF_STREAM_TOKEN` (Secret, the token) and `CF_ACCOUNT_ID` (Text, your Cloudflare account ID).
4. Paste the latest [`worker.js`](worker.js) into the Worker (**Edit code**) and deploy.
5. On the camera phone: sign in to the scorebook as a coach and set up **Team → Cloudflare Worker**.

**Each game**

1. Start the game in the scorebook (on any coach's phone).
2. On the camera phone: **Live → Stream video → Go Live**. Mount it sideways behind the plate and plug in a battery pack. Keep the screen on; locking the phone pauses the stream (tap **Resume**).
3. When the game ends: **End stream** (tap twice).

**Saving the game:** Cloudflare doesn't record these streams, so the camera phone records the game itself in 10-second pieces. After the game, on the camera phone: **Get video → Save to phone** (from the end screen, or **Team → Game videos on this phone**), upload it to YouTube as **Unlisted**, and paste the link under the game's **Edit details**. Then delete it from the scorebook to free up space. A 2-hour game takes about 2 GB.

**Camera operators** can do all of this on their own phone: sign in, then **Live → Stream video**. The Cloudflare Worker connection is shared with them automatically, so they don't need the access code.

### YouTube live streaming

Instead of the built-in camera, you can stream to YouTube from a streaming app. Free, saves every game, and anyone with the link can watch. YouTube runs 10 to 30 seconds behind, so each viewer can set **Score delay** under the video to keep the scoreboard from spoiling plays.

1. **Get your channel ID.** In YouTube Studio: **Settings → Channel → Advanced settings**. It starts with `UC`.
2. **Add it to the scorebook.** **Team → Live video → Set up**.
3. **Get your stream key.** In YouTube Studio: **Create → Go live → Stream**. Copy the **Stream URL** and **Stream key**, turn on auto-start and auto-stop, and choose **Low latency**.
4. **Set up a streaming app** such as Larix Broadcaster with the URL `rtmp://a.rtmp.youtube.com/live2/` followed by your key. Streaming this way doesn't need 50 subscribers; going live from the YouTube app does.

Each game, start the stream in the app. **Public** streams appear automatically; for an **Unlisted** stream, paste that game's link under the game's **Edit details**.

When a built-in camera stream is live, the scorebook shows it; otherwise it shows YouTube.

## YouTube uploads

When a built-in camera stream ends, the camera phone can upload the game video to YouTube by itself, and add the replay to the game page.

**Google's review comes first.** YouTube locks every video uploaded by a new app as **private** until Google reviews the app. You can watch private videos in YouTube Studio or the YouTube app (**You → Your videos**) and download them there, but families can't, and videos uploaded before approval stay locked. Apply for the review right after setup.

**One-time setup** (Google Cloud, easiest on a computer)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and pick the **stingerz-scorebook** project at the top (the same project as Firebase).
2. **APIs & Services → Library**, search **YouTube Data API v3**, and tap **Enable**.
3. **Google Auth Platform** (or **APIs & Services → OAuth consent screen**) → **Get started**. App name `GS Baseball Scorebook`, your email, audience **External**, then **Create**.
4. **Audience → Test users → Add users**: add the Google account that owns your YouTube channel, plus anyone else who will upload.
5. **Data access → Add or remove scopes**: tick `.../auth/youtube.upload` and save.
6. **Clients → Create client**: type **Web application**, name `Scorebook`, and under **Authorized JavaScript origins** add `https://scorebook.stingerz-baseball.com`. Create it and copy the **Client ID**.
7. In the scorebook: **Team → YouTube uploads → Set up**, paste the Client ID, and save. Leave **Add the replay to the game page** off for now.
8. Apply for the review at [support.google.com/youtube/contact/yt_api_form](https://support.google.com/youtube/contact/yt_api_form). Explain that it's a youth baseball team's own scorebook that uploads game video only to the team's own channel, non-commercial, at https://scorebook.stingerz-baseball.com. Reviews have taken from a few days to a few months.
9. Once Google approves, turn on **Add the replay to the game page**.

**Each game:** when the camera phone taps **End stream**, Google asks which account to use (the first time, it warns the app isn't verified; tap **Continue**, since it's your own app). Pick the channel's account and the upload starts. Keep the screen on until it says **On YouTube**. If it stops, tap **Continue upload** and it picks up where it left off. Uploads use about 1 GB per hour of video, so use Wi-Fi if you can. You can also upload later from **Team → Game videos on this phone**.

Videos go to the channel of the Google account that signs in, and that account must be on the test-user list. If a camera operator films, they sign in with the team channel's Google account.

## Cloudflare Worker

Roster photo scanning, scouting reports, the built-in camera, chat photos, fee reminders and phone notifications go through your Cloudflare Worker ([`worker.js`](worker.js)), which keeps your keys off this public site. Its **Settings → Variables and Secrets**:

| Name | Type | What it's for |
| --- | --- | --- |
| `ACCESS_CODE` | Secret | Any passphrase; coaches type it into the scorebook |
| `ANTHROPIC_API_KEY` | Secret | Roster photos and scouting reports ([console.anthropic.com](https://console.anthropic.com)) |
| `CF_STREAM_TOKEN` | Secret | Built-in camera (Account · Stream · Edit token) |
| `CF_ACCOUNT_ID` | Text | Built-in camera (your Cloudflare account ID) |
| `FIREBASE_SERVICE_ACCOUNT` | Secret | Phone notifications, chat photos and tournament fees (see [Notifications](#notifications)) |
| `ALLOWED_ORIGIN` | Text | Optional. Defaults to `https://scorebook.stingerz-baseball.com,https://keubanks16.github.io` |

In the scorebook, each coach's phone needs **Team → Cloudflare Worker → Set up**: paste the Worker address and access code, tap **Test connection**, then **Save**.

To create the Worker from scratch: in [Cloudflare](https://dash.cloudflare.com), create a Worker from "Hello World", choose **Edit code**, paste [`worker.js`](worker.js), deploy, then add the variables above, the `PHOTOS` R2 bucket binding (see [Photos in the chat](#photos-in-the-chat)), and the every-minute Cron Trigger.

## Put it on a phone's home screen

- **iPhone:** open the address in Safari → **Share** → **Add to Home Screen**.
- **Android:** open it in Chrome → **⋮** → **Add to Home screen**.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole app in one page, including the Firebase settings |
| `firestore.rules` | Database security rules: owner, coaches, families, who can watch |
| `worker.js` | Cloudflare Worker: holds the API key, opens private Cloudflare streams for the camera phone, stores and shows chat photos, and sends notifications |
| `firebase-messaging-sw.js` | Keeps a copy of the Hub on the phone so it opens and scores with no signal, and shows notifications when the app is closed |
| `CNAME` | Tells GitHub Pages to serve this at scorebook.stingerz-baseball.com |
| `icons/`, `manifest.webmanifest` | Home-screen icon and app settings |

The Firebase settings in `index.html` (apiKey and the rest) identify the project and are meant to be public. The security rules are what protect the data.
