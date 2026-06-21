// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { AppConfig } from "../features/settings/types";
import { SettingsPanel } from "./SettingsPanel";

vi.mock("../features/settings/api", () => ({
  checkGlobalShortcut: vi.fn(),
  chooseBackgroundImage: vi.fn(),
  listSystemFonts: vi.fn(() => Promise.resolve([])),
}));

function testConfig(backgroundImagePath = "C:\\data\\backgrounds\\background.png"): AppConfig {
  return {
    locale: "zh-CN",
    dataDir: "C:\\data",
    globalShortcut: "Ctrl+Shift+N",
    closeToTray: true,
    autostart: false,
    defaultViewMode: "split",
    noteAutoSave: true,
    noteSurfaceAutoSave: true,
    tileColor: "#fdf6e3",
    tileColorMode: "system",
    theme: "system",
    fontSize: 14,
    surfaceFontSize: 14,
    noteFontFamily: "system",
    tabIndentSize: 2,
    externalFileAutoSave: true,
    rememberSurfaceSize: true,
    tileCtrlClose: true,
    tileRenderMarkdown: false,
    renderHtmlMarkdown: false,
    splitScrollSync: true,
    toggleVisibilityShortcut: "Ctrl+Shift+M",
    openAtCursor: true,
    backgroundImagePath,
    backgroundFit: "cover",
    backgroundDim: 0.25,
    backgroundBlur: 6,
  };
}

function renderSettings(config: AppConfig): string {
  return renderToStaticMarkup(
    <SettingsPanel
      config={config}
      onChange={vi.fn()}
      onMigrateDataDir={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe("SettingsPanel background controls", () => {
  test("shows remove, transparency, and blur controls for a selected background", () => {
    const markup = renderSettings(testConfig());

    expect(markup).toContain("移除");
    expect(markup).toContain("透明度");
    expect(markup).toContain("25%");
    expect(markup).toContain("模糊度");
    expect(markup).toContain("6px");
  });

  test("hides background adjustments when no image is selected", () => {
    const markup = renderSettings(testConfig(""));

    expect(markup).not.toContain("移除");
    expect(markup).not.toContain("透明度");
    expect(markup).not.toContain("模糊度");
  });
});
