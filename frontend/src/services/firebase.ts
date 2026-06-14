// services/firebase.ts
// Env-guarded Firebase for Analytics (GA4) + Google sign-in.
//
// All config comes from public VITE_FIREBASE_* env vars (Vite exposes these to
// the client automatically — they are NOT secrets; the Firebase web config is
// safe to ship). With no config present every export here no-ops, so the app
// runs unchanged. The backend service account (the real secret) lives only on
// the server in services/firebaseAdmin.js.
//
// The Firebase SDK is large, so it is loaded with dynamic import() — it lands in
// its own chunk and never bloats the initial bundle / first paint. Analytics
// loads lazily after mount; Auth loads only when the user clicks "Continue with
// Google".

import type { FirebaseApp } from "firebase/app";
import type { Analytics } from "firebase/analytics";
import type { Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Minimum needed for Auth; Analytics additionally needs measurementId.
export const firebaseEnabled = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId
);

let appPromise: Promise<FirebaseApp> | null = null;
let analytics: Analytics | null = null;
let analyticsInitStarted = false;
let pendingPageView: { path: string; title?: string } | null = null;

async function getApp(): Promise<FirebaseApp> {
  if (!appPromise) {
    appPromise = import("firebase/app").then(({ initializeApp }) =>
      initializeApp(firebaseConfig as Record<string, string>)
    );
  }
  return appPromise;
}

// Kick off Analytics lazily. If a page_view arrives before init finishes we
// stash the latest one and flush it once Analytics is ready (so the first view
// isn't lost).
function ensureAnalytics(): void {
  if (analyticsInitStarted || !firebaseEnabled || !firebaseConfig.measurementId) return;
  if (typeof window === "undefined") return;
  analyticsInitStarted = true;

  import("firebase/analytics")
    .then(async ({ getAnalytics, isSupported }) => {
      if (!(await isSupported())) return;
      const app = await getApp();
      analytics = getAnalytics(app);
      if (pendingPageView) {
        const p = pendingPageView;
        pendingPageView = null;
        logPageView(p.path, p.title);
      }
    })
    .catch(() => {
      /* analytics simply stays off */
    });
}

/** Log a GA4 page_view. No-op unless Analytics is configured/supported. */
export function logPageView(path: string, title?: string): void {
  if (!firebaseEnabled || !firebaseConfig.measurementId) return;
  if (!analytics) {
    pendingPageView = { path, title };
    ensureAnalytics();
    return;
  }
  import("firebase/analytics")
    .then(({ logEvent }) => {
      if (!analytics) return;
      logEvent(analytics, "page_view", {
        page_path: path,
        page_location: typeof window !== "undefined" ? window.location.href : path,
        page_title: title || (typeof document !== "undefined" ? document.title : undefined),
      });
    })
    .catch(() => {
      /* never let analytics break navigation */
    });
}

/**
 * Run the Google sign-in popup and return the Firebase ID token, which the
 * backend (/api/auth/google) verifies. Throws if Firebase isn't configured or
 * the user cancels.
 */
export async function getGoogleIdToken(): Promise<string> {
  if (!firebaseEnabled) throw new Error("Google sign-in is not available.");
  const app = await getApp();
  const { getAuth, GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  const auth: Auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  return result.user.getIdToken();
}
