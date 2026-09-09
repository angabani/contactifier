import { useEffect, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function TaskProgress({ title, detail, progress }: {
  readonly title: string;
  readonly detail: string;
  readonly progress?: number;
}) {
  const theme = useTheme();
  const [rotation] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.loop(Animated.timing(rotation, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      })),
      Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ])),
    ]);
    animation.start();
    return () => animation.stop();
  }, [pulse, rotation]);

  const normalizedProgress = Math.max(0, Math.min(1, progress ?? 0));
  return (
    <ThemedView type="backgroundElement" style={styles.progressCard} accessibilityLiveRegion="polite">
      <View style={styles.orbitWrap}>
        <Animated.View style={[
          styles.orbit,
          { borderColor: theme.primarySoft, borderTopColor: theme.primary },
          { transform: [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] },
        ]} />
        <Animated.View style={[
          styles.progressCore,
          { backgroundColor: theme.primary },
          { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }] },
        ]}>
          <ThemedText style={styles.progressGlyph}>✦</ThemedText>
        </Animated.View>
      </View>
      <View style={styles.progressCopy}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText>
        {progress !== undefined && (
          <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
            <View style={[styles.fill, { backgroundColor: theme.primary, width: `${normalizedProgress * 100}%` }]} />
          </View>
        )}
      </View>
    </ThemedView>
  );
}

export function SuccessCelebration({
  visible,
  count,
  scannedCount,
  onContinue,
  onClose,
}: {
  readonly visible: boolean;
  readonly count: number;
  readonly scannedCount: number;
  readonly onContinue: () => void;
  readonly onClose: () => void;
}) {
  const theme = useTheme();
  const [entrance] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!visible) return;
    entrance.setValue(0);
    Animated.spring(entrance, { toValue: 1, damping: 13, stiffness: 150, useNativeDriver: true }).start();
  }, [entrance, visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Animated.View style={{
          opacity: entrance,
          transform: [
            { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) },
            { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
          ],
        }}>
          <ThemedView style={styles.modalCard}>
            <View style={[styles.successHalo, { backgroundColor: theme.successSoft }]}>
              <ThemedText style={[styles.successCheck, { color: theme.success }]}>✓</ThemedText>
            </View>
            <ThemedText type="title" style={styles.modalTitle}>
              {count > 0 ? 'Your cleanup is ready' : 'Everything looks tidy'}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.modalCopy}>
              We safely scanned {scannedCount} contacts. {count > 0
                ? `You have ${count} ${count === 1 ? 'suggestion' : 'suggestions'} to review.`
                : 'No changes are needed right now.'}
            </ThemedText>
            <View style={[styles.educationCard, { backgroundColor: theme.primarySoft }]}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>You stay in control</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Review each suggestion, preview the exact result, then approve only what you want. Your backup is ready if you need to undo.
              </ThemedText>
            </View>
            {count > 0 && (
              <Pressable accessibilityRole="button" onPress={onContinue} style={[styles.modalButton, { backgroundColor: theme.primary }]}>
                <ThemedText style={styles.modalButtonText}>Review suggestions</ThemedText>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>
                {count > 0 ? 'Not now' : 'Done'}
              </ThemedText>
            </Pressable>
          </ThemedView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  progressCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: 18, borderRadius: 22 },
  orbitWrap: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center' },
  orbit: { position: 'absolute', width: 56, height: 56, borderRadius: 28, borderWidth: 4 },
  progressCore: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  progressGlyph: { color: '#FFFFFF', fontSize: 17, lineHeight: 20 },
  progressCopy: { flex: 1, gap: 3 },
  track: { height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 7 },
  fill: { height: '100%', borderRadius: 3 },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(11, 18, 32, 0.58)' },
  modalCard: { width: '100%', maxWidth: 440, alignSelf: 'center', alignItems: 'center', gap: 16, borderRadius: 30, padding: 28 },
  successHalo: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  successCheck: { fontSize: 38, lineHeight: 46, fontWeight: '900' },
  modalTitle: { fontSize: 30, lineHeight: 35, textAlign: 'center' },
  modalCopy: { textAlign: 'center' },
  educationCard: { width: '100%', gap: 5, padding: 16, borderRadius: 18 },
  modalButton: { width: '100%', minHeight: 54, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  modalButtonText: { color: '#FFFFFF', fontWeight: '800' },
  closeButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 16 },
});
