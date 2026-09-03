import { useEffect, useState } from "react";
import ComposeStep from "./pages/ComposeStep.jsx";
import PreviewStep from "./pages/PreviewStep.jsx";
import SendingStep from "./pages/SendingStep.jsx";
import CompleteStep from "./pages/CompleteStep.jsx";
import LoginScreen from "./pages/LoginScreen.jsx";
import { IconMail, IconCheck } from "./icons.jsx";
import { getMe, logout } from "./api.js";

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

  const [step, setStep] = useState(0);
  const [campaign, setCampaign] = useState(null);
  const [finalStatus, setFinalStatus] = useState(null);

  useEffect(() => {
    getMe()
      .then(setUser)
      .finally(() => setCheckingAuth(false));
  }, []);

  function reset() {
    setCampaign(null);
    setFinalStatus(null);
    setStep(0);
  }

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  if (checkingAuth) return null; // avoids a login-screen flash while the cookie check is in flight
  if (!user) return <LoginScreen error={authError} />;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-top">
          <div className="kicker">
            <IconMail width={14} height={14} />
            Bulk Mailer
          </div>
          <div className="account-bar">
            <span>{user.email}</span>
            <button type="button" className="link-button" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>
        <h1>Send a personalized campaign</h1>
        <p>Upload a recipient list, compose one email, optionally attach a personalized PDF per recipient, and send.</p>
      </header>

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
    </div>
  );
}
