"""Desktop GUI for CV extraction and recruitment email campaigns."""

import os
import re
import smtplib
import threading
from email.message import EmailMessage
from pathlib import Path
from tkinter import END, LEFT, RIGHT, StringVar, Text, Tk, filedialog, messagebox, ttk

import pandas as pd
from PyPDF2 import PdfReader
from docx import Document


EMAIL_PATTERN = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
PHONE_PATTERN = re.compile(r"(\+?\d[\d\-\s]{7,}\d)")
INVALID_NAME_WORDS = {
    "curriculum vitae", "cv", "resume", "about me", "profile", "objective",
    "personal information", "contact", "summary", "experience", "education",
    "skills", "references", "employment", "work history", "qualifications",
    "career", "background", "achievements", "certifications", "projects",
}

DOCUMENT_REQUEST_SUBJECT = "Request for Supporting Documents - Open Market Sales Representative"
DOCUMENT_REQUEST_BODY = """Dear {name},

Please ignore earlier email.

Having received your CV and application for employment for the role of an Open Market Sales Representative in {location}, kindly revert with the following documents within the soonest possible time.

1. CV
2. Educational Qualification (Minimum OND)
3. Complete the guarantor's form for two guarantors
4. Updated medical report and passport photograph

Please scan all documents into a single PDF file and reply to this email.

After sending the complete documents, you can call or reach us via WhatsApp on 07088992234 immediately.

Regards,
Peachstrides and Pristine Recruitment Team
"""

ASSESSMENT_SUBJECT = "Outcome of Your NBC Assessment"
ASSESSMENT_BODY = """Dear {name},

Thank you for participating in the NBC assessment process.

After careful review, we regret to inform you that your assessment result was graded D, which does not meet the requirement to progress to the next stage at this time.

We sincerely appreciate the time, effort, and interest you invested in the process. Your details will remain on file, and we may reach out should suitable opportunities arise in the future.

We wish you every success in your future endeavors.

Warm regards,
Peach Strides & Pristine Recruitment Team
"""


def clean_name(value: str) -> str:
    value = re.sub(r"[_\-\.\d]", " ", value)
    value = re.sub(r"\b(cv|resume|document|copy|pdf|docx|edited|updated?)\b", "", value, flags=re.I)
    value = re.sub(r"\(.*?\)", "", value)
    return re.sub(r"\s+", " ", value).strip().title()


def looks_like_name(value: str) -> bool:
    words = value.strip().split()
    if not 1 <= len(words) <= 4:
        return False
    for word in words:
        letters = re.sub(r"[^A-Za-z]", "", word)
        if not 2 <= len(letters) <= 20:
            return False
    return True


def extract_contact_details(text: str, filename: str) -> dict:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    result = {"filename": filename, "name": "", "email": "", "phone": ""}

    for line in lines[:20]:
        lowered = line.lower()
        if any(word in lowered for word in INVALID_NAME_WORDS):
            continue
        if EMAIL_PATTERN.search(line) or PHONE_PATTERN.search(line) or len(line) > 50:
            continue
        if looks_like_name(line):
            result["name"] = clean_name(line)
            break

    if not result["name"]:
        match = re.search(r"(?:name|full\s*name)\s*[:\-]\s*([A-Za-z\s]{2,30})", text, re.I)
        if match and looks_like_name(match.group(1)):
            result["name"] = clean_name(match.group(1))
        else:
            fallback = clean_name(Path(filename).stem)
            result["name"] = fallback if looks_like_name(fallback) else ""

    if match := EMAIL_PATTERN.search(text):
        result["email"] = match.group().lower()
    if match := PHONE_PATTERN.search(text):
        phone = re.sub(r"\D", "", match.group())
        if phone.startswith("234") and len(phone) >= 11:
            phone = "0" + phone[3:]
        if 8 <= len(phone) <= 15:
            result["phone"] = phone
    return result


