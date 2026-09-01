# Recruitment Desk

`web_app.py` combines the existing recruitment scripts into a local browser application.

Run it from this folder:

```powershell
python web_app.py
```

Then open `http://127.0.0.1:5000` in your browser. The application provides two workflows:

You can also double-click `run_web_app.bat`; it opens the browser and starts the local site.

- **CV Extraction**: choose a folder containing `.pdf` and `.docx` CVs, then export detected names, emails and phone numbers to Excel.
- **Email Campaigns**: choose an Excel recipient list, preview recipients, then send a document-request or assessment-outcome campaign.

For recipient lists, Excel headers must be exactly `Name` and `Email`. The document-request campaign also requires `Location`.

Use a Gmail App Password, not your normal Gmail password. The site does not save the password. Sending a campaign always asks for confirmation first.
