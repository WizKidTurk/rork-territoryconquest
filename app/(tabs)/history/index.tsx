import React, { useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Animated, PanResponder, Alert, Image } from "react-native";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useSession, Session, AchievementEarned } from "@/providers/SessionProvider";
import { ModeColors, ModeLabels } from "@/constants/game";
import { useRouter } from "expo-router";
import { Trash2, Trophy } from "lucide-react-native";

export default function HistoryScreen() {
  return (
    <ErrorBoundary>
      <Inner />
    </ErrorBoundary>
  );
}

function Inner() {
  const { sessions } = useSession();
  const data = useMemo(() => sessions ?? [], [sessions]);

  return (
    <View style={styles.container} testID="history-screen">
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        contentContainerStyle={data.length === 0 ? styles.emptyList : undefined}
        renderItem={({ item }) => <HistoryItem item={item} />}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No sessions yet</Text>
            <Text style={styles.emptySub}>Start a walk, run, or ride to see it here</Text>
          </View>
        )}
      />
    </View>
  );
}

function HistoryItem({ item }: { item: Session }) {
  const router = useRouter();
  const { deleteSession } = useSession();
  const miles = (item.distanceMeters / 1609.344).toFixed(2);
  const date = new Date(item.startedAt);
  const color = ModeColors[item.mode];
  const title = `${ModeLabels[item.mode]} • ${miles} mi`;
  const subtitle = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;

  const translateX = useRef(new Animated.Value(0)).current;
  const [swiping, setSwiping] = useState<boolean>(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10;
      },
      onPanResponderGrant: () => {
        setSwiping(true);
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          translateX.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        setSwiping(false);
        if (gestureState.dx < -80) {
          Animated.timing(translateX, {
            toValue: -80,
            duration: 200,
            useNativeDriver: true,
          }).start();
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const handleDelete = () => {
    Alert.alert("Delete Session", "Are you sure you want to delete this session?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          Animated.timing(translateX, {
            toValue: -500,
            duration: 300,
            useNativeDriver: true,
          }).start(() => {
            deleteSession(item.id);
          });
        },
      },
    ]);
  };

  const handlePress = () => {
    if (!swiping) {
      router.push({ pathname: "/history/details", params: { id: item.id } });
    }
  };

  return (
    <View style={styles.itemContainer}>
      <View style={styles.deleteContainer}>
        <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
          <Trash2 color="#fff" size={22} />
        </TouchableOpacity>
      </View>
      <Animated.View
        style={[styles.row, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={styles.rowTouchable}
          onPress={handlePress}
          activeOpacity={0.7}
          testID={`history-item-${item.id}`}
        >
          <View style={[styles.dot, { backgroundColor: color }]} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{title}</Text>
            <Text style={styles.rowSub}>{subtitle}</Text>
            {item.achievements && item.achievements.length > 0 && (
              <View style={styles.achievementsRow}>
                <Trophy color="#F59E0B" size={14} />
                <Text style={styles.achievementsText}>
                  {item.achievements.length} {item.achievements.length === 1 ? 'achievement' : 'achievements'}
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B1220" },
  sep: { height: 1, backgroundColor: "#111827" },
  itemContainer: { position: "relative" as const, overflow: "hidden" as const },
  deleteContainer: {
    position: "absolute" as const,
    right: 0,
    top: 0,
    bottom: 0,
    width: 80,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  deleteButton: {
    backgroundColor: "#EF4444",
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  row: {
    backgroundColor: "#0B1220",
  },
  rowTouchable: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  rowText: { flex: 1 },
  rowTitle: { color: "#fff", fontWeight: "700" as const },
  rowSub: { color: "#9CA3AF", marginTop: 2 },
  achievementsRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, marginTop: 6 },
  achievementsText: { color: "#F59E0B", fontSize: 12, fontWeight: "600" as const },
  empty: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: 24 },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "700" as const },
  emptySub: { color: "#9CA3AF", marginTop: 6 },
  emptyList: { flexGrow: 1 },
});
