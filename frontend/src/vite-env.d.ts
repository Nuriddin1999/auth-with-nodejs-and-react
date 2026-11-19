/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_FACEBOOK_APP_ID?: string;
  readonly VITE_FACEBOOK_GRAPH_VERSION?: string;
  readonly VITE_TELEGRAM_BOT_NAME?: string;
  readonly VITE_MOCK_AUTH?: string;
  readonly VITE_FACEBOOK_EMAIL_FALLBACK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
