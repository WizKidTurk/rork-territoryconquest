import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Animated, Easing, PanResponder, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "@/providers/SessionProvider";
import { Crown, Medal, Sparkles, Trophy, Zap, Star, Award } from "lucide-react-native";
import type { Territory, UseSession } from "@/providers/SessionProvider";
import type { ActivityMode } from "@/constants/game";
import { getFirebase } from "@/services/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function toMetersXY(originLat: number, p: { latitude: number; longitude: number }) {
  const R = 6378137;
  const dLat = ((p.latitude - originLat) * Math.PI) / 180;
  const dLon = (p.longitude * Math.PI) / 180;
  const x = R * dLon * Math.cos((originLat * Math.PI) / 180);
  const y = R * dLat;
  return { x, y };
}

function polygonAreaM2(poly: { latitude: number; longitude: number }[]): number {
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

function metersSquaredToSquareMiles(m2: number): number {
  return m2 / 2589988.11;
}

type PlayerStats = {
  ownerId: string;
  nickname: string;
  avatarUrl?: string;
  color: string;
  totalSquareMiles: number;
  territoryCount: number;
};

type TimePeriod = "today" | "month" | "year";



type ModeFilter = ActivityMode | "all";

function getStartOfPeriod(period: TimePeriod): number {
  const now = new Date();
  switch (period) {
    case "today":
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      console.log(`🕐 Today filter: ${today.toISOString()} (${today.getTime()})`);
      return today.getTime();
    case "month":
      now.setDate(1);
      now.setHours(0, 0, 0, 0);
      return now.getTime();
    case "year":
      now.setMonth(0, 1);
      now.setHours(0, 0, 0, 0);
      return now.getTime();
  }
}

export default function LeaderboardScreen() {
  const session = useSession() as UseSession;
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>("today");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [allPlayers, setAllPlayers] = useState<Map<string, { nickname: string; avatarStyle: string; color: string }>>(new Map());
  const [failedAvatars, setFailedAvatars] = useState<Set<string>>(new Set());
  const insets = useSafeAreaInsets();
  
  const { territories, ownerId, nickname, avatarStyle, ownerColor } = session || {};

  useEffect(() => {
    const fetchAllPlayers = async () => {
      if (!territories || !Array.isArray(territories)) return;
      
      const uniqueOwnerIds = new Set<string>();
      territories.forEach((territory: Territory) => {
        if (!territory.owners || !Array.isArray(territory.owners)) return;
        territory.owners.forEach((owner) => {
          if (owner.ownerId !== ownerId) {
            uniqueOwnerIds.add(owner.ownerId);
          }
        });
      });

      if (uniqueOwnerIds.size === 0) return;

      const refs = getFirebase();
      if (!refs) {
        console.log("⚠️ Firebase not configured, can't fetch player data");
        return;
      }

      try {
        const playersCol = collection(refs.db, "players");
        const playersMap = new Map<string, { nickname: string; avatarStyle: string; color: string }>();
        
        for (const playerId of Array.from(uniqueOwnerIds)) {
          const q = query(playersCol, where("ownerId", "==", playerId));
          const snap = await getDocs(q);
          
          if (!snap.empty) {
            const data: any = snap.docs[0]!.data();
            playersMap.set(playerId, {
              nickname: data.nickname || `Player ${playerId.substring(0, 6)}`,
              avatarStyle: data.avatarStyle || "shapes",
              color: data.ownerColor || "#999",
            });
            console.log(`✅ Fetched player data for ${playerId.slice(0, 8)}: ${data.nickname}`);
          } else {
            console.log(`⚠️ No player data found for ${playerId.slice(0, 8)}`);
          }
        }
        
        setAllPlayers(playersMap);
      } catch (e) {
        console.log("❌ Failed to fetch player data:", e);
      }
    };

    fetchAllPlayers();
  }, [territories, ownerId]);

  const leaderboard = useMemo(() => {
    if (!territories || !Array.isArray(territories)) return [];
    if (!ownerId) return [];
    if (!nickname) return [];
    if (!ownerColor) return [];
    
    const periodStart = getStartOfPeriod(selectedPeriod);
    const filteredTerritories = territories.filter((t) => {
      const territoryDate = new Date(t.createdAt);
      console.log(`📍 Territory ${t.id.slice(0,8)}: ${territoryDate.toISOString()} (${t.createdAt}) >= ${periodStart}?`, t.createdAt >= periodStart);
      if (t.createdAt < periodStart) return false;
      if (modeFilter !== "all" && t.mode !== modeFilter) return false;
      return true;
    });
    console.log(`✅ Filtered to ${filteredTerritories.length} territories for ${selectedPeriod} (${modeFilter})`);


    const statsMap = new Map<string, PlayerStats>();

    filteredTerritories.forEach((territory: Territory) => {
      if (!territory.polygon || territory.polygon.length < 3) return;
      if (!territory.owners || !Array.isArray(territory.owners)) return;
      const areaM2 = polygonAreaM2(territory.polygon);

      territory.owners.forEach((owner) => {
        if (!statsMap.has(owner.ownerId)) {
          let playerNickname = "Player";
          let playerColor = "#999";
          let playerAvatarUrl: string | undefined;

          if (owner.ownerId === ownerId) {
            playerNickname = nickname;
            playerColor = ownerColor;
            playerAvatarUrl = `https://api.dicebear.com/8.x/${avatarStyle}/svg?seed=${encodeURIComponent(nickname)}`;
            console.log(`🎨 Generated avatar URL for current user (${nickname}):`, playerAvatarUrl);
          } else {
            const playerData = allPlayers.get(owner.ownerId);
            if (playerData) {
              playerNickname = playerData.nickname;
              playerColor = playerData.color;
              playerAvatarUrl = `https://api.dicebear.com/8.x/${playerData.avatarStyle}/svg?seed=${encodeURIComponent(playerData.nickname)}`;
              console.log(`🎨 Generated avatar URL for ${playerData.nickname}:`, playerAvatarUrl);
            } else {
              playerNickname = `Player ${owner.ownerId.substring(0, 6)}`;
              console.log(`⚠️ No player data found for ${owner.ownerId.slice(0, 8)}, using fallback`);
            }
          }

          statsMap.set(owner.ownerId, {
            ownerId: owner.ownerId,
            nickname: playerNickname,
            avatarUrl: playerAvatarUrl,
            color: playerColor,
            totalSquareMiles: 0,
            territoryCount: 0,
          });
        }

        const stats: PlayerStats = statsMap.get(owner.ownerId)!;
        const weightedArea = areaM2 * owner.strength;
        stats.totalSquareMiles += metersSquaredToSquareMiles(weightedArea);
        stats.territoryCount += 1;
      });
    });

    const arr = Array.from(statsMap.values());
    const sorted = arr.sort((a, b) => b.totalSquareMiles - a.totalSquareMiles);
    return sorted.slice(0, 10);
  }, [territories, ownerId, nickname, avatarStyle, ownerColor, allPlayers, selectedPeriod, modeFilter]);

  const AnimatedHeader = React.memo(function AnimatedHeader() {
    const float = React.useRef(new Animated.Value(0)).current;
    const pulse = React.useRef(new Animated.Value(1)).current;
    const hue = React.useRef(new Animated.Value(0)).current;
    const stars = React.useRef(
      Array.from({ length: 8 }, () => ({
        anim: new Animated.Value(0),
        x: Math.random() * 100,
        y: Math.random() * 100,
        delay: Math.random() * 2000,
      }))
    ).current;

    React.useEffect(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(float, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
          Animated.timing(float, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        ])
      ).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.12, duration: 900, useNativeDriver: false }),
          Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: false }),
        ])
      ).start();

      Animated.loop(
        Animated.timing(hue, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: false })
      ).start();

      stars.forEach((star) => {
        setTimeout(() => {
          Animated.loop(
            Animated.sequence([
              Animated.timing(star.anim, { toValue: 1, duration: 1500, useNativeDriver: false }),
              Animated.timing(star.anim, { toValue: 0, duration: 1500, useNativeDriver: false }),
            ])
          ).start();
        }, star.delay);
      });
    }, [float, pulse, hue, stars]);

    const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
    const rotate = float.interpolate({ inputRange: [0, 1], outputRange: ["-8deg", "8deg"] });
    const glowOpacity = float.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.45] });

    const bgColor = hue.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: ["#1a0f2e", "#0f1a2e", "#2e1a0f", "#1a0f2e"] });
    const accent = hue.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: ["#a855f7", "#3b82f6", "#f59e0b", "#a855f7"] });
    const glow1 = hue.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["#a855f7", "#3b82f6", "#a855f7"] });
    const glow2 = hue.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["#f59e0b", "#10b981", "#f59e0b"] });

    return (
      <Animated.View style={[styles.hero, { backgroundColor: bgColor as unknown as string }]} testID="leaderboard-hero">
        <Animated.View style={[styles.heroHalo, { backgroundColor: glow1 as unknown as string, opacity: glowOpacity, transform: [{ scale: pulse }] }]} />
        <Animated.View style={[styles.heroHalo2, { backgroundColor: glow2 as unknown as string, opacity: glowOpacity, transform: [{ scale: pulse }] }]} />
        
        {stars.map((star, i) => (
          <Animated.View
            key={i}
            style={[
              styles.floatingStar,
              {
                left: `${star.x}%`,
                top: `${star.y}%`,
                opacity: star.anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) as unknown as number,
                transform: [
                  { scale: star.anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.2] }) as unknown as number },
                ],
              },
            ]}
          >
            <Star size={8} color="#fbbf24" fill="#fbbf24" />
          </Animated.View>
        ))}

        <Animated.View style={[styles.heroIconLeft, { transform: [{ translateY }, { rotate }] }]}> 
          <Trophy size={32} color="#fbbf24" fill="#fbbf24" />
        </Animated.View>
        <Animated.View style={[styles.heroIconRight, { transform: [{ translateY: Animated.multiply(translateY, -1) }, { rotate }] }]}> 
          <Zap size={36} color="#a855f7" fill="#a855f7" />
        </Animated.View>
        <View style={styles.heroCenter}>
          <Text style={styles.headerTitle}>🏆 Top Players 🏆</Text>
          <Animated.View style={[styles.heroUnderline, { backgroundColor: accent as unknown as string }]} />
          <View style={styles.metricPill}>
            <Sparkles size={16} color="#fbbf24" />
            <Text style={styles.headerSubtitle}>
              Ranked by Square Miles
            </Text>
            <Sparkles size={16} color="#fbbf24" />
          </View>
        </View>
      </Animated.View>
    );
  });

  const TopPodium = React.memo(function TopPodium({ players }: { players: PlayerStats[] }) {
    const topThree = players.slice(0, 3);
    const [failedAvatars, setFailedAvatars] = React.useState<Set<string>>(new Set());
    const [currentIndex, setCurrentIndex] = React.useState(0);
    const slideAnim = React.useRef(new Animated.Value(0)).current;

    const pulse = React.useRef(new Animated.Value(1)).current;
    const shimmer = React.useRef(new Animated.Value(0)).current;
    const rotate = React.useRef(new Animated.Value(0)).current;
    const bounce = React.useRef(new Animated.Value(0)).current;
    const confetti = React.useRef(
      Array.from({ length: 12 }, () => ({
        anim: new Animated.Value(0),
        x: Math.random() * 100 - 50,
        rotation: Math.random() * 360,
        delay: Math.random() * 800,
      }))
    ).current;

    React.useEffect(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.15, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        ])
      ).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmer, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(shimmer, {
            toValue: 0,
            duration: 1000,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
        ])
      ).start();

      Animated.loop(
        Animated.timing(rotate, {
          toValue: 1,
          duration: 2500,
          easing: Easing.linear,
          useNativeDriver: false,
        })
      ).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(bounce, {
            toValue: -12,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(bounce, {
            toValue: 0,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ])
      ).start();

      confetti.forEach((item) => {
        setTimeout(() => {
          Animated.loop(
            Animated.sequence([
              Animated.timing(item.anim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
              Animated.timing(item.anim, { toValue: 0, duration: 0, useNativeDriver: false }),
            ])
          ).start();
        }, item.delay);
      });
    }, [pulse, shimmer, rotate, bounce, confetti]);

    const barHeights = React.useMemo(() => {
      const values = topThree.map(p => p.totalSquareMiles);
      const max = Math.max(1, ...values);
      return values.map(v => 40 + (v / max) * 80);
    }, [topThree]);

    const panResponder = React.useRef(
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return Math.abs(gestureState.dx) > 10;
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx > 50 && currentIndex > 0) {
            goToPrevious();
          } else if (gestureState.dx < -50 && currentIndex < topThree.length - 1) {
            goToNext();
          } else {
            Animated.spring(slideAnim, {
              toValue: -currentIndex * SCREEN_WIDTH,
              useNativeDriver: false,
            }).start();
          }
        },
      })
    ).current;

    const goToNext = () => {
      if (currentIndex < topThree.length - 1) {
        const nextIndex = currentIndex + 1;
        setCurrentIndex(nextIndex);
        Animated.spring(slideAnim, {
          toValue: -nextIndex * SCREEN_WIDTH,
          useNativeDriver: false,
        }).start();
      }
    };

    const goToPrevious = () => {
      if (currentIndex > 0) {
        const prevIndex = currentIndex - 1;
        setCurrentIndex(prevIndex);
        Animated.spring(slideAnim, {
          toValue: -prevIndex * SCREEN_WIDTH,
          useNativeDriver: false,
        }).start();
      }
    };

    if (topThree.length === 0) {
      return null;
    }

    return (
      <View style={styles.podiumWrapper}>
        <View style={styles.podiumContainer} testID="podium" {...panResponder.panHandlers}>
          {confetti.map((item, i) => (
            <Animated.View
              key={`confetti-${i}`}
              style={[
                styles.confettiPiece,
                {
                  left: `${50 + item.x}%`,
                  transform: [
                    { translateY: item.anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 150] }) as unknown as number },
                    { rotate: `${item.rotation + (360 * (item.anim as any)._value)}deg` },
                  ],
                  opacity: item.anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.8, 0] }) as unknown as number,
                },
              ]}
            >
              <View style={[styles.confettiShape, { backgroundColor: i % 4 === 0 ? '#fbbf24' : i % 4 === 1 ? '#a855f7' : i % 4 === 2 ? '#3b82f6' : '#10b981' }]} />
            </Animated.View>
          ))}

          <Animated.View 
            style={[
              styles.podiumSlider,
              {
                transform: [{ translateX: slideAnim }],
              },
            ]}
          >
            {topThree.map((p, i) => {
              const rank = i + 1;
              const isFirst = rank === 1;
              const color = isFirst ? "#fbbf24" : rank === 2 ? "#d1d5db" : "#f97316";
              
              const animatedTransform = isFirst 
                ? { transform: [{ scale: pulse }, { translateY: bounce }] }
                : {};

              return (
                <View
                  key={p.ownerId}
                  style={[styles.podiumSlide]}
                >
                  <Animated.View style={[styles.podiumItem, animatedTransform]}>
                    <Animated.View
                      style={[
                        styles.podiumBadge,
                        { backgroundColor: color },
                        isFirst && {
                          transform: [
                            {
                              rotate: rotate.interpolate({
                                inputRange: [0, 1],
                                outputRange: ['-5deg', '5deg'],
                              }) as unknown as string,
                            },
                            { scale: pulse },
                          ],
                        },
                      ]}
                    >
                      {isFirst ? <Crown size={18} color="#111" fill="#111" /> : rank === 2 ? <Award size={16} color="#111" fill="#111" /> : <Medal size={16} color="#111" fill="#111" />}
                      <Text style={styles.podiumRank}>#{rank}</Text>
                    </Animated.View>

                    <View style={styles.podiumAvatarWrap}>
                      {isFirst && (
                        <>
                          <Animated.View
                            style={[styles.glowRing, {
                              borderColor: '#fbbf24',
                              borderWidth: 4,
                              transform: [
                                {
                                  rotate: rotate.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: ['0deg', '360deg'],
                                  }) as unknown as string,
                                },
                              ],
                            }]}
                          />
                          <Animated.View
                            style={[styles.glowRing2, {
                              borderColor: '#a855f7',
                              borderWidth: 4,
                              transform: [
                                {
                                  rotate: rotate.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: ['360deg', '0deg'],
                                  }) as unknown as string,
                                },
                              ],
                            }]}
                          />
                          <Animated.View
                            style={[styles.shimmer, {
                              opacity: shimmer.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.3, 0.6],
                              }) as unknown as number,
                            }]}
                          />
                        </>
                      )}
                      {p.avatarUrl && !failedAvatars.has(p.ownerId) ? (
                        <Image 
                          source={{ uri: p.avatarUrl }} 
                          style={[styles.podiumAvatar, isFirst && styles.podiumAvatarLarge]} 
                          onError={(e) => {
                            console.log(`❌ Failed to load avatar for ${p.nickname}:`, e.nativeEvent.error);
                            console.log(`Avatar URL was: ${p.avatarUrl}`);
                            setFailedAvatars(prev => new Set(prev).add(p.ownerId));
                          }}
                          onLoad={() => console.log(`✅ Avatar loaded for ${p.nickname}`)}
                        />
                      ) : (
                        <View style={[styles.podiumAvatar, isFirst && styles.podiumAvatarLarge, { backgroundColor: p.color }]}> 
                          <Text style={[styles.avatarText, isFirst && styles.avatarTextLarge]}>{p.nickname.charAt(0).toUpperCase()}</Text>
                        </View>
                      )}
                    </View>

                    <View style={[styles.podiumBar, { height: barHeights[i]!, borderColor: color }]} />

                    <Text style={styles.podiumName} numberOfLines={1}>{p.nickname}</Text>
                    <Text style={styles.podiumValue}>
                      {p.totalSquareMiles.toFixed(3)} sq mi
                    </Text>
                  </Animated.View>
                </View>
              );
            })}
          </Animated.View>

          <Animated.View
            style={[
              styles.podiumSparkles,
              {
                opacity: shimmer.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.6, 1],
                }) as unknown as number,
                transform: [
                  { scale: shimmer.interpolate({ inputRange: [0, 1], outputRange: [1, 1.2] }) as unknown as number },
                ],
              },
            ]}
          >
            <Star size={16} color="#fbbf24" fill="#fbbf24" />
            <Sparkles size={18} color="#a855f7" />
            <Star size={14} color="#3b82f6" fill="#3b82f6" />
          </Animated.View>
        </View>
        
        {topThree.length > 1 && (
          <View style={styles.paginationDots}>
            {topThree.map((_, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  styles.dot,
                  currentIndex === i && styles.dotActive,
                ]}
                onPress={() => {
                  setCurrentIndex(i);
                  Animated.spring(slideAnim, {
                    toValue: -i * SCREEN_WIDTH,
                    useNativeDriver: false,
                  }).start();
                }}
              />
            ))}
          </View>
        )}
      </View>
    );
  });

  const getRankIcon = (rank: number) => {
    const colors = {
      1: '#fbbf24',
      2: '#d1d5db', 
      3: '#f97316',
    };
    
    if (rank === 1 || rank === 2 || rank === 3) {
      const color = colors[rank as keyof typeof colors];
      console.log(`🏅 Rendering medal for rank ${rank}`);
      return (
        <View style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 3,
          borderColor: rank === 1 ? '#fef3c7' : rank === 2 ? '#f3f4f6' : '#fed7aa',
          shadowColor: color,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.6,
          shadowRadius: 8,
          elevation: 8,
        }}>
          {rank === 1 ? (
            <Crown size={20} color="#78350f" fill="#78350f" />
          ) : rank === 2 ? (
            <Award size={18} color="#374151" fill="#374151" />
          ) : (
            <Medal size={18} color="#7c2d12" fill="#7c2d12" />
          )}
        </View>
      );
    }
    console.log(`⚠️ No medal for rank ${rank}`);
    return null;
  };
  
  if (!session || !territories || !ownerId) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 16 }]}>
        <AnimatedHeader />

        <TopPodium players={leaderboard} />

        <View style={styles.filterContainer}>
          <TouchableOpacity
            style={[styles.filterButton, selectedPeriod === "today" && styles.filterButtonActive]}
            onPress={() => setSelectedPeriod("today")}
            testID="period-today"
          >
            <Text style={[styles.filterText, selectedPeriod === "today" && styles.filterTextActive]}>
              Today
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterButton, selectedPeriod === "month" && styles.filterButtonActive]}
            onPress={() => setSelectedPeriod("month")}
            testID="period-month"
          >
            <Text style={[styles.filterText, selectedPeriod === "month" && styles.filterTextActive]}>
              Month
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterButton, selectedPeriod === "year" && styles.filterButtonActive]}
            onPress={() => setSelectedPeriod("year")}
            testID="period-year"
          >
            <Text style={[styles.filterText, selectedPeriod === "year" && styles.filterTextActive]}>
              Year
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Filter by Activity</Text>
        </View>
        <View style={styles.modeContainer}>
          {(["all", "walk", "run", "cycle"] as ModeFilter[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.modeButton, modeFilter === m && styles.modeButtonActive]}
              onPress={() => setModeFilter(m)}
              testID={`mode-${m}`}
            >
              <Text style={[styles.modeText, modeFilter === m && styles.modeTextActive]}>
                {m === "all" ? "All" : m.charAt(0).toUpperCase() + m.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {leaderboard.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No territories captured yet</Text>
            <Text style={styles.emptySubtext}>Start capturing to see rankings!</Text>
          </View>
        ) : (
          leaderboard.map((player, index) => {
            const rank = index + 1;
            const isCurrentUser = player.ownerId === ownerId;

            return (
              <View
                key={player.ownerId}
                testID={`player-${rank}`}
                style={[
                  styles.playerCard,
                  isCurrentUser && styles.currentUserCard,
                  rank === 1 && styles.firstPlaceCard,
                ]}
              >
                {rank <= 3 ? (
                  <View style={styles.avatarContainer}>
                    {player.avatarUrl && !failedAvatars.has(player.ownerId) ? (
                      <Image 
                        source={{ uri: player.avatarUrl }} 
                        style={[styles.avatar, rank === 1 && styles.avatarLarge]} 
                        onError={(e) => {
                          console.log(`❌ Failed to load avatar for ${player.nickname}:`, e.nativeEvent.error);
                          console.log(`Avatar URL was: ${player.avatarUrl}`);
                          setFailedAvatars(prev => new Set(prev).add(player.ownerId));
                        }}
                        onLoad={() => console.log(`✅ Avatar loaded for ${player.nickname}`)}
                      />
                    ) : (
                      <View style={[styles.avatarFallback, { backgroundColor: player.color }, rank === 1 && styles.avatarLarge]}>
                        <Text style={[styles.avatarText, rank === 1 && styles.avatarTextLarge]}>
                          {player.nickname.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={styles.medalOverlay}>
                      {getRankIcon(rank)}
                    </View>
                  </View>
                ) : (
                  <>
                    <View style={styles.rankContainer}>
                      {getRankIcon(rank) || <Text style={styles.rankNumber}>{rank}</Text>}
                    </View>
                    <View style={styles.avatarContainer}>
                      {player.avatarUrl && !failedAvatars.has(player.ownerId) ? (
                        <Image 
                          source={{ uri: player.avatarUrl }} 
                          style={styles.avatar} 
                          onError={(e) => {
                            console.log(`❌ Failed to load avatar for ${player.nickname}:`, e.nativeEvent.error);
                            console.log(`Avatar URL was: ${player.avatarUrl}`);
                            setFailedAvatars(prev => new Set(prev).add(player.ownerId));
                          }}
                          onLoad={() => console.log(`✅ Avatar loaded for ${player.nickname}`)}
                        />
                      ) : (
                        <View style={[styles.avatarFallback, { backgroundColor: player.color }]}>
                          <Text style={styles.avatarText}>
                            {player.nickname.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                    </View>
                  </>
                )}

                <View style={styles.playerInfo}>
                  <Text style={styles.playerName}>
                    {player.nickname}
                    {isCurrentUser && <Text style={styles.youBadge}> (You)</Text>}
                  </Text>
                  <Text style={styles.territoryCount}>
                    {player.territoryCount} {player.territoryCount === 1 ? "territory" : "territories"}
                  </Text>
                </View>

                <View style={styles.statsContainer}>
                  <Text style={styles.squareMiles}>
                    {player.totalSquareMiles.toFixed(3)}
                  </Text>
                  <Text style={styles.squareMilesLabel}>sq mi</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  scrollContentWithInsets: {
    paddingTop: 16,
  },
  header: {
    alignItems: "center",
    marginBottom: 24,
    paddingVertical: 20,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: "900" as const,
    color: "#fff",
    marginTop: 12,
    textShadowColor: "rgba(168, 85, 247, 0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#999",
    marginTop: 4,
  },
  hero: {
    position: "relative",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    paddingVertical: 24,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
    backgroundColor: "#0b0b0c",
  },
  heroHalo: {
    position: "absolute",
    width: 300,
    height: 300,
    borderRadius: 150,
    top: -150,
    left: -80,
  },
  heroHalo2: {
    position: "absolute",
    width: 250,
    height: 250,
    borderRadius: 125,
    top: -100,
    right: -60,
  },
  floatingStar: {
    position: "absolute",
  },
  heroIconLeft: {
    position: "absolute",
    top: 12,
    left: 16,
  },
  heroIconRight: {
    position: "absolute",
    top: 10,
    right: 16,
  },
  heroCenter: {
    alignItems: "center",
  },
  heroUnderline: {
    marginTop: 8,
    width: 160,
    height: 5,
    borderRadius: 3,
    opacity: 0.9,
    shadowColor: "#a855f7",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  metricPill: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#0b1220",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  filterContainer: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#2a2a2a",
    alignItems: "center",
  },
  filterButtonActive: {
    backgroundColor: "#3B82F6",
    borderColor: "#3B82F6",
  },

  modeContainer: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 999,
    alignItems: "center",
  },
  modeButtonActive: {
    backgroundColor: "#3B82F6",
    borderColor: "#3B82F6",
  },
  modeText: {
    fontSize: 13,
    color: "#999",
    fontWeight: "700" as const,
  },
  modeTextActive: {
    color: "#fff",
  },
  filterText: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: "#999",
  },
  filterTextActive: {
    color: "#fff",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600" as const,
    color: "#666",
  },
  emptySubtext: {
    fontSize: 14,
    color: "#444",
    marginTop: 8,
  },
  playerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: "#2a2a2a",
  },
  currentUserCard: {
    borderColor: "#3B82F6",
    backgroundColor: "#1a2332",
  },
  firstPlaceCard: {
    borderColor: "#fbbf24",
    backgroundColor: "#1f1b0f",
  },
  rankContainer: {
    width: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  rankNumber: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: "#999",
  },
  avatarContainer: {
    marginLeft: 8,
    marginRight: 12,
    position: "relative",
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: "#fff",
  },
  avatarTextLarge: {
    fontSize: 32,
  },
  medalOverlay: {
    position: "absolute",
    top: -8,
    right: -8,
  },
  playerInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: 16,
    fontWeight: "600" as const,
    color: "#fff",
    marginBottom: 4,
  },
  youBadge: {
    color: "#3B82F6",
    fontWeight: "700" as const,
  },
  territoryCount: {
    fontSize: 13,
    color: "#999",
  },
  statsContainer: {
    alignItems: "flex-end",
    marginLeft: 12,
  },
  squareMiles: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: "#22C55E",
  },
  squareMilesLabel: {
    fontSize: 11,
    color: "#999",
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    fontSize: 16,
    color: "#999",
  },
  sectionHeader: {
    marginTop: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: "#999",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  podiumWrapper: {
    marginBottom: 16,
  },
  podiumContainer: {
    backgroundColor: "#0f0b1a",
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "#a855f7",
    shadowColor: "#a855f7",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
    overflow: "hidden",
    padding: 16,
  },
  podiumSlider: {
    flexDirection: "row",
  },
  podiumSlide: {
    width: SCREEN_WIDTH - 32,
    alignItems: "center",
    justifyContent: "center",
  },
  podiumItem: {
    alignItems: "center",
    gap: 6,
  },
  podiumBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  podiumRank: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: "#111",
  },
  podiumAvatarWrap: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  podiumAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    justifyContent: "center",
  },
  podiumAvatarLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  glowRing: {
    position: "absolute",
    width: 90,
    height: 90,
    borderRadius: 45,
    borderTopColor: "transparent" as const,
    borderLeftColor: "transparent" as const,
    opacity: 0.9,
  },
  glowRing2: {
    position: "absolute",
    width: 90,
    height: 90,
    borderRadius: 45,
    borderBottomColor: "transparent" as const,
    borderRightColor: "transparent" as const,
    opacity: 0.9,
  },
  shimmer: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#fbbf24",
  },
  podiumBar: {
    width: "60%",
    borderWidth: 2,
    borderRadius: 8,
    backgroundColor: "#111827",
  },
  podiumName: {
    color: "#fff",
    fontWeight: "700" as const,
    fontSize: 13,
  },
  podiumValue: {
    color: "#9CA3AF",
    fontSize: 12,
  },
  podiumSparkles: {
    position: "absolute",
    top: 12,
    right: 12,
    flexDirection: "row",
    gap: 8,
  },
  confettiPiece: {
    position: "absolute",
    top: -20,
  },
  confettiShape: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  paginationDots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#374151",
  },
  dotActive: {
    width: 24,
    backgroundColor: "#a855f7",
  },
});
