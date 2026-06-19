import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  checkGlobalShortcut,
  chooseBackgroundImage,
  listSystemFonts,
} from "../features/settings/api";
import {
  formatHeldKeys,
  hotkeyToConfigString,
  isValidGlobalShortcut,
  shortcutPlatform,
} from "../features/settings/shortcutRecorder";
import { DEFAULT_TILE_COLOR, normalizeTileColor } from "../features/settings/tileColor";
import { applyTheme, watchSystemTheme } from "../features/settings/theme";
import type {
  AppConfig,
  BackgroundFit,
  NoteFontFamily,
  ThemeOption,
  TileColorMode,
} from "../features/settings/types";
import { useShortcutRecorder } from "../features/settings/useShortcutRecorder";
import { SlidingButtonGroup } from "./SlidingButtonGroup";

interface SettingsPanelProps {
  config: AppConfig;
  onChange: (config: AppConfig) => void;
  onMigrateDataDir: () => void;
  onClose: () => void;
}

export function SettingsPanel({ config, onChange, onMigrateDataDir, onClose }: SettingsPanelProps) {
  const { t } = useTranslation();
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [fontSearch, setFontSearch] = useState("");
  const setConfigValue = <Key extends keyof AppConfig>(key: Key, value: AppConfig[Key]) => {
    onChange({ ...config, [key]: value });
  };
  const themeOptions = useMemo<Array<{ value: ThemeOption; label: string }>>(
    () => [
      { value: "light", label: t("settings.theme.light", { defaultValue: "浅色" }) },
      { value: "dark", label: t("settings.theme.dark", { defaultValue: "深色" }) },
      { value: "system", label: t("settings.theme.system", { defaultValue: "跟随系统" }) },
    ],
    [t],
  );
  const tileColorModes = useMemo<Array<{ value: TileColorMode; label: string }>>(
    () => [
      { value: "system", label: t("settings.tileColor.followTheme", { defaultValue: "跟随主题" }) },
      { value: "custom", label: t("settings.tileColor.custom", { defaultValue: "自定义" }) },
    ],
    [t],
  );
  const backgroundFits = useMemo<Array<{ value: BackgroundFit; label: string }>>(
    () => [
      { value: "cover", label: t("settings.background.fit.cover", { defaultValue: "填充" }) },
      { value: "contain", label: t("settings.background.fit.contain", { defaultValue: "完整" }) },
      { value: "repeat", label: t("settings.background.fit.repeat", { defaultValue: "平铺" }) },
    ],
    [t],
  );
  const fontOptions = useMemo<Array<{ value: NoteFontFamily; label: string }>>(() => {
    if (config.noteFontFamily.startsWith("system:")) {
      return [
        {
          value: config.noteFontFamily,
          label: config.noteFontFamily.slice("system:".length),
        },
      ];
    }
    return [
      { value: "system", label: t("settings.fontFamily.system", { defaultValue: "跟随系统" }) },
    ];
  }, [config.noteFontFamily, t]);
  const filteredSystemFonts = useMemo(() => {
    const query = fontSearch.trim().toLocaleLowerCase();
    const fonts = query
      ? systemFonts.filter((font) => font.toLocaleLowerCase().includes(query))
      : systemFonts;
    return fonts.slice(0, 120);
  }, [fontSearch, systemFonts]);

  useEffect(() => {
    let cancelled = false;
    void listSystemFonts()
      .then((fonts) => {
        if (!cancelled) setSystemFonts(fonts);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside className="w-[360px] h-full shrink-0 border-l border-paper-deep/45 bg-cloud/95 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between h-11 px-4 border-b border-paper-deep/35">
        <h2 className="text-[13px] font-display font-medium text-bamboo">
          {t("settings.title", { defaultValue: "应用设置" })}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-soft hover:bg-paper-warm transition-colors cursor-pointer"
          title={t("settings.closeTitle", { defaultValue: "关闭设置" })}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hidden px-4 py-4 space-y-5">
        <SettingGroup label={t("settings.theme.label", { defaultValue: "主题" })}>
          <SlidingButtonGroup
            options={themeOptions}
            value={config.theme}
            onChange={(value: ThemeOption) => {
              setConfigValue("theme", value);
              applyTheme(value);
              watchSystemTheme(value);
            }}
          />
        </SettingGroup>

        <SettingGroup label={t("settings.dataDir", { defaultValue: "数据目录" })}>
          <div className="flex gap-2">
            <input
              type="text"
              value={config.dataDir}
              readOnly
              className="min-w-0 flex-1 h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] font-mono text-ink-faint truncate"
            />
            <button
              type="button"
              onClick={onMigrateDataDir}
              className="h-8 px-3 rounded-lg border border-paper-deep/45 text-[11px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 transition-colors cursor-pointer"
            >
              {t("settings.selectFolder", { defaultValue: "选择文件夹" })}
            </button>
          </div>
        </SettingGroup>

        <section className="space-y-2">
          <ToggleRow
            label={t("settings.closeToTray", { defaultValue: "关闭到托盘" })}
            checked={config.closeToTray}
            onChange={(checked) => setConfigValue("closeToTray", checked)}
          />
          <ToggleRow
            label={t("settings.autostart", { defaultValue: "开机自启" })}
            checked={config.autostart}
            onChange={(checked) => setConfigValue("autostart", checked)}
          />
          <ToggleRow
            label={t("settings.rememberSurfaceSize", { defaultValue: "记住小窗尺寸" })}
            checked={config.rememberSurfaceSize}
            onChange={(checked) => setConfigValue("rememberSurfaceSize", checked)}
          />
          <ToggleRow
            label={t("settings.openAtCursor", { defaultValue: "快捷键打开时跟随鼠标位置" })}
            checked={config.openAtCursor}
            onChange={(checked) => setConfigValue("openAtCursor", checked)}
          />
        </section>

        <section className="space-y-3">
          <ShortcutField
            label={t("settings.quickNoteShortcut", { defaultValue: "快捷便签快捷键" })}
            value={config.globalShortcut}
            onChange={(value) => setConfigValue("globalShortcut", value)}
          />
          <ShortcutField
            label={t("settings.visibilityShortcut", { defaultValue: "显示/隐藏窗口快捷键" })}
            value={config.toggleVisibilityShortcut}
            onChange={(value) => setConfigValue("toggleVisibilityShortcut", value)}
          />
        </section>

        <SettingGroup label={t("settings.fontFamily.label", { defaultValue: "应用字体" })}>
          <SlidingButtonGroup
            options={fontOptions}
            value={config.noteFontFamily}
            onChange={(value: NoteFontFamily) => setConfigValue("noteFontFamily", value)}
          />
          <input
            type="text"
            value={fontSearch}
            onChange={(event) => setFontSearch(event.target.value)}
            placeholder={t("settings.fontFamily.searchSystem", { defaultValue: "搜索系统字体…" })}
            className="w-full h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] text-ink-soft outline-none placeholder:text-ink-ghost/60"
          />
          <select
            value={config.noteFontFamily.startsWith("system:") ? config.noteFontFamily : ""}
            onChange={(event) =>
              setConfigValue("noteFontFamily", (event.target.value || "system") as NoteFontFamily)
            }
            className="w-full h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] text-ink-soft outline-none"
          >
            <option value="">
              {t("settings.fontFamily.systemPlaceholder", { defaultValue: "选择系统字体" })}
            </option>
            {filteredSystemFonts.map((font) => (
              <option key={font} value={`system:${font}`}>
                {font}
              </option>
            ))}
          </select>
        </SettingGroup>

        <SettingGroup label={t("settings.fontSize.editor", { defaultValue: "编辑器字号" })}>
          <RangeRow
            value={config.fontSize}
            min={8}
            max={30}
            step={1}
            format={(value) => `${value}px`}
            onChange={(value) => setConfigValue("fontSize", value)}
          />
        </SettingGroup>

        <SettingGroup label={t("settings.fontSize.surface", { defaultValue: "小窗/磁贴字号" })}>
          <RangeRow
            value={config.surfaceFontSize}
            min={8}
            max={30}
            step={1}
            format={(value) => `${value}px`}
            onChange={(value) => setConfigValue("surfaceFontSize", value)}
          />
        </SettingGroup>

        <SettingGroup label={t("settings.tileColor.label", { defaultValue: "磁贴颜色" })}>
          <SlidingButtonGroup
            options={tileColorModes}
            value={config.tileColorMode}
            onChange={(value: TileColorMode) => setConfigValue("tileColorMode", value)}
          />
          {config.tileColorMode === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={normalizeTileColor(config.tileColor)}
                onChange={(event) => setConfigValue("tileColor", event.target.value)}
                className="w-10 h-8 rounded-lg border border-paper-deep/40 bg-paper-warm/70 cursor-pointer"
              />
              <input
                type="text"
                value={config.tileColor}
                onChange={(event) => setConfigValue("tileColor", event.target.value)}
                className="min-w-0 flex-1 h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[12px] font-mono text-ink-soft outline-none"
              />
              <button
                type="button"
                onClick={() => setConfigValue("tileColor", DEFAULT_TILE_COLOR)}
                className="h-8 px-2.5 rounded-lg border border-paper-deep/45 text-[11px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 transition-colors cursor-pointer"
              >
                {t("common.default", { defaultValue: "默认" })}
              </button>
            </div>
          )}
        </SettingGroup>

        <SettingGroup label={t("settings.background.label", { defaultValue: "背景图片" })}>
          <div className="flex gap-2">
            <input
              type="text"
              value={
                (config.backgroundImagePath &&
                  (localStorage.getItem("backgroundImageName") ||
                    config.backgroundImagePath.split(/[/\\]/).pop())) ||
                t("settings.background.default", { defaultValue: "默认背景" })
              }
              readOnly
              className="min-w-0 flex-1 h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] font-mono text-ink-faint truncate"
            />
            <button
              type="button"
              onClick={() => {
                void chooseBackgroundImage().then(async (path) => {
                  if (!path) return;
                  const originalName = path.split(/[/\\]/).pop() ?? "";
                  const saved = await invoke<string>("copy_background_image", {
                    sourcePath: path,
                  });
                  localStorage.setItem("backgroundImageName", originalName);
                  setConfigValue("backgroundImagePath", saved);
                });
              }}
              className="h-8 px-3 rounded-lg border border-paper-deep/45 text-[11px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 transition-colors cursor-pointer"
            >
              {t("settings.background.choose", { defaultValue: "选择" })}
            </button>
          </div>
          <SlidingButtonGroup
            options={backgroundFits}
            value={config.backgroundFit ?? "cover"}
            onChange={(value: BackgroundFit) => setConfigValue("backgroundFit", value)}
          />
        </SettingGroup>
      </div>
    </aside>
  );
}

function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <label className="block text-[11px] text-ink-faint">{label}</label>
      {children}
    </section>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between h-10 rounded-lg px-3 bg-paper-warm/55 border border-paper-deep/35 cursor-pointer">
      <span className="text-[12px] text-ink-soft">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      <span
        className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 ${
          checked ? "bg-bamboo" : "bg-paper-deep/55"
        }`}
      >
        <span
          className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? "translate-x-[14px]" : "translate-x-0"
          }`}
        />
      </span>
    </label>
  );
}

