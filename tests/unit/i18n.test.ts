import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  detectSystemLocale,
  getMessages,
  LOCALES,
} from "../../src/shared/i18n/index";

describe("i18n infrastructure", () => {
  it("defaults to English for safe and consistent layout baseline", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    const messages = getMessages();
    expect(messages.tray.open).toBe("Open");
    expect(messages.tray.quit).toBe("Quit");
    expect(messages.ui.appName).toBe("LLM Usage Monitor");
    expect(messages.errors.not_installed).toBe("CLI is not installed.");
  });

  it("provides Korean translations ready for future activation", () => {
    const koMessages = getMessages("ko");
    expect(koMessages.tray.open).toBe("열기");
    expect(koMessages.tray.quit).toBe("종료");
    expect(koMessages.errors.not_installed).toBe("CLI가 설치되어 있지 않습니다.");
    expect(koMessages.ui.additionalLimits(3)).toBe("+3개 추가 한도");
  });

  it("detects system locale while respecting canonical English layout policy", () => {
    expect(detectSystemLocale({ LANG: "en_US.UTF-8" })).toBe("en");
    expect(detectSystemLocale({ LANG: "ko_KR.UTF-8" })).toBe("en");
  });

  it("ensures all locale bundles have identical key structures", () => {
    const enKeys = Object.keys(LOCALES.en);
    const koKeys = Object.keys(LOCALES.ko);
    expect(koKeys).toEqual(enKeys);

    const enErrorKeys = Object.keys(LOCALES.en.errors);
    const koErrorKeys = Object.keys(LOCALES.ko.errors);
    expect(koErrorKeys).toEqual(enErrorKeys);

    const enTrayKeys = Object.keys(LOCALES.en.tray);
    const koTrayKeys = Object.keys(LOCALES.ko.tray);
    expect(koTrayKeys).toEqual(enTrayKeys);
  });
});
