import React, { useMemo, useRef, useEffect, useState } from "react";
import { StyleProp, ViewStyle, View, Text, StyleSheet, Image, Platform } from "react-native";
import { MapPin, Navigation } from "lucide-react-native";
import { ModeColors, ActivityMode, Player } from "@/constants/game";
import type { LatLng, Territory } from "@/providers/SessionProvider";

import MapView, { Marker, Polyline, Polygon } from "react-native-maps";
import * as Location from "expo-location";

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

export default function TrackingMap(props: TrackingMapProps) {
  console.log('🗺️ TrackingMap rendering, Platform.OS:', Platform.OS);
  
  // react-native-maps is polyfilled for web, so we can use NativeMapWrapper on all platforms
  return <NativeMapWrapper {...props} />;
}

function NativeMapWrapper(props: TrackingMapProps) {
  const [hasError, setHasError] = useState(false);
  
  if (hasError) {
    console.log('❌ NativeMap had an error, showing fallback');
    return <WebMapFallback {...props} />;
  }
  
  return <NativeMap {...props} onError={() => setHasError(true)} />;
}

function NativeMap({
  style,
  region,
  path = [],
  mode,
  lastPoint,
  territories = [],
  ownerId,
  ownerColor,
  players = [],
  nickname = "Player",
  avatarStyle = "shapes",
  isTracking = false,
  onError,
}: TrackingMapProps & { onError?: () => void }) {
  const mapRef = useRef<any>(null);
  const [heading, setHeading] = useState<number | null>(null);

  const hasInitiallyZoomed = useRef(false);
  


  const territoryPolys = useMemo(() => {
    if (!territories || !Array.isArray(territories)) return [];
    
    const YOUR_COLOR = ownerColor ?? "#22C55E"; // Green for your territories
    const OTHER_PLAYER_COLOR = "#EF4444"; // Red for other players' territories
    const CONTESTED_COLOR = "#F59E0B"; // Orange/amber for contested
    
    return territories
      .filter((t): t is Territory => !!t && Array.isArray(t.polygon))
      .map((t) => {
        const owners = Array.isArray(t.owners) ? t.owners : [];
        const dominant = [...owners].sort((a, b) => b.strength - a.strength)[0];
        const isYours = Boolean(dominant?.ownerId && ownerId && dominant.ownerId === ownerId);
        const contested = owners.length > 1;
        
        let baseColor: string;
        let strokeColor: string;
        let fillColor: string;
        
        if (contested) {
          // Contested territory - orange with pulsing effect visual
          strokeColor = CONTESTED_COLOR;
          fillColor = `${CONTESTED_COLOR}55`;
        } else if (isYours) {
          // Your territory - green
          baseColor = YOUR_COLOR;
          strokeColor = baseColor;
          fillColor = `${baseColor}55`;
        } else {
          // Other player's territory - red
          baseColor = OTHER_PLAYER_COLOR;
          strokeColor = baseColor;
          fillColor = `${baseColor}44`;
        }
        
        const coords = (t.polygon ?? []).map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
        return { id: t.id, coords, stroke: strokeColor, fill: fillColor, isYours, contested } as const;
      });
  }, [territories, ownerId, ownerColor]);

  useEffect(() => {
    if (region && mapRef.current && !hasInitiallyZoomed.current) {
      hasInitiallyZoomed.current = true;
      console.log('🗺️ Initial zoom to user location:', region.latitude, region.longitude);
      setTimeout(() => {
        try {
          mapRef.current?.animateToRegion(
            {
              latitude: region.latitude,
              longitude: region.longitude,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            },
            800
          );
        } catch (e) {
          console.log('❌ Failed to animate to initial region:', e);
        }
      }, 500);
    }
  }, [region]);

  useEffect(() => {
    if (lastPoint && mapRef.current) {
      const cam = {
        center: { latitude: lastPoint.latitude, longitude: lastPoint.longitude },
        heading: typeof heading === "number" && heading >= 0 ? heading : undefined,
        pitch: 0,
      };
      try {
        mapRef.current.animateCamera(cam, { duration: 500 });
      } catch {
        mapRef.current.animateToRegion(
          {
            latitude: lastPoint.latitude,
            longitude: lastPoint.longitude,
            latitudeDelta: 0.003,
            longitudeDelta: 0.003,
          },
          500
        );
      }
    }
  }, [lastPoint, heading]);

  useEffect(() => {
    let sub: any = null;
    let cancelled = false;
    (async () => {
      try {
        if (!isTracking) return;
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        sub = await Location.watchHeadingAsync((h: any) => {
          if (cancelled) return;
          const deg = (h?.trueHeading ?? h?.magHeading ?? -1);
          if (typeof deg === "number" && isFinite(deg) && deg >= 0) {
            setHeading(deg);
          }
        });
      } catch (e) {
        console.log('❌ Heading watch error:', e);
      }
    })();
    return () => {
      cancelled = true;
      try { sub?.remove(); } catch {}
    };
  }, [isTracking]);

  if (!region) {
    console.log('🗺️ NativeMap returning null:', { hasRegion: !!region });
    return null;
  }

  const pngAvatar = (avatarStyleParam: string, seed: string) => `https://api.dicebear.com/8.x/${avatarStyleParam}/png?seed=${encodeURIComponent(seed)}&size=128`;
  const toPng = (u?: string, fallbackStyle?: string, fallbackSeed?: string) => {
    if (u && u.includes('/svg?')) return u.replace('/svg?', '/png?') + "&size=128";
    if (u) return u;
    return pngAvatar(fallbackStyle ?? "shapes", fallbackSeed ?? "Player");
  };

  return (
    <MapView
      ref={mapRef}
      style={style}
      initialRegion={{
        latitude: region.latitude,
        longitude: region.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      }}
      showsUserLocation
      showsMyLocationButton
      showsCompass
      rotateEnabled
      followsUserLocation={!isTracking}
      testID="map-native"
    >
      {territoryPolys.map((p, idx) => (
        <Polygon key={`poly-${p.id || idx}`}
          coordinates={p.coords}
          strokeColor={p.stroke}
          strokeWidth={2}
          fillColor={p.fill}
        />
      ))}
      {(path?.length ?? 0) > 0 && (
        <Polyline
          coordinates={(path ?? []).map((p) => ({ latitude: p.latitude, longitude: p.longitude }))}
          strokeColor={mode ? ModeColors[mode] : "#3B82F6"}
          strokeWidth={4}
        />
      )}
      {players
        .filter((player): player is Player & { approxLocation: NonNullable<Player['approxLocation']> } => 
          player !== null && player !== undefined && typeof player.id === 'string' && player.id.length > 0 && !!player.approxLocation
        )
        .map((player, idx) => {
          const avatarUri = toPng(player.avatarUrl, avatarStyle, player.nickname);
          if (!avatarUri || avatarUri.trim().length === 0) {
            console.log('⚠️ Skipping player marker due to invalid avatar URL:', player.id);
            return null;
          }
          return (
            <Marker
              key={`player-${player.id || idx}`}
              coordinate={{
                latitude: player.approxLocation.latitude,
                longitude: player.approxLocation.longitude,
              }}
              title={player.nickname}
              testID={`player-marker-${player.id || idx}`}
            >
              <Image
                source={{ uri: avatarUri }}
                style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: player.color }}
              />
            </Marker>
          );
        })}
      {lastPoint && (
        <Marker
          key={`you-${ownerId || 'self'}-${avatarStyle}`}
          coordinate={{ latitude: lastPoint.latitude, longitude: lastPoint.longitude }}
          title={nickname}
          testID="last-point-marker"
        >
          <Image
            source={{ uri: pngAvatar(avatarStyle, nickname) }}
            style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 3, borderColor: ownerColor }}
          />
        </Marker>
      )}
    </MapView>
  );
}

function WebMapFallback({
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
