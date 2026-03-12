import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type Locale, translations } from "@/lib/i18n";

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (typeof translations)[Locale];
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set, get) => ({
      locale: "en",
      t: translations.en,
      setLocale: (locale) => set({ locale, t: translations[locale] }),
    }),
    {
      name: "sna-locale",
      onRehydrateStorage: () => (state) => {
        if (state) state.t = translations[state.locale];
      },
    }
  )
);
