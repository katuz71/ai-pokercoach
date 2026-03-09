import { Redirect, Stack, usePathname } from 'expo-router';
import { useApp } from '../../context/AppContext';

export default function OnboardingLayout() {
  const { isHydrated, onboardingDone } = useApp();
  const pathname = usePathname();

  if (!isHydrated) return null;

  // Если онбординг пройден, и юзер пытается открыть любой экран кроме coach -> на главную
  if (onboardingDone && !pathname.includes('coach')) {
    return <Redirect href="/(tabs)/analyze" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="coach" />
      <Stack.Screen name="finish" />
    </Stack>
  );
}
