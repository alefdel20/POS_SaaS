/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_OPENPAY_MERCHANT_ID: string;
  readonly VITE_OPENPAY_PUBLIC_KEY: string;
  readonly VITE_OPENPAY_SANDBOX: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
