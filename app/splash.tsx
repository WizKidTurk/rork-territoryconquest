import React, { useEffect, useRef } from "react";
import { View, StyleSheet, ImageBackground, Animated, Platform, StatusBar, Text, Pressable } from "react-native";
import { router, Stack } from "expo-router";
import ErrorBoundary from "@/components/ErrorBoundary";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

const IMAGE_URL = "https://r2-pub.rork.com/generated-images/7def2e86-a805-4927-97ae-13b2ad78fb8c.png" as const;

export default function SplashScreenPage() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ headerShown: false }} />
      <Inner />
    </ErrorBoundary>
  );
}

function Inner() {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    console.log("[Splash] mounted");

    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: Platform.OS !== "web",
    }).start();

    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 900, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: Platform.OS !== "web" }),
      ])
    );
    pulseAnim.start();

    return () => {
      console.log("[Splash] unmounted");
      pulseAnim.stop();
    };
  }, [fadeAnim, pulse]);

  const onStart = async () => {
    console.log("[Splash] Tap to start pressed");
    try {
      await AsyncStorage.setItem("hasSeenSplash", "true");
      console.log("[Splash] Marked splash as seen, navigating to game...");
      setTimeout(() => {
        router.replace("/(tabs)/(play)");
      }, 100);
    } catch (e) {
      console.log("[Splash] Failed to save splash status:", e);
      router.replace("/(tabs)/(play)");
    }
  };

  return (
    <View style={styles.root} testID="splash-screen">
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.container}>
        <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}> 
          <ImageBackground
            source={{ uri: IMAGE_URL }}
            resizeMode="cover"
            style={styles.image}
            imageStyle={styles.imageRadius}
          >
            <View style={styles.scrim} />
            <View style={styles.textWrap} pointerEvents="none">
              <Text style={styles.title} accessibilityRole="header">Territory Run</Text>
              <Text style={styles.tagline}>Move. Conquer. Dominate your streets.</Text>
            </View>
            <View style={styles.ctaWrap}>
              <Animated.View style={{ transform: [{ scale: pulse }] }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={onStart}
                  style={styles.ctaBtn}
                  testID="tap-to-start-button"
                >
                  <Text style={styles.ctaText}>Tap to Start</Text>
                </Pressable>
              </Animated.View>
              <Text style={styles.credit} testID="developer-credit" accessibilityLabel="Developed by ETEAM SISMAN App Developers">ETEAM SISMAN App Developers</Text>
            </View>
          </ImageBackground>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0F1E" },
  container: { flex: 1 },
  overlay: { flex: 1 },
  image: { flex: 1, justifyContent: "flex-end" },
  imageRadius: { },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.2)" },
  textWrap: { paddingHorizontal: 24, paddingBottom: 120 },
  title: { color: "#FFFFFF", fontSize: 40, fontWeight: "800" as const, textAlign: "center" as const, textShadowColor: "rgba(0, 255, 255, 0.3)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12 },
  tagline: { marginTop: 8, color: "#C7D2FE", fontSize: 14, fontWeight: "600" as const, textAlign: "center" as const },
  ctaWrap: { position: "absolute", left: 24, right: 24, bottom: 40, alignItems: "center" as const },
  ctaBtn: { backgroundColor: "#22C55E", borderRadius: 9999, paddingVertical: 14, paddingHorizontal: 24, borderWidth: 2, borderColor: "#065F46", shadowColor: "#22C55E", shadowOpacity: 0.6, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  ctaText: { color: "#0B1220", fontWeight: "800" as const, fontSize: 16, letterSpacing: 0.5 },
  credit: { marginTop: 10, color: "#E5E7EB", opacity: 0.7, fontSize: 12, fontWeight: "600" as const, textAlign: "center" as const },
});
