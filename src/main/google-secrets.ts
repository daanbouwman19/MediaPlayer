// Load from environment variables (e.g. set in .env)
// Using functions to ensure .env is loaded before accessing process.env
export function getGoogleClientId(): string {
  return process.env.GOOGLE_CLIENT_ID || '';
}

export function getGoogleClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET || '';
}

// The Electron OAuth callback server listens on this URI's host and port.
export function getGoogleRedirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    'http://localhost:12345/auth/google/callback'
  );
}
