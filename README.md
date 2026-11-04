# Media Tracker

A small app for logging books, TV, movies and drinking straight into your Google Sheet. Works on your Android home screen and as a bookmark on your computer.

- **Front end:** plain HTML, CSS and JavaScript hosted free on GitHub Pages. No build step.
- **Back end:** a Google Apps Script attached to your sheet. It reads and writes rows for the app.
- **Security:** the repo holds no secrets. The script URL and a passcode are entered once on each device and saved only on that device.

Setup takes about 15 minutes.

## Updating from version 1

1. **Script:** in Apps Script, select all the code, delete it, paste in the new `apps-script/Code.gs`, and save.
2. **TMDB key (for movies):** make a free account at themoviedb.org, then go to Settings > API and request a Developer key for personal use. Copy the **API Key** (the short one). In Apps Script, go to Project Settings > Script properties and add `TMDB_KEY` with that value.
3. **Approve the new permission:** pick `testLookup` in the function dropdown and click **Run**. Google will ask you to allow "connect to an external service". Allow it. The log should list a book, a TV show and a movie.
4. **Redeploy:** Deploy > Manage deployments > pencil > Version: **New version** > Deploy. Same URL as before.
5. **App files:** on GitHub, click **Add file > Upload files** and drag in the new `app.js`, `styles.css` and `sw.js`. They replace the old ones. Click **Commit changes**.
6. Give GitHub Pages a minute, then close and reopen the app on your phone. You may need to reopen it twice to get the new version.

The first time you open it, covers and posters fill in over a minute or two in the background.

**Updating to 3.3:** paste the new Code.gs, redeploy as a New version, and upload app.js, styles.css and sw.js.

**Updating to 3.2:** paste the new Code.gs, redeploy as a New version, and upload app.js, styles.css and sw.js.

**Updating to 3.1:** paste the new Code.gs, redeploy as a New version, and upload app.js, styles.css and sw.js.

**Updating to 3.0.1:** upload app.js and sw.js. No script changes.

**Updating to 3.0:** paste the new Code.gs, redeploy as a New version, and upload app.js, styles.css and sw.js. The Backlog tab is added to your sheet the first time the app loads.

**Updating to 2.9:** paste the new Code.gs, redeploy as a New version, and upload app.js and sw.js.

**Updating to 2.8:** upload app.js, styles.css and sw.js. No script changes.

**Updating to 2.7:** paste the new Code.gs, redeploy as a New version, and upload app.js, styles.css and sw.js.

**Updating to 2.6:** upload app.js, styles.css and sw.js (plus manifest.webmanifest and index.html for the new name). No script changes.

**Updating to 2.5:** paste the new Code.gs, redeploy as a New version, and upload app.js, styles.css and sw.js.

**Updating to 2.4:** paste the new Code.gs, redeploy as a New version, and upload app.js, styles.css and sw.js.

**Updating to 2.3:** paste the new Code.gs, redeploy as a New version, and upload app.js, styles.css and sw.js. Update both together, since the app and script changed how rows are checked.

**Updating to 2.1:** paste the new Code.gs, then Deploy > Manage deployments > pencil > New version > Deploy. Upload the new app.js, styles.css and sw.js to GitHub. No new permissions this time.

---

## 1. Add the script to your sheet

1. Open your Media Tracker Google Sheet.
2. Go to **Extensions > Apps Script**.
3. Delete whatever is in `Code.gs`, then paste in everything from `apps-script/Code.gs` in this repo. Click the save icon.
4. Click the gear (**Project Settings**) on the left. Scroll to **Script properties** and click **Add script property**.
   - Property: `PASSCODE`
   - Value: something only you know (a few random words works well)
   - Click **Save script properties**.
