"""Local browser interface for Recruitment Desk."""

import io
import os
import smtplib
import uuid
from email.message import EmailMessage
from pathlib import Path

import pandas as pd
from flask import Flask, abort, flash, redirect, render_template, request, send_file, url_for
from werkzeug.utils import secure_filename

from recruitment_gui import (
    ASSESSMENT_BODY,
    ASSESSMENT_SUBJECT,
    DOCUMENT_REQUEST_BODY,
    DOCUMENT_REQUEST_SUBJECT,
    read_cv,
)


BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "web_uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
ALLOWED_CV_EXTENSIONS = {".pdf", ".docx"}
RESULTS = {}
CAMPAIGNS = {}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024
app.config["SECRET_KEY"] = os.environ.get("RECRUITMENT_WEB_SECRET", uuid.uuid4().hex)


def save_upload(file, allowed_extensions=None):
    filename = secure_filename(file.filename or "")
    suffix = Path(filename).suffix.lower()
    if not filename:
        raise ValueError("Choose a file.")
    if allowed_extensions and suffix not in allowed_extensions:
        raise ValueError("Unsupported file type: " + suffix)
    destination = UPLOAD_DIR / f"{uuid.uuid4().hex}_{filename}"
    file.save(destination)
    return destination


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/extract", methods=["POST"])
def extract_cvs():
    files = [file for file in request.files.getlist("cvs") if file.filename]
    if not files:
        flash("Select one or more PDF or DOCX CV files.", "error")
        return redirect(url_for("home") + "#extract")

    rows, failures = [], []
    for file in files:
        path = None
        try:
            path = save_upload(file, ALLOWED_CV_EXTENSIONS)
            row = read_cv(path)
            row["filename"] = file.filename
            rows.append(row)
        except Exception as error:
            failures.append(f"{file.filename}: {error}")
        finally:
            if path:
                path.unlink(missing_ok=True)

    if not rows:
        flash("None of the selected files could be processed.", "error")
        return redirect(url_for("home") + "#extract")

    output = io.BytesIO()
    pd.DataFrame(rows, columns=["filename", "name", "email", "phone"]).to_excel(output, index=False)
    output.seek(0)
    result_id = uuid.uuid4().hex
    RESULTS[result_id] = output.getvalue()
    return render_template("extraction_result.html", rows=rows, failures=failures, result_id=result_id)


@app.route("/download/<result_id>")
def download_result(result_id):
    data = RESULTS.get(result_id)
    if data is None:
        abort(404)
    return send_file(
        io.BytesIO(data),
        as_attachment=True,
        download_name="extracted_cvs.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.route("/campaign/preview", methods=["POST"])
def preview_campaign():
    campaign_type = request.form.get("campaign_type", "")
    if campaign_type not in {"document", "assessment"}:
        abort(400)
    spreadsheet = None
    try:
        spreadsheet = save_upload(request.files.get("spreadsheet"), {".xlsx", ".xls"})
        recipients = pd.read_excel(spreadsheet)
        required = {"Name", "Email"}
        if campaign_type == "document":
            required.add("Location")
        missing = required - set(recipients.columns)
        if missing:
            raise ValueError("Your spreadsheet is missing: " + ", ".join(sorted(missing)))
        recipients = recipients.dropna(subset=["Email"]).fillna("")
        recipients["Email"] = recipients["Email"].astype(str).str.strip()
        if recipients.empty:
            raise ValueError("The spreadsheet has no recipients with an email address.")
        attachment = request.files.get("attachment")
        attachment_path = save_upload(attachment) if attachment and attachment.filename else None
    except Exception as error:
        flash(str(error), "error")
        return redirect(url_for("home") + "#campaign")
    finally:
        if spreadsheet:
            spreadsheet.unlink(missing_ok=True)

    campaign_id = uuid.uuid4().hex
    CAMPAIGNS[campaign_id] = {
        "type": campaign_type,
        "recipients": recipients.to_dict("records"),
        "attachment": attachment_path,
    }
    return render_template("campaign_preview.html", campaign_id=campaign_id, campaign=CAMPAIGNS[campaign_id])


@app.route("/campaign/send/<campaign_id>", methods=["POST"])
def send_campaign(campaign_id):
    campaign = CAMPAIGNS.get(campaign_id)
    if campaign is None:
        flash("This campaign preview has expired. Upload the spreadsheet again.", "error")
        return redirect(url_for("home") + "#campaign")

    sender = request.form.get("sender", "").strip()
    password = request.form.get("password", "")
    smtp_server = request.form.get("smtp_server", "smtp.gmail.com").strip()
    try:
        smtp_port = int(request.form.get("smtp_port", "587"))
    except ValueError:
        flash("SMTP port must be a number.", "error")
        return render_template("campaign_preview.html", campaign_id=campaign_id, campaign=campaign)
    if not sender or not password or request.form.get("confirmation") != "SEND":
        flash("Enter your email, app password, and type SEND to confirm.", "error")
        return render_template("campaign_preview.html", campaign_id=campaign_id, campaign=campaign)

    attachment = campaign["attachment"]
    attachment_data = attachment.read_bytes() if attachment else None
    sent, failures = 0, []
    try:
        with smtplib.SMTP(smtp_server, smtp_port, timeout=30) as server:
            server.starttls()
            server.login(sender, password)
            for recipient in campaign["recipients"]:
                try:
                    message = EmailMessage()
                    message["From"] = sender
                    message["To"] = recipient["Email"]
                    if campaign["type"] == "document":
                        message["Subject"] = DOCUMENT_REQUEST_SUBJECT
                        message.set_content(DOCUMENT_REQUEST_BODY.format(name=recipient["Name"], location=recipient["Location"]))
                    else:
                        message["Subject"] = ASSESSMENT_SUBJECT
                        message.set_content(ASSESSMENT_BODY.format(name=recipient["Name"]))
                    if attachment:
                        message.add_attachment(attachment_data, maintype="application", subtype="octet-stream", filename=attachment.name.split("_", 1)[-1])
                    server.send_message(message)
                    sent += 1
                except Exception as error:
                    failures.append(f"{recipient['Email']}: {error}")
    except Exception as error:
        failures.append(f"SMTP connection: {error}")

    CAMPAIGNS.pop(campaign_id, None)
    if attachment:
        attachment.unlink(missing_ok=True)
    return render_template("campaign_complete.html", sent=sent, failures=failures)


@app.errorhandler(413)
def file_too_large(_error):
    flash("Uploads are limited to 30 MB per request.", "error")
    return redirect(url_for("home")), 413


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
