import { Stack } from "expo-router";
import React from "react";

export default function HistoryLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="index" options={{ title: "History" }} />
      <Stack.Screen name="details" options={{ title: "Session" }} />
    </Stack>
  );
}
