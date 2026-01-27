import React, { useMemo, useRef, useEffect, useState } from "react";
import { StyleProp, ViewStyle, Image, Platform } from "react-native";
import MapView, { Marker, Polyline, Polygon, Camera } from "react-native-maps";
import { ModeColors, ActivityMode, Player } from "@/constants/game";
import type { LatLng, Territory } from "@/providers/SessionProvider";
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

export default function TrackingMap({
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
}: TrackingMapProps) {
  const mapRef = useRef<MapView>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const territoryPolys = useMemo(() => {
    if (!territories || !Array.isArray(territories)) return [];
    return territories
      .filter((t): t is Territory => !!t && Array.isArray(t.polygon))
      .map((t) => {
        const owners = Array.isArray(t.owners) ? t.owners : [];
        const dominant = [...owners].sort((a, b) => b.strength - a.strength)[0];
        const isYours = Boolean(dominant?.ownerId && ownerId && dominant.ownerId === ownerId);
        const contested = owners.length > 1;
        const baseColor = isYours ? (ownerColor ?? "#22C55E") : ModeColors[t.mode];
        const stroke = contested ? "#0EA5E9" : baseColor;
        const fill = contested ? "#0EA5E977" : (`${baseColor}55` as string);
        const coords = (t.polygon ?? []).map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
        return { id: t.id, coords, stroke: stroke, fill } as const;
      });
  }, [territories, ownerId, ownerColor]);

  useEffect(() => {
    if (lastPoint && mapRef.current) {
      const cam: Partial<Camera> = {
        center: { latitude: lastPoint.latitude, longitude: lastPoint.longitude },
        heading: typeof heading === "number" && heading >= 0 ? heading : undefined,
        pitch: 0,
      };
      try {
        mapRef.current.animateCamera(cam as Camera, { duration: 500 });
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
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      try {
        if (Platform.OS === "web") return;
        if (!isTracking) return;
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        sub = await Location.watchHeadingAsync((h) => {
          if (cancelled) return;
          const deg = (h?.trueHeading ?? h?.magHeading ?? -1);
          if (typeof deg === "number" && isFinite(deg) && deg >= 0) {
            setHeading(deg);
          }
        });
      } catch {}
    })();
    return () => {
      cancelled = true;
      try { sub?.remove(); } catch {}
    };
  }, [isTracking]);

  if (!region) {
    return null;
  }

  const pngAvatar = (style: string, seed: string) => `https://api.dicebear.com/8.x/${style}/png?seed=${encodeURIComponent(seed)}&size=128`;
  const toPng = (u?: string, fallbackStyle?: string, fallbackSeed?: string) => {
    if (u && u.includes('/svg?')) return u.replace('/svg?', '/png?') + "&size=128";
    if (u) return u;
    return pngAvatar(fallbackStyle ?? "shapes", fallbackSeed ?? "Player");
  };

  return (
    <MapView
      ref={mapRef}
      style={style}
      initialRegion={region}
      showsUserLocation
      showsMyLocationButton
      showsCompass
      rotateEnabled
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