def read_cv(path: Path) -> dict:
    text = ""
    if path.suffix.lower() == ".pdf":
        for page in PdfReader(str(path)).pages:
            text += (page.extract_text() or "") + "\n"
    elif path.suffix.lower() == ".docx":
        document = Document(str(path))
        text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    return extract_contact_details(text, path.name)


class RecruitmentApp:
    def __init__(self, root: Tk):
        self.root = root
        self.root.title("Recruitment Desk")
        self.root.minsize(860, 640)
        self.root.option_add("*Font", "Segoe UI 10")
        self.style = ttk.Style()
        self.style.theme_use("clam")
        self.style.configure("Accent.TButton", foreground="white", background="#0b6e4f", padding=(12, 7))
        self.style.configure("TNotebook.Tab", padding=(16, 9))

        self.cv_folder = StringVar()
        self.cv_output = StringVar(value=str(Path.cwd() / "extracted_cvs.xlsx"))
        self.excel_file = StringVar()
        self.attachment_file = StringVar()
        self.campaign_type = StringVar(value="Document request")
        self.sender_email = StringVar()
        self.sender_password = StringVar()
        self.smtp_server = StringVar(value="smtp.gmail.com")
        self.smtp_port = StringVar(value="587")

        self._build_header()
        notebook = ttk.Notebook(root)
        notebook.pack(fill="both", expand=True, padx=18, pady=(0, 18))
        self._build_cv_tab(notebook)
        self._build_email_tab(notebook)

    def _build_header(self):
        frame = ttk.Frame(self.root, padding=(20, 18, 20, 10))
        frame.pack(fill="x")
        ttk.Label(frame, text="Recruitment Desk", font=("Segoe UI Semibold", 22)).pack(anchor="w")
        ttk.Label(frame, text="Extract applicant details and send controlled, personalised recruitment emails.").pack(anchor="w", pady=(3, 0))

    @staticmethod
    def _file_row(parent, row, label, variable, command, button_text="Browse"):
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", pady=7)
        ttk.Entry(parent, textvariable=variable, width=72).grid(row=row, column=1, sticky="ew", padx=10, pady=7)
        ttk.Button(parent, text=button_text, command=command).grid(row=row, column=2, pady=7)
        parent.columnconfigure(1, weight=1)

    def _build_cv_tab(self, notebook):
        tab = ttk.Frame(notebook, padding=20)
        notebook.add(tab, text="CV Extraction")
        ttk.Label(tab, text="Create a spreadsheet from PDF and Word CVs", font=("Segoe UI Semibold", 14)).pack(anchor="w")
        ttk.Label(tab, text="The output includes filename, detected name, email address and phone number.").pack(anchor="w", pady=(4, 18))
        form = ttk.Frame(tab)
        form.pack(fill="x")
        self._file_row(form, 0, "CV folder", self.cv_folder, self._choose_cv_folder, "Choose folder")
        self._file_row(form, 1, "Save Excel file as", self.cv_output, self._choose_cv_output, "Save as")
        ttk.Button(tab, text="Extract CV details", style="Accent.TButton", command=self.extract_cvs).pack(anchor="w", pady=(15, 12))
        self.cv_log = Text(tab, height=18, state="disabled", wrap="word", background="#f5f7f6", relief="flat")
        self.cv_log.pack(fill="both", expand=True)

    def _build_email_tab(self, notebook):
        tab = ttk.Frame(notebook, padding=20)
        notebook.add(tab, text="Email Campaigns")
        ttk.Label(tab, text="Send emails from an Excel list", font=("Segoe UI Semibold", 14)).pack(anchor="w")
        ttk.Label(tab, text="Required columns: Name and Email. Document requests also require Location.").pack(anchor="w", pady=(4, 18))
        form = ttk.Frame(tab)
        form.pack(fill="x")
        self._file_row(form, 0, "Recipient Excel file", self.excel_file, self._choose_excel)
        self._file_row(form, 1, "Attachment (optional)", self.attachment_file, self._choose_attachment)
        ttk.Label(form, text="Campaign type").grid(row=2, column=0, sticky="w", pady=7)
        ttk.Combobox(form, textvariable=self.campaign_type, values=["Document request", "Assessment outcome"], state="readonly", width=28).grid(row=2, column=1, sticky="w", padx=10, pady=7)
        ttk.Separator(tab).pack(fill="x", pady=16)
        credentials = ttk.Frame(tab)
        credentials.pack(fill="x")
        ttk.Label(credentials, text="SMTP email settings", font=("Segoe UI Semibold", 12)).grid(row=0, column=0, columnspan=4, sticky="w", pady=(0, 7))
        self._field(credentials, 1, 0, "Sender email", self.sender_email)
        self._field(credentials, 1, 2, "App password", self.sender_password, show="*")
        self._field(credentials, 2, 0, "SMTP server", self.smtp_server)
        self._field(credentials, 2, 2, "Port", self.smtp_port)
        credentials.columnconfigure(1, weight=1)
        credentials.columnconfigure(3, weight=1)
        controls = ttk.Frame(tab)
        controls.pack(fill="x", pady=16)
        ttk.Button(controls, text="Preview recipients", command=self.preview_recipients).pack(side=LEFT)
        ttk.Button(controls, text="Send campaign", style="Accent.TButton", command=self.start_campaign).pack(side=RIGHT)
        self.email_log = Text(tab, height=14, state="disabled", wrap="word", background="#f5f7f6", relief="flat")
        self.email_log.pack(fill="both", expand=True)

    @staticmethod
    def _field(parent, row, column, label, variable, show=None):
        ttk.Label(parent, text=label).grid(row=row, column=column, sticky="w", padx=(0, 7), pady=6)
        ttk.Entry(parent, textvariable=variable, show=show, width=27).grid(row=row, column=column + 1, sticky="ew", padx=(0, 15), pady=6)

    def _choose_cv_folder(self):
        if path := filedialog.askdirectory(title="Choose CV folder"):
            self.cv_folder.set(path)

    def _choose_cv_output(self):
        if path := filedialog.asksaveasfilename(defaultextension=".xlsx", filetypes=[("Excel files", "*.xlsx")]):
            self.cv_output.set(path)

    def _choose_excel(self):
        if path := filedialog.askopenfilename(filetypes=[("Excel files", "*.xlsx *.xls")]):
            self.excel_file.set(path)

    def _choose_attachment(self):
        if path := filedialog.askopenfilename():
            self.attachment_file.set(path)

    def _write_log(self, widget, message):
        widget.configure(state="normal")
        widget.insert(END, message + "\n")
        widget.see(END)
        widget.configure(state="disabled")

    def extract_cvs(self):
        folder = Path(self.cv_folder.get())
        output = Path(self.cv_output.get())
        if not folder.is_dir() or not output.name:
            messagebox.showerror("Missing information", "Choose a CV folder and an Excel output file.")
            return
        self._write_log(self.cv_log, f"Scanning {folder}...")
        threading.Thread(target=self._extract_cvs_worker, args=(folder, output), daemon=True).start()

    def _extract_cvs_worker(self, folder: Path, output: Path):
        rows, errors = [], []
        files = [path for path in folder.iterdir() if path.suffix.lower() in {".pdf", ".docx"}]
        for path in files:
            try:
                rows.append(read_cv(path))
            except Exception as error:
                errors.append(f"{path.name}: {error}")
        try:
            pd.DataFrame(rows, columns=["filename", "name", "email", "phone"]).to_excel(output, index=False)
            self.root.after(0, lambda: self._write_log(self.cv_log, f"Finished: {len(rows)} CVs saved to {output}"))
            if errors:
                self.root.after(0, lambda: self._write_log(self.cv_log, f"Skipped {len(errors)} unreadable file(s)."))
        except Exception as error:
            self.root.after(0, lambda: messagebox.showerror("Export failed", str(error)))

    def _load_recipients(self):
        path = Path(self.excel_file.get())
        if not path.is_file():
            raise ValueError("Choose a recipient Excel file.")
        data = pd.read_excel(path)
        required = {"Name", "Email"}
        if self.campaign_type.get() == "Document request":
            required.add("Location")
        missing = required - set(data.columns)
        if missing:
            raise ValueError("Excel file is missing column(s): " + ", ".join(sorted(missing)))
        data = data.dropna(subset=["Email"])
        data["Email"] = data["Email"].astype(str).str.strip()
        return data

    def preview_recipients(self):
        try:
            data = self._load_recipients()
            sample = "\n".join(f"- {row.Name}: {row.Email}" for row in data.head(8).itertuples())
            self._write_log(self.email_log, f"Ready to send to {len(data)} recipient(s).\n{sample}")
        except Exception as error:
            messagebox.showerror("Cannot load recipients", str(error))

    def start_campaign(self):
        try:
            recipients = self._load_recipients()
            port = int(self.smtp_port.get())
        except Exception as error:
            messagebox.showerror("Cannot start campaign", str(error))
            return
        if not self.sender_email.get().strip() or not self.sender_password.get():
            messagebox.showerror("Missing credentials", "Enter a sender email and its SMTP app password.")
            return
        if self.attachment_file.get() and not Path(self.attachment_file.get()).is_file():
            messagebox.showerror("Attachment missing", "Choose an existing attachment or clear that field.")
            return
        approved = messagebox.askyesno(
            "Confirm bulk email",
            f"Send the {self.campaign_type.get().lower()} campaign to {len(recipients)} recipient(s)?\n\nThis sends real emails immediately.",
        )
        if not approved:
            return
        self._write_log(self.email_log, f"Sending campaign to {len(recipients)} recipient(s)...")
        settings = {
            "sender": self.sender_email.get().strip(),
            "password": self.sender_password.get(),
            "server": self.smtp_server.get().strip(),
            "campaign": self.campaign_type.get(),
            "attachment": Path(self.attachment_file.get()) if self.attachment_file.get() else None,
        }
        threading.Thread(target=self._send_worker, args=(recipients, port, settings), daemon=True).start()

    def _send_worker(self, recipients, port, settings):
        attachment = settings["attachment"]
        attachment_data = attachment.read_bytes() if attachment else None
        sent, failed = 0, []
        try:
            with smtplib.SMTP(settings["server"], port, timeout=30) as server:
                server.starttls()
                server.login(settings["sender"], settings["password"])
                for row in recipients.itertuples(index=False):
                    try:
                        message = EmailMessage()
                        message["From"] = settings["sender"]
                        message["To"] = row.Email
                        if settings["campaign"] == "Document request":
                            message["Subject"] = DOCUMENT_REQUEST_SUBJECT
                            message.set_content(DOCUMENT_REQUEST_BODY.format(name=row.Name, location=row.Location))
                        else:
                            message["Subject"] = ASSESSMENT_SUBJECT
                            message.set_content(ASSESSMENT_BODY.format(name=row.Name))
                        if attachment:
                            message.add_attachment(attachment_data, maintype="application", subtype="octet-stream", filename=attachment.name)
                        server.send_message(message)
                        sent += 1
                        self.root.after(0, lambda name=row.Name: self._write_log(self.email_log, f"Sent: {name}"))
                    except Exception as error:
                        failed.append(f"{row.Email}: {error}")
        except Exception as error:
            failed.append(f"SMTP connection: {error}")
        self.root.after(0, lambda: self._write_log(self.email_log, f"Complete. Sent: {sent}. Failed: {len(failed)}."))
        for error in failed:
            self.root.after(0, lambda error=error: self._write_log(self.email_log, f"Failed: {error}"))


if __name__ == "__main__":
    window = Tk()
    RecruitmentApp(window)
    window.mainloop()
