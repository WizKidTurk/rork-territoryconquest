import React, { useMemo } from "react";
import { Platform } from "react-native";
import { View, Text, StyleSheet, ScrollView, Image } from "react-native";
import { useLocalSearchParams } from "expo-router";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useSession } from "@/providers/SessionProvider";
import { ModeLabels, ModeColors } from "@/constants/game";
import SessionSnapshot from "@/components/SessionSnapshot";
import { Clock, Gauge, Route, Trophy } from "lucide-react-native";

export default function SessionDetailsScreen() {
  return (
    <ErrorBoundary>
      <Inner />
    </ErrorBoundary>
  );
}

function Inner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sessions } = useSession();
  const s = useMemo(() => (sessions ?? []).find((x) => x?.id === id), [sessions, id]);

  const formatDuration = (ms: number): string => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s2 = totalSec % 60;
    const hh = h.toString().padStart(2, "0");
    const mm = m.toString().padStart(2, "0");
    const ss = s2.toString().padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  };

  if (!s) {
    return (
      <View style={styles.container}>
        <Text style={styles.missing}>Session not found</Text>
      </View>
    );
  }

  const miles = (s.distanceMeters / 1609.344).toFixed(2);
  const km = s.distanceMeters / 1000;
  const durationMs = Math.max(0, (s.endedAt ?? s.startedAt) - s.startedAt);
  const durationStr = formatDuration(durationMs);
  const avgSpeedMs = durationMs > 0 ? s.distanceMeters / (durationMs / 1000) : 0;
  const avgKmh = (avgSpeedMs * 3.6).toFixed(2);
  const avgMph = (avgSpeedMs * 2.236936).toFixed(2);
  const date = new Date(s.startedAt);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="session-details">
      <SessionSnapshot path={s.path} mode={s.mode} />
      <View style={[styles.card, { borderColor: ModeColors[s.mode] }]} testID="session-summary"> 
        <Text style={styles.title}>{ModeLabels[s.mode]}</Text>
        <Text style={styles.meta}>{date.toLocaleString()}</Text>
        <Text style={styles.distance}>{s.distanceMeters} m • {miles} mi</Text>
      </View>

      <View style={styles.statsRow} testID="session-stats">
        <View style={styles.statCard}>
          <View style={styles.statIconWrap}><Route color="#60A5FA" size={18} /></View>
          <Text style={styles.statLabel}>Distance</Text>
          <Text style={styles.statValue}>{km.toFixed(2)} km</Text>
        </View>
        <View style={styles.statCard}>
          <View style={styles.statIconWrap}><Clock color="#F59E0B" size={18} /></View>
          <Text style={styles.statLabel}>Duration</Text>
          <Text style={styles.statValue}>{durationStr}</Text>
        </View>
        <View style={styles.statCard}>
          <View style={styles.statIconWrap}><Gauge color="#34D399" size={18} /></View>
          <Text style={styles.statLabel}>Avg Speed</Text>
          <Text style={styles.statValue}>{avgKmh} km/h</Text>
          <Text style={styles.statSub}>{avgMph} mph</Text>
        </View>
      </View>

      {s.achievements && s.achievements.length > 0 && (
        <View style={styles.achievementsSection}>
          <View style={styles.achievementsHeader}>
            <Trophy color="#F59E0B" size={20} />
            <Text style={styles.achievementsTitle}>Achievements Earned</Text>
          </View>
          <View style={styles.achievementsGrid}>
            {s.achievements.map((achievement, idx) => {
              console.log('🏆 Rendering achievement:', { miles: achievement.miles, imageUrl: achievement.imageUrl });
              return (
                <View key={idx} style={styles.achievementCard}>
                  {achievement.imageUrl ? (
                    <Image
                      source={{ uri: achievement.imageUrl }}
                      style={styles.achievementImage}
                      resizeMode="cover"
                      onError={(e) => console.log('❌ Image load error for', achievement.miles, 'mi:', e.nativeEvent?.error)}
                      onLoad={() => console.log('✅ Image loaded for', achievement.miles, 'mi')}
                    />
                  ) : (
                    <View style={[styles.achievementImage, { backgroundColor: '#1F2937', justifyContent: 'center' as const, alignItems: 'center' as const }]}>
                      <Trophy color="#F59E0B" size={32} />
                    </View>
                  )}
                  <View style={styles.achievementOverlay}>
                    <Text style={styles.achievementMiles}>{achievement.miles} mi</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B1220" },
  content: { padding: 16, gap: 12 },
  missing: { color: "#fff", textAlign: "center", marginTop: 40 },
  card: { backgroundColor: "#111827", borderRadius: 12, padding: 16, borderWidth: 1, borderColor: "#1F2937" },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  meta: { color: "#9CA3AF", marginTop: 4 },
  distance: { color: "#fff", marginTop: 8, fontWeight: "700" },
  sectionTitle: { color: "#fff", fontWeight: "800", marginBottom: 8 },
  statsRow: { flexDirection: "row" as const, gap: 12, justifyContent: "space-between" as const },
  statCard: { flex: 1, backgroundColor: "#0F172A", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12, alignItems: "flex-start" as const },
  statIconWrap: { backgroundColor: "#111827", padding: 6, borderRadius: 8, marginBottom: 8 },
  statLabel: { color: "#9CA3AF", fontSize: 12, fontWeight: "600" as const },
  statValue: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" as const, marginTop: 2 },
  statSub: { color: "#9CA3AF", fontSize: 12 },
  achievementsSection: { backgroundColor: "#111827", borderRadius: 12, padding: 16 },
  achievementsHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, marginBottom: 12 },
  achievementsTitle: { color: "#fff", fontSize: 16, fontWeight: "800" as const },
  achievementsGrid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 12 },
  achievementCard: { width: 100, height: 100, borderRadius: 12, overflow: "hidden" as const, position: "relative" as const, borderWidth: 2, borderColor: "#F59E0B" },
  achievementImage: { width: "100%" as const, height: "100%" as const },
  achievementOverlay: { position: "absolute" as const, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(17,24,39,0.9)", paddingVertical: 4, paddingHorizontal: 6, alignItems: "center" as const },
  achievementMiles: { color: "#F59E0B", fontSize: 12, fontWeight: "700" as const },
});
