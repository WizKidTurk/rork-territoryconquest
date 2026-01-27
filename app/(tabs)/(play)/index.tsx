import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, Modal, Pressable, Animated } from "react-native";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useSession } from "@/providers/SessionProvider";
import { ModeColors, ModeLabels } from "@/constants/game";
import { Pause, Play, Square, Bike, Footprints, Flame } from "lucide-react-native";
import TrackingMap from "@/components/TrackingMap";
import * as Location from "expo-location";
import { CycleAwards, WalkingAwards, RunningAwards } from "@/constants/awards";

type LatLng = { latitude: number; longitude: number };

type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

export default function PlayScreen() {
  return (
    <ErrorBoundary>
      <Inner />
    </ErrorBoundary>
  );
}

function Inner() {
  const { mode, state, path, distance, stepCount, territories, loopCaptured, capturedLoopCount, lastCaptured, canSelectMode, start, pause, resume, stop, elapsedMs, ownerId, ownerColor, players, nickname, avatarStyle, showInactivityPrompt, inactivityPauseCountdown, autoPaused, handleInactivityResponse, cancelAutoPause, locationPermissionDenied, setLocationPermissionDenied } = useSession();

  useEffect(() => {
    console.log('📍 Territories count:', territories.length);
    console.log('🎮 Your player ID:', ownerId);
    territories.forEach((t, i) => {
      console.log(`Territory ${i}:`, {
        id: t.id,
        owners: t.owners.map(o => ({ id: o.ownerId.slice(0, 8), strength: o.strength.toFixed(2) })),
        points: t.polygon.length,
      });
    });
  }, [territories.length, ownerId]);

  const lastPoint = path[path.length - 1];

  const [initialRegion, setInitialRegion] = useState<Region | null>(null);
  const [showModePicker, setShowModePicker] = useState<boolean>(false);
  const [showLocationPrompt, setShowLocationPrompt] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    async function getInitialLocation() {
      try {
        if (Platform.OS === "web") {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (cancelled) return;
              setInitialRegion({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                latitudeDelta: 0.003,
                longitudeDelta: 0.003,
              });
            },
            () => {
              if (cancelled) return;
              setInitialRegion({ latitude: 37.7749, longitude: -122.4194, latitudeDelta: 0.04, longitudeDelta: 0.04 });
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
          );
        } else {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== "granted") {
            setShowLocationPrompt(true);
            setInitialRegion({ latitude: 37.7749, longitude: -122.4194, latitudeDelta: 0.04, longitudeDelta: 0.04 });
            return;
          }
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
          if (cancelled) return;
          setInitialRegion({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            latitudeDelta: 0.003,
            longitudeDelta: 0.003,
          });
        }
      } catch {
        if (!cancelled) {
          setInitialRegion({ latitude: 37.7749, longitude: -122.4194, latitudeDelta: 0.04, longitudeDelta: 0.04 });
        }
      }
    }
    getInitialLocation();
    return () => {
      cancelled = true;
    };
  }, []);

  const region = useMemo(() => {
    if (lastPoint) {
      return {
        latitude: lastPoint.latitude,
        longitude: lastPoint.longitude,
        latitudeDelta: 0.003,
        longitudeDelta: 0.003,
      } as const;
    }
    return initialRegion ?? null;
  }, [lastPoint, initialRegion]);

  const miles = (distance / 1609.344).toFixed(2);
  const milesNum = Number(miles);
  const meters = Math.round(distance);
  const avgSpeedMph = elapsedMs > 0 ? ((distance / 1609.344) / (elapsedMs / 3600000)).toFixed(1) : "0.0";

  const [awardImage, setAwardImage] = useState<string | null>(null);
  const [awardMiles, setAwardMiles] = useState<number | null>(null);
  const [shownMilestones, setShownMilestones] = useState<number[]>([]);
  const [imageLoaded, setImageLoaded] = useState<boolean>(false);
  const awardOpacity = useRef(new Animated.Value(0)).current;
  const awardScale = useRef(new Animated.Value(0.3)).current;
  const awardRotate = useRef(new Animated.Value(0)).current;
  const trophyBounce = useRef(new Animated.Value(0)).current;
  const shinePosition = useRef(new Animated.Value(-200)).current;
  const hideTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (state !== "active" || !mode) return;
    
    let list = CycleAwards;
    if (mode === "walk") list = WalkingAwards;
    else if (mode === "run") list = RunningAwards;
    else if (mode === "cycle") list = CycleAwards;
    
    const upcoming = list.find(a => milesNum >= a.miles && !shownMilestones.includes(a.miles));
    if (!upcoming) return;
    
    console.log('🏆 Achievement unlocked!', { mode, miles: upcoming.miles, imageUrl: upcoming.imageUrl });
    setShownMilestones(prev => [...prev, upcoming.miles]);
    setAwardImage(upcoming.imageUrl);
    setAwardMiles(upcoming.miles);
    setImageLoaded(true);
  }, [milesNum, state, mode, shownMilestones]);

  useEffect(() => {
    if (!awardImage) return;
    
    console.log('🎨 Animating achievement popup');
    awardOpacity.setValue(0);
    awardScale.setValue(0.3);
    awardRotate.setValue(-10);
    trophyBounce.setValue(0);
    shinePosition.setValue(-200);
    
    Animated.sequence([
      Animated.parallel([
        Animated.timing(awardOpacity, { toValue: 1, duration: 300, useNativeDriver: Platform.OS !== "web" }),
        Animated.spring(awardScale, {
          toValue: 1,
          tension: 50,
          friction: 5,
          useNativeDriver: Platform.OS !== "web"
        }),
        Animated.spring(awardRotate, {
          toValue: 0,
          tension: 40,
          friction: 3,
          useNativeDriver: Platform.OS !== "web"
        })
      ]),
      Animated.loop(
        Animated.sequence([
          Animated.timing(trophyBounce, { toValue: -8, duration: 500, useNativeDriver: Platform.OS !== "web" }),
          Animated.timing(trophyBounce, { toValue: 0, duration: 500, useNativeDriver: Platform.OS !== "web" })
        ])
      )
    ]).start();
    
    Animated.loop(
      Animated.timing(shinePosition, {
        toValue: 400,
        duration: 2000,
        useNativeDriver: Platform.OS !== "web"
      })
    ).start();
    
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    
    hideTimeoutRef.current = setTimeout(() => {
      console.log('⏱️ Hiding achievement popup after 1 minute');
      Animated.timing(awardOpacity, { toValue: 0, duration: 300, useNativeDriver: Platform.OS !== "web" }).start(({ finished }) => {
        if (finished) {
          setAwardImage(null);
          setAwardMiles(null);
          setImageLoaded(false);
        }
      });
    }, 60000) as unknown as number;
    
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    };
  }, [awardImage, awardOpacity, awardScale, awardRotate, trophyBounce, shinePosition]);

  useEffect(() => {
    if (state === "idle") {
      setShownMilestones([]);
      setAwardImage(null);
      setAwardMiles(null);
      setImageLoaded(false);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    }
  }, [state]);

  const formatTime = (ms: number): string => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600).toString().padStart(2, "0");
    const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, "0");
    const s = Math.floor(totalSec % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  const formatCountdown = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };



  useEffect(() => {
    if (locationPermissionDenied) {
      setShowLocationPrompt(true);
    }
  }, [locationPermissionDenied]);

  return (
    <View style={styles.container} testID="play-screen">
      {!region ? (
        <View style={styles.mapFallback}>
          <Text style={styles.fallbackText}>Locating...</Text>
        </View>
      ) : (
        <TrackingMap
          style={styles.map}
          region={region}
          path={path}
          mode={mode}
          lastPoint={lastPoint}
          territories={territories}
          ownerId={ownerId}
          ownerColor={ownerColor}
          players={players}
          nickname={nickname}
          avatarStyle={avatarStyle}
          isTracking={state === "active"}
        />
      )}

      {awardImage && awardMiles !== null && (
        <View style={styles.awardOverlay} testID="award-overlay">
          <Pressable
            style={styles.awardBackdrop}
            onPress={() => {
              console.log('🔘 User dismissed achievement popup');
              if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
                hideTimeoutRef.current = null;
              }
              Animated.timing(awardOpacity, { toValue: 0, duration: 300, useNativeDriver: Platform.OS !== "web" }).start(({ finished }) => {
                if (finished) {
                  setAwardImage(null);
                  setAwardMiles(null);
                  setImageLoaded(false);
                }
              });
            }}
          >
            <Animated.View style={[styles.awardCard, {
              opacity: awardOpacity,
              transform: [
                { scale: awardScale },
                { rotate: awardRotate.interpolate({ inputRange: [-10, 0], outputRange: ['-10deg', '0deg'] }) }
              ]
            }]}>
              <View style={styles.awardContent}>
                <Animated.View style={[styles.trophyContainer, { transform: [{ translateY: trophyBounce }] }]}>
                  <Text style={styles.awardTrophy}>🏆</Text>
                  <View style={styles.sparkles}>
                    <Text style={[styles.sparkle, styles.sparkle1]}>✨</Text>
                    <Text style={[styles.sparkle, styles.sparkle2]}>✨</Text>
                    <Text style={[styles.sparkle, styles.sparkle3]}>✨</Text>
                  </View>
                </Animated.View>
                <View style={styles.awardTextContainer}>
                  <Text style={styles.awardTitle}>ACHIEVEMENT</Text>
                  <Text style={styles.awardTitle2}>UNLOCKED!</Text>
                  <View style={styles.awardMilesContainer}>
                    <View style={styles.awardMilesBadge}>
                      <Text style={styles.awardMilesNumber}>{awardMiles}</Text>
                      <Text style={styles.awardMilesUnit}>MILE</Text>
                    </View>
                    <Text style={styles.awardMilestone}>MILESTONE</Text>
                  </View>
                  {mode && (
                    <View style={[styles.modeBadge, { backgroundColor: ModeColors[mode] }]}>
                      {mode === 'walk' && <Footprints color="#111" size={14} />}
                      {mode === 'run' && <Flame color="#111" size={14} />}
                      {mode === 'cycle' && <Bike color="#111" size={14} />}
                      <Text style={styles.modeBadgeText}>{ModeLabels[mode]}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.tapToDismiss}>Tap to dismiss</Text>
              </View>
              <Animated.View style={[styles.shineEffect, { transform: [{ translateX: shinePosition }] }]} />
            </Animated.View>
          </Pressable>
        </View>
      )}

      {state !== "idle" && (
        <View style={styles.sessionInfo} pointerEvents="box-none">
          <View style={styles.infoCard} testID="session-info-card">
            <View style={styles.infoRow}>
              {mode && (mode === "walk" || mode === "run") ? (
                <Text style={styles.infoPrimary}>{stepCount.toLocaleString()} steps • {miles} mi</Text>
              ) : mode === "cycle" ? (
                <Text style={styles.infoPrimary}>{miles} mi</Text>
              ) : null}
              <Text style={styles.speedBadge}>{avgSpeedMph} mph</Text>
            </View>
            <Text style={styles.infoSecondary}>{formatTime(elapsedMs)}</Text>
            {capturedLoopCount > 0 && (
              <View style={styles.loopCountBadge}>
                <Text style={styles.loopCountText}>{capturedLoopCount} {capturedLoopCount === 1 ? 'loop' : 'loops'} captured</Text>
              </View>
            )}
            {loopCaptured && (
              <View style={styles.capturedBadge} testID="loop-captured-pill">
                <Text style={styles.capturedText}>Territory captured!</Text>
              </View>
            )}
          </View>
        </View>
      )}

      <View style={styles.modeRow}>
        {(!mode || mode === "walk") && (
          <ModeButton
            label="Walk"
            color={ModeColors.walk}
            Icon={Footprints}
            disabled={!canSelectMode && !!mode}
            onPress={() => start("walk")}
            active={mode === "walk"}
            shouldPulse={(canSelectMode && !mode) || (mode === "walk" && state !== "idle")}
          />
        )}
        {(!mode || mode === "run") && (
          <ModeButton
            label="Run"
            color={ModeColors.run}
            Icon={Flame}
            disabled={!canSelectMode && !!mode}
            onPress={() => start("run")}
            active={mode === "run"}
            shouldPulse={(canSelectMode && !mode) || (mode === "run" && state !== "idle")}
          />
        )}
        {(!mode || mode === "cycle") && (
          <ModeButton
            label="Cycle"
            color={ModeColors.cycle}
            Icon={Bike}
            disabled={!canSelectMode && !!mode}
            onPress={() => start("cycle")}
            active={mode === "cycle"}
            shouldPulse={(canSelectMode && !mode) || (mode === "cycle" && state !== "idle")}
          />
        )}
      </View>

      <View style={styles.controls}>
        {state === "active" && (
          <TouchableOpacity style={[styles.controlBtn, styles.pause]} onPress={pause} testID="pause-button">
            <Pause color="#111" />
          </TouchableOpacity>
        )}
        {state === "paused" && (
          <TouchableOpacity style={[styles.controlBtn, styles.resume]} onPress={resume} testID="resume-button">
            <Play color="#111" />
          </TouchableOpacity>
        )}
        {state !== "idle" && (
          <TouchableOpacity style={[styles.controlBtn, styles.stop]} onPress={stop} testID="stop-button">
            <Square color="#111" />
          </TouchableOpacity>
        )}
      </View>

      {showInactivityPrompt && (
        <View style={styles.inactivityOverlay} testID="inactivity-prompt">
          <Pressable style={styles.inactivityBackdrop} onPress={() => {}} />
          <View style={styles.inactivityCard}>
            <Text style={styles.inactivityEmoji}>😴</Text>
            <Text style={styles.inactivityTitle}>Still {mode === "walk" ? "Walking" : mode === "run" ? "Running" : "Cycling"}?</Text>
            <Text style={styles.inactivityMessage}>
              We haven’t detected any movement in the last 5 minutes.
              {"\n\n"}
              Are you still active or would you like to pause?
            </Text>
            <View style={styles.inactivityButtons}>
              <TouchableOpacity 
                style={[styles.inactivityBtn, styles.inactivityBtnYes]} 
                onPress={() => handleInactivityResponse(true)}
                testID="inactivity-yes"
              >
                <Text style={styles.inactivityBtnTextYes}>✔️ Yes, I’m still {mode === "walk" ? "walking" : mode === "run" ? "running" : "cycling"}!</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.inactivityBtn, styles.inactivityBtnNo]} 
                onPress={() => handleInactivityResponse(false)}
                testID="inactivity-no"
              >
                <Text style={styles.inactivityBtnTextNo}>⏸️ Pause my session</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.inactivityWarning}>
              No response? We’ll pause automatically in {formatCountdown(180 - inactivityPauseCountdown)}
            </Text>
          </View>
        </View>
      )}

      {autoPaused && state === "paused" && (
        <View style={styles.autoPauseOverlay} testID="auto-pause-banner">
          <View style={styles.autoPauseCard}>
            <Text style={styles.autoPauseEmoji}>⏸️</Text>
            <Text style={styles.autoPauseTitle}>Session Paused</Text>
            <Text style={styles.autoPauseMessage}>
              Your session has been paused due to inactivity.
              {"\n\n"}
              Tap below to resume, or we’ll end the session in:
            </Text>
            <View style={styles.autoPauseCountdown}>
              <Text style={styles.autoPauseCountdownText}>{formatCountdown(180 - inactivityPauseCountdown)}</Text>
            </View>
            <TouchableOpacity 
              style={styles.autoPauseResumeBtn} 
              onPress={cancelAutoPause}
              testID="auto-pause-resume"
            >
              <Play color="#111" size={20} />
              <Text style={styles.autoPauseResumeBtnText}>Resume Session</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {showLocationPrompt && (
        <View style={styles.inactivityOverlay} testID="location-permission-prompt">
          <Pressable style={styles.inactivityBackdrop} onPress={() => {}} />
          <View style={[styles.inactivityCard, { borderColor: '#3B82F6' }]}>
            <Text style={styles.inactivityEmoji}>📍</Text>
            <Text style={[styles.inactivityTitle, { color: '#60A5FA' }]}>Enable Location</Text>
            <Text style={styles.inactivityMessage}>
              We need your precise location to show the map around you and track your session. Please enable Location in Settings.
            </Text>
            <View style={styles.inactivityButtons}>
              <TouchableOpacity 
                style={[styles.inactivityBtn, { backgroundColor: '#3B82F6' }]} 
                onPress={async () => {
                  try {
                    const { Linking, Platform } = await import('react-native');
                    if (Platform.OS === 'web') {
                      console.log('Opening browser location settings is not supported on web');
                    } else {
                      await Linking.openSettings();
                    }
                  } catch {}
                }}
                testID="open-settings-btn"
              >
                <Text style={styles.inactivityBtnTextYes}>Open Settings</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.inactivityBtn, styles.inactivityBtnNo]} 
                onPress={() => { setShowLocationPrompt(false); setLocationPermissionDenied(false); }}
                testID="location-not-now"
              >
                <Text style={styles.inactivityBtnTextNo}>Not now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <Modal visible={showModePicker} transparent animationType="fade" onRequestClose={() => setShowModePicker(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select mode</Text>
            <View style={{ gap: 10 }}>
              <Pressable style={[styles.modalBtn, { backgroundColor: ModeColors.walk }]} onPress={() => { setShowModePicker(false); start("walk"); }} testID="modal-walk">
                <Footprints color="#111" />
                <Text style={styles.modalBtnText}>Walk</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, { backgroundColor: ModeColors.run }]} onPress={() => { setShowModePicker(false); start("run"); }} testID="modal-run">
                <Flame color="#111" />
                <Text style={styles.modalBtnText}>Run</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, { backgroundColor: ModeColors.cycle }]} onPress={() => { setShowModePicker(false); start("cycle"); }} testID="modal-cycle">
                <Bike color="#111" />
                <Text style={styles.modalBtnText}>Cycle</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => setShowModePicker(false)} style={styles.modalCancel} testID="modal-cancel">
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

