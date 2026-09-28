import { useEffect, useState } from "react";
import ComposeStep from "./pages/ComposeStep.jsx";
import PreviewStep from "./pages/PreviewStep.jsx";
import SendingStep from "./pages/SendingStep.jsx";
import CompleteStep from "./pages/CompleteStep.jsx";
import LoginScreen from "./pages/LoginScreen.jsx";
import CvExtract from "./pages/CvExtract.jsx";
import IdCards from "./pages/IdCards.jsx";
import { IconCheck } from "./icons.jsx";
import { getMe, logout } from "./api.js";
import { buildRecipientsFile } from "./utils/buildRecipientsFile.js";

const STEPS = ["Compose", "Preview & send", "Sending", "Done"];

function authErrorFromUrl() {
  const msg = new URLSearchParams(window.location.search).get("auth_error");
  if (msg) window.history.replaceState({}, "", window.location.pathname);
  return msg;
}

export default function App() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [user, setUser] = useState(null);
  const [authError] = useState(authErrorFromUrl);

  const [tool, setTool] = useState("mailer"); // "mailer" | "cv" | "idcards"
  const [step, setStep] = useState(0);
  const [campaign, setCampaign] = useState(null);
  const [finalStatus, setFinalStatus] = useState(null);
  // Recipients handed over from CV extraction, as the same .xlsx the mailer
  // already accepts — so the hand-off reuses the normal upload path.
  const [presetRecipients, setPresetRecipients] = useState(null);

  useEffect(() => {
    getMe()
      .then(setUser)
      .finally(() => setCheckingAuth(false));
  }, []);

  function reset() {
    setCampaign(null);
    setFinalStatus(null);
    setPresetRecipients(null);
    setStep(0);
  }

  async function handleUseContacts(rows) {
    const file = await buildRecipientsFile(rows);
    setCampaign(null);
    setFinalStatus(null);
    setPresetRecipients(file);
    setStep(0);
    setTool("mailer");
  }

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  if (checkingAuth) return null; // avoids a login-screen flash while the cookie check is in flight
  if (!user) return <LoginScreen error={authError} />;

  return (
    <div className={`app${tool === "cv" || tool === "idcards" ? " app-wide" : ""}`}>
      <header className="app-header">
        <div className="app-header-top">
          <div className="brand">
            <img src="/logo.png" alt="Peach Strides &amp; Pristine" className="brand-logo" />
            <span className="brand-divider" />
            <span className="brand-tool">Staff Tools</span>
          </div>
          <div className="account-bar">
            <span>{user.email}</span>
            <button type="button" className="link-button" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>
        <h1>
          {tool === "mailer"
            ? "Send a personalized campaign"
            : tool === "cv"
              ? "Extract contacts from CVs"
              : "Generate staff ID cards"}
        </h1>
        <p>
          {tool === "mailer"
            ? "Upload a recipient list, compose one email, optionally attach a personalized PDF per recipient, and send."
            : tool === "cv"
              ? "Read names, emails and phone numbers out of a batch of CVs, review anything uncertain, then mail them."
              : "Upload a staff spreadsheet and photos, and get one ID card per employee — no more building them one by one."}
        </p>
      </header>

      <nav className="tool-tabs">
        <button
          type="button"
          className={tool === "mailer" ? "active" : ""}
          onClick={() => setTool("mailer")}
        >
          Bulk Mailer
        </button>
        <button
          type="button"
          className={tool === "cv" ? "active" : ""}
          onClick={() => setTool("cv")}
        >
          CV Extract
        </button>
        <button
          type="button"
          className={tool === "idcards" ? "active" : ""}
          onClick={() => setTool("idcards")}
        >
          ID Cards
        </button>
      </nav>

      {tool === "cv" ? (
        <main>
          <CvExtract onUseContacts={handleUseContacts} />
        </main>
      ) : tool === "idcards" ? (
        <main>
          <IdCards />
        </main>
      ) : (
      <>
      <ol className="steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? "active" : i < step ? "done" : ""}>
            {i < step && <IconCheck className="step-check" />}
            {label}
          </li>
        ))}
      </ol>

      <main>
        {step === 0 && (
          <ComposeStep
            presetRecipients={presetRecipients}
            onCreated={(c) => {
              setCampaign(c);
              setStep(1);
            }}
          />
        )}
        {step === 1 && campaign && (
          <PreviewStep
            campaign={campaign}
            onBack={reset}
            onStarted={() => setStep(2)}
          />
        )}
        {step === 2 && campaign && (
          <SendingStep
            campaignId={campaign.id}
            onDone={(status) => {
              setFinalStatus(status);
              setStep(3);
            }}
          />
        )}
        {step === 3 && campaign && finalStatus && (
          <CompleteStep
            campaignId={campaign.id}
            status={finalStatus}
            onRestart={reset}
            onResumed={() => setStep(2)}
          />
        )}
      </main>
      </>
      )}
    </div>
  );
}
