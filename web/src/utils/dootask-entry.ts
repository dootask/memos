const MEMOS_THEME_STORAGE_KEY = "memos-theme";
const MEMOS_LOCALE_STORAGE_KEY = "memos-locale";

const mapThemeParamToMemosTheme = (theme: string): string | null => {
  const normalized = theme.trim().toLowerCase();

  if (normalized === "dark") return "default-dark";
  if (normalized === "light") return "default";
  return null;
};

const mapLangParamToMemosLocale = (lang: string): string => {
  const lower = lang.trim().replaceAll("-", "").toLowerCase();

  // DooTask spec: zh|zh-CHT|en|ko|ja|de|fr|id|ru
  const exactMap: Record<string, string> = {
    zh: "zh-Hans",
    zhcht: "zh-Hant",
    en: "en",
    ko: "ko",
    ja: "ja",
    de: "de",
    fr: "fr",
    id: "id",
    ru: "ru",
  };

  return exactMap[lower] ?? "en";
};

const safeSetLocalStorageItem = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
};

export const parseDooTaskThemeAndLangFromUrl = (): {
  theme: string | null;
  locale: string | null;
} => {
  if (typeof window === "undefined") {
    return { theme: null, locale: null };
  }

  const params = new URLSearchParams(window.location.search);
  const themeParam = params.get("theme");
  const langParam = params.get("lang");

  const theme = themeParam ? mapThemeParamToMemosTheme(themeParam) : null;
  const locale = langParam ? mapLangParamToMemosLocale(langParam) : null;

  return { theme, locale };
};

/**
 * Applies DooTask-provided theme/lang from URL to Memos localStorage keys:
 * - theme=light|dark -> memos-theme=default|default-dark
 * - lang=zh|zh-CHT|en|... -> memos-locale=<valid memos locale>
 *
 * This is intentionally side-effect-only and low-intrusion: it only writes localStorage
 * and optionally strips URL params, letting existing Memos startup logic apply them.
 */
export const applyDooTaskThemeAndLangFromUrl = (): void => {
  const { theme, locale } = parseDooTaskThemeAndLangFromUrl();
  if (theme) {
    safeSetLocalStorageItem(MEMOS_THEME_STORAGE_KEY, theme);
  }
  if (locale) {
    safeSetLocalStorageItem(MEMOS_LOCALE_STORAGE_KEY, locale);
  }
};
