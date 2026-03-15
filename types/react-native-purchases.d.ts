/**
 * Type declaration for react-native-purchases when the package's own types
 * are not resolved (e.g. module resolution or missing types).
 */
declare module 'react-native-purchases' {
  export interface PurchasesEntitlementInfos {
    active: Record<string, unknown>;
    all: Record<string, unknown>;
  }

  export interface CustomerInfo {
    readonly entitlements: PurchasesEntitlementInfos;
    readonly activeSubscriptions: string[];
    readonly allPurchasedProductIdentifiers: Set<string>;
    readonly managementURL: string | null;
  }

  export interface PurchasesStoreProduct {
    readonly priceString: string;
    readonly identifier: string;
  }

  export interface PurchasesPackage {
    readonly identifier: string;
    readonly packageType: string;
    readonly product: PurchasesStoreProduct;
    readonly offeringIdentifier?: string;
  }

  export interface PurchasesOffering {
    readonly identifier: string;
    readonly availablePackages: PurchasesPackage[];
    readonly current?: PurchasesOffering;
  }

  export interface Offerings {
    readonly current: PurchasesOffering | null;
    readonly all: Record<string, PurchasesOffering>;
  }

  export interface Configuration {
    apiKey: string;
  }

  const Purchases: {
    configure(config: Configuration): void;
    logIn(appUserID: string): Promise<{ customerInfo: CustomerInfo }>;
    getOfferings(): Promise<Offerings>;
    getCustomerInfo(): Promise<CustomerInfo>;
    purchasePackage(pkg: PurchasesPackage): Promise<{ customerInfo: CustomerInfo }>;
    restorePurchases(): Promise<CustomerInfo>;
  };

  export default Purchases;
}
