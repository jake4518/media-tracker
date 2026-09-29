# Media Tracker

A small app for logging books, TV, movies and drinking straight into your Google Sheet. Works on your Android home screen and as a bookmark on your computer.

- **Front end:** plain HTML, CSS and JavaScript hosted free on GitHub Pages. No build step.
- **Back end:** a Google Apps Script attached to your sheet. It reads and writes rows for the app.
- **Security:** the repo holds no secrets. The script URL and a passcode are entered once on each device and saved only on that device.

Setup takes about 15 minutes.

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

- **Dashboard** shows this year's totals and recent activity grouped by day. Same-day episodes of a show are combined, like "S2 E3-4".
- **Books** has "Currently reading" (started but no finish date) with a **Finished today** button.
- **TV** has "Watching now" (anything watched in the last 30 days) with a **Log E#** button that pre-fills the next episode. When logging, pick a show and the season, next episode, run time, year and channel fill in from your last entry. Fill in **Through episode** to log a batch, one row per episode like your sheet already does.
- **All lists** have search and sorting. Tap any row to edit it.
- Data is cached on the device, so the app opens instantly and shows your last sync even offline. It refreshes when you open it after 5+ minutes away, or when you tap the sync label up top.

## Good to know

- **Formulas are never touched.** Days to Finish, Episodes Watched, Total Time Watched and the other formula columns are skipped on write. New rows copy formatting and formulas from the row above, so they match the rest of the sheet.
- **Rows go right after your last entry**, not below the pre-filled Days to Finish formulas.
- **Header check:** every request checks your column headers. If you rename or move a column, the app stops with a clear message instead of writing into the wrong spot.
- **Text that looks like a date or number** (like "8/10" in Thoughts) is saved with a leading apostrophe so Sheets keeps it as text. You'll see the apostrophe if you click into the cell in Sheets; it doesn't show otherwise.
- **Edits are safe from shifted rows:** if you sort or insert rows in the sheet while the app is open, saving an edit will ask you to refresh instead of overwriting the wrong row.
- **No delete yet.** Delete rows in the sheet directly for now.
- **Updating the app:** after changing front end files on GitHub, bump `CACHE` in `sw.js` (for example `media-tracker-v2`) so phones pick up the new version cleanly.
