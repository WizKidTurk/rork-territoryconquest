import createContextHook from "@nkzw/create-context-hook";
import { useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Location from "expo-location";
import { Pedometer } from "expo-sensors";
import { startBackgroundLocation, stopBackgroundLocation, drainBackgroundPoints } from "@/services/backgroundLocation";
import type { ActivityMode, Player, TerritoryOwner } from "@/constants/game";
import { CycleAwards, WalkingAwards, RunningAwards } from "@/constants/awards";
import { MaxSpeedMps, LOOP_CLOSE_THRESHOLD_M, MIN_LOOP_DISTANCE_M, MIN_TERRITORY_AREA_M2, DAILY_DECAY_RATE, DefaultOwnerColors } from "@/constants/game";
import { getFirebase } from "@/services/firebase";
import { addDoc, collection, serverTimestamp, onSnapshot, query, orderBy, where, getDocs, deleteDoc, doc } from "firebase/firestore";

export type LatLng = { latitude: number; longitude: number; timestamp: number };

export type AchievementEarned = {
  miles: number;
  imageUrl: string;
  earnedAt: number;
};

export type Session = {
  id: string;
  mode: ActivityMode;
  path: LatLng[];
  distanceMeters: number;
  startedAt: number;
  endedAt: number;
  achievements?: AchievementEarned[];
};

export type Territory = {
  id: string;
  mode: ActivityMode;
  polygon: LatLng[];
  createdAt: number;
  owners: TerritoryOwner[];
};

export type SessionState = "idle" | "active" | "paused";

type PendingSessionUpload = { type: "session"; ownerId: string; payload: Session };

type PendingTerritoryUpload = { type: "territory"; payload: Territory };

const PENDING_SESSION_KEY = "pending_session_uploads" as const;
const PENDING_TERRITORY_KEY = "pending_territory_uploads" as const;

function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function smoothPath(points: LatLng[], windowSize: number): LatLng[] {
  if (points.length <= 2) return points;
  const w = Math.max(2, Math.min(windowSize, 5));
  const out: LatLng[] = [];
  for (let i = 0; i < points.length; i++) {
    const start = Math.max(0, i - Math.floor(w / 2));
    const end = Math.min(points.length - 1, i + Math.floor(w / 2));
    let lat = 0;
    let lon = 0;
    let ts = 0;
    let n = 0;
    for (let j = start; j <= end; j++) {
      lat += points[j]!.latitude;
      lon += points[j]!.longitude;
      ts += points[j]!.timestamp;
      n++;
    }
    out.push({ latitude: lat / n, longitude: lon / n, timestamp: Math.round(ts / n) });
  }
  return out;
}

function toMetersXY(originLat: number, p: { latitude: number; longitude: number }) {
  const R = 6378137;
  const dLat = ((p.latitude - originLat) * Math.PI) / 180;
  const dLon = (p.longitude * Math.PI) / 180;
  const x = R * dLon * Math.cos((originLat * Math.PI) / 180);
  const y = R * dLat;
  return { x, y };
}

function polygonAreaM2(poly: LatLng[]): number {
  if (poly.length < 3) return 0;
  const originLat = poly[0]!.latitude;
  const pts = poly.map((p) => toMetersXY(originLat, p));
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function bbox(poly: LatLng[]) {
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  for (const p of poly) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.longitude < minLon) minLon = p.longitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude > maxLon) maxLon = p.longitude;
  }
  return { minLat, minLon, maxLat, maxLon };
}

function bboxesOverlap(a: LatLng[], b: LatLng[]): boolean {
  const A = bbox(a);
  const B = bbox(b);
  return !(A.maxLat < B.minLat || A.minLat > B.maxLat || A.maxLon < B.minLon || A.minLon > B.maxLon);
}

async function saveSessionsLocally(sessions: Session[]): Promise<void> {
  await AsyncStorage.setItem("sessions", JSON.stringify(sessions));
}

