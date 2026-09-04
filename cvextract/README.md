# cvextract

Pulls **names, emails and phone numbers** out of a folder of CVs and writes a spreadsheet.

Runs entirely on your machine. No internet, no API key, no model. Same input, same
output, every time — and every decision it makes is a line of code you can read.

---

## Install

```
pip install pymupdf python-docx openpyxl pillow lxml
```

That is the only step that needs the internet, and only once.

| Thing | Needed for | If missing |
|---|---|---|
| Windows 10/11 | OCR of scanned CVs | Scanned PDFs come back empty and get flagged |
| Word **or** LibreOffice | legacy `.doc` files | `.doc` files are reported as unreadable, never silently dropped |

## Use

```
python cvextract.py <folder>                              # writes cv_contacts.xlsx
python cvextract.py <folder> -o january.xlsx              # name the output
python cvextract.py <folder> --csv                        # also write a .csv
python cvextract.py <folder> --master contacts_master.xlsx  # append new people
python cvextract.py <folder> --watch                      # keep running, pick up new files
```

Handles `.pdf`, `.docx`, `.doc`. Spreadsheets and images in the folder are ignored.

## What you get

A workbook with four sheets:

| Sheet | What's on it |
|---|---|
| **Contacts** | Every CV. Amber rows carry a flag. |
| **Needs Review** | Only the flagged rows — start here. |
| **Clean** | Rows with nothing flagged. |
| **Flag Guide** | What each flag actually means. |

Console output marks flagged rows with `!` so you can see the shape of a batch as it runs.

---

## The part that matters

**It does not try to be right about everything. It tries to be honest about what it
isn't sure of.**

That distinction is the whole design. A CV that puts the candidate's email in a Word
text box will, with ordinary tooling, hand you the **referee's** address under the
candidate's name. Not a blank. Not an error. A confident wrong answer that looks
exactly like a right one. Send that list and you've written to someone's referee about
a job they didn't apply for.

So rows the tool is unsure about go to **Needs Review** rather than being quietly
guessed at.

### Measured on 60 real CVs

```
correct                 57/60   (95%)
sent to review          12/60   (20%)
wrong                    3
wrong but NOT flagged    0      <- the number that matters
```

Every row it got wrong, it flagged. Twenty percent of a batch needs a human glance;
the errors are inside that twenty percent.

Do not read 95% as a promise. Those 60 CVs are the ones the heuristics were built
against. An earlier version scored 95% on the first batch and **82%** on a fresh one.
Expect drift on new sources — which is exactly why the review queue exists.

## Flags

| Flag | Means |
|---|---|
| `NO_EMAIL` | No address anywhere in the document |
| `MULTI_EMAIL` | Several addresses outside the referee block; best name match used, others kept |
| `OCR_USED` | No text layer — read from the page image; check the characters |
| `NAME_LOW_CONFIDENCE` | No line looked clearly like a name |
| `NAME_FROM_FILENAME` | No name in the document at all |
| `NAME_JOINED_FROM_TWO_LINES` | Name was split across lines and rejoined, vouched for by the email |
| `DOMAIN_NEAR_<domain>` | Domain is 1–2 letters off a common provider — typo, or a real rarer host |
| `EMAIL_LABEL_STRIPPED` | A label was glued to the address (`Email-name@x.com`); removed, confirm it |
| `EMAIL_ONLY_IN_REFEREE_BLOCK` | The only address sits under REFEREES — may not be the candidate's |
| `DUPLICATE_IN_BATCH` | Same address on more than one CV |
| `NO_PHONE` | No phone number, Nigerian or foreign, found outside the referee block |
| `FOREIGN_PHONE` | No Nigerian mobile on the CV — a non-Nigerian number was used instead; check it |
| `UNSUPPORTED_FORMAT` / `NO_TEXT_FOUND` / `READ_FAILED` | Nothing was extracted |

## How it reads things

**`.docx`** — walks the WordprocessingML in document order rather than using
`python-docx`'s `.paragraphs`, which never descends into `w:txbxContent` and so misses
**text boxes** entirely. Field codes (`HYPERLINK "mailto:..."`) are deliberately
skipped: those targets are often a stale address the author edited away from, and are
not what a reader of the CV sees.

**`.pdf`** — PyMuPDF text layer. Under 200 characters it falls back to OCR, preferring
the *embedded* scan at native resolution over re-rendering the page: rendering a
low-resolution scan at high DPI only interpolates and adds nothing the OCR can use.

**`.doc`** — Word COM automation, falling back to LibreOffice.

**Emails** — everything under a `REFEREES` / `REFERENCES` / `RECOMMENDATIONS` heading is
cut before matching, so referees' addresses can't be mistaken for the candidate's. The
heading match tolerates the letter-spacing designed CVs use (`R E F E R E N C E S`).
Remaining candidates are ranked by how well they match the file name.

**Phones** — Nigerian mobiles, normalised to `0XXXXXXXXXX` from `+234`, `(0)` and
whatever punctuation the CV used. Two numbers written `0816… / 0813…` become a single
digit run once separators are stripped, so valid numbers are peeled off the front
rather than the whole run being read as one bad number. Referee numbers are cut the
same way as referee emails.

If a CV has no Nigerian number at all, a foreign one is used instead — anything
opening with `+` or the `00` access code, normalised to `+<countrycode><number>`.
That pattern is much looser than the Nigerian one (it can't validate a foreign
number's shape the way it can a Nigerian mobile's), so it only ever runs as a
fallback and is flagged `FOREIGN_PHONE` for a second look.

**Names** — a `Name:` field wins if there is one. Otherwise lines are scored on shape,
position, and character overlap with the email's local part — the email is the most
useful corroborating signal available, since `muritalanurat2019@` will find
`MURITALA AYOMIDE NURAT` in the right-hand column of a two-column CV where the first
line reads "CONTACT".

## `--master`

Appends people who aren't already there, matching on email. **Only clean rows are
appended** — anything flagged is held back for you to look at first.

Existing rows are never touched. Nothing is renamed, reformatted or repaired. A
malformed row gets flagged, never fixed, because guessing at somebody's contact
address is fabrication wearing the costume of a correction.

Finds the contact sheet by looking for an `Email` column header, so a workbook that
leads with a Read Me sheet works fine.

## Limits worth knowing

- Phone patterns are tuned for **Nigerian** mobiles first; a foreign number is only
  read as a fallback (flagged `FOREIGN_PHONE`) and isn't validated as tightly.
- OCR is the Windows on-device engine — Windows only. Swap in Tesseract for portability.
- Faint or low-contrast scanned print can defeat OCR entirely. It flags `OCR_USED` so
  you know to look, but it cannot tell you *which* characters it got wrong.
- Only the first 3 pages of a scanned PDF are OCR'd.
