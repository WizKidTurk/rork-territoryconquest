import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Stack } from "expo-router";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getFirebase } from "@/services/firebase";
import Constants from "expo-constants";

type Probe = {
  configured: boolean;
  connected: boolean;
  lastCheckedAt: number | null;
  errorText: string | null;
  latencyMs: number | null;
  firestoreCollections: string[];
  lastWriteId: string | null;
};

export default function ConnectionsFullScreen() {
  const [probe, setProbe] = useState<Probe>({
    configured: false,
    connected: false,
    lastCheckedAt: null,
    errorText: null,
    latencyMs: null,
    firestoreCollections: [],
    lastWriteId: null,
  });
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [isWriting, setIsWriting] = useState<boolean>(false);

  const run = useCallback(async () => {
    if (isChecking) return;
    setIsChecking(true);
    console.log("🔎 ConnectionsFull: start");

    const refs = getFirebase();
    const start = Date.now();

    if (!refs) {
      setProbe({
        configured: false,
        connected: false,
        lastCheckedAt: Date.now(),
        errorText: "Firebase not configured. Add keys to app.json -> expo.extra",
        latencyMs: null,
        firestoreCollections: [],
        lastWriteId: null,
      });
      setIsChecking(false);
      return;
    }

    try {
      const { getDocs, collection, query, orderBy, limit } = await import("firebase/firestore");
      const col = collection(refs.db, "sessions");
      const q = query(col, orderBy("createdAt", "desc" as const), limit(1));
      const snap = await getDocs(q);
      const latency = Date.now() - start;
      console.log("✅ ConnectionsFull: fetched sessions:", snap.size);
      setProbe((p) => ({
        ...p,
        configured: true,
        connected: true,
        lastCheckedAt: Date.now(),
        errorText: null,
        latencyMs: latency,
        firestoreCollections: ["sessions"],
      }));
    } catch (e: any) {
      const latency = Date.now() - start;
      const msg = e?.message ?? String(e);
      console.log("❌ ConnectionsFull error:", msg);
      setProbe((p) => ({
        ...p,
        configured: true,
        connected: false,
        lastCheckedAt: Date.now(),
        errorText: msg,
        latencyMs: latency,
        firestoreCollections: [],
      }));
    } finally {
      setIsChecking(false);
    }
  }, [isChecking]);

  const writeTestDoc = useCallback(async () => {
    if (isWriting) return;
    setIsWriting(true);
    const refs = getFirebase();
    if (!refs) {
      setProbe((p) => ({ ...p, configured: false, connected: false, errorText: "Firebase not configured", lastWriteId: null }));
      setIsWriting(false);
      return;
    }
    try {
      const { addDoc, collection, serverTimestamp, doc, getDoc } = await import("firebase/firestore");
      const payload = {
        createdAt: serverTimestamp(),
        from: Platform.OS,
        note: "connection_test",
        ts: Date.now(),
      } as const;
      console.log("📝 Writing connection_tests payload", payload);
      const ref = await addDoc(collection(refs.db, "connection_tests"), payload as any);
      console.log("✅ Wrote test doc:", ref.id);
      const snap = await getDoc(doc(refs.db, "connection_tests", ref.id));
      const ok = snap.exists();
      setProbe((p) => ({
        ...p,
        connected: ok,
        lastWriteId: ref.id,
        errorText: ok ? null : "Document not found after write",
      }));
    } catch (e: any) {
      console.log("❌ Write test failed:", e?.message ?? String(e));
      setProbe((p) => ({ ...p, errorText: e?.message ?? String(e), lastWriteId: null }));
    } finally {
      setIsWriting(false);
    }
  }, [isWriting]);

  useEffect(() => {
    run();
  }, [run]);

  const statusColor = useMemo(() => {
    if (isChecking || isWriting) return "#F59E0B";
    if (!probe.configured) return "#EF4444";
    return probe.connected ? "#22C55E" : "#EF4444";
  }, [isChecking, isWriting, probe.configured, probe.connected]);

  const extra = (Constants as any)?.expoConfig?.extra ?? (Constants as any)?.manifest?.extra ?? (Constants as any)?.manifest2?.extra ?? (globalThis as any)?.expo?.manifest?.extra ?? {};
  const projectId = ((extra as any).EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? (extra as any).firebaseProjectId ?? process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "") as string;
  const apiKey = ((extra as any).EXPO_PUBLIC_FIREBASE_API_KEY ?? (extra as any).firebaseApiKey ?? process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "") as string;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Connections Report" }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
            <Text style={styles.title}>Status</Text>
            {isChecking || isWriting ? <ActivityIndicator size="small" color="#6B7280" /> : null}
          </View>

          <Row label="Firebase configured" value={probe.configured ? "Yes" : "No"} valueColor={probe.configured ? "#16A34A" : "#DC2626"} />
          <Row label="Firestore reachable" value={probe.connected ? "Yes" : "No"} valueColor={probe.connected ? "#16A34A" : "#DC2626"} />
          <Row label="Latency" value={probe.latencyMs != null ? `${probe.latencyMs} ms` : "-"} />
          <Row label="Platform" value={Platform.OS} />
          <Row label="Checked" value={probe.lastCheckedAt ? new Date(probe.lastCheckedAt).toLocaleString() : "-"} />
          <Row label="Collections" value={probe.firestoreCollections.join(", ") || "-"} />
          <Row label="Project ID" value={projectId || "-"} />
          <Row label="API Key suffix" value={apiKey ? `...${apiKey.slice(-6)}` : "-"} />
          <Row label="Last test write" value={probe.lastWriteId ? `OK: ${probe.lastWriteId}` : "-"} />

          {probe.errorText ? (
            <View style={styles.errorBox}>
              <Text style={styles.sectionTitle}>Error</Text>
              <ScrollView style={styles.errorScroll} contentContainerStyle={styles.errorScrollContent}>
                <Text selectable style={styles.errorText} testID="full-error-text">{probe.errorText}</Text>
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable onPress={run} style={[styles.actionBtn, styles.primary]} testID="full-run-check">
              <Text style={styles.actionTextPrimary}>Run Check</Text>
            </Pressable>
            <Pressable onPress={writeTestDoc} style={[styles.actionBtn, styles.secondary]} testID="full-write-test">
              <Text style={styles.actionTextSecondary}>Write Test Doc</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, valueColor ? { color: valueColor } : (null as unknown as undefined)]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  scrollContent: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: "#FFF", borderRadius: 12, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { fontSize: 16, fontWeight: "700", color: "#111827", flex: 1 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: 6 },
  label: { color: "#6B7280", fontSize: 14 },
  value: { color: "#111827", fontSize: 14, fontWeight: "600" },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#991B1B", marginBottom: 6 },
  errorBox: { backgroundColor: "#FEF2F2", borderColor: "#FECACA", borderWidth: 1, padding: 10, borderRadius: 8, marginTop: 12 },
  errorScroll: { maxHeight: 400 },
  errorScrollContent: { paddingRight: 6 },
  errorText: { color: "#991B1B", fontSize: 12, lineHeight: 16 },
  actions: { marginTop: 16, flexDirection: "row", gap: 10 },
  actionBtn: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 10 },
  primary: { backgroundColor: "#111827" },
  secondary: { backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  actionTextPrimary: { color: "#FFF", fontWeight: "700" },
  actionTextSecondary: { color: "#111827", fontWeight: "700" },
});
