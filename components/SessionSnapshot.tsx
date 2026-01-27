import React, { useMemo } from "react";
import { View, StyleSheet, StyleProp, ViewStyle, Text } from "react-native";
import Svg, { Polyline, Rect, Defs, LinearGradient, Stop } from "react-native-svg";
import type { LatLng } from "@/providers/SessionProvider";
import { ModeColors, ActivityMode } from "@/constants/game";

export type SessionSnapshotProps = {
  style?: StyleProp<ViewStyle>;
  path: LatLng[];
  mode: ActivityMode;
};

function normalizePath(path: LatLng[], width: number, height: number, padding: number) {
  if (!Array.isArray(path) || path.length === 0) return "";
  let minLat = Infinity,
    minLon = Infinity,
    maxLat = -Infinity,
    maxLon = -Infinity;
  for (const p of path) {
    if (typeof p?.latitude !== "number" || typeof p?.longitude !== "number") continue;
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.longitude < minLon) minLon = p.longitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude > maxLon) maxLon = p.longitude;
  }
  if (!isFinite(minLat) || !isFinite(minLon) || !isFinite(maxLat) || !isFinite(maxLon)) return "";

  const spanLat = Math.max(1e-9, maxLat - minLat);
  const spanLon = Math.max(1e-9, maxLon - minLon);
  const innerW = Math.max(0, width - padding * 2);
  const innerH = Math.max(0, height - padding * 2);
  const scaleX = innerW / spanLon;
  const scaleY = innerH / spanLat;
  const scale = Math.min(scaleX, scaleY);

  const offsetX = (width - (spanLon * scale)) / 2;
  const offsetY = (height - (spanLat * scale)) / 2;

  const pts: string[] = [];
  for (const p of path) {
    const x = (p.longitude - minLon) * scale + offsetX;
    const y = height - ((p.latitude - minLat) * scale + offsetY);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

export default function SessionSnapshot({ style, path, mode }: SessionSnapshotProps) {
  const width = 360;
  const height = 220;
  const padding = 16;

  const points = useMemo(() => normalizePath(path ?? [], width, height, padding), [path, width, height, padding]);
  const stroke = ModeColors[mode] ?? "#3B82F6";

  return (
    <View style={[styles.card, style]} testID="session-snapshot">
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0B1220" stopOpacity="1" />
            <Stop offset="1" stopColor="#0F172A" stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} rx={16} fill="url(#bg)" />
        {points ? (
          <Polyline
            points={points}
            fill="none"
            stroke={stroke}
            strokeWidth={4}
            strokeLinejoin="round"
            strokeLinecap="round"
          />)
          : (
          <Text style={styles.empty}>No route data</Text>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: "hidden" as const,
    alignSelf: "stretch" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "#0F172A",
  },
  empty: { position: "absolute" as const, color: "#9CA3AF" },
});