function RangeRow({
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 h-9 rounded-lg px-2.5 bg-paper-warm/45 border border-paper-deep/25">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="flex-1 accent-bamboo cursor-pointer"
      />
      <span className="w-10 text-right text-[11px] font-mono text-ink-soft tabular-nums">
        {format(value)}
      </span>
    </div>
  );
}

function ShortcutField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] text-ink-faint">{label}</label>
      <ShortcutRecorder value={value} onChange={onChange} />
    </div>
  );
}

type ShortcutMsg = { key: string; params?: Record<string, string> } | { raw: string };

function ShortcutRecorder({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [checkState, setCheckState] = useState<"idle" | "checking" | "ok" | "warning" | "error">(
    "idle",
  );
  const [checkMsg, setCheckMsg] = useState<ShortcutMsg>({
    key: "settings.shortcut.forQuickNote",
  });
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const platform = shortcutPlatform();
  const resolveMsg = (msg: ShortcutMsg): string =>
    "raw" in msg ? msg.raw : String(t(msg.key as never, msg.params as never));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const markCleared = () => {
    requestIdRef.current += 1;
    setCheckState("idle");
    setCheckMsg({ key: "settings.shortcut.cleared" });
  };

  const checkShortcut = async (shortcut: string, save: boolean) => {
    if (!shortcut) {
      markCleared();
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setCheckState("checking");
    setCheckMsg({ key: "settings.shortcut.checking" });
    try {
      const result = await checkGlobalShortcut(shortcut);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setCheckState(result.available ? "ok" : "warning");
      setCheckMsg({
        key: `settings.shortcut.conflict.${result.conflictType}`,
        params: { shortcut },
      });
      if (result.available && save) onChange(shortcut);
    } catch (error) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setCheckState("error");
      setCheckMsg(
        error instanceof Error ? { raw: error.message } : { key: "settings.shortcut.checkFailed" },
      );
    }
  };

  const recorder = useShortcutRecorder({
    onRecord: (shortcut) => {
      if (!shortcut) {
        onChange("");
        markCleared();
      } else if (isValidGlobalShortcut(shortcut)) {
        void checkShortcut(hotkeyToConfigString(shortcut, platform), true);
      } else {
        setCheckState("warning");
        setCheckMsg({ key: "settings.shortcut.needsModifier" });
      }
    },
  });

  useEffect(() => {
    if (!recorder.isRecording) return;
    const handleClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        recorder.cancelRecording();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [recorder]);

  const liveDisplay =
    recorder.isRecording && recorder.heldKeys.length > 0
      ? formatHeldKeys(recorder.heldKeys, platform)
      : null;
  const statusClass =
    checkState === "ok"
      ? "text-bamboo"
      : checkState === "warning" || checkState === "error"
        ? "text-red-400"
        : "text-ink-ghost";

  return (
    <div ref={containerRef} className="space-y-1.5">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={recorder.startRecording}
          className={`min-w-0 flex-1 h-8 px-2.5 rounded-lg border text-[12px] text-left cursor-pointer ${
            recorder.isRecording
              ? "bg-bamboo-mist/40 border-bamboo text-bamboo"
              : "bg-paper-warm/70 border-paper-deep/40 text-ink-soft"
          }`}
        >
          {recorder.isRecording
            ? liveDisplay || t("settings.shortcut.pressHint", { defaultValue: "按下快捷键" })
            : value || t("settings.shortcut.notSet", { defaultValue: "未设置" })}
        </button>
        <button
          type="button"
          disabled={!value || recorder.isRecording}
          onClick={() => {
            recorder.cancelRecording();
            onChange("");
            markCleared();
          }}
          className="w-8 h-8 rounded-lg border border-paper-deep/45 text-ink-faint hover:text-red-400 disabled:opacity-40 cursor-pointer"
        >
          ×
        </button>
        <button
          type="button"
          disabled={!value || checkState === "checking" || recorder.isRecording}
          onClick={() => void checkShortcut(value, false)}
          className="h-8 px-3 rounded-lg border border-paper-deep/45 text-[11px] text-ink-faint hover:text-bamboo disabled:opacity-40 cursor-pointer"
        >
          {checkState === "checking"
            ? t("settings.shortcut.checkingShort", { defaultValue: "检测中" })
            : t("settings.shortcut.check", { defaultValue: "检测" })}
        </button>
      </div>
      <p className={`min-h-4 text-[11px] ${statusClass}`}>{resolveMsg(checkMsg)}</p>
    </div>
  );
}
