import { Redirect, Tabs } from 'expo-router';
import { useApp } from '../../context/AppContext';

export default function TabsLayout() {
  const { isHydrated, onboardingDone } = useApp();

  if (!isHydrated) return null;
  if (!onboardingDone) return <Redirect href="/(onboarding)/welcome" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { 
          backgroundColor: '#0B0E14', 
          borderTopColor: 'rgba(255, 255, 255, 0.06)',
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: '#E53935',
        tabBarInactiveTintColor: '#65708A',
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen name="analyze" options={{ title: 'Analyze' }} />
      <Tabs.Screen name="train" options={{ title: 'Train' }} />
      <Tabs.Screen name="tools" options={{ title: 'Tools' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
