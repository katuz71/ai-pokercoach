import { Stack } from 'expo-router';

export default function ToolsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="insights" />
      <Stack.Screen name="calculator" />
      <Stack.Screen name="bankroll" />
    </Stack>
  );
}
