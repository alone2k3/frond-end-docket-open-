# Front End Docket

A digital version of the **Front End Docket (Shoot Review Sheet) attendance report** used on film shoots.
It is a web app: open the link on any phone, tablet or laptop, and it can be added to the home screen like an app.
With the shared database turned on, everyone sees the same sheet and changes show up on every device within a second or two.

## What it does

- One sheet per shooting day, with a list of past days
- Shoot header: date, movie or show, location, scheduled and actual shift
- Attendance register: name, department, card no., time in and out, signatures, amount
- "Now" buttons for time in and out, finger or mouse signature pads
- Live headcount, with a count for each department
- Saved crew list, so repeat crew fill in their department and card number
- Production Team and SAGE Team signature boxes
- Copy for Excel, Download CSV, and Print / Save PDF (A4 landscape, laid out like the paper sheet)
- Login with three kinds of account: **Editor** (can change everything), **Viewer** (can only look), **Pending** (waiting for approval, sees nothing)
- Works offline: changes made with no signal are kept on the device and uploaded when the connection returns

Without a database the app runs in **demo mode**: no login, sample rows, data stays on that one device.

## Set up the shared database (about 10 minutes)

1. Create a free project at https://supabase.com.
2. In the project open **SQL Editor, New query**, paste the whole of `schema.sql`, and press **Run**.
   Do this before anyone creates an account.
3. Open **Project Settings, API** and copy the **Project URL** and the **anon public** key.
   Paste them into `config.js`. The anon key is meant to be public. Never use the `service_role` key.
4. In **Authentication, Providers, Email**, either turn off "Confirm email" (quickest for a small unit)
   or leave it on so people confirm their address by email.
5. Host the app (next section), open it, and **create your own account first**. The first account becomes the Editor.
6. Everyone else creates an account and sees "Waiting for approval". An editor opens **Team access** at the bottom
   of the sheet and sets each person to **Viewer** or **Editor**.

Who can do what:

| | Pending | Viewer | Editor |
|---|---|---|---|
| See sheets, crew and signatures | No | Yes | Yes |
| Add, change or delete entries | No | No | Yes |
| Approve people and change access | No | No | Yes |

These rules are enforced by the database itself (row level security), not just hidden in the screen.

## Put it on GitHub and host it on Vercel

Vercel hosts the app for free and updates it every time you push to GitHub. No build step is needed.

1. Create a new repository on GitHub, for example `front-end-docket`, and push this folder to it:

   ```
   git remote add origin https://github.com/<your-username>/front-end-docket.git
   git push -u origin main
   ```

2. Go to https://vercel.com/new, sign in with GitHub, and **Import** the repository.
3. Leave every setting as it is (Framework Preset: **Other**, no build command, no output directory) and press **Deploy**.
4. In about a minute you get a link like `https://front-end-docket.vercel.app`. Open it on the phones and tablets.
5. In Supabase open **Authentication, URL Configuration** and set **Site URL** to that Vercel link,
   so confirmation emails send people to the right place.

From then on, every change pushed to `main` goes live on its own. You can also add your own domain in Vercel under
**Settings, Domains**.

No GitHub? From this folder run `npx vercel` and follow the prompts, then `npx vercel --prod` to publish.

## Install on a phone or tablet

- **Android (Chrome):** open the link, then menu, **Install app**.
- **iPhone or iPad (Safari):** open the link, tap Share, then **Add to Home Screen**.

## Run it on your computer

No build step. Any static server works:

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Things to know

- One sheet per date. Two shows shooting on the same date share one docket.
- If two people edit the same field at the same moment, the last change wins. Different fields on the same row merge fine.
- Signatures are stored as small images in the database.
- After you change any file, raise `VERSION` in `sw.js` so installed copies pick up the update.
- If the Supabase free project is paused after a week without use, open its dashboard and press **Restore**.

## Tests that were run

- Real SQL and permission rules, run in a Postgres engine: first account is editor, new accounts are pending and read nothing,
  viewers cannot add, change, delete or promote themselves, deleting a day removes its rows.
- Two simulated devices against a stand-in database: rows, times, signatures, headcount, show title and team signatures
  appear live on the second device; typing is sent after a short pause; changes made offline upload on reconnect without
  duplicates; the approval flow; sign out.
- Demo mode: add, Now, two-step delete, clear sample.

Not tested yet: the real Supabase service (live sockets and email login), and how the pages look on real phones, tablets
and printers. Check those on the first real run.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `styles.css` | Layout, light and dark themes, print layout |
| `app.js` | Screen logic, signature pad, exports |
| `store.js` | Data layer: demo store and Supabase store with live updates and offline queue |
| `config.js` | Your Supabase URL and anon key |
| `schema.sql` | Database tables, access rules and live-update setup |
| `supabase-js.js` | Supabase client library (bundled so the app also loads offline) |
| `sw.js` | Offline cache |
| `manifest.webmanifest` | Install details and icons |
| `vercel.json` | Hosting settings for Vercel (caching and security headers) |

## Roadmap

- The other 14 reports from the docket index (Junior Artist, Camera, Generator, Vehicle and so on) on the same database
- Tamil labels
