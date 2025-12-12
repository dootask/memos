const MEMOS_THEME_STORAGE_KEY = "memos-theme";
const MEMOS_LOCALE_STORAGE_KEY = "memos-locale";

const mapThemeParamToMemosTheme = (theme: string): string | null => {
  const normalized = theme.trim().toLowerCase();

  return normalized === "dark" ? "default-dark" : "default";
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

/**
 * Applies DooTask-provided theme/lang from URL to Memos localStorage keys:
 * - theme=light|dark -> memos-theme=default|default-dark
 * - lang=zh|zh-CHT|en|... -> memos-locale=<valid memos locale>
 *
 * This is intentionally side-effect-only and low-intrusion: it only writes localStorage
 * and optionally strips URL params, letting existing Memos startup logic apply them.
 */
export const applyDooTaskThemeAndLangFromUrl = (): void => {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  const theme = params.get("theme");
  const lang = params.get("lang");

  if (theme) {
    const memosTheme = mapThemeParamToMemosTheme(theme);
    if (memosTheme) {
      safeSetLocalStorageItem(MEMOS_THEME_STORAGE_KEY, memosTheme);
    }
  }

  if (lang) {
    const memosLocale = mapLangParamToMemosLocale(lang);
    safeSetLocalStorageItem(MEMOS_LOCALE_STORAGE_KEY, memosLocale);
  }
};
