import React from "react";
import { StyleProp, ViewStyle, View, Text, StyleSheet } from "react-native";
import { MapPin, Navigation } from "lucide-react-native";
import { ActivityMode, Player } from "@/constants/game";
import type { LatLng, Territory } from "@/providers/SessionProvider";

export type TrackingMapProps = {
  style?: StyleProp<ViewStyle>;
  region?: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } | null;
  path: LatLng[];
  mode: ActivityMode | null;
  lastPoint?: LatLng | undefined;
  territories?: Territory[];
  ownerId?: string;
  ownerColor?: string;
  players?: Player[];
  nickname?: string;
  avatarStyle?: string;
  isTracking?: boolean;
};

export default function TrackingMap({
  style,
  region,
  path = [],
  lastPoint,
  territories = [],
  isTracking,
}: TrackingMapProps) {
  const pathLength = path?.length ?? 0;
  const territoryCount = territories?.length ?? 0;

  return (
    <View style={[styles.container, style]} testID="map-web">
      <View style={styles.mapPlaceholder}>
        <View style={styles.gridOverlay}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={styles.gridRow}>
              {Array.from({ length: 6 }).map((_, j) => (
                <View key={j} style={styles.gridCell} />
              ))}
            </View>
          ))}
        </View>
        
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            {isTracking ? (
              <Navigation size={48} color="#22C55E" />
            ) : (
              <MapPin size={48} color="#6B7280" />
            )}
          </View>
          
          <Text style={styles.title}>
            {isTracking ? "Tracking Active" : "Map View"}
          </Text>
          
          <Text style={styles.subtitle}>
            Use mobile app for full map experience
          </Text>
          
          {region && (
            <View style={styles.coordsContainer}>
              <Text style={styles.coordsLabel}>Current Location</Text>
              <Text style={styles.coords}>
                {lastPoint 
                  ? `${lastPoint.latitude.toFixed(5)}, ${lastPoint.longitude.toFixed(5)}`
                  : `${region.latitude.toFixed(5)}, ${region.longitude.toFixed(5)}`
                }
              </Text>
            </View>
          )}
          
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{pathLength}</Text>
              <Text style={styles.statLabel}>Points</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{territoryCount}</Text>
              <Text style={styles.statLabel}>Territories</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  mapPlaceholder: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  gridOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.1,
  },
  gridRow: {
    flex: 1,
    flexDirection: 'row',
  },
  gridCell: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#4B5563',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    marginBottom: 24,
    textAlign: 'center',
  },
  coordsContainer: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    alignItems: 'center',
  },
  coordsLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  coords: {
    fontSize: 16,
    color: '#22C55E',
    fontWeight: '600' as const,
    fontFamily: 'monospace',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#374151',
    marginHorizontal: 16,
  },
});
