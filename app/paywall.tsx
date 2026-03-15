import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PurchasesPackage } from 'react-native-purchases';
import { AppText } from '../components/AppText';
import { Card } from '../components/Card';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useAuth } from '../providers/AuthProvider';
import { useRevenueCat } from '../providers/RevenueCatProvider';

export default function PaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const {
    offerings,
    purchasePackage,
    restorePurchases,
    refreshOfferings,
    isReady,
  } = useRevenueCat();
  const [purchasingPackageId, setPurchasingPackageId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (isReady) {
      refreshOfferings();
    }
  }, [isReady, refreshOfferings]);

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile');
    }
  };

  const handleBuySubscription = async (pkg: PurchasesPackage) => {
    if (!user) {
      Alert.alert('Ошибка', 'Войдите в аккаунт');
      return;
    }
    setPurchasingPackageId(pkg.identifier);
    try {
      const success = await purchasePackage(pkg);
      if (success) {
        Alert.alert(
          'Готово',
          'Подписка оформлена. PRO доступ активирован.',
          [{ text: 'OK', onPress: handleClose }]
        );
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Не удалось оформить подписку. Попробуйте позже.';
      Alert.alert('Ошибка', msg);
    } finally {
      setPurchasingPackageId(null);
    }
  };

  const handleRestorePurchases = async () => {
    setRestoring(true);
    try {
      const hasPro = await restorePurchases();
      if (hasPro) {
        Alert.alert(
          'Готово',
          'Покупки восстановлены. PRO доступ активирован.',
          [{ text: 'OK', onPress: handleClose }]
        );
      } else {
        Alert.alert(
          'Нет активных подписок',
          'Не найдено активных подписок для восстановления.'
        );
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Не удалось восстановить покупки. Попробуйте позже.';
      Alert.alert('Ошибка', msg);
    } finally {
      setRestoring(false);
    }
  };

  const packages = offerings?.availablePackages ?? [];
  const hasPackages = packages.length > 0;
  const packageCount = packages.length;

  useEffect(() => {
    if (!isReady) return;
    console.log('[Paywall] offerings.availablePackages count:', packageCount);
    if (packageCount < 2) {
      console.log('Google Play still hiding annual price');
    }
    if (!hasPackages) {
      console.error(
        '[Paywall] No packages to display. offerings=',
        offerings == null ? 'null' : { identifier: offerings.identifier, packageCount: offerings.availablePackages?.length ?? 0 },
        '- Check RevenueCat dashboard (products, Monthly/Annual) and Google Play connection.'
      );
    } else {
      console.log(
        '[Paywall] Packages loaded:',
        packageCount,
        packages.map((p) => ({ id: p.identifier, type: p.packageType, priceString: p.product?.priceString ?? 'N/A' }))
      );
    }
  }, [isReady, hasPackages, offerings, packages, packageCount]);

  const POKEROK_PARTNER_URL =
    'https://click3.ggpartners1.com/?serial=6090&creative_id=153&utm_source=allinbro_app&utm_medium=paywall&utm_campaign=bonus_button';

  const handlePokerokBonusPress = () => {
    const url = user?.id
      ? `${POKEROK_PARTNER_URL}&anid=${encodeURIComponent(user.id)}`
      : POKEROK_PARTNER_URL;
    Linking.openURL(url);
  };

  return (
    <ScreenWrapper edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleClose} style={styles.closeButton} hitSlop={12}>
          <AppText variant="label" color="#A7B0C0">← Закрыть</AppText>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.badge}>
            <AppText variant="label" color="#0B0E14">PRO</AppText>
          </View>
          <AppText variant="h1" style={styles.title}>
            Снимите все ограничения с PRO
          </AppText>
          <AppText variant="body" style={styles.subtitle}>
            Оформите подписку или получите бонус на Покерок.
          </AppText>
        </View>

        <Card style={styles.optionCard}>
          <View style={styles.optionHeader}>
            <AppText variant="h3">Оформить подписку</AppText>
          </View>
          <AppText variant="body" style={styles.optionDescription}>
            Не хотите регистрироваться? Оформите подписку и получите доступ моментально.
          </AppText>
          <View style={styles.prices}>
            {!isReady ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color="#4C9AFF" />
                <AppText variant="body" style={styles.loadingText}>
                  Загрузка тарифов…
                </AppText>
              </View>
            ) : !hasPackages ? (
              <AppText variant="body" style={styles.optionDescription}>
                Тарифы временно недоступны. Попробуйте позже.
              </AppText>
            ) : (
              packages.map((pkg: PurchasesPackage) => {
                const priceString = pkg.product?.priceString ?? '—';
                const isAnnual =
                  pkg.packageType === 'ANNUAL' ||
                  pkg.identifier.toLowerCase() === 'annual';
                const isPurchasing = purchasingPackageId === pkg.identifier;
                console.log('Rendering package:', pkg.identifier, pkg.product?.priceString);
                return (
                  <View key={pkg.identifier} style={styles.priceRow}>
                    <View style={styles.priceLabelBlock}>
                      <AppText variant="body" style={styles.priceLabel}>
                        {priceString}
                        {isAnnual ? ' / год' : ' / мес'}
                      </AppText>
                      {isAnnual && (
                        <View style={styles.savingsBadge}>
                          <AppText variant="label" color="#0B0E14">
                            Выгоднее на 30%
                          </AppText>
                        </View>
                      )}
                    </View>
                    <TouchableOpacity
                      onPress={() => handleBuySubscription(pkg)}
                      style={[
                        styles.buyButton,
                        isAnnual && styles.buyButtonHighlight,
                        isPurchasing && styles.submitButtonDisabled,
                      ]}
                      disabled={isPurchasing}
                      activeOpacity={0.85}
                    >
                      {isPurchasing ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <AppText variant="label" color="#FFFFFF">Купить</AppText>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </View>
          <TouchableOpacity
            onPress={handlePokerokBonusPress}
            style={styles.pokerokBonusButton}
            activeOpacity={0.85}
          >
            <AppText variant="label" color="#FFFFFF" style={styles.pokerokBonusButtonText}>
              Бонус на Покерок
            </AppText>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleRestorePurchases}
            style={styles.restoreLink}
            disabled={restoring}
            activeOpacity={0.7}
          >
            {restoring ? (
              <ActivityIndicator size="small" color="#6B7280" />
            ) : (
              <AppText variant="body" style={styles.restoreLinkText}>
                Восстановить покупки
              </AppText>
            )}
          </TouchableOpacity>
        </Card>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginBottom: 8,
  },
  closeButton: {
    paddingVertical: 8,
    paddingRight: 12,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  hero: {
    marginBottom: 28,
    gap: 12,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#F59E0B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  title: {
    fontSize: 28,
    lineHeight: 36,
    color: '#FFFFFF',
  },
  subtitle: {
    color: '#A7B0C0',
    lineHeight: 24,
  },
  optionCard: {
    backgroundColor: '#11161F',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    gap: 14,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionDescription: {
    color: '#A7B0C0',
    lineHeight: 22,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  prices: {
    gap: 12,
    marginTop: 4,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  loadingText: {
    color: '#A7B0C0',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  priceLabelBlock: {
    flex: 1,
    gap: 6,
  },
  priceLabel: {
    color: '#E8ECF4',
    fontWeight: '600',
  },
  savingsBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#F59E0B',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  buyButton: {
    backgroundColor: '#4C9AFF',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    minWidth: 70,
    alignItems: 'center',
  },
  buyButtonHighlight: {
    backgroundColor: '#22C55E',
  },
  pokerokBonusButton: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#DC2626',
    borderWidth: 2,
    borderColor: '#F87171',
  },
  pokerokBonusButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  restoreLink: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginTop: 16,
  },
  restoreLinkText: {
    fontSize: 13,
    color: '#6B7280',
  },
});
