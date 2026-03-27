import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, ScrollView } from "react-native";
import { router } from "expo-router";
import { getFirebase } from "@/services/firebase";

export type ConnectionProbe = {
  configured: boolean;
  connected: boolean;
  lastCheckedAt: number | null;
  errorText: string | null;
  latencyMs: number | null;
  firestoreCollections: string[];
};

export default function ConnectionStatus() {
  const [probe, setProbe] = useState<ConnectionProbe>({
    configured: false,
    connected: false,
    lastCheckedAt: null,
    errorText: null,
    latencyMs: null,
    firestoreCollections: [],
  });
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [showDetails, setShowDetails] = useState<boolean>(false);

  const runCheck = useCallback(async () => {
    if (isChecking) return;
    setIsChecking(true);
    console.log("🔎 ConnectionStatus: starting connectivity check...");

    const refs = getFirebase();
    const start = Date.now();

    if (!refs) {
      console.log("⚠️ Firebase not configured (missing keys)");
      setProbe((p) => ({
        ...p,
        configured: false,
        connected: false,
        lastCheckedAt: Date.now(),
        errorText: "Firebase not configured. Add keys to app.json -> expo.extra",
        latencyMs: null,
      }));
      setIsChecking(false);
      return;
    }

    try {
      const { getDocs, collection, query, orderBy, limit } = await import("firebase/firestore");
      const col = collection(refs.db, "sessions");
      const q = query(col, orderBy("createdAt", "desc" as const), limit(1));
      const snap = await getDocs(q);
      const latency = Date.now() - start;
      const existing = snap.docs.map((d) => d.id);
      console.log("✅ Firestore reachable. docs(sessions) fetched:", existing.length, "latency(ms)=", latency);

      setProbe({
        configured: true,
        connected: true,
        lastCheckedAt: Date.now(),
        errorText: null,
        latencyMs: latency,
        firestoreCollections: ["sessions"],
      });
    } catch (e: any) {
      const latency = Date.now() - start;
      const msg = e?.message ?? String(e);
      console.log("❌ Firestore probe failed:", msg);
      setProbe({
        configured: true,
        connected: false,
        lastCheckedAt: Date.now(),
        errorText: msg,
        latencyMs: latency,
        firestoreCollections: [],
      });
    } finally {
      setIsChecking(false);
    }
  }, [isChecking]);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const statusColor = useMemo(() => {
    if (isChecking) return "#F59E0B";
    if (!probe.configured) return "#EF4444";
    return probe.connected ? "#22C55E" : "#EF4444";
  }, [probe.configured, probe.connected, isChecking]);

  return (
    <View style={styles.card} testID="connection-status">
      <View style={styles.headerRow}>
        <View style={[styles.dot, { backgroundColor: statusColor }]} />
        <Text style={styles.title}>Connections</Text>
        {isChecking ? <ActivityIndicator size="small" color="#6B7280" /> : null}
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Firebase configured</Text>
        <Text style={[styles.value, { color: probe.configured ? "#16A34A" : "#DC2626" }]}>
          {probe.configured ? "Yes" : "No"}
        </Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Firestore reachable</Text>
        <Text style={[styles.value, { color: probe.connected ? "#16A34A" : "#DC2626" }]}>
          {probe.connected ? "Yes" : "No"}
        </Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Latency</Text>
        <Text style={styles.value}>{probe.latencyMs != null ? `${probe.latencyMs} ms` : "-"}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Platform</Text>
        <Text style={styles.value}>{Platform.OS}</Text>
      </View>

      {probe.errorText ? (
        <View style={styles.errorBox}>
          {showDetails ? (
            <ScrollView style={styles.errorScroll} contentContainerStyle={styles.errorScrollContent}>
              <Text style={styles.errorText} selectable>{probe.errorText}</Text>
            </ScrollView>
          ) : (
            <Text style={styles.errorText} numberOfLines={3}>{probe.errorText}</Text>
          )}
          <Pressable
            onPress={() => setShowDetails((v) => !v)}
            style={styles.linkButton}
            testID="toggle-error-details"
          >
            <Text style={styles.linkText}>{showDetails ? "Hide details" : "Show full"}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.buttonsRow}>
        <Pressable onPress={runCheck} style={[styles.button, styles.primary]} testID="connection-refresh">
          <Text style={styles.buttonText}>Run Check</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push("/(tabs)/profile/connections")}
          style={[styles.button, styles.secondary]}
          testID="open-connections-full"
        >
          <Text style={styles.secondaryText}>Open Full</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 4,
  },
  label: { color: "#6B7280", fontSize: 13 },
  value: { color: "#111827", fontSize: 13, fontWeight: "600" },
  errorBox: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
  },
  errorScroll: {
    maxHeight: 140,
  },
  errorScrollContent: {
    paddingRight: 4,
  },
  errorText: { color: "#991B1B", fontSize: 12 },
  linkButton: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: "#fee2e2",
  },
  linkText: { color: "#b91c1c", fontSize: 12, fontWeight: "600" },
  buttonsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  primary: {
    backgroundColor: "#111827",
  },
  secondary: {
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  buttonText: { color: "#FFF", fontWeight: "700" },
  secondaryText: { color: "#111827", fontWeight: "700" },
});
