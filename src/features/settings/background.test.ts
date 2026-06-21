import { describe, expect, test } from "vitest";
import {
  backgroundDimFromTransparency,
  backgroundTransparencyPercent,
  normalizeBackgroundBlur,
} from "./background";

describe("background settings", () => {
  test("maps the persisted dim value to a transparency percentage", () => {
    expect(backgroundTransparencyPercent()).toBe(25);
    expect(backgroundTransparencyPercent(0.6)).toBe(60);
    expect(backgroundTransparencyPercent(2)).toBe(100);
  });

  test("maps the transparency slider back to a persisted dim value", () => {
    expect(backgroundDimFromTransparency(35)).toBe(0.35);
    expect(backgroundDimFromTransparency(-10)).toBe(0);
    expect(backgroundDimFromTransparency(120)).toBe(1);
  });

  test("keeps background blur within the supported range", () => {
    expect(normalizeBackgroundBlur()).toBe(0);
    expect(normalizeBackgroundBlur(8)).toBe(8);
    expect(normalizeBackgroundBlur(30)).toBe(20);
  });
});
