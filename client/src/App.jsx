import { useState } from "react";
import ComposeStep from "./pages/ComposeStep.jsx";
import PreviewStep from "./pages/PreviewStep.jsx";
import SendingStep from "./pages/SendingStep.jsx";
import CompleteStep from "./pages/CompleteStep.jsx";

const STEPS = ["Compose", "Preview & send", "Sending", "Done"];

export default function App() {
  const [step, setStep] = useState(0);
  const [campaign, setCampaign] = useState(null);
  const [finalStatus, setFinalStatus] = useState(null);

  function reset() {
    setCampaign(null);
    setFinalStatus(null);
    setStep(0);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Bulk Mailer</h1>
        <p>Upload a recipient list, compose one email, optionally attach a personalized PDF, and send.</p>
      </header>

      <ol className="steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? "active" : i < step ? "done" : ""}>
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
          <CompleteStep campaignId={campaign.id} status={finalStatus} onRestart={reset} />
        )}
      </main>
    </div>
  );
}
