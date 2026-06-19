import zhCN from "./zh-CN/translation.json";

export interface TranslationTree {
  [key: string]: string | TranslationTree;
}

export const translationOverrides = {
  "zh-CN": zhCN,
} as const satisfies Record<string, TranslationTree>;

export const resolvedTranslations = {
  "zh-CN": translationOverrides["zh-CN"],
} as const;

export const resources = {
  "zh-CN": { translation: resolvedTranslations["zh-CN"] },
} as const;
