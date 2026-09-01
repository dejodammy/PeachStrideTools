import smtplib
import os
import pandas as pd
from email.message import EmailMessage

# === CONFIGURATION ===
EXCEL_FILE = "employees.xlsx"   # Excel file with columns: Name, Email
SENDER_EMAIL = "pplimitedrecruitment@gmail.com"
SENDER_PASSWORD = os.getenv("ASSESSMENT_SMTP_PASSWORD", "")
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587

# === EMAIL CONTENT ===
SUBJECT = "SUBJECT: Outcome of Your NBC Assessment"

BODY_TEMPLATE = """Dear {name},

Thank you for participating in the NBC assessment process.

After careful review, we regret to inform you that your assessment result was graded D, which does not meet the requirement to progress to the next stage at this time.

We sincerely appreciate the time, effort, and interest you invested in the process, and we encourage you not to be discouraged. Your details will remain on file, and we may reach out should suitable opportunities arise in the future.

We wish you every success in your future endeavors.

Warm regards,
Peach Strides & Pristine Recruitment Team
"""

# === LOAD EMPLOYEES DATA ===
df = pd.read_excel(EXCEL_FILE)

# === SEND EMAIL FUNCTION ===
def send_email(name, recipient_email):
    if not SENDER_PASSWORD:
        raise RuntimeError("Set ASSESSMENT_SMTP_PASSWORD before running this legacy script.")
    # Create email
    msg = EmailMessage()
    msg["Subject"] = SUBJECT
    msg["From"] = SENDER_EMAIL
    msg["To"] = recipient_email
    msg.set_content(BODY_TEMPLATE.format(name=name))

    # Send email
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
    send_email(name, email)
