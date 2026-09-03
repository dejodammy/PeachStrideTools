import { IconMail } from "../icons.jsx";

function IconGoogle(props) {
  return (
    <svg viewBox="0 0 20 20" width={18} height={18} {...props}>
      <path
        fill="#4285F4"
        d="M19.6 10.23c0-.68-.06-1.33-.17-1.96H10v3.71h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 3-4.32 3-7.27Z"
      />
      <path
        fill="#34A853"
        d="M10 20c2.7 0 4.96-.9 6.62-2.44l-3.24-2.5c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.75-5.59-4.11H1.06v2.59A10 10 0 0 0 10 20Z"
      />
      <path fill="#FBBC05" d="M4.41 11.9a5.99 5.99 0 0 1 0-3.8V5.5H1.06a10 10 0 0 0 0 9l3.35-2.6Z" />
      <path
        fill="#EA4335"
        d="M10 3.98c1.47 0 2.79.5 3.83 1.49l2.87-2.87A9.96 9.96 0 0 0 10 0 10 10 0 0 0 1.06 5.5l3.35 2.6C5.2 5.73 7.4 3.98 10 3.98Z"
      />
    </svg>
  );
}

export default function LoginScreen({ error }) {
  return (
    <div className="app">
      <header className="app-header">
        <div className="kicker">
          <IconMail width={14} height={14} />
          Bulk Mailer
        </div>
        <h1>Sign in to continue</h1>
        <p>This tool is restricted to approved staff accounts.</p>
      </header>

      <div className="card" style={{ maxWidth: 420, margin: "0 auto", textAlign: "center" }}>
        {error && (
          <div className="banner error" style={{ textAlign: "left" }}>
            {error}
          </div>
        )}
        <p className="lede" style={{ marginBottom: 24 }}>
          Use the Google account your company access is tied to.
        </p>
        <a
          href="/auth/google"
          className="primary"
          style={{ width: "100%", justifyContent: "center", gap: 10, fontSize: 15 }}
        >
          <IconGoogle />
          Sign in with Google
        </a>
      </div>
    </div>
  );
}
