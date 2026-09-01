import smtplib
import os
import pandas as pd
from email.message import EmailMessage

# === CONFIGURATION ===
EXCEL_FILE = "empp.xlsx"   # Excel file with columns: Name, Email, Location
GUARANTOR_FORM = "guarantor_form.pdf"   # PDF file you want to attach
SENDER_EMAIL = "pplimitedemployment@gmail.com"
SENDER_PASSWORD = os.getenv("DOCUMENT_REQUEST_SMTP_PASSWORD", "")
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587

# === EMAIL CONTENT ===
SUBJECT = "Request for Supporting Documents – Open Market Sales Representative"

BODY_TEMPLATE = """Dear {name},
Please ignore earlier email

Having received your CV and application for employment for the role of an Open Market Sales Representative in {location}, kindly revert with the following documents within the soonest possible time.

1- CV

2- Educational Qualification (Minimum OND)

3- Complete the guarantor's form for two guarantors

4- Updated Medical report and your passport photograph

Please note: Scan all documents in a single PDF file and send them back to this email.

After sending the complete document listed above, you can call or reach us via WhatsApp on 07088992234 immediately.

Regards,
Peachstrides and Pristine Recruitment Team
"""

# === LOAD EMPLOYEE DATA ===
df = pd.read_excel(EXCEL_FILE)

# === SEND EMAIL FUNCTION ===
def send_email(name, recipient_email, location):
    if not SENDER_PASSWORD:
        raise RuntimeError("Set DOCUMENT_REQUEST_SMTP_PASSWORD before running this legacy script.")
    msg = EmailMessage()
    msg["Subject"] = SUBJECT
    msg["From"] = SENDER_EMAIL
    msg["To"] = recipient_email
    msg.set_content(BODY_TEMPLATE.format(name=name, location=location))

    # Attach the Guarantor Form PDF
    try:
        with open(GUARANTOR_FORM, "rb") as pdf:
            msg.add_attachment(
                pdf.read(),
                maintype="application",
                subtype="pdf",
                filename="Guarantor_Form.pdf"
            )
    except FileNotFoundError:
        print("❌ Guarantor form file not found. Please check the file path.")
        return

    # Send the email
    try:
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(SENDER_EMAIL, SENDER_PASSWORD)
            server.send_message(msg)
            print(f"✅ Email sent to {name} ({recipient_email})")
    except Exception as e:
        print(f"❌ Failed to send email to {name}: {e}")

# === MAIN LOOP ===
for _, row in df.iterrows():
    name = row["Name"]
    email = row["Email"]
    location = row["Location"]
    send_email(name, email, location)
