import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { DeviceContactScanProvider } from '@/features/contact-import/use-device-contact-scan';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <DeviceContactScanProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </DeviceContactScanProvider>
    </ThemeProvider>
  );
}
