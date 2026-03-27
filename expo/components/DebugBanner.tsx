import React, { useMemo, useState, useEffect } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSession } from "@/providers/SessionProvider";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function DebugBanner() {
  const s = useSession();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState<boolean>(true);
  const [expanded, setExpanded] = useState<boolean>(Platform.OS === "web");

  useEffect(() => {
    console.log("🟩 DebugBanner mounted", { platform: Platform.OS });
    return () => console.log("🟥 DebugBanner unmounted");
  }, []);

  const info = useMemo(() => {
    const myTerritories = (s.territories ?? []).filter((t) => t.owners?.some((o) => o.ownerId === s.ownerId));
    const otherTerritories = (s.territories ?? []).filter((t) => !t.owners?.some((o) => o.ownerId === s.ownerId));
    const totalTerritories = s.territories?.length ?? 0;
    return {
      line1: `mode:${s.mode ?? "-"} state:${s.state} sess:${s.sessions.length}`,
      line2: `myTerr:${myTerritories.length} otherTerr:${otherTerritories.length} total:${totalTerritories}`,
    };
  }, [s.mode, s.state, s.sessions.length, s.territories, s.ownerId]);

  if (!visible) return null as unknown as React.ReactElement;

  return (
    <Pressable
      onPress={() => setExpanded((e) => !e)}
      onLongPress={() => setVisible(false)}
      testID="debug-banner"
      accessibilityRole="button"
      accessibilityLabel="Debug banner"
      style={[styles.container, { bottom: (insets.bottom || 0) + 76 }]}
    >
      {expanded ? (
        <View style={styles.pill} pointerEvents="none">
          <Text style={styles.title}>DEBUG</Text>
          <Text style={styles.subtitle}>{info.line1}</Text>
          <Text style={styles.subtitle}>{info.line2}</Text>
          <Text style={styles.subtitle}>{Platform.OS}</Text>
          <Text style={styles.hint}>tap to collapse • long‑press to hide</Text>
        </View>
      ) : (
        <View style={styles.mini} pointerEvents="none">
          <Text style={styles.miniText}>DBG</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 12,
    zIndex: 9999,
    alignItems: "flex-start",
  },
  pill: {
    backgroundColor: "rgba(10, 132, 255, 0.95)",
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  title: { color: "#fff", fontWeight: "700", fontSize: 12 },
  subtitle: { color: "#e6f0ff", fontSize: 11 },
  hint: { color: "#dbeafe", fontSize: 10, marginTop: 2 },
  mini: {
    backgroundColor: "rgba(10, 132, 255, 0.95)",
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  miniText: { color: "#fff", fontWeight: "800", fontSize: 11 },
});