5. Go back to the **Editor** (the `< >` icon). In the function dropdown at the top pick `testRead`, then click **Run**.
   - Google will ask you to authorize. Pick your account. If you see "Google hasn't verified this app", click **Advanced > Go to (project name)**. This is your own script, so that warning is expected.
   - The log at the bottom should list row counts for books, episodes, shows, movies and drinks. If it shows an error about a tab or header, the sheet layout doesn't match. Send me the message.

## 2. Deploy it as a web app

1. Click **Deploy > New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Set:
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`). Keep it handy for step 4.

"Anyone" is needed so your phone can reach it without a Google sign-in screen. The passcode is what keeps other people out, and after 10 wrong tries the script locks for 15 minutes.

**If you change Code.gs later:** go to **Deploy > Manage deployments**, click the pencil, set Version to **New version**, and click **Deploy**. This keeps the same URL. Making a brand new deployment would give you a new URL you'd have to enter on every device again.

## 3. Put the app on GitHub Pages

1. On GitHub, click **New repository**. Name it something like `media-tracker`. Public is fine since there's nothing secret in it. Click **Create repository**.
2. Click **uploading an existing file** and drag in everything from this folder: `index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, the `icons` folder, and the `apps-script` folder (optional, just so you have a copy). Click **Commit changes**.
3. Go to **Settings > Pages**. Under "Build and deployment" set Source to **Deploy from a branch**, Branch to **main** and folder to **/ (root)**. Click **Save**.
4. After a minute or two the page shows your link, like `https://yourname.github.io/media-tracker/`.

## 4. Connect your devices

**Android**
1. Open your GitHub Pages link in **Chrome**.
2. Paste the web app URL from step 2, enter your passcode, tap **Connect**.
3. Tap the three-dot menu, then **Add to Home screen** (or **Install app** if it shows). It opens full screen like a normal app.

**Computer**
1. Open the same link, connect the same way, and bookmark it.

Each device remembers its own connection. **Settings > Disconnect this device** clears it.

---

## Using it

