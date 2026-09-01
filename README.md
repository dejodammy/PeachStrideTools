# Bulk Mailer

A local web app for sending a personalized bulk email campaign from a spreadsheet — with an
optional personalized PDF attachment generated per recipient.

Node/Express backend, React frontend, no cloud services involved. Runs entirely on your machine.

## Running it

**Easiest:** double-click `run_app.bat`. It installs dependencies (first run only), builds the
app, opens your browser, and starts the server at `http://127.0.0.1:5000`.

**Manually:**

```powershell
npm run setup   # first time only — installs server + client dependencies
npm start       # builds the client and starts the server
```

Then open `http://127.0.0.1:5000`.

### Requirements

- Node.js 18+
- Google Chrome or Microsoft Edge installed (used headlessly to render personalized PDFs — no
  separate download needed, the app drives whichever one is already on your machine)

## How it works

1. **Compose** — upload a recipient spreadsheet (`.xlsx`/`.xls`, must have a column named exactly
   `Email`), write the subject and body, and optionally attach a file or enable a personalized PDF.
2. **Preview & send** — see the rendered email and PDF for your first recipient, review the full
   recipient list, enter your SMTP sender details, and type `SEND` to confirm.
3. **Sending** — the app sends one email at a time (with a configurable delay between sends) and
   shows live progress.
4. **Done** — a downloadable CSV log records the outcome (sent/failed + reason) for every recipient.

### Placeholders

Any column from your spreadsheet can be used in the subject, body, or PDF template:

- `{{ColumnName}}` — works when the header has no spaces (e.g. `{{Location}}`)
- `{{lookup this "Column Name"}}` — always works, including headers with spaces

### Personalized PDFs

Enable the checkbox on the compose step and edit the HTML template that's pre-filled for you (a
letterhead-style starter). It's plain HTML/CSS with the placeholders above — no separate template
language to learn. One PDF is generated per recipient at send time and attached only to their email.

### Sending credentials

Use a Gmail **App Password**, not your normal password
(https://myaccount.google.com/apppasswords). The password is only held in memory for the duration
of the send and is never written to disk.

### Resuming an interrupted send

If the app or your machine is interrupted mid-campaign, sending the same campaign again picks up
where it left off — recipients already marked "sent" in that campaign's log are skipped.

## Project layout

```
server/           Express API (Node, ES modules)
  src/services/    excel parsing, Handlebars templating, PDF rendering (Puppeteer), SMTP sending, storage
  src/routes/      campaign endpoints
  templates/       starter PDF letter template
  data/campaigns/  per-campaign runtime data (recipients, generated PDFs, send logs) — not committed
client/           React app (Vite)
  src/pages/       the 4-step wizard: Compose, Preview, Sending, Done
```

## Other files in this folder

- `employee.xlsx`, `employees.xlsx`, `empp.xlsx` — recipient spreadsheets from past campaigns
- `guarantor_form.pdf`, `handbook.pdf` — reference documents
- `letters/` — archived salary review letters issued previously (not read by the app)
