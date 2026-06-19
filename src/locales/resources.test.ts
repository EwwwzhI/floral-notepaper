import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./locale-whitelist";
import { resolvedTranslations, translationOverrides, type TranslationTree } from "./resources";

function collectLeafKeys(tree: TranslationTree, prefix = ""): string[] {
  const keys: string[] = [];

  for (const [key, value] of Object.entries(tree)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      keys.push(nextPrefix);
      continue;
    }

    keys.push(...collectLeafKeys(value, nextPrefix));
  }

  return keys.sort();
}

describe("locale resources", () => {
  const sourceKeys = collectLeafKeys(translationOverrides[DEFAULT_LOCALE]);
  it("resolves every supported locale with complete source-locale coverage", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(collectLeafKeys(resolvedTranslations[locale])).toEqual(sourceKeys);
    }
  });
});
