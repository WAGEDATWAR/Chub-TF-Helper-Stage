import { ContentError } from "./loader";

export const DEFAULT_LOCALE = "en";

export class LocaleBundle {
  readonly locale: string;
  readonly strings: Record<string, string>;

  constructor(locale: string, strings: Record<string, string> = {}) {
    this.locale = locale;
    this.strings = strings;
  }

  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.strings, key);
  }

  get(key: string): string | null {
    return this.strings[key] ?? null;
  }

  all(): Record<string, string> {
    return { ...this.strings };
  }
}

export class I18n {
  readonly defaultLocale: string;
  locale: string;
  private readonly bundles: Map<string, LocaleBundle>;

  constructor({ defaultLocale = DEFAULT_LOCALE }: { defaultLocale?: string } = {}) {
    this.defaultLocale = defaultLocale;
    this.locale = defaultLocale;
    this.bundles = new Map();
  }

  register(locale: string, strings: Record<string, string>): this {
    this.bundles.set(locale, new LocaleBundle(locale, strings));
    return this;
  }

  setLocale(locale: string): this {
    if (!this.bundles.has(locale)) {
      throw new ContentError(`i18n: unknown locale "${locale}"`, "locale");
    }
    this.locale = locale;
    return this;
  }

  translate(key: string, fallback: string | null = null): string {
    const bundle = this.bundles.get(this.locale);
    if (bundle && bundle.has(key)) return bundle.get(key)!;
    const base = this.bundles.get(this.defaultLocale);
    if (base && base.has(key)) return base.get(key)!;
    return fallback ?? key;
  }

  missingKeys(againstLocale = this.defaultLocale): Array<{ locale: string; key: string }> {
    const base = this.bundles.get(againstLocale);
    if (!base) return [];
    const missing: Array<{ locale: string; key: string }> = [];
    for (const [locale, bundle] of this.bundles) {
      if (locale === againstLocale) continue;
      for (const key of Object.keys(base.strings)) {
        if (!bundle.has(key)) missing.push({ locale, key });
      }
    }
    return missing;
  }

  availableLocales(): string[] {
    return [...this.bundles.keys()].sort();
  }
}

export function buildI18n({ defaultLocale = DEFAULT_LOCALE, bundles = {} }: { defaultLocale?: string; bundles?: Record<string, Record<string, string>> } = {}): I18n {
  const i18n = new I18n({ defaultLocale });
  for (const [locale, strings] of Object.entries(bundles)) {
    i18n.register(locale, strings);
  }
  return i18n;
}
