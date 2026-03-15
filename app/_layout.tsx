import '../lib/supabase';

import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../context/AppContext';
import { AuthProvider } from '../providers/AuthProvider';
import { RevenueCatProvider } from '../providers/RevenueCatProvider';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RevenueCatProvider>
          <AppProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
            </Stack>
          </AppProvider>
        </RevenueCatProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
