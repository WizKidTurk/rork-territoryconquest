import { Stack } from "expo-router";
import React from "react";

export default function PlayLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="index" options={{ title: "TerritoryConquest" }} />
    </Stack>
  );
}
