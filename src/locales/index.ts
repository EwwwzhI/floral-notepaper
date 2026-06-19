import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LOCALE } from "./locale-whitelist";
import { resources } from "./resources";

let initPromise: Promise<typeof i18n> | null = null;

export function initializeI18n() {
  if (!initPromise) {
    initPromise = i18n
      .use(initReactI18next)
      .init({
        resources,
        lng: DEFAULT_LOCALE,
        fallbackLng: DEFAULT_LOCALE,
        supportedLngs: [DEFAULT_LOCALE],
        defaultNS: "translation",
        ns: ["translation"],
        interpolation: {
          escapeValue: false,
        },
        returnEmptyString: false,
        returnNull: false,
      })
      .then(() => i18n);
  }

  return initPromise;
}

export { i18n };

export default i18n;
