import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  Platform,
} from "react-native";
import { useSession } from "@/providers/SessionProvider";
import { User, Trophy, Target, Activity, Trash2, Lock, Edit3, XCircle } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ConnectionStatus from "@/components/ConnectionStatus";

const AVATAR_STYLES = [
  "shapes",
  "bottts",
  "avataaars",
  "fun-emoji",
  "thumbs",
  "lorelei",
  "notionists",
  "personas",
];

export default function ProfileScreen() {
  const {
    nickname,
    avatarStyle,
    ownerColor,
    updateProfile,
    updateAvatarStyle,
    isNicknameAvailable,
    sessions,
    territories,
    ownerId,
    clearAllTerritories,
    clearAllData,
    nicknameLocked,
    beginNicknameChange,
    cancelNicknameChange,
    avatarLocked,
    beginAvatarChange,
    cancelAvatarChange,
  } = useSession();

  const [localNickname, setLocalNickname] = useState<string>(nickname);
  const [selectedAvatar, setSelectedAvatar] = useState<string>(avatarStyle);
  const [checking, setChecking] = useState<boolean>(false);
  const [available, setAvailable] = useState<boolean>(true);

  useEffect(() => {
    setLocalNickname(nickname);
  }, [nickname]);

  useEffect(() => {
    setSelectedAvatar(avatarStyle);
  }, [avatarStyle]);

  useEffect(() => {
    let cancelled = false;
    const name = (localNickname ?? '').trim();
    if (nicknameLocked) {
      setAvailable(true);
      setChecking(false);
      return;
    }
    if (!name || name.toLowerCase() === (nickname ?? '').trim().toLowerCase()) {
      setAvailable(true);
      setChecking(false);
      return;
    }
    setChecking(true);
    const run = async () => {
      try {
        const ok = await isNicknameAvailable(name);
        if (!cancelled) setAvailable(ok);
      } catch {
        if (!cancelled) setAvailable(true);
      } finally {
        if (!cancelled) setChecking(false);
      }
    };
    const t = setTimeout(run, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
      setChecking(false);
    };
  }, [localNickname, isNicknameAvailable, nickname, nicknameLocked]);

  const handleSave = async () => {
    const nick = localNickname.trim();
    if (!nick) {
      Alert.alert("Error", "Please enter a nickname");
      return;
    }
    if (!available) {
      Alert.alert("Nickname Unavailable", "This nickname is already taken. Please choose another.");
      return;
    }
    if (nicknameLocked) {
      Alert.alert("Locked", "Tap 'Change nickname' first to enable editing.");
      return;
    }
    try {
      await updateProfile(nick, selectedAvatar);
      setChecking(false);
      setAvailable(true);
      await cancelNicknameChange();
      Alert.alert("Success", "Profile updated!");
    } catch (e: any) {
      const msg = (e && typeof e.message === "string") ? e.message : "Failed to update profile";
      Alert.alert("Nickname Unavailable", msg);
    }
  };

  const handleClearAllTerritories = () => {
    Alert.alert(
      "Clear All Territories",
      `Are you sure you want to delete all ${myTerritories.length} of your territories? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete All",
          style: "destructive",
          onPress: async () => {
            await clearAllTerritories();
            Alert.alert("Success", "All territories cleared!");
          },
        },
      ]
    );
  };

  const handleClearAllData = () => {
    const totalMine = myTerritories.length;
    const totalSessions = sessions.length;
    Alert.alert(
      "Reset All Data",
      `This will delete ${totalSessions} sessions locally and ${totalMine} of your territories locally and on Firebase. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Everything",
          style: "destructive",
          onPress: async () => {
            await clearAllData();
            Alert.alert("Done", "All your sessions and territories have been cleared.");
          },
        },
      ]
    );
  };

  const myTerritories = territories.filter((t) =>
    t.owners.some((o) => o.ownerId === ownerId)
  );
  const totalDistance = sessions.reduce(
    (sum, s) => sum + (s.distanceMeters || 0),
    0
  );

  const getAvatarUrl = (style: string) => {
    const seed = encodeURIComponent(localNickname || "Player");
    const ext = Platform.OS === 'web' ? 'svg' : 'png';
    return `https://api.dicebear.com/8.x/${style}/${ext}?seed=${seed}&size=128`;
  };

  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 },
      ]}
    >
      <ConnectionStatus />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your Avatar</Text>
        <View style={styles.currentAvatar}>
          <Image
            source={{ uri: getAvatarUrl(selectedAvatar) }}
            style={styles.avatarLarge}
          />
          <View
            style={[styles.colorIndicator, { backgroundColor: ownerColor }]}
          />
          {avatarLocked && (
            <TouchableOpacity
              testID="edit-avatar"
              onPress={() => { setSelectedAvatar(avatarStyle); beginAvatarChange(); }}
              style={styles.avatarEditBtn}
              accessibilityLabel="Edit avatar"
            >
              <Edit3 size={16} color="#111827" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {!avatarLocked && (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Choose Avatar Style</Text>
        <View style={styles.avatarGrid}>
          {AVATAR_STYLES.map((style) => (
            <TouchableOpacity
              key={style}
              style={[
                styles.avatarOption,
                selectedAvatar === style && styles.avatarSelected,
              ]}
              onPress={() => setSelectedAvatar(style)}
            >
              <Image
                source={{ uri: getAvatarUrl(style) }}
                style={styles.avatarSmall}
              />
              <Text
                style={[
                  styles.avatarLabel,
                  selectedAvatar === style && styles.avatarLabelSelected,
                ]}
              >
                {style}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {selectedAvatar !== avatarStyle && (
          <TouchableOpacity
            testID="save-avatar"
            style={styles.saveAvatarButton}
            onPress={async () => {
              try {
                await updateAvatarStyle(selectedAvatar);
                await cancelAvatarChange();
                Alert.alert("Saved", "Avatar updated");
              } catch (e: any) {
                const msg = (e && typeof e.message === 'string') ? e.message : 'Failed to save avatar';
                Alert.alert('Error', msg);
              }
            }}
          >
            <Text style={styles.saveAvatarText}>Save Avatar</Text>
          </TouchableOpacity>
        )}
      </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Nickname</Text>
        {nicknameLocked ? (
          <View style={styles.lockRow}>
            <View style={[styles.inputContainer, { flex: 1, opacity: 0.9 }]}>
              <Lock size={18} color="#6B7280" />
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.input, { paddingVertical: 2 }]}>
                {nickname}
              </Text>
              <Text style={{ color: '#16A34A', fontSize: 12, fontWeight: '700' as const }}>Locked</Text>
            </View>
            <TouchableOpacity
              testID="begin-nickname-change"
              onPress={beginNicknameChange}
              style={styles.iconBtn}
              accessibilityLabel="Edit nickname"
            >
              <Edit3 size={18} color="#111827" />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.inputContainer}>
              <User size={20} color="#6B7280" />
              <TextInput
                style={styles.input}
                value={localNickname}
                onChangeText={setLocalNickname}
                placeholder="Enter your nickname"
                maxLength={20}
                placeholderTextColor="#999"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={{ color: available ? '#16A34A' : '#DC2626', fontSize: 12, fontWeight: '700' as const }}>{checking ? 'Checking…' : (available ? 'Available' : 'Already taken')}</Text>
            </View>
            <View style={styles.editActionsRow}>
              <TouchableOpacity testID="cancel-nickname-change" style={styles.cancelBtn} onPress={cancelNicknameChange}>
                <XCircle size={16} color="#DC2626" />
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="save-profile" style={[styles.saveButton, (!available || checking) ? { opacity: 0.6 } : null as unknown as undefined]} onPress={handleSave} disabled={!available || checking}>
                <Text style={styles.saveButtonText}>{checking ? 'Checking…' : 'Save Profile'}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      <View style={styles.statsSection}>
        <Text style={styles.sectionTitle}>Your Stats</Text>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <View
              style={[styles.statIconContainer, { backgroundColor: "#3B82F620" }]}
            >
              <Activity size={24} color="#3B82F6" />
            </View>
            <Text style={styles.statValue}>{sessions.length}</Text>
            <Text style={styles.statLabel}>Sessions</Text>
          </View>

          <View style={styles.statCard}>
            <View
              style={[styles.statIconContainer, { backgroundColor: "#22C55E20" }]}
            >
              <Target size={24} color="#22C55E" />
            </View>
            <Text style={styles.statValue}>{myTerritories.length}</Text>
            <Text style={styles.statLabel}>Territories</Text>
          </View>

          <View style={styles.statCard}>
            <View
              style={[styles.statIconContainer, { backgroundColor: "#F59E0B20" }]}
            >
              <Trophy size={24} color="#F59E0B" />
            </View>
            <Text style={styles.statValue}>
              {(totalDistance / 1000).toFixed(1)}
            </Text>
            <Text style={styles.statLabel}>km Traveled</Text>
          </View>
        </View>
      </View>

      <View style={styles.dangerZone}>
        <Text style={styles.dangerZoneTitle}>Danger Zone</Text>
        <TouchableOpacity
          testID="reset-all-data"
          style={[styles.dangerButton, { marginBottom: 12 }]}
          onPress={handleClearAllData}
        >
          <Trash2 size={20} color="#DC2626" />
          <Text style={styles.dangerButtonText}>Reset All Data (Sessions + Territories)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="clear-all-territories"
          style={styles.dangerButton}
          onPress={handleClearAllTerritories}
          disabled={myTerritories.length === 0}
        >
          <Trash2 size={20} color={myTerritories.length === 0 ? "#9CA3AF" : "#EF4444"} />
          <Text
            style={[
              styles.dangerButtonText,
              myTerritories.length === 0 && styles.dangerButtonTextDisabled,
            ]}
          >
            Clear All Territories ({myTerritories.length})
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Player ID: {ownerId.slice(0, 8)}</Text>
        <View style={[styles.colorBadge, { backgroundColor: ownerColor }]}>
          <Text style={styles.colorBadgeText}>Your Color</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F9FAFB",
  },
  content: {
    padding: 20,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: "#111827",
    marginBottom: 16,
  },
  currentAvatar: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  avatarLarge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#E5E7EB",
  },
  colorIndicator: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: "#FFF",
    position: "absolute",
    bottom: 0,
    right: "50%",
    marginRight: -48,
  },
  avatarEditBtn: { position: "absolute", right: 24, bottom: 8, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB", width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  avatarOption: {
    alignItems: "center",
    padding: 8,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#E5E7EB",
    width: "22%",
    backgroundColor: "#FFF",
  },
  avatarSelected: {
    borderColor: "#3B82F6",
    backgroundColor: "#EFF6FF",
  },
  avatarSmall: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#F3F4F6",
    marginBottom: 4,
  },
  avatarLabel: {
    fontSize: 10,
    color: "#6B7280",
    textAlign: "center",
  },
  avatarLabelSelected: {
    color: "#3B82F6",
    fontWeight: "600" as const,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    gap: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: "#111827",
    minWidth: 0,
  },
  lockRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  editActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  cancelBtn: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  cancelBtnText: {
    color: '#DC2626',
    fontWeight: '700' as const,
    fontSize: 13,
  },
  saveButton: {
    flex: 1,
    backgroundColor: "#3B82F6",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 0,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: "#FFF",
  },
  saveAvatarButton: {
    marginTop: 12,
    backgroundColor: "#111827",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  saveAvatarText: {
    color: "#FFF",
    fontWeight: "700" as const,
    fontSize: 14,
  },
  statsSection: {
    marginBottom: 28,
  },
  statsGrid: {
    flexDirection: "row",
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  statIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "700" as const,
    color: "#111827",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: "#6B7280",
    textAlign: "center",
  },
  dangerZone: {
    marginBottom: 28,
  },
  dangerZoneTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: "#DC2626",
    marginBottom: 16,
  },
  dangerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FEE2E2",
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  dangerButtonText: {
    fontSize: 16,
    fontWeight: "600" as const,
    color: "#DC2626",
  },
  dangerButtonTextDisabled: {
    color: "#9CA3AF",
  },
  footer: {
    alignItems: "center",
    gap: 12,
    paddingBottom: 20,
  },
  footerText: {
    fontSize: 12,
    color: "#9CA3AF",
  },
  colorBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  colorBadgeText: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: "#FFF",
  },
});
