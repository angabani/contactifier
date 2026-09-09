import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { DeviceContactScanProvider } from '@/features/contact-import/use-device-contact-scan';
import { SmartMatchingProvider } from '@/features/smart-matching/use-smart-matching';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SmartMatchingProvider>
        <DeviceContactScanProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
        </DeviceContactScanProvider>
      </SmartMatchingProvider>
    </ThemeProvider>
  );
}
