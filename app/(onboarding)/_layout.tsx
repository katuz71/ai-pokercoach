import { Redirect, Stack } from 'expo-router';
import { useApp } from '../../context/AppContext';

export default function OnboardingLayout() {
  const { isHydrated, onboardingDone } = useApp();

  if (!isHydrated) return null;
  if (onboardingDone) return <Redirect href="/(tabs)/analyze" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="coach" />
      <Stack.Screen name="finish" />
    </Stack>
  );
}