async function saveTerritoriesLocally(territories: Territory[]): Promise<void> {
  await AsyncStorage.setItem("territories", JSON.stringify(territories));
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const PLAYER_UPDATE_INTERVAL = 10000;

export const [SessionProvider, useSession] = createContextHook(() => {
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [mode, setMode] = useState<ActivityMode | null>(null);
  const [state, setState] = useState<SessionState>("idle");
  const [path, setPath] = useState<LatLng[]>([]);
  const [distance, setDistance] = useState<number>(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [loopCaptured, setLoopCaptured] = useState<boolean>(false);
  const [capturedLoopCount, setCapturedLoopCount] = useState<number>(0);
  const [lastCaptured, setLastCaptured] = useState<Territory | null>(null);
  const [ownerId, setOwnerId] = useState<string>("");
  const [ownerColor, setOwnerColor] = useState<string>(DefaultOwnerColors[0]!);
  const [nickname, setNickname] = useState<string>("Player");
  const [nicknameLocked, setNicknameLocked] = useState<boolean>(false);
  const [avatarStyle, setAvatarStyle] = useState<string>("shapes");
  const [avatarLocked, setAvatarLocked] = useState<boolean>(false);
  const [lastMovementTime, setLastMovementTime] = useState<number>(Date.now());
  const [showInactivityPrompt, setShowInactivityPrompt] = useState<boolean>(false);
  const [inactivityPauseCountdown, setInactivityPauseCountdown] = useState<number>(0);
  const [autoPaused, setAutoPaused] = useState<boolean>(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [sessionStartAt, setSessionStartAt] = useState<number | null>(null);
  const [pausedAccumMs, setPausedAccumMs] = useState<number>(0);
  const [pauseStartedAt, setPauseStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [sessionAchievements, setSessionAchievements] = useState<AchievementEarned[]>([]);
  const [stepCount, setStepCount] = useState<number>(0);
  const [sessionStartSteps, setSessionStartSteps] = useState<number>(0);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState<boolean>(false);
  const watchSub = useRef<number | Location.LocationSubscription | null>(null);
  const pedometerSub = useRef<any>(null);
  const inactivityTimerRef = useRef<number | null>(null);
  const pauseCountdownTimerRef = useRef<number | null>(null);
  const lastKnownPositionRef = useRef<LatLng | null>(null);
  const queryClient = useQueryClient();

  const clearInactivityTimers = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    if (pauseCountdownTimerRef.current) {
      clearInterval(pauseCountdownTimerRef.current);
      pauseCountdownTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const timeoutId = setTimeout(() => {
      if (mounted && !isInitialized) {
        console.log('⚠️ SessionProvider initialization timeout - proceeding anyway');
        setIsInitialized(true);
      }
    }, 3000);
    
    (async () => {
      try {
        console.log("🔄 Initializing SessionProvider...");
        
        const [s, t, id, c, n, a, nl, al] = await Promise.all([
          AsyncStorage.getItem("sessions").catch(() => null),
          AsyncStorage.getItem("territories").catch(() => null),
          AsyncStorage.getItem("ownerId").catch(() => null),
          AsyncStorage.getItem("ownerColor").catch(() => null),
          AsyncStorage.getItem("nickname").catch(() => null),
          AsyncStorage.getItem("avatarStyle").catch(() => null),
          AsyncStorage.getItem("nicknameLocked").catch(() => null),
          AsyncStorage.getItem("avatarLocked").catch(() => null),
        ]);
        
        if (!mounted) return;
        
        if (s && typeof s === "string" && s.length > 0) {
          try {
            if (!s.startsWith('[') && !s.startsWith('{')) {
              console.log("❌ Invalid sessions format, clearing");
              await AsyncStorage.removeItem("sessions").catch(() => {});
              setSessions([]);
            } else {
              const parsed = JSON.parse(s);
              if (Array.isArray(parsed)) {
                setSessions(parsed);
                console.log("✅ Loaded", parsed.length, "sessions");
              } else {
                console.log("⚠️ Sessions not array, resetting");
                await AsyncStorage.removeItem("sessions").catch(() => {});
                setSessions([]);
              }
            }
          } catch (parseError) {
            console.log("❌ Failed to parse sessions, clearing");
            await AsyncStorage.removeItem("sessions").catch(() => {});
            setSessions([]);
          }
        }
        
        if (t && typeof t === "string" && t.length > 0) {
          try {
            if (!t.startsWith('[') && !t.startsWith('{')) {
              console.log("❌ Invalid territories format, clearing");
              await AsyncStorage.removeItem("territories").catch(() => {});
              setTerritories([]);
            } else {
              const parsed = JSON.parse(t);
              if (Array.isArray(parsed)) {
                setTerritories(parsed);
                console.log("✅ Loaded", parsed.length, "territories");
              } else {
                console.log("⚠️ Territories not array, resetting");
                await AsyncStorage.removeItem("territories").catch(() => {});
                setTerritories([]);
              }
            }
          } catch (parseError) {
            console.log("❌ Failed to parse territories, clearing");
            await AsyncStorage.removeItem("territories").catch(() => {});
            setTerritories([]);
          }
        }
        
        if (id) {
          setOwnerId(id);
        } else {
          const id2 = uid();
          setOwnerId(id2);
          AsyncStorage.setItem("ownerId", id2).catch(() => {});
        }
        
        if (c) {
          setOwnerColor(c);
        } else {
          const c2 = DefaultOwnerColors[Math.floor(Math.random() * DefaultOwnerColors.length)]!;
          setOwnerColor(c2);
          AsyncStorage.setItem("ownerColor", c2).catch(() => {});
        }
        
        if (n) setNickname(n);
        if (a) setAvatarStyle(a);
        else {
          const defaultStyles = ['bottts', 'avataaars', 'fun-emoji', 'lorelei'];
          const randomStyle = defaultStyles[Math.floor(Math.random() * defaultStyles.length)]!;
          setAvatarStyle(randomStyle);
          AsyncStorage.setItem('avatarStyle', randomStyle).catch(() => {});
        }
        if (al) setAvatarLocked(al === "true");
        if (nl) setNicknameLocked(nl === "true");
        
        console.log("✅ SessionProvider initialization complete");
        clearTimeout(timeoutId);
        setIsInitialized(true);
      } catch (e) {
        console.log("❌ Failed to initialize session data:", e);
        clearTimeout(timeoutId);
        if (mounted) {
          setIsInitialized(true);
        }
      }
    })();
    
    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (!isInitialized) return;
    
    const timer = setTimeout(async () => {
      const current = (nickname ?? '').trim();
      if (!current) return;
      try {
        const ok = await isNicknameAvailable(current);
        if (ok) return;
        
        const base = current.replace(/\s+\d{3,}$/,'');
        for (let i = 0; i < 10; i++) {
          const candidate = `${base} ${Math.floor(100 + Math.random() * 900)}`;
          const free = await isNicknameAvailable(candidate);
          if (free) {
            await updateProfile(candidate, avatarStyle).catch(() => {});
            break;
          }
        }
      } catch (e) {
        console.log('⚠️ Auto-claim nickname failed:', e);
      }
    }, 2000);
    
    return () => clearTimeout(timer);
  }, [isInitialized]);

  const ownerIdRef = useRef<string>(ownerId);
  useEffect(() => {
    ownerIdRef.current = ownerId;
  }, [ownerId]);

  useEffect(() => {
    if (!isInitialized) return;
    
    const refs = getFirebase();
    if (!refs) {
      console.log("🔥 Firebase not configured - territories won't sync");
      return;
    }
    console.log("🔥 Firebase connected, setting up real-time listener...");
    try {
      const q = query(collection(refs.db, "territories"), orderBy("createdAt", "desc"));
      const unsub = onSnapshot(
        q,
        (snap) => {
          try {
            console.log(`📥 Received ${snap.docs.length} territories from Firestore`);

            if (snap.docs.length === 0) {
              console.log("🧹 Remote is empty. Replacing local territories with empty list");
              setTerritories([]);
              saveTerritoriesLocally([]).catch(() => {});
              return;
            }

            const remote: Territory[] = snap.docs
              .map((doc) => {
                const data: any = doc.data();
                const polygonArr = Array.isArray(data?.polygon) ? data.polygon : [];
                const ownersArr = Array.isArray(data?.owners) ? data.owners : [];
                const createdAt: number = typeof data?.createdAt?.toMillis === "function" ? data.createdAt.toMillis() : typeof data?.createdAt === "number" ? data.createdAt : Date.now();
                const modeVal = data?.mode as ActivityMode;
                const polygon: LatLng[] = polygonArr
                  .filter((p: any) => p && typeof p.latitude === "number" && typeof p.longitude === "number")
                  .map((p: any) => ({ latitude: p.latitude, longitude: p.longitude, timestamp: p.timestamp ?? createdAt }));
                const owners = ownersArr
                  .filter((o: any) => o && typeof o.ownerId === "string" && typeof o.strength === "number")
                  .map((o: any) => ({ ownerId: o.ownerId as string, strength: Number(o.strength) }));
                const t: Territory = { id: doc.id, mode: modeVal, polygon, createdAt, owners };
                return t;
              })
              .filter((t): t is Territory => !!t && Array.isArray(t.polygon));

            console.log(`✅ Parsed ${remote.length} valid territories`);
            
            remote.forEach((t, idx) => {
              const ownerSummary = t.owners.map(o => `${o.ownerId.slice(0, 8)}: ${o.strength.toFixed(2)}`).join(', ');
              console.log(`  Territory ${idx + 1}/${remote.length}: ID=${t.id.slice(0, 8)}, owners=[${ownerSummary}], created=${new Date(t.createdAt).toISOString()}, points=${t.polygon.length}`);
            });

            setTerritories(() => {
              const sorted = [...remote].sort((a, b) => b.createdAt - a.createdAt);
              const currentOwnerId = ownerIdRef.current;
              console.log(`💾 Synced total (remote only): ${sorted.length} territories`);
              console.log(`🎮 Your ownerId: ${currentOwnerId}`);
              const yourTerritories = sorted.filter(t => t.owners.some(o => o.ownerId === currentOwnerId));
              const otherTerritories = sorted.filter(t => !t.owners.some(o => o.ownerId === currentOwnerId));
              console.log(`   - Your territories: ${yourTerritories.length}`);
              console.log(`   - Other players' territories: ${otherTerritories.length}`);
              saveTerritoriesLocally(sorted).catch(() => {});
              return sorted;
            });
          } catch (e) {
            console.log("❌ onSnapshot parse error", e);
          }
        },
        (err) => {
          console.log("❌ Firestore listener error:", err?.message ?? String(err));
        }
      );
      return () => {
        try {
          console.log("🔥 Firestore listener cleanup");
          unsub();
        } catch {}
      };
    } catch (e) {
      console.log("❌ Firestore subscription setup failed", e);
    }
  }, [isInitialized]);

  const startPedometer = useCallback(async () => {
    if (Platform.OS === "web") {
      console.log("⚠️ Pedometer not available on web");
      return;
    }
    
    try {
      const isAvailable = await Pedometer.isAvailableAsync();
      if (!isAvailable) {
        console.log("⚠️ Pedometer not available on this device");
        return;
      }
      
      setStepCount(0);
      
      console.log("🚶 Starting pedometer tracking");
      console.log("📱 Pedometer will continue tracking when phone is locked or app is in background");
      
      pedometerSub.current = Pedometer.watchStepCount((result) => {
        console.log("👣 Steps detected:", result.steps);
        setStepCount(prev => prev + result.steps);
      });
    } catch (e) {
      console.log("❌ Failed to start pedometer:", e);
    }
  }, []);

  const stopPedometer = useCallback(() => {
    if (pedometerSub.current) {
      pedometerSub.current.remove();
      pedometerSub.current = null;
      console.log("🚶 Stopped pedometer tracking");
    }
  }, []);

  const resetInactivityTimer = useCallback(() => {
    clearInactivityTimers();
    setLastMovementTime(Date.now());
    setShowInactivityPrompt(false);
    setInactivityPauseCountdown(0);
    
    if (state === "active") {
      inactivityTimerRef.current = setTimeout(() => {
        console.log("⏰ 5 minutes of inactivity detected - showing prompt");
        setShowInactivityPrompt(true);
      }, 5 * 60 * 1000) as unknown as number;
    }
  }, [state, clearInactivityTimers]);

  const startWatching = useCallback(async () => {
    if (Platform.OS === "web") {
      if (watchSub.current && typeof watchSub.current === "number") {
        navigator.geolocation.clearWatch(watchSub.current);
      }
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          const coords = pos.coords;
          if (coords.accuracy && coords.accuracy > 50) {
            console.log("🎯 Filtered inaccurate point, accuracy:", coords.accuracy.toFixed(1), "m");
            return;
          }
          const p: LatLng = {
            latitude: coords.latitude,
            longitude: coords.longitude,
            timestamp: pos.timestamp,
          };
          setPath((prev) => {
            if (prev.length === 0) return [p];
            const last = prev[prev.length - 1];
            if (!last) return [...prev, p];
            const dist = haversine(last, p);
            if (dist > 100) {
              console.log("🎯 Filtered GPS jump:", dist.toFixed(1), "m from last point");
              return prev;
            }
            return [...prev, p];
          });
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
      );
      watchSub.current = id;
    } else {
      let permissionStatus = "denied";
      try {
        const result = await Location.requestForegroundPermissionsAsync().catch(() => ({ status: "denied" as const }));
        permissionStatus = result.status;
      } catch {
        console.log("📍 Location permission request failed");
        setLocationPermissionDenied(true);
        setState("idle");
        setMode(null);
        return;
      }
      
      if (permissionStatus !== "granted") {
        console.log("📍 Location permission not granted");
        setLocationPermissionDenied(true);
        setState("idle");
        setMode(null);
        return;
      }
      
      let sub: Location.LocationSubscription | null = null;
      try {
        sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 3000, distanceInterval: 5 },
        (loc) => {
          if (loc.coords.accuracy && loc.coords.accuracy > 50) {
            console.log("🎯 Filtered inaccurate point, accuracy:", loc.coords.accuracy.toFixed(1), "m");
            return;
          }
          const p: LatLng = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            timestamp: Date.now(),
          };
          setPath((prev) => {
            if (prev.length === 0) return [p];
            const last = prev[prev.length - 1];
            if (!last) return [...prev, p];
            const dist = haversine(last, p);
            if (dist > 100) {
              console.log("🎯 Filtered GPS jump:", dist.toFixed(1), "m from last point");
              return prev;
            }
            return [...prev, p];
          });
        }
      ).catch(() => null);
      } catch {
        console.log("📍 Failed to start location watching");
        setLocationPermissionDenied(true);
        setState("idle");
        setMode(null);
        return;
      }
      
      if (sub) {
        watchSub.current = sub;
      } else {
        console.log("📍 Location watch subscription failed");
        setLocationPermissionDenied(true);
        setState("idle");
        setMode(null);
      }
    }
  }, []);

  const updatePlayerLocation = useCallback(async () => {
    const refs = getFirebase();
    if (!refs || !ownerId || !nickname) return;
    const lastPt = path.length > 0 ? path[path.length - 1] : null;
    if (!lastPt) return;
    
    try {
      const playerData = {
        ownerId,
        nickname,
        nicknameLower: nickname.trim().toLowerCase(),
        avatarStyle,
        ownerColor,
        location: {
          latitude: lastPt.latitude,
          longitude: lastPt.longitude,
        },
        updatedAt: serverTimestamp(),
        isActive: state === "active",
      };
      
      const playersCol = collection(refs.db, "players");
      const q = query(playersCol, where("ownerId", "==", ownerId));
      const snap = await getDocs(q);
      
      if (snap.empty) {
        await addDoc(playersCol, playerData);
        console.log("📍 Created player location entry");
      } else {
        const docRef = doc(refs.db, "players", snap.docs[0]!.id);
        await import('firebase/firestore').then(({ updateDoc }) => 
          updateDoc(docRef, playerData as any)
        );
        console.log("📍 Updated player location");
      }
    } catch (e) {
      console.log("❌ Failed to update player location:", e);
    }
  }, [ownerId, nickname, avatarStyle, ownerColor, path, state]);

  const isNicknameAvailable = useCallback(async (name: string): Promise<boolean> => {
    const refs = getFirebase();
    if (!refs) {
      console.log("⚠️ Nickname check skipped: Firebase not configured/online, allowing nickname");
      return true;
    }
    const desired = name.trim().toLowerCase();
    try {
      const { getDoc, doc } = await import('firebase/firestore');
      const nameRef = doc(refs.db, 'playerNames', desired);
      const nameDoc = await getDoc(nameRef);
      if (nameDoc.exists()) {
        const data: any = nameDoc.data();
        console.log(`🔍 Found existing nickname '${desired}' owned by ${data?.ownerId?.slice(0, 8)}, current owner: ${ownerId?.slice(0, 8)}`);
        if (data?.ownerId && data.ownerId !== ownerId) {
          console.log(`❌ Nickname '${desired}' is taken by another player`);
          return false;
        }
      }
      const playersCol = collection(refs.db, "players");
      const qNick = query(playersCol, where("nicknameLower", "==", desired));
      const snap = await getDocs(qNick);
      if (snap.empty) {
        console.log(`✅ Nickname '${desired}' is available (not found in players collection)`);
        return true;
      }
      for (const d of snap.docs) {
        const data: any = d.data();
        if (data?.ownerId && data.ownerId !== ownerId) {
          console.log(`❌ Nickname '${desired}' is taken by another player in players collection`);
          return false;
        }
      }
      console.log(`✅ Nickname '${desired}' is available (owned by current player or free)`);
      return true;
    } catch (e) {
      console.log("❌ Nickname availability check failed:", e);
      return true;
    }
  }, [ownerId]);

  const updateProfile = useCallback(async (newNickname: string, newAvatarStyle: string): Promise<void> => {
    const cleanNick = newNickname.trim();
    if (!cleanNick) throw new Error("Nickname cannot be empty");

    const refs = getFirebase();
    if (!refs) {
      console.log("❌ Cannot reserve nickname without Firebase. Online connection required.");
      throw new Error("Go online to claim a unique nickname, then try again.");
    }

    const desired = cleanNick.toLowerCase();
    const prev = (nickname ?? '').trim().toLowerCase();


    try {
      const { runTransaction, doc } = await import('firebase/firestore');

      await runTransaction(refs.db, async (tx) => {
        const nameRef = doc(refs.db, 'playerNames', desired);
        const existing = await tx.get(nameRef);
        if (existing.exists()) {
          const data: any = existing.data();
          if (data?.ownerId && data.ownerId !== ownerId) {
            throw new Error('This nickname is already taken. Please choose another.');
          }
        }
        tx.set(nameRef, { ownerId, nickname: cleanNick, updatedAt: serverTimestamp() } as any);

        if (prev && prev !== desired) {
          const prevRef = doc(refs.db, 'playerNames', prev);
          const prevDoc = await tx.get(prevRef);
          if (prevDoc.exists()) {
            const pdata: any = prevDoc.data();
            if (pdata?.ownerId === ownerId) {
              tx.delete(prevRef);
            }
          }
        }

        const playersCol = collection(refs.db, 'players');
        const qMe = query(playersCol, where('ownerId', '==', ownerId));
        const meSnap = await getDocs(qMe);
        const baseData: any = {
          ownerId,
          nickname: cleanNick,
          nicknameLower: desired,
          avatarStyle: newAvatarStyle,
          ownerColor,
          updatedAt: serverTimestamp(),
        };
        if (meSnap.empty) {
          tx.set(doc(playersCol), baseData as any);
        } else {
          tx.update(doc(refs.db, 'players', meSnap.docs[0]!.id), baseData as any);
        }
      });

      setNickname(cleanNick);
      setAvatarStyle(newAvatarStyle);
      setNicknameLocked(true);
      await AsyncStorage.setItem('nickname', cleanNick).catch(() => {});
      await AsyncStorage.setItem('avatarStyle', newAvatarStyle).catch(() => {});
      await AsyncStorage.setItem('nicknameLocked', 'true').catch(() => {});
      console.log('✅ Profile and unique nickname reserved and locked');
    } catch (e: any) {
      console.log('❌ Failed to update profile with unique nickname:', e?.message ?? e);
      if (e && typeof e.message === 'string') throw e;
      throw new Error('Failed to update profile');
    }
  }, [ownerId, ownerColor, nickname]);

  const updateAvatarStyle = useCallback(async (newAvatarStyle: string): Promise<void> => {
    try {
      setAvatarStyle(newAvatarStyle);
      await AsyncStorage.setItem('avatarStyle', newAvatarStyle).catch(() => {});
      setAvatarLocked(true);
      await AsyncStorage.setItem('avatarLocked', 'true').catch(() => {});
      console.log('🖼️ Avatar style set locally and locked:', newAvatarStyle);

      const refs = getFirebase();
      if (!refs) {
        console.log("⚠️ Firebase not available. Will keep avatar locally and sync later.");
        return;
      }

      try {
        const playersCol = collection(refs.db, 'players');
        const qMe = query(playersCol, where('ownerId', '==', ownerId));
        const meSnap = await getDocs(qMe);
        const baseData: any = {
          avatarStyle: newAvatarStyle,
          updatedAt: serverTimestamp(),
        };
        if (meSnap.empty) {
          await addDoc(playersCol, {
            ownerId,
            nickname,
            nicknameLower: (nickname ?? '').trim().toLowerCase(),
            ownerColor,
            avatarStyle: newAvatarStyle,
            updatedAt: serverTimestamp(),
          } as any);
        } else {
          const dref = doc(refs.db, 'players', meSnap.docs[0]!.id);
          await import('firebase/firestore').then(({ updateDoc }) => updateDoc(dref, baseData as any));
        }
        console.log('✅ Avatar style synced to Firestore');
      } catch (remoteErr) {
        console.log('⚠️ Failed to sync avatar to Firestore, keeping local value:', remoteErr);
      }
    } catch (e) {
      console.log('❌ Unexpected error setting avatar:', e);
      throw new Error('Failed to update avatar');
    }
  }, [ownerId, nickname, ownerColor]);

  const start = useCallback(async (m: ActivityMode) => {
    if (state !== "idle") return;
    setMode(m);
    setPath([]);
    setLocationPermissionDenied(false);
    distanceRef.current = 0;
    setDistance(0);
    setStepCount(0);
    setSessionStartSteps(0);
    setLoopCaptured(false);
    setCapturedLoopCount(0);
    setLastCaptured(null);
    setPausedAccumMs(0);
    setPauseStartedAt(null);
    setSessionAchievements([]);
    achievedMilestonesRef.current = new Set();
    const now = Date.now();
    setSessionStartAt(now);
    setElapsedMs(0);
    setState("active");
    await startWatching();
    
    if (m === "walk" || m === "run") {
      await startPedometer();
    }
    
    await startBackgroundLocation();
    resetInactivityTimer();
  }, [state, startWatching, startPedometer, resetInactivityTimer]);

  const pause = useCallback(() => {
    if (state !== "active") return;
    setState("paused");
    setPauseStartedAt(Date.now());
    clearInactivityTimers();
    if (Platform.OS === "web") {
      if (watchSub.current && typeof watchSub.current === "number") {
        navigator.geolocation.clearWatch(watchSub.current);
      }
    } else {
      if (watchSub.current && typeof watchSub.current !== "number") {
        (watchSub.current as Location.LocationSubscription).remove();
      }
    }
    watchSub.current = null;
    stopPedometer();
    stopBackgroundLocation();
  }, [state, stopPedometer, clearInactivityTimers]);

  const enqueuePendingSession = useCallback(async (s: Session, owner: string) => {
    try {
      const raw = await AsyncStorage.getItem(PENDING_SESSION_KEY).catch(() => null);
      let arr: PendingSessionUpload[] = [];
      if (raw && typeof raw === "string" && raw.length > 0) {
        try {
          console.log("📦 Parsing pending sessions:", raw.substring(0, 50) + (raw.length > 50 ? "..." : ""));
          
          if (!raw.startsWith('[') && !raw.startsWith('{')) {
            console.log("❌ Invalid JSON format detected, clearing pending sessions");
            await AsyncStorage.removeItem(PENDING_SESSION_KEY).catch(() => {});
          } else {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              arr = parsed;
            } else {
              console.log("⚠️ Pending sessions not an array, resetting");
              await AsyncStorage.removeItem(PENDING_SESSION_KEY).catch(() => {});
            }
          }
        } catch (parseError) {
          console.log("❌ Failed to parse pending sessions, resetting:", parseError);
          console.log("❌ Raw data:", raw);
          await AsyncStorage.removeItem(PENDING_SESSION_KEY).catch(() => {});
        }
      }
      arr.push({ type: "session", ownerId: owner, payload: s });
      await AsyncStorage.setItem(PENDING_SESSION_KEY, JSON.stringify(arr));
      console.log("📦 Queued session for later upload. Pending sessions:", arr.length);
    } catch (e) {
      console.log("❌ Failed to queue session:", e);
    }
  }, []);

  const enqueuePendingTerritory = useCallback(async (t: Territory) => {
    try {
      const raw = await AsyncStorage.getItem(PENDING_TERRITORY_KEY).catch(() => null);
      let arr: PendingTerritoryUpload[] = [];
      if (raw && typeof raw === "string" && raw.length > 0) {
        try {
          console.log("📦 Parsing pending territories:", raw.substring(0, 50) + (raw.length > 50 ? "..." : ""));
          
          if (!raw.startsWith('[') && !raw.startsWith('{')) {
            console.log("❌ Invalid JSON format detected, clearing pending territories");
            await AsyncStorage.removeItem(PENDING_TERRITORY_KEY).catch(() => {});
          } else {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              arr = parsed;
            } else {
              console.log("⚠️ Pending territories not an array, resetting");
              await AsyncStorage.removeItem(PENDING_TERRITORY_KEY).catch(() => {});
            }
          }
        } catch (parseError) {
          console.log("❌ Failed to parse pending territories, resetting:", parseError);
          console.log("❌ Raw data:", raw);
          await AsyncStorage.removeItem(PENDING_TERRITORY_KEY).catch(() => {});
        }
      }
      arr.push({ type: "territory", payload: t });
      await AsyncStorage.setItem(PENDING_TERRITORY_KEY, JSON.stringify(arr));
      console.log("📦 Queued territory for later upload. Pending territories:", arr.length);
    } catch (e) {
      console.log("❌ Failed to queue territory:", e);
    }
  }, []);

  const trySaveToFirestore = useCallback(async (s: Session, owner: string) => {
    const refs = getFirebase();
    if (!refs) {
      console.log("⚠️ Cannot save session - Firebase not configured");
      return;
    }
    try {
      console.log("📤 Saving session to Firestore...", {
        distance: s.distanceMeters,
        points: s.path.length,
        mode: s.mode,
        owner,
      });
      const docRef = await addDoc(collection(refs.db, "sessions"), {
        mode: s.mode,
        path: s.path,
        distanceMeters: s.distanceMeters,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        ownerId: owner,
        createdAt: serverTimestamp(),
      });
      console.log("✅ Session saved successfully, ID:", docRef.id);
      return true as const;
    } catch (err) {
      console.log("❌ Failed to save session, queueing for retry:", err);
      await enqueuePendingSession(s, owner);
      return false as const;
    }
  }, [enqueuePendingSession]);

  const trySaveTerritory = useCallback(async (t: Territory) => {
    const refs = getFirebase();
    if (!refs) {
      console.log("⚠️ Cannot save territory - Firebase not configured");
      return;
    }
    try {
      console.log("📤 Saving territory to Firestore...", {
        owners: t.owners.length,
        points: t.polygon.length,
        mode: t.mode,
      });
      const docRef = await addDoc(collection(refs.db, "territories"), {
        owners: t.owners,
        mode: t.mode,
        polygon: t.polygon,
        createdAt: serverTimestamp(),
      });
      console.log("✅ Territory saved successfully, ID:", docRef.id);
      return true as const;
    } catch (err) {
      console.log("❌ Failed to save territory, queueing for retry:", err);
      await enqueuePendingTerritory(t);
      return false as const;
    }
  }, [enqueuePendingTerritory]);

  const tryUpdateTerritoryOwners = useCallback(async (territoryId: string, owners: TerritoryOwner[]) => {
    const refs = getFirebase();
    if (!refs) {
      console.log("⚠️ Cannot update territory - Firebase not configured");
      return false as const;
    }
    try {
      const dref = doc(refs.db, 'territories', territoryId);
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(dref, { owners, updatedAt: serverTimestamp() } as any);
      console.log('✅ Updated territory owners in Firestore:', territoryId.slice(0,8));
      return true as const;
    } catch (e) {
      console.log('❌ Failed to update territory owners:', territoryId, e);
      return false as const;
    }
  }, []);

  const resume = useCallback(async () => {
    if (state !== "paused" || !mode) return;
    if (pauseStartedAt) {
      setPausedAccumMs((prev) => prev + (Date.now() - pauseStartedAt));
      setPauseStartedAt(null);
    }
    setState("active");
    await startWatching();
    
    if (mode === "walk" || mode === "run") {
      await startPedometer();
    }
    
    await startBackgroundLocation();
    setAutoPaused(false);
    resetInactivityTimer();
  }, [state, mode, pauseStartedAt, startWatching, startPedometer, resetInactivityTimer]);

  const distanceRef = useRef(0);
  const achievedMilestonesRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (state !== "active" || !mode) return;
    
    const currentMiles = distance / 1609.344;
    let awardList = CycleAwards;
    if (mode === "walk") awardList = WalkingAwards;
    else if (mode === "run") awardList = RunningAwards;
    else if (mode === "cycle") awardList = CycleAwards;
    
    for (const award of awardList) {
      if (currentMiles >= award.miles && !achievedMilestonesRef.current.has(award.miles)) {
        achievedMilestonesRef.current.add(award.miles);
        const newAchievement: AchievementEarned = {
          miles: award.miles,
          imageUrl: award.imageUrl,
          earnedAt: Date.now(),
        };
        setSessionAchievements(prev => [...prev, newAchievement]);
        console.log('🏅 Achievement earned during session:', { mode, miles: award.miles });
      }
    }
  }, [distance, mode, state]);

  useEffect(() => {
    if (path.length < 2 || !mode) {
        return;
    }
    
    const currentPoint = path[path.length - 1]!;
    if (lastKnownPositionRef.current) {
      const distanceMoved = haversine(lastKnownPositionRef.current, currentPoint);
      if (distanceMoved > 5) {
        console.log("👣 Movement detected:", distanceMoved.toFixed(1), "m");
        resetInactivityTimer();
      }
    }
    lastKnownPositionRef.current = currentPoint;
    
    const smoothed = smoothPath(path, 3);
    const last = smoothed[smoothed.length - 1]!;
    const prev = smoothed[smoothed.length - 2]!;
    const dt = Math.max(1, (last.timestamp - prev.timestamp) / 1000);
    const d = haversine(prev, last);
    const speed = d / dt;
    const max = MaxSpeedMps[mode];
    
    console.log('📊 Movement:', {
      mode,
      distance: d.toFixed(2),
      speed: speed.toFixed(2),
      maxAllowed: (max * 1.5).toFixed(2),
      valid: speed <= max * 1.5,
      pathLength: path.length,
      smoothedLength: smoothed.length,
      usingPedometer: mode === "walk" || mode === "run"
    });
    
    if (mode === "walk" || mode === "run") {
      const avgStrideLengthM = mode === "walk" ? 0.762 : 0.914;
      const distanceFromSteps = stepCount * avgStrideLengthM;
      distanceRef.current = distanceFromSteps;
      setDistance(distanceFromSteps);
      console.log('👣 Using pedometer: steps=' + stepCount + ', distance=' + distanceFromSteps.toFixed(2) + 'm');
    } else if (speed <= max * 1.5) {
      distanceRef.current += d;
      setDistance(distanceRef.current);
    } else {
      console.log('⚠️ Speed too high, skipping point');
    }

    if (smoothed.length > 10) {
      let loopDetected = false;
      let loopStartIdx = -1;
      let loopDistance = 0;
      
      for (let i = 0; i < Math.max(0, smoothed.length - 10); i++) {
        const potentialStart = smoothed[i]!;
        const distToPoint = haversine(potentialStart, last);
        
        if (distToPoint < LOOP_CLOSE_THRESHOLD_M) {
          let pathDist = 0;
          for (let j = i; j < smoothed.length - 1; j++) {
            pathDist += haversine(smoothed[j]!, smoothed[j + 1]!);
          }
          
          if (pathDist > MIN_LOOP_DISTANCE_M) {
            loopDetected = true;
            loopStartIdx = i;
            loopDistance = pathDist;
            console.log('🔍 Loop detected at point', i, '/', smoothed.length, 'with distance', pathDist.toFixed(1) + 'm');
            break;
          }
        }
      }
      
      if (loopDetected && loopStartIdx >= 0) {
        const loopPath = smoothed.slice(loopStartIdx);
        const poly = [...loopPath];
        const area = polygonAreaM2(poly);
        console.log('🎯 Potential loop detected!', {
          startIndex: loopStartIdx,
          loopPoints: loopPath.length,
          area: area.toFixed(0) + 'm²',
          distance: loopDistance.toFixed(1) + 'm',
          minRequired: MIN_TERRITORY_AREA_M2 + 'm²',
          meetsThreshold: area >= MIN_TERRITORY_AREA_M2
        });
        
        if (area >= MIN_TERRITORY_AREA_M2) {
          const newTerr: Territory = {
            id: uid(),
            mode: mode,
            polygon: poly,
            createdAt: Date.now(),
            owners: [{ ownerId, strength: 1 }],
          };

          console.log('✅ Loop completed! ID:', newTerr.id, 'Distance:', loopDistance.toFixed(0), 'm, Area:', area.toFixed(0), 'm²');
          
          let shouldAddNewTerritory = true;
          let overlappedExistingTerritories = false;
          
          const changed: { id: string; owners: TerritoryOwner[] }[] = [];
          setTerritories((prev) => {
            let updated = [...prev];
            
            for (let i = 0; i < updated.length; i++) {
              const t = updated[i];
              if (!t || !Array.isArray(t.polygon)) continue;
              if (!t.owners || !Array.isArray(t.owners)) {
                t.owners = [];
              }
              
              if (bboxesOverlap(t.polygon, newTerr.polygon)) {
                overlappedExistingTerritories = true;
                
                const myOwnership = t.owners.find((o) => o?.ownerId === ownerId);
                const otherOwners = t.owners.filter((o) => o?.ownerId !== ownerId);
                
                if (myOwnership && otherOwners.length === 0) {
                  myOwnership.strength = Math.min(2.0, myOwnership.strength + 0.2);
                  console.log('💪 Strengthened your existing territory:', t.id.slice(0, 8), 'new strength:', myOwnership.strength.toFixed(2));
                  changed.push({ id: t.id, owners: [...t.owners] });
                } else if (otherOwners.length > 0 && !myOwnership) {
                  t.owners.push({ ownerId, strength: 0.5 });
                  console.log('⚔️ First overlap - Territory now CONTESTED:', t.id.slice(0, 8), 'owners:', t.owners.map(o => o.ownerId.slice(0, 8)).join(', '));
                  changed.push({ id: t.id, owners: [...t.owners] });
                } else if (myOwnership && otherOwners.length > 0) {
                  myOwnership.strength += 0.5;
                  console.log('💥 Second overlap - Increasing your strength:', t.id.slice(0, 8), 'new strength:', myOwnership.strength.toFixed(2));
                  
                  if (myOwnership.strength >= 1.0) {
                    const totalOthersStrength = otherOwners.reduce((sum, o) => sum + o.strength, 0);
                    if (myOwnership.strength > totalOthersStrength) {
                      t.owners = [{ ownerId, strength: 1.0 }];
                      console.log('🏆 Territory CLAIMED! Removed all other owners from:', t.id.slice(0, 8));
                    }
                  }
                  changed.push({ id: t.id, owners: [...t.owners] });
                }
              }
            }
            
            if (!overlappedExistingTerritories) {
              updated = [newTerr, ...updated];
              console.log('🆕 Added new territory (no overlaps), total territories:', updated.length);
            } else {
              shouldAddNewTerritory = false;
              console.log('📝 Updated overlapping territories instead of creating new one');
            }
            
            saveTerritoriesLocally(updated).catch(() => {});
            setTimeout(() => {
              changed.forEach((c) => tryUpdateTerritoryOwners(c.id, c.owners));
            }, 0);
            return updated;
          });
          
          setCapturedLoopCount((prev) => {
            const newCount = prev + 1;
            console.log('📊 Loop count updated:', newCount);
            return newCount;
          });
          setLoopCaptured(true);
          setLastCaptured(newTerr);
          
          if (shouldAddNewTerritory) {
            console.log('💾 Saving NEW territory to Firestore...');
            trySaveTerritory(newTerr).then((success) => {
              if (success) {
                console.log('✅ Territory saved to Firestore successfully');
              } else {
                console.log('⚠️ Territory queued for later upload');
              }
            });
          } else {
            console.log('ℹ️ Overlap handled and persisted where applicable');
          }
          
          console.log('🔄 Keeping remaining path after loop...');
          const remainingPath = smoothed.slice(0, loopStartIdx + 1);
          setPath(remainingPath);
          
          setTimeout(() => {
            console.log('⏱️ Hiding loop captured badge');
            setLoopCaptured(false);
          }, 3000);
        } else {
          console.log('❌ Loop area too small, not capturing. Area:', area.toFixed(0), 'm² < min:', MIN_TERRITORY_AREA_M2, 'm²');
        }
      }
    }
  }, [path, mode, ownerId, trySaveTerritory, resetInactivityTimer, tryUpdateTerritoryOwners]);

  useEffect(() => {
    let timer: number | null = null;
    if (state === "active" && sessionStartAt) {
      const tick = () => {
        const now = Date.now();
        const base = now - sessionStartAt - pausedAccumMs;
        setElapsedMs(base > 0 ? base : 0);
      };
      tick();
      timer = setInterval(tick, 1000) as unknown as number;
    }
    return () => {
      if (timer) clearInterval(timer as unknown as number);
    };
  }, [state, sessionStartAt, pausedAccumMs]);

  const stop = useCallback(async () => {
    if (state === "idle") return;
    if (Platform.OS === "web") {
      if (watchSub.current && typeof watchSub.current === "number") {
        navigator.geolocation.clearWatch(watchSub.current);
      }
    } else {
      if (watchSub.current && typeof watchSub.current !== "number") {
        (watchSub.current as Location.LocationSubscription).remove();
      }
    }
    watchSub.current = null;
    stopPedometer();
    stopBackgroundLocation();
    clearInactivityTimers();

    const endedAt = Date.now();
    const startedAt = sessionStartAt ?? path[0]?.timestamp ?? endedAt;
    const m = mode ?? "walk";
    console.log('📊 Session complete. Achievements earned:', sessionAchievements.length, sessionAchievements);
    
    const session: Session = {
      id: `${endedAt}`,
      mode: m,
      path,
      distanceMeters: Math.round(distance),
      startedAt,
      endedAt,
      achievements: sessionAchievements.length > 0 ? sessionAchievements : undefined,
    };

    const updated = [session, ...sessions];
    setSessions(updated);
    setMode(null);
    setState("idle");
    setPath([]);
    setDistance(0);
    setStepCount(0);
    setSessionStartSteps(0);
    setSessionStartAt(null);
    setPausedAccumMs(0);
    setPauseStartedAt(null);
    setElapsedMs(0);
    setSessionAchievements([]);
    achievedMilestonesRef.current = new Set();
    await saveSessionsLocally(updated);
    await trySaveToFirestore(session, ownerId);
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
  }, [state, mode, path, distance, sessions, sessionStartAt, queryClient, trySaveToFirestore, ownerId, stopPedometer, clearInactivityTimers]);

  const deleteSession = useCallback(async (sessionId: string) => {
    const session = sessions?.find((s) => s?.id === sessionId);
    const updated = sessions?.filter((s) => s?.id !== sessionId) ?? [];
    setSessions(updated);
    await saveSessionsLocally(updated);
    
    if (session) {
      const updatedTerritories = territories?.filter((t) => {
        return !(t?.createdAt >= session.startedAt && t?.createdAt <= session.endedAt && Array.isArray(t?.owners) && t.owners.some(o => o?.ownerId === ownerId));
      }) ?? [];
      setTerritories(updatedTerritories);
      await saveTerritoriesLocally(updatedTerritories);
      
      const refs = getFirebase();
      if (refs) {
        try {
          const { getDocs, collection, deleteDoc, doc } = await import('firebase/firestore');
          const snap = await getDocs(collection(refs.db, 'territories'));
          let deleted = 0;
          for (const d of snap.docs) {
            const data: any = d.data();
            const createdAt: number = typeof data?.createdAt?.toMillis === 'function' ? data.createdAt.toMillis() : (typeof data?.createdAt === 'number' ? data.createdAt : 0);
            const owners: any[] = Array.isArray(data?.owners) ? data.owners : [];
            const mine = owners.some((o) => typeof o?.ownerId === 'string' && o.ownerId === ownerId);
            if (mine && createdAt >= session.startedAt && createdAt <= session.endedAt) {
              await deleteDoc(doc(refs.db, 'territories', d.id));
              console.log('🗑️ Deleted territory from Firestore:', d.id);
              deleted++;
            }
          }
          console.log(`✅ Deleted ${deleted} territories for this session window`);
        } catch (err) {
          console.log('❌ Failed to delete territories from Firestore:', err);
        }
      }
    }
    
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
  }, [sessions, territories, ownerId, queryClient]);

  const clearAllTerritories = useCallback(async () => {
    console.log('🗑️ Clearing all territories...');
    console.log('📊 Current territories count:', territories.length);
    console.log('🎮 Your player ID:', ownerId);
    
    const refs = getFirebase();
    if (refs) {
      try {
        const { getDocs, collection, deleteDoc, doc } = await import('firebase/firestore');
        const snap = await getDocs(collection(refs.db, 'territories'));
        let successCount = 0;
        let failCount = 0;
        for (const d of snap.docs) {
          const data: any = d.data();
          const owners: any[] = Array.isArray(data?.owners) ? data.owners : [];
          const mine = owners.some((o) => typeof o?.ownerId === 'string' && o.ownerId === ownerId);
          if (mine) {
            try {
              await deleteDoc(doc(refs.db, 'territories', d.id));
              console.log('✅ Deleted territory from Firestore:', d.id);
              successCount++;
            } catch (err) {
              console.log('❌ Failed to delete territory:', d.id, err);
              failCount++;
            }
          }
        }
        console.log(`📊 Deletion summary: ${successCount} deleted, ${failCount} failed`);
        const remainingTerritories = territories?.filter(t => t && !(Array.isArray(t?.owners) && t.owners.some(o => o?.ownerId === ownerId))) ?? [];
        setTerritories(remainingTerritories);
        await saveTerritoriesLocally(remainingTerritories);
        console.log('✅ Local state updated, remaining territories:', remainingTerritories.length);
      } catch (err) {
        console.log('❌ Failed to clear territories:', err);
      }
    } else {
      console.log('⚠️ Firebase not configured, clearing locally only');
      const remainingTerritories = territories.filter(t => !(Array.isArray(t.owners) && t.owners.some(o => o.ownerId === ownerId)));
      setTerritories(remainingTerritories);
      await saveTerritoriesLocally(remainingTerritories);
      console.log('✅ Territories cleared locally');
    }
  }, [territories, ownerId]);

  const clearAllData = useCallback(async () => {
    try {
      console.log("🧹 Clearing all local and remote data for previous sessions...");
      try { await stop(); } catch {}

      // Optimistically clear local UI state first so the user immediately sees zero
      setSessions([]);
      await AsyncStorage.setItem("sessions", JSON.stringify([]));
      await AsyncStorage.removeItem("bg_points").catch(() => {});
      setLastCaptured(null);
      setLoopCaptured(false);
      setDistance(0);
      setPath([]);
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      console.log("✅ Local sessions cleared, proceeding to territories and remote cleanup...");

      await clearAllTerritories();

      const refs = getFirebase();
      if (refs) {
        try {
          console.log("🗑️ Deleting your sessions from Firestore...");
          const q = query(collection(refs.db, "sessions"), where("ownerId", "==", ownerId));
          const snap = await getDocs(q);
          let remoteDeleted = 0;
          for (const d of snap.docs) {
            await deleteDoc(doc(refs.db, "sessions", d.id));
            remoteDeleted++;
          }
          console.log(`✅ Deleted ${remoteDeleted} remote sessions`);
        } catch (err) {
          console.log("❌ Failed to delete remote sessions", err);
        }
        try {
          console.log("🗑️ Deleting your player records from Firestore...");
          const pq = query(collection(refs.db, 'players'), where('ownerId', '==', ownerId));
          const psnap = await getDocs(pq);
          let pDeleted = 0;
          for (const d of psnap.docs) {
            await deleteDoc(doc(refs.db, 'players', d.id));
            pDeleted++;
          }
          console.log(`✅ Deleted ${pDeleted} player records`);
        } catch (err) {
          console.log('❌ Failed to delete player records', err);
        }
      } else {
        console.log("⚠️ Firebase not configured, skipping remote session delete");
      }

      console.log("✅ All data cleared");
    } catch (e) {
      console.log("❌ Failed to clear all data", e);
      throw e;
    }
  }, [stop, clearAllTerritories, queryClient, ownerId]);

  const canSelectMode = state === "idle";

  const decayedTerritories = useMemo(() => {
    const now = Date.now();
    if (!territories || !Array.isArray(territories)) return [];
    return territories
      .filter((t): t is Territory => !!t && Array.isArray(t.polygon) && Array.isArray(t.owners))
      .map((t) => {
        const days = (now - t.createdAt) / (1000 * 60 * 60 * 24);
        const decay = Math.pow(1 - DAILY_DECAY_RATE, Math.max(0, days));
        const owners = (t.owners ?? []).map((o) => ({ ...o, strength: o.strength * decay }));
        return { ...t, owners } as Territory;
      });
  }, [territories]);

  useEffect(() => {
    let interval: number | null = null;
    let appSub: any = null;

    const drain = async () => {
      if (state !== "active") return;
      const pts = await drainBackgroundPoints();
      if (pts.length > 0) {
        setPath((prev) => [...prev, ...pts]);
      }
    };

    if (state === "active") {
      interval = setInterval(drain, 3000) as unknown as number;
      drain();
    }

    appSub = AppState.addEventListener("change", (s) => {
      if (s === "active") drain();
    });

    return () => {
      if (interval) clearInterval(interval as unknown as number);
      if (appSub && typeof appSub.remove === "function") appSub.remove();
    };
  }, [state]);

  const flushPendingUploads = useCallback(async () => {
    try {
      const refs = getFirebase();
      if (!refs) return;

      const rawS = await AsyncStorage.getItem(PENDING_SESSION_KEY).catch(() => null);
      const rawT = await AsyncStorage.getItem(PENDING_TERRITORY_KEY).catch(() => null);
      let sessionsQ: PendingSessionUpload[] = [];
      let terrsQ: PendingTerritoryUpload[] = [];
      
      if (rawS && typeof rawS === "string" && rawS.length > 0) {
        try {
          console.log("📦 Parsing pending sessions for flush:", rawS.substring(0, 50) + (rawS.length > 50 ? "..." : ""));
          
          if (!rawS.startsWith('[') && !rawS.startsWith('{')) {
            console.log("❌ Invalid JSON format detected in pending sessions, clearing");
            await AsyncStorage.removeItem(PENDING_SESSION_KEY).catch(() => {});
          } else {
            const parsed = JSON.parse(rawS);
            if (Array.isArray(parsed)) {
              sessionsQ = parsed;
            } else {
              console.log("⚠️ Pending sessions not an array during flush");
              await AsyncStorage.removeItem(PENDING_SESSION_KEY).catch(() => {});
            }
          }
        } catch (parseError) {
          console.log("❌ Failed to parse pending sessions during flush, clearing:", parseError);
          console.log("❌ Raw data:", rawS);
          await AsyncStorage.removeItem(PENDING_SESSION_KEY).catch(() => {});
        }
      }
      
      if (rawT && typeof rawT === "string" && rawT.length > 0) {
        try {
          console.log("📦 Parsing pending territories for flush:", rawT.substring(0, 50) + (rawT.length > 50 ? "..." : ""));
          
          if (!rawT.startsWith('[') && !rawT.startsWith('{')) {
            console.log("❌ Invalid JSON format detected in pending territories, clearing");
            await AsyncStorage.removeItem(PENDING_TERRITORY_KEY).catch(() => {});
          } else {
            const parsed = JSON.parse(rawT);
            if (Array.isArray(parsed)) {
              terrsQ = parsed;
            } else {
              console.log("⚠️ Pending territories not an array during flush");
              await AsyncStorage.removeItem(PENDING_TERRITORY_KEY).catch(() => {});
            }
          }
        } catch (parseError) {
          console.log("❌ Failed to parse pending territories during flush, clearing:", parseError);
          console.log("❌ Raw data:", rawT);
          await AsyncStorage.removeItem(PENDING_TERRITORY_KEY).catch(() => {});
        }
      }

      if (sessionsQ.length === 0 && terrsQ.length === 0) return;
      console.log(`🔄 Flushing pending uploads: ${sessionsQ.length} sessions, ${terrsQ.length} territories`);

      const keptSessions: PendingSessionUpload[] = [];
      for (const item of sessionsQ) {
        try {
          await addDoc(collection(refs.db, "sessions"), {
            mode: item.payload.mode,
            path: item.payload.path,
            distanceMeters: item.payload.distanceMeters,
            startedAt: item.payload.startedAt,
            endedAt: item.payload.endedAt,
            ownerId: item.ownerId,
            createdAt: serverTimestamp(),
          });
        } catch (e) {
          keptSessions.push(item);
        }
      }

      const keptTerrs: PendingTerritoryUpload[] = [];
      for (const item of terrsQ) {
        try {
          await addDoc(collection(refs.db, "territories"), {
            owners: item.payload.owners,
            mode: item.payload.mode,
            polygon: item.payload.polygon,
            createdAt: serverTimestamp(),
          });
        } catch (e) {
          keptTerrs.push(item);
        }
      }

      await AsyncStorage.setItem(PENDING_SESSION_KEY, JSON.stringify(keptSessions));
      await AsyncStorage.setItem(PENDING_TERRITORY_KEY, JSON.stringify(keptTerrs));
      if (keptSessions.length === 0 && keptTerrs.length === 0) {
        console.log("✅ All pending uploads flushed");
      } else {
        console.log(`⚠️ Remaining pending uploads: ${keptSessions.length} sessions, ${keptTerrs.length} territories`);
      }
    } catch (e) {
      console.log("❌ Flush pending uploads failed:", e);
    }
  }, []);

  useEffect(() => {
    let flushTimer: number | null = null;
    const onApp = AppState.addEventListener("change", (s) => {
      if (s === "active") flushPendingUploads();
    });
    flushPendingUploads();
    flushTimer = setInterval(() => {
      flushPendingUploads();
    }, 15000) as unknown as number;
    return () => {
      if (flushTimer) clearInterval(flushTimer as unknown as number);
      if (onApp && typeof onApp.remove === "function") onApp.remove();
    };
  }, [flushPendingUploads]);

  useEffect(() => {
    const refs = getFirebase();
    if (!refs) return;
    
    console.log("👥 Setting up real-time player listener...");
    
    try {
      const playersCol = collection(refs.db, "players");
      const q = query(playersCol, orderBy("updatedAt", "desc"));
      
      const unsub = onSnapshot(
        q,
        (snap) => {
          const activePlayers: Player[] = [];
          
          snap.docs.forEach((doc) => {
            const data: any = doc.data();
            if (data.ownerId === ownerId) return;
            
            const updatedAt = typeof data?.updatedAt?.toMillis === "function" 
              ? data.updatedAt.toMillis() 
              : Date.now();
            
            if (Date.now() - updatedAt > 5 * 60 * 1000) return;
            
            if (!data.isActive) return;
            
            activePlayers.push({
              id: data.ownerId,
              nickname: data.nickname || "Player",
              avatarUrl: `https://api.dicebear.com/8.x/${data.avatarStyle || "shapes"}/svg?seed=${encodeURIComponent(data.nickname || "Player")}`,
              color: data.ownerColor || DefaultOwnerColors[0]!,
              approxLocation: data.location ? {
                latitude: data.location.latitude,
                longitude: data.location.longitude,
              } : null,
            });
          });
          
          console.log(`👥 Updated active players: ${activePlayers.length}`);
          setPlayers(activePlayers);
        },
        (err) => {
          console.log("❌ Players listener error:", err?.message ?? String(err));
        }
      );
      
      return () => {
        console.log("👥 Cleaning up players listener");
        unsub();
      };
    } catch (e) {
      console.log("❌ Failed to setup players listener:", e);
    }
  }, [ownerId]);

  useEffect(() => {
    let interval: number | null = null;
    
    if (state === "active" && path.length > 0) {
      updatePlayerLocation();
      interval = setInterval(() => {
        updatePlayerLocation();
      }, PLAYER_UPDATE_INTERVAL) as unknown as number;
    }
    
    return () => {
      if (interval) clearInterval(interval as unknown as number);
    };
  }, [state, path.length, updatePlayerLocation]);

  const beginNicknameChange = useCallback(async () => {
    try {
      setNicknameLocked(false);
      await AsyncStorage.setItem('nicknameLocked', 'false').catch(() => {});
      console.log('✏️ Nickname editing enabled by user');
    } catch {}
  }, []);

  const cancelNicknameChange = useCallback(async () => {
    try {
      setNicknameLocked(true);
      await AsyncStorage.setItem('nicknameLocked', 'true').catch(() => {});
      console.log('🔒 Nickname editing cancelled and re-locked');
    } catch {}
  }, []);

  const beginAvatarChange = useCallback(async () => {
    try {
      setAvatarLocked(false);
      await AsyncStorage.setItem('avatarLocked', 'false').catch(() => {});
      console.log('✏️ Avatar editing enabled by user');
    } catch {}
  }, []);

  const cancelAvatarChange = useCallback(async () => {
    try {
      setAvatarLocked(true);
      await AsyncStorage.setItem('avatarLocked', 'true').catch(() => {});
      console.log('🔒 Avatar editing cancelled and re-locked');
    } catch {}
  }, []);

  const handleInactivityResponse = useCallback(async (stillActive: boolean) => {
    console.log("👤 User responded to inactivity prompt:", stillActive);
    setShowInactivityPrompt(false);
    clearInactivityTimers();
    setInactivityPauseCountdown(0);
    
    if (stillActive) {
      resetInactivityTimer();
    } else {
      setAutoPaused(true);
      pause();
      
      setInactivityPauseCountdown(0);
      pauseCountdownTimerRef.current = setInterval(async () => {
        setInactivityPauseCountdown(prev => {
          if (prev >= 180) {
            console.log("⏰ Auto-pause 3 minute timeout - stopping session");
            clearInactivityTimers();
            stop().catch(() => {});
            return 0;
          }
          return prev + 1;
        });
      }, 1000) as unknown as number;
    }
  }, [pause, stop, resetInactivityTimer, clearInactivityTimers]);

  const cancelAutoPause = useCallback(() => {
    console.log("✋ User cancelled auto-pause");
    setAutoPaused(false);
    setInactivityPauseCountdown(0);
    clearInactivityTimers();
    resume();
  }, [resume, clearInactivityTimers]);

  const resetProfileAndClaimNickname = useCallback(async (newNickname: string, newAvatarStyle: string): Promise<void> => {
    const cleanNick = newNickname.trim();
    if (!cleanNick) throw new Error('Nickname cannot be empty');
    const refs = getFirebase();
    if (!refs) throw new Error('Go online to change nickname');
    const desired = cleanNick.toLowerCase();
    const oldOwnerId = ownerId;
    const prevLower = (nickname ?? '').trim().toLowerCase();
    try {
      const { runTransaction, doc } = await import('firebase/firestore');
      const canUse = await isNicknameAvailable(cleanNick);
      if (!canUse && desired !== prevLower) {
        throw new Error('This nickname is already taken.');
      }
      await clearAllData();
      const newId = uid();
      setOwnerId(newId);
      await AsyncStorage.setItem('ownerId', newId).catch(() => {});
      await runTransaction(refs.db, async (tx) => {
        const nameRef = doc(refs.db, 'playerNames', desired);
        tx.set(nameRef, { ownerId: newId, nickname: cleanNick, updatedAt: serverTimestamp() } as any);
        if (prevLower && prevLower !== desired) {
          const prevRef = doc(refs.db, 'playerNames', prevLower);
          const prevDoc = await tx.get(prevRef);
          if (prevDoc.exists()) {
            const pdata: any = prevDoc.data();
            if (pdata?.ownerId === oldOwnerId) {
              tx.delete(prevRef);
            }
          }
        }
        const playersCol = collection(refs.db, 'players');
        tx.set(doc(playersCol), {
          ownerId: newId,
          nickname: cleanNick,
          nicknameLower: desired,
          avatarStyle: newAvatarStyle,
          ownerColor,
          updatedAt: serverTimestamp(),
        } as any);
      });
      setNickname(cleanNick);
      setAvatarStyle(newAvatarStyle);
      setNicknameLocked(true);
      await AsyncStorage.setItem('nickname', cleanNick).catch(() => {});
      await AsyncStorage.setItem('avatarStyle', newAvatarStyle).catch(() => {});
      await AsyncStorage.setItem('nicknameLocked', 'true').catch(() => {});
      setAvatarLocked(true);
      await AsyncStorage.setItem('avatarLocked', 'true').catch(() => {});
      console.log('✅ Profile reset and nickname changed/locked');
    } catch (e) {
      console.log('❌ Failed to reset profile and change nickname:', e);
      throw e;
    }
  }, [ownerId, nickname, ownerColor, clearAllData, isNicknameAvailable]);

  const value = useMemo(
    () => ({
      isInitialized,
      mode,
      state,
      path: path ?? [],
      distance: distance ?? 0,
      sessions: sessions ?? [],
      territories: decayedTerritories ?? [],
      loopCaptured,
      capturedLoopCount,
      lastCaptured,
      canSelectMode,
      start,
      pause,
      resume,
      stop,
      deleteSession,
      clearAllTerritories,
      clearAllData,
      elapsedMs,
      ownerId,
      ownerColor,
      nickname,
      avatarStyle,
      stepCount,
      updateProfile,
      updateAvatarStyle,
      resetProfileAndClaimNickname,
      isNicknameAvailable,
      players: players ?? [],
      nicknameLocked,
      beginNicknameChange,
      cancelNicknameChange,
      avatarLocked,
      beginAvatarChange,
      cancelAvatarChange,
      showInactivityPrompt,
      inactivityPauseCountdown,
      autoPaused,
      handleInactivityResponse,
      cancelAutoPause,
      locationPermissionDenied,
      setLocationPermissionDenied,
    }),
    [isInitialized, mode, state, path, distance, sessions, decayedTerritories, loopCaptured, capturedLoopCount, lastCaptured, canSelectMode, start, pause, resume, stop, deleteSession, clearAllTerritories, clearAllData, elapsedMs, ownerId, ownerColor, nickname, avatarStyle, stepCount, updateProfile, updateAvatarStyle, resetProfileAndClaimNickname, isNicknameAvailable, players, nicknameLocked, beginNicknameChange, cancelNicknameChange, avatarLocked, beginAvatarChange, cancelAvatarChange, showInactivityPrompt, inactivityPauseCountdown, autoPaused, handleInactivityResponse, cancelAutoPause, locationPermissionDenied]
  );

  return value;
});

export type UseSession = ReturnType<typeof useSession>;
