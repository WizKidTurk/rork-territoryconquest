export type ActivityMode = "walk" | "run" | "cycle";

export const ModeColors: Record<ActivityMode, string> = {
  walk: "#3B82F6",
  run: "#F59E0B",
  cycle: "#8B5CF6",
};

export const ModeLabels: Record<ActivityMode, string> = {
  walk: "Walk",
  run: "Run",
  cycle: "Cycle",
};

export const MaxSpeedMps: Record<ActivityMode, number> = {
  walk: 3,
  run: 7,
  cycle: 15,
};

export const LOOP_CLOSE_THRESHOLD_M = 50;
export const MIN_LOOP_DISTANCE_M = 20;
export const MIN_TERRITORY_AREA_M2 = 30;
export const DAILY_DECAY_RATE = 0.02;

export type Player = {
  id: string;
  nickname: string;
  avatarUrl?: string;
  color: string;
  approxLocation?: { latitude: number; longitude: number } | null;
};

export type TerritoryOwner = {
  ownerId: string;
  strength: number;
};

export type TerritoryStatus = "yours" | "others" | "contested";

export const DefaultOwnerColors: string[] = ["#22C55E", "#EF4444", "#06B6D4", "#EAB308", "#F472B6", "#10B981"];