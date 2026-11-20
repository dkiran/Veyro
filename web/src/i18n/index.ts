import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Add a language: drop locales/<code>.json (same keys as en.json) and add it here. Missing keys fall back to English.
const modules = import.meta.glob('./locales/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, string>>;
const resources = Object.fromEntries(Object.entries(modules).map(([p, v]) => [p.match(/([\w-]+)\.json$/)![1], { translation: v }]));

export const LANGUAGES: { code: string; label: string; rtl?: boolean }[] = [
  { code: 'en', label: 'English' }, { code: 'hi', label: 'हिन्दी' }, { code: 'mr', label: 'मराठी' }, { code: 'ta', label: 'தமிழ்' },
  { code: 'te', label: 'తెలుగు' }, { code: 'bn', label: 'বাংলা' }, { code: 'ar', label: 'العربية', rtl: true }, { code: 'es', label: 'Español' },
].filter((l) => resources[l.code]);

function applyDir(lng: string) {
  const l = LANGUAGES.find((x) => x.code === lng.split('-')[0]);
  document.documentElement.lang = lng;
  document.documentElement.dir = l?.rtl ? 'rtl' : 'ltr';
}

i18n.use(LanguageDetector).use(initReactI18next).init({
  resources, fallbackLng: 'en', keySeparator: false, nsSeparator: false,
  supportedLngs: false, interpolation: { escapeValue: false },
  detection: { caches: ['localStorage'], lookupLocalStorage: 'veyro.lang' },
});
i18n.on('languageChanged', applyDir);
applyDir(i18n.language || 'en');

export const fmtDate = (d: string | Date) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
export const fmtNum = (n: number, max = 1) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: max }).format(n);
export default i18n;
