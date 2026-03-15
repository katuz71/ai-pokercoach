import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Purchases, {
  CustomerInfo,
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';
import type { Offerings } from 'react-native-purchases';
import { useAuth } from './AuthProvider';
import { supabase } from '../lib/supabase';

const PRO_ENTITLEMENT_ID = 'pro';

/** Mask API key for debug logs: show last 4 chars only */
function maskApiKey(key: string): string {
  if (!key || key.length < 4) return '(empty or too short)';
  return `...${key.slice(-4)}`;
}

type RevenueCatContextType = {
  isReady: boolean;
  offerings: PurchasesOffering | null;
  customerInfo: CustomerInfo | null;
  purchasePackage: (pkg: PurchasesPackage) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
  refreshOfferings: () => Promise<void>;
};

const RevenueCatContext = createContext<RevenueCatContextType | null>(null);

// Supabase client generics can infer 'never' for table methods; payload matches profiles.Update
async function updateSupabaseSubscriptionTier(userId: string, tier: 'pro' | 'free') {
  const { error } = await supabase
    .from('profiles')
    // @ts-expect-error - profiles update payload is correct per types/database.ts
    .update({ subscription_tier: tier })
    .eq('id', userId);
  if (error) throw error;
}

export function RevenueCatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [isReady, setIsReady] = useState(false);
  const [offerings, setOfferings] = useState<PurchasesOffering | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const configuredRef = useRef(false);

  // 1. Configure Purchases once at app start; only after this may getOfferings() be called.
  useEffect(() => {
    const isAndroid = Platform.OS === 'android';
    const isIos = Platform.OS === 'ios';

    const apiKey = isAndroid
      ? (process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ??
         process.env.EXPO_PUBLIC_RC_ANDROID ??
         '')
      : isIos
        ? (process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ??
           process.env.EXPO_PUBLIC_RC_IOS ??
           '')
        : '';

    console.log('[RevenueCat] Platform:', Platform.OS, 'API key (masked):', maskApiKey(apiKey));

    if (!apiKey) {
      console.warn('[RevenueCat] No API key for platform:', Platform.OS, '- subscriptions disabled');
      setIsReady(true);
      return;
    }

    // Android must use Public API key starting with goog_, not app ID
    if (isAndroid && !apiKey.startsWith('goog_')) {
      console.warn(
        '[RevenueCat] Android API key should start with goog_ (Public API key from dashboard). Got prefix:',
        apiKey.slice(0, 8),
        '- did you paste App ID instead?'
      );
    }

    try {
      Purchases.configure({ apiKey });
      configuredRef.current = true;
      console.log('[RevenueCat] configure() called for', Platform.OS);
      // Give native SDK a tick to init (avoids "no singleton instance" on Android)
      const t = setTimeout(() => {
        setIsReady(true);
      }, 100);
      return () => clearTimeout(t);
    } catch (e) {
      console.error('[RevenueCat] configure() failed:', e);
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    if (!user?.id || !isReady || !configuredRef.current) return;

    const setUserId = async () => {
      try {
        await Purchases.logIn(user.id);
      } catch (e) {
        __DEV__ && console.warn('[RevenueCat] logIn failed:', e);
      }
    };
    setUserId();
  }, [user?.id, isReady]);

  const refreshOfferings = useCallback(async () => {
    if (!isReady || !configuredRef.current) {
      console.log('[RevenueCat] refreshOfferings skipped: isReady=', isReady, 'configured=', configuredRef.current);
      return;
    }
    console.log('[RevenueCat] Loading offerings…');
    try {
      const offer: Offerings = await Purchases.getOfferings();

      // Extended logging: full getOfferings() result (safe serialization, no circular refs)
      const logPayload = {
        currentId: offer.current?.identifier ?? null,
        allKeys: Object.keys(offer.all ?? {}),
        offeringsDetail: Object.fromEntries(
          Object.entries(offer.all ?? {}).map(([k, v]) => [
            k,
            {
              identifier: v.identifier,
              packageCount: v.availablePackages?.length ?? 0,
              packageIds: (v.availablePackages ?? []).map((p) => p.identifier),
              priceStrings: (v.availablePackages ?? []).map((p) => p.product?.priceString ?? 'N/A'),
            },
          ])
        ),
      };
      console.log('[RevenueCat] getOfferings() full result:', JSON.stringify(logPayload, null, 2));

      // Prefer offering with identifier 'default', fallback to current
      const defaultOffering = offer.all?.['default'] ?? offer.current ?? null;
      const source = offer.all?.['default'] ? 'default' : offer.current ? 'current' : 'none';
      console.log('[RevenueCat] Using offering source:', source, 'identifier=', defaultOffering?.identifier ?? 'null');
      setOfferings(defaultOffering);

      if (defaultOffering) {
        const count = defaultOffering.availablePackages?.length ?? 0;
        console.log('[RevenueCat] Offerings loaded: offeringId=', defaultOffering.identifier, 'packages=', count);
        if (count === 0) {
          console.warn(
            '[RevenueCat] Offering "' +
              defaultOffering.identifier +
              '" has no availablePackages (check dashboard: products, Monthly/Annual)'
          );
        } else {
          defaultOffering.availablePackages?.forEach((pkg, i) => {
            console.log(
              '[RevenueCat] Package[' + i + ']',
              pkg.identifier,
              'priceString=',
              pkg.product?.priceString ?? 'N/A'
            );
          });
        }
      } else {
        console.warn('[RevenueCat] No default/current offering (check RevenueCat dashboard: offering id "default")');
      }

      const info = await Purchases.getCustomerInfo();
      setCustomerInfo(info);
    } catch (e) {
      console.error('[RevenueCat] getOfferings failed:', e);
      setOfferings(null);
    }
  }, [isReady]);

  useEffect(() => {
    refreshOfferings();
  }, [refreshOfferings]);

  const purchasePackage = useCallback(
    async (pkg: PurchasesPackage): Promise<boolean> => {
      if (!user?.id) return false;
      try {
        const { customerInfo: info } = await Purchases.purchasePackage(pkg);
        setCustomerInfo(info);
        const hasPro = typeof info.entitlements.active[PRO_ENTITLEMENT_ID] !== 'undefined';
        if (hasPro) {
          await updateSupabaseSubscriptionTier(user.id, 'pro');
        }
        return hasPro;
      } catch (err: unknown) {
        const rcErr = err as { userCancelled?: boolean; code?: string };
        const cancelled =
          rcErr?.userCancelled === true ||
          rcErr?.code === 'PURCHASE_CANCELLED_ERROR';
        if (cancelled) return false;
        throw err;
      }
    },
    [user?.id]
  );

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    try {
      const info = await Purchases.restorePurchases();
      setCustomerInfo(info);
      const hasPro = typeof info.entitlements.active[PRO_ENTITLEMENT_ID] !== 'undefined';
      if (hasPro) {
        await updateSupabaseSubscriptionTier(user.id, 'pro');
      }
      return hasPro;
    } catch (err) {
      throw err;
    }
  }, [user?.id]);

  return (
    <RevenueCatContext.Provider
      value={{
        isReady,
        offerings,
        customerInfo,
        purchasePackage,
        restorePurchases,
        refreshOfferings,
      }}
    >
      {children}
    </RevenueCatContext.Provider>
  );
}

export function useRevenueCat() {
  const ctx = useContext(RevenueCatContext);
  if (!ctx) {
    throw new Error('useRevenueCat must be used within RevenueCatProvider');
  }
  return ctx;
}
