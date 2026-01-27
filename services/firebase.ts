import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";
import Constants from "expo-constants";
import { defaultFirebasePublicConfig } from "@/constants/firebaseConfig";

export type FirebaseRefs = { app: FirebaseApp; db: Firestore } | null;

function readExpoExtra(): Record<string, unknown> {
  try {
    const fromExpoConfig = (Constants as any)?.expoConfig?.extra;
    if (fromExpoConfig && typeof fromExpoConfig === "object") return fromExpoConfig as Record<string, unknown>;
  } catch {}
  try {
    const fromManifest = (Constants as any)?.manifest?.extra;
    if (fromManifest && typeof fromManifest === "object") return fromManifest as Record<string, unknown>;
  } catch {}
  try {
    const fromManifest2 = (Constants as any)?.manifest2?.extra;
    if (fromManifest2 && typeof fromManifest2 === "object") return fromManifest2 as Record<string, unknown>;
  } catch {}
  try {
    const fromGlobal = (globalThis as any)?.expo?.manifest?.extra;
    if (fromGlobal && typeof fromGlobal === "object") return fromGlobal as Record<string, unknown>;
  } catch {}
  return {} as Record<string, unknown>;
}

export function getFirebase(): FirebaseRefs {
  const extra = readExpoExtra();

  const apiKey = (
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY ??
    (extra as any).EXPO_PUBLIC_FIREBASE_API_KEY ??
    (extra as any).firebaseApiKey ??
    (extra as any).firebase?.apiKey ??
    defaultFirebasePublicConfig.apiKey
  ) as string;
  const authDomain = (
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    (extra as any).EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    (extra as any).firebaseAuthDomain ??
    (extra as any).firebase?.authDomain ??
    defaultFirebasePublicConfig.authDomain ?? ""
  ) as string;
  const projectId = (
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ??
    (extra as any).EXPO_PUBLIC_FIREBASE_PROJECT_ID ??
    (extra as any).firebaseProjectId ??
    (extra as any).firebase?.projectId ??
    defaultFirebasePublicConfig.projectId
  ) as string;
  const storageBucket = (
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    (extra as any).EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    (extra as any).firebaseStorageBucket ??
    (extra as any).firebase?.storageBucket ??
    defaultFirebasePublicConfig.storageBucket ?? ""
  ) as string;
  const messagingSenderId = (
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ??
    (extra as any).EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ??
    (extra as any).firebaseMessagingSenderId ??
    (extra as any).firebase?.messagingSenderId ??
    defaultFirebasePublicConfig.messagingSenderId ?? ""
  ) as string;
  const appId = (
    process.env.EXPO_PUBLIC_FIREBASE_APP_ID ??
    (extra as any).EXPO_PUBLIC_FIREBASE_APP_ID ??
    (extra as any).firebaseAppId ??
    (extra as any).firebase?.appId ??
    defaultFirebasePublicConfig.appId
  ) as string;

  const hasConfig = Boolean(apiKey && projectId && appId);

  if (!hasConfig) {
    console.log("Firebase config missing. Provide EXPO_PUBLIC_* env or app.json extra.");
    console.log("Debug extra keys suffix:", {
      apiKey: apiKey ? String(apiKey).slice(-6) : "",
      projectId,
      appId: appId ? String(appId).slice(0, 4) + "…" : "",
    });
    return null;
  }

  const config = {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
  } as const;

  const app = getApps().length ? getApps()[0]! : initializeApp(config);
  const db = getFirestore(app);
  return { app, db };
}
