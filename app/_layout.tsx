import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import { View, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "@/providers/SessionProvider";
import DebugBanner from "@/components/DebugBanner";
import ErrorBoundary from "@/components/ErrorBoundary";
import AsyncStorage from "@react-native-async-storage/async-storage";

console.log("🚀 App _layout.tsx loaded");

if (Platform.OS !== "web") {
  SplashScreen.preventAutoHideAsync().catch(() => {});
}

const queryClient = new QueryClient();

function RootLayoutNav() {
  const { isInitialized } = useSession();
  const [isReady, setIsReady] = useState<boolean>(false);
  const [hasTimedOut, setHasTimedOut] = useState<boolean>(false);
  const didNavigateRef = useRef<boolean>(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!isReady && !didNavigateRef.current) {
        console.log('⚠️ Initialization timeout - forcing navigation');
        setHasTimedOut(true);
        setIsReady(true);
        didNavigateRef.current = true;
        setTimeout(() => router.replace("/splash"), 100);
      }
    }, 5000);

    return () => clearTimeout(timeout);
  }, [isReady]);

  useEffect(() => {
    if (isInitialized && !didNavigateRef.current) {
      console.log('✅ SessionProvider initialized');
      setIsReady(true);
      didNavigateRef.current = true;
      
      AsyncStorage.getItem("hasSeenSplash")
        .then((value) => {
          console.log('🔍 Splash status:', value);
          if (value === "true") {
            console.log('👤 Returning user, navigating to game');
            setTimeout(() => router.replace("/(tabs)/(play)"), 100);
          } else {
            console.log('✨ New user, showing splash');
            setTimeout(() => router.replace("/splash"), 100);
          }
        })
        .catch(() => {
          console.log('⚠️ Failed to read splash status, showing splash');
          setTimeout(() => router.replace("/splash"), 100);
        });
    }
  }, [isInitialized]);
  
  if (!isReady) {
    console.log('⏳ Waiting for SessionProvider...');
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }
  
  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="splash" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS !== "web") {
      const timer = setTimeout(() => {
        SplashScreen.hideAsync().catch((err) => {
          console.log('Splash hide error:', err);
        });
      }, 1000);
      return () => clearTimeout(timer);
    }
    return () => {};
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <SessionProvider>
            <ErrorBoundary>
              <RootLayoutNav />
              {__DEV__ ? <DebugBanner /> : null}
            </ErrorBoundary>
          </SessionProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "#fff",
  },
});