- **Dashboard** shows this year's totals compared with last year at the same point, a month-by-month chart for each section, a day-by-day grid of when you read and watched, and recent activity grouped into This week, Last week, Earlier this month, then by month.
- **Chart details:** hover over a bar or day square on a computer, or tap it on your phone, to see the total and what was in it.
- **Section stats:** every tab shows a This year row and an All time row. Hours watched use matched run times when your sheet is blank.
- **Review and fill** (Settings): three steps. 1) Check matches: every matched title with its cover, likely-wrong ones first. Tap a title to open a side-by-side card (your sheet vs the match, with the match's description and a link to it). Tap the cover to see it full size. Looks right, Remove match and Skip jump to the next title. Change opens a search with an author box and results from Open Library and Google Books; if nothing fits, tap None of these are right. A removed title is never auto-matched again or used to fill your sheet. Confirm the rest in one tap. 2) Preview: see exactly what will be written and untick anything. 3) Write: fills only empty cells, only from matches you confirmed. Books get author, year, pages and genre. Movies get run time, year and genre. TV episodes get the real run time and air year of each episode.
- **Safeguards:** when adding or editing, the app warns you before saving if something looks off: an episode you've already logged, skipped episodes, a jump in seasons, a big batch, more episodes than have aired, a date in the future, a book or movie you already have, a second drinks entry on the same day, or an edit that replaces a value you had. Tap once to see the warning, tap again (the button turns amber) to save anyway.
- **Delete:** open any entry and tap Delete, then confirm. Only that section's columns shift up, so the shows table beside your episode log stays put.
- **Find info:** when adding or editing a book, movie or episode, tap **Find info** next to the title. Pick the right match and the app fills in the official title (when adding), the author (or completes a partial one), and any empty fields like pages, year and genre, and saves the cover or poster. It never renames an entry you're editing, or a show you've already logged episodes of. Books come from Open Library, movies from TMDB, TV from TVmaze.
- **Pictures** are matched automatically in the background for everything you've logged, newest first. If one is wrong, open the show (or use Find info on a book or movie) and pick the right one. Your pick is never replaced by an automatic match.
- **TV shows** get their stats from your episode log: started, last watched, episodes watched (and out of how many have aired), time watched and days to finish. A show counts as finished when it has ended and you've logged every episode, or when you tap **Mark finished**. The shows table in your sheet is left alone.
- **Books** has "Currently reading" (started but no finish date) with a **Mark finished** button that asks for the date.
- **TV** has "Watching now" (anything watched in the last 30 days that isn't finished) with a **Log E#** button that pre-fills the next episode. When logging, pick a show and you'll see your last 5 logged episodes of it, and the season, next episode, year and channel fill in from your last entry. Channel uses the dropdown list from your sheet. Run time isn't guessed; for shows whose match you've confirmed, the script saves each episode's real run time when you log it. The form logs one episode by default. Tap **+ Log more than one episode** to open the Through episode box for a batch, which still writes one row per episode like your sheet already does.
- **All lists** have search and sorting. Tap any row to edit it. All books shows two lines per book, with the year (or letter, for A to Z) pinned at the top while you scroll and a strip on the right to jump between them.
- Data is cached on the device, so the app opens instantly and shows your last sync even offline. It refreshes when you open it after 5+ minutes away, or when you tap the sync label up top.

## Backlog (things to read and watch someday)

- Books, TV and Movies each have a **Reading log / Watch log | Backlog** switch at the top. **+ Add** in Backlog view adds to that section's backlog.
- **Books** are grouped by author with a Genre filter. **Movies and TV** are one list with Genre and Streaming filters. Sort A to Z or Newest.
- Tap a row for its description, details, your note, Edit and Remove (tap Remove twice; Undo is offered).
- **Find info** on the backlog always fills in the official title (adding or editing), plus author, year, genre and where to watch.
- Lookups only return English titles (other languages and alphabets are skipped). For books you can look up by author alone. Results float over the form so nothing jumps, and once you've picked a match your edits are left alone.
- Adding warns about close matches already on your backlog (same or near title, same author) and anything you've already read, are reading, or watched.
- **Series:** when adding a book, tick **This is a series** to add one entry for a whole series (like Mistborn). It shows a Series tag, Find info fills the author and genre but keeps your series name, and it comes off the backlog as soon as you start any book in it (matched by your Books tab's Series column, or a title like "Mistborn: The Final Empire").
- **Where to watch** shows Canadian streaming services (subscription and free), checked automatically every week. Data from JustWatch via TMDB, so it needs your TMDB_KEY.
- **Auto-cleanup:** finishing a book, logging a movie, or logging any episode of a show removes it from the backlog. You'll see a message with Undo.
- It all lives in a **Backlog** tab in your sheet (Type, Title, Author, Year, Genre, Where to watch (CA), Notes, Added), created automatically the first time the app loads. You can add or edit rows there directly too.

## Good to know

- **App Data tab:** the script adds one tab called App Data to remember which book, movie or show each title matched, its picture, and anything you marked finished. You never need to edit it. Deleting a row just makes the app look that title up again.
- **Formulas are never touched.** Days to Finish, Episodes Watched, Total Time Watched and the other formula columns are skipped on write. New rows copy formatting and formulas from the row above, so they match the rest of the sheet.
- **Rows go right after your last entry**, not below the pre-filled Days to Finish formulas.
- **Header check:** every request checks your column headers. If you rename or move a column, the app stops with a clear message instead of writing into the wrong spot.
- **Text that looks like a date or number** (like "8/10" in Thoughts) is saved with a leading apostrophe so Sheets keeps it as text. You'll see the apostrophe if you click into the cell in Sheets; it doesn't show otherwise.
- **Edits are safe from shifted rows:** if you sort or insert rows in the sheet while the app is open, saving an edit will ask you to refresh instead of overwriting the wrong row.
- **Updating the app:** after changing front end files on GitHub, bump `CACHE` in `sw.js` (for example `media-tracker-v2`) so phones pick up the new version cleanly.