type IconComp = React.ComponentType<{ color?: string; size?: number }>;

function ModeButton({ label, color, Icon, disabled, onPress, active, shouldPulse }: { label: string; color: string; Icon: IconComp; disabled: boolean; onPress: () => void; active: boolean; shouldPulse: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    if (shouldPulse) {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.06, duration: 800, useNativeDriver: Platform.OS !== "web" }),
          Animated.timing(scale, { toValue: 1, duration: 800, useNativeDriver: Platform.OS !== "web" }),
        ])
      );
      loop.start();
    } else {
      scale.setValue(1);
    }
    return () => {
      if (loop) loop.stop();
    };
  }, [scale, shouldPulse]);

  const bg = active ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.9)";
  const textColor = active ? "#111" : color;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        style={[
          styles.modeBtn,
          styles.modeBtnShadow,
          { borderColor: color, backgroundColor: bg },
        ]}
        onPress={onPress}
        disabled={!active && disabled}
        testID={`mode-${label.toLowerCase()}-button`}
      >
        <Icon color={textColor} size={22} />
        <Text style={[styles.modeLabel, { color: textColor }]}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B1220" },
  map: { flex: 1 },
  mapFallback: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  fallbackText: { color: "#999" },
  sessionInfo: { position: "absolute", top: 16, left: 0, right: 0, alignItems: "center" },
  infoCard: { backgroundColor: "rgba(17,24,39,0.85)", paddingVertical: 12, paddingHorizontal: 16, borderRadius: 16, alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#1F2937" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoPrimary: { color: "#fff", fontWeight: "700", fontSize: 16 },
  infoSecondary: { color: "#9CA3AF", fontWeight: "700", fontSize: 14 },
  speedBadge: { backgroundColor: "rgba(59,130,246,0.2)", color: "#60A5FA", fontWeight: "700", fontSize: 13, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: "#3B82F6" },
  modeSmallBtn: { marginTop: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9999 },
  modeSmallText: { color: "#fff", fontWeight: "700" },
  loopCountBadge: { marginTop: 6, backgroundColor: "rgba(34,197,94,0.2)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9999, borderWidth: 1, borderColor: "#22C55E" },
  loopCountText: { color: "#22C55E", fontWeight: "700", fontSize: 12 },
  capturedBadge: { marginTop: 8, backgroundColor: "#22C55E", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9999 },
  capturedText: { color: "#111", fontWeight: "700" },

  modeRow: { position: "absolute", left: 16, right: 16, bottom: 120, flexDirection: "row", gap: 12, justifyContent: "space-between" },
  modeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, borderWidth: 2 },
  modeBtnShadow: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  modeLabel: { fontWeight: "700", fontSize: 16 },
  controls: { position: "absolute", bottom: 40, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 12 },
  controlBtn: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  pause: { backgroundColor: "#FDE68A" },
  resume: { backgroundColor: "#86EFAC" },
  stop: { backgroundColor: "#FCA5A5" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 420, backgroundColor: "#111827", borderRadius: 16, padding: 20, gap: 16 },
  modalTitle: { color: "#fff", fontWeight: "700", fontSize: 18 },
  modalBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, paddingVertical: 12, justifyContent: "center" },
  modalBtnText: { color: "#111", fontWeight: "700" },
  modalCancel: { marginTop: 8, alignItems: "center" },
  modalCancelText: { color: "#9CA3AF" },
  livePill: { position: "absolute", right: 16, top: 0, backgroundColor: "rgba(34,197,94,0.15)", borderColor: "#22C55E", borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9999 },
  livePillText: { color: "#22C55E", fontWeight: "700" },

  inactivityOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", zIndex: 1000 },
  inactivityBackdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.7)" },
  inactivityCard: { width: "86%", maxWidth: 400, backgroundColor: "#1F2937", borderRadius: 24, padding: 24, alignItems: "center", gap: 16, borderWidth: 3, borderColor: "#F59E0B" },
  inactivityEmoji: { fontSize: 64, marginBottom: 8 },
  inactivityTitle: { color: "#F59E0B", fontSize: 24, fontWeight: "800", textAlign: "center" },
  inactivityMessage: { color: "#E5E7EB", fontSize: 16, fontWeight: "600", textAlign: "center", lineHeight: 24 },
  inactivityButtons: { width: "100%", gap: 12, marginTop: 8 },
  inactivityBtn: { width: "100%", paddingVertical: 16, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  inactivityBtnYes: { backgroundColor: "#22C55E" },
  inactivityBtnNo: { backgroundColor: "#EF4444" },
  inactivityBtnTextYes: { color: "#111", fontSize: 16, fontWeight: "700" },
  inactivityBtnTextNo: { color: "#fff", fontSize: 16, fontWeight: "700" },
  inactivityWarning: { color: "#9CA3AF", fontSize: 13, fontWeight: "600", textAlign: "center", marginTop: 8 },

  autoPauseOverlay: { position: "absolute", left: 16, right: 16, top: 80, alignItems: "center", zIndex: 999 },
  autoPauseCard: { width: "100%", maxWidth: 400, backgroundColor: "#1F2937", borderRadius: 20, padding: 20, alignItems: "center", gap: 12, borderWidth: 2, borderColor: "#EF4444", shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  autoPauseEmoji: { fontSize: 48 },
  autoPauseTitle: { color: "#EF4444", fontSize: 20, fontWeight: "800", textAlign: "center" },
  autoPauseMessage: { color: "#E5E7EB", fontSize: 14, fontWeight: "600", textAlign: "center", lineHeight: 20 },
  autoPauseCountdown: { backgroundColor: "rgba(239,68,68,0.2)", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, borderWidth: 2, borderColor: "#EF4444", marginVertical: 8 },
  autoPauseCountdownText: { color: "#EF4444", fontSize: 32, fontWeight: "800", fontVariant: ["tabular-nums"] },
  autoPauseResumeBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#22C55E", paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, marginTop: 8 },
  autoPauseResumeBtnText: { color: "#111", fontSize: 16, fontWeight: "700" },

  awardOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.85)" },
  awardBackdrop: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  awardCard: {
    width: "80%",
    maxWidth: 340,
    backgroundColor: "#1F2937",
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: 4,
    borderColor: "#F59E0B",
    shadowColor: "#F59E0B",
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12
  },
  awardContent: {
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 16,
    backgroundColor: "linear-gradient(135deg, #1F2937 0%, #111827 100%)"
  },
  trophyContainer: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative"
  },
  awardTrophy: { fontSize: 72, marginBottom: 4 },
  sparkles: {
    position: "absolute",
    width: 120,
    height: 120,
    alignItems: "center",
    justifyContent: "center"
  },
  sparkle: {
    position: "absolute",
    fontSize: 20
  },
  sparkle1: { top: 0, left: 20 },
  sparkle2: { top: 10, right: 15 },
  sparkle3: { bottom: 15, left: 10 },
  awardTextContainer: {
    alignItems: "center",
    gap: 4
  },
  awardTitle: {
    color: "#FBBF24",
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 2,
    textShadowColor: "rgba(251,191,36,0.5)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8
  },
  awardTitle2: {
    color: "#FBBF24",
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 2,
    marginTop: -4,
    textShadowColor: "rgba(251,191,36,0.5)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8
  },
  awardMilesContainer: {
    alignItems: "center",
    gap: 8,
    marginTop: 12
  },
  awardMilesBadge: {
    flexDirection: "row",
    alignItems: "baseline",
    backgroundColor: "rgba(251,191,36,0.15)",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#FBBF24",
    gap: 6
  },
  awardMilesNumber: {
    color: "#FBBF24",
    fontSize: 32,
    fontWeight: "900",
    lineHeight: 32,
    textShadowColor: "rgba(251,191,36,0.3)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4
  },
  awardMilesUnit: {
    color: "#FDE68A",
    fontSize: 14,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1
  },
  awardMilestone: {
    color: "#E5E7EB",
    fontSize: 16,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.5
  },
  modeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginTop: 8
  },
  modeBadgeText: {
    color: "#111",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  tapToDismiss: {
    color: "#9CA3AF",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 8
  },
  shineEffect: {
    position: "absolute",
    top: 0,
    left: -100,
    width: 100,
    height: "100%",
    backgroundColor: "rgba(255,255,255,0.15)",
    transform: [{ skewX: "-20deg" }]
  },
});
