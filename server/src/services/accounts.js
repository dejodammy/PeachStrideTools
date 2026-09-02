// Sender accounts come from environment variables (server/.env), never from the
// client. MAIL_ACCOUNT_1_EMAIL / _PASSWORD / _LABEL, MAIL_ACCOUNT_2_*, etc.
function loadAccounts() {
  const accounts = [];
  let i = 1;
  while (process.env[`MAIL_ACCOUNT_${i}_EMAIL`]) {
    const email = process.env[`MAIL_ACCOUNT_${i}_EMAIL`].trim();
    const password = process.env[`MAIL_ACCOUNT_${i}_PASSWORD`] || "";
    const label = (process.env[`MAIL_ACCOUNT_${i}_LABEL`] || email).trim();
    if (email && password) {
      accounts.push({ id: `account_${i}`, label, email, password });
    }
    i += 1;
  }
  return accounts;
}

export const ACCOUNTS = loadAccounts();

export function getAccount(id) {
  return ACCOUNTS.find((a) => a.id === id);
}

// Safe to send to the browser: never includes the password.
export function publicAccounts() {
  return ACCOUNTS.map(({ id, label, email }) => ({ id, label, email }));
}
