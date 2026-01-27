import { Platform } from "react-native";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type LatLng = { latitude: number; longitude: number; timestamp: number };

export const BG_TASK_NAME = "bg-location-tracking" as const;
const BG_POINTS_KEY = "bg_points" as const;

let TaskManager: any = null;
if (Platform.OS !== "web") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  TaskManager = require("expo-task-manager");
}

if (TaskManager && typeof TaskManager.defineTask === "function") {
  TaskManager.defineTask(BG_TASK_NAME, async ({ data, error }: any) => {
    try {
      if (error) {
        console.log("BG task error", error.message ?? String(error));
        return;
      }
      const payload = data as { locations?: Location.LocationObject[] } | undefined;
      const locs = payload?.locations ?? [];
      if (!Array.isArray(locs) || locs.length === 0) return;

      const mapped: LatLng[] = locs
        .filter((l) => {
          if (!l || !l.coords) return false;
          if (l.coords.accuracy && l.coords.accuracy > 50) {
            console.log("🎯 BG: Filtered inaccurate point, accuracy:", l.coords.accuracy.toFixed(1), "m");
            return false;
          }
          return true;
        })
        .map((l) => ({
          latitude: l.coords.latitude,
          longitude: l.coords.longitude,
          timestamp: (l as any).timestamp ?? Date.now(),
        }));

      const prevStr = await AsyncStorage.getItem(BG_POINTS_KEY).catch(() => null);
      let prev: LatLng[] = [];
      if (prevStr && typeof prevStr === "string" && prevStr.length > 0) {
        try {
          console.log("📍 BG: Parsing previous points:", prevStr.substring(0, 50) + (prevStr.length > 50 ? "..." : ""));
          const parsed = JSON.parse(prevStr);
          if (Array.isArray(parsed)) {
            prev = parsed;
          } else {
            console.log("⚠️ BG: Previous points not an array, resetting");
            await AsyncStorage.removeItem(BG_POINTS_KEY).catch(() => {});
          }
        } catch (e) {
          console.log("❌ BG task parse error, resetting:", e);
          console.log("❌ BG: Raw data:", prevStr);
          await AsyncStorage.removeItem(BG_POINTS_KEY).catch(() => {});
          prev = [];
        }
      }
      
      const filtered: LatLng[] = [];
      for (const pt of mapped) {
        if (prev.length === 0) {
          filtered.push(pt);
          continue;
        }
        const lastPrev = prev[prev.length - 1];
        if (!lastPrev) {
          filtered.push(pt);
          continue;
        }
        const R = 6371000;
        const toRad = (x: number) => (x * Math.PI) / 180;
        const dLat = toRad(pt.latitude - lastPrev.latitude);
        const dLon = toRad(pt.longitude - lastPrev.longitude);
        const lat1 = toRad(lastPrev.latitude);
        const lat2 = toRad(pt.latitude);
        const sinDLat = Math.sin(dLat / 2);
        const sinDLon = Math.sin(dLon / 2);
        const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
        const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
        const dist = R * c;
        
        if (dist > 100) {
          console.log("🎯 BG: Filtered GPS jump:", dist.toFixed(1), "m from last point");
          continue;
        }
        filtered.push(pt);
      }
      
      const merged = [...prev, ...filtered];
      await AsyncStorage.setItem(BG_POINTS_KEY, JSON.stringify(merged));
    } catch (e) {
      console.log("BG task store error", e);
    }
  });
}

export async function startBackgroundLocation(): Promise<void> {
  if (Platform.OS === "web") return;
  const hasStarted = await Location.hasStartedLocationUpdatesAsync(BG_TASK_NAME);
  if (hasStarted) return;

  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== "granted") return;
  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  if (bg !== "granted") return;

  await Location.startLocationUpdatesAsync(BG_TASK_NAME, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 3000,
    distanceInterval: 5,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    activityType: Location.ActivityType.Fitness,
    deferredUpdatesInterval: 3000,
    deferredUpdatesDistance: 5,
    foregroundService: {
      notificationTitle: "Tracking session",
      notificationBody: "Your activity is being recorded",
      notificationColor: "#2563eb",
      killServiceOnDestroy: false,
    },
  });
}

export async function stopBackgroundLocation(): Promise<void> {
  if (Platform.OS === "web") return;
  const hasStarted = await Location.hasStartedLocationUpdatesAsync(BG_TASK_NAME);
  if (hasStarted) {
    await Location.stopLocationUpdatesAsync(BG_TASK_NAME);
  }
}

export async function drainBackgroundPoints(): Promise<LatLng[]> {
  try {
    const str = await AsyncStorage.getItem(BG_POINTS_KEY).catch(() => null);
    if (!str || typeof str !== "string" || str.length === 0) return [];
    await AsyncStorage.removeItem(BG_POINTS_KEY);
    let pts: LatLng[] = [];
    try {
      console.log("📍 Draining background points:", str.substring(0, 50) + (str.length > 50 ? "..." : ""));
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        pts = parsed;
      } else {
        console.log("⚠️ Background points not an array");
        return [];
      }
    } catch (parseError) {
      console.log("❌ Failed to parse background points, clearing corrupted data:", parseError);
      console.log("❌ Raw data:", str);
      return [];
    }
    const filtered = pts.filter(
      (p): p is LatLng =>
        !!p && typeof p.latitude === "number" && typeof p.longitude === "number" && typeof p.timestamp === "number"
    );
    console.log("✅ Drained", filtered.length, "valid background points");
    return filtered;
  } catch (e) {
    console.log("❌ Error draining background points:", e);
    return [];
  }
}
