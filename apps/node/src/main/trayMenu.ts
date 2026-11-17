import {
  APP_NAME,
  APP_VERSION,
  MAX_UPDATE_INTERVAL_MINUTES,
  MIN_UPDATE_INTERVAL_MINUTES,
  getMessages,
  type Locale,
} from "../shared/index";
import { getLaunchAtLoginLabel } from "./platform/index";

export interface TrayMenuActions {
  open(): void;
  refresh(): void;
  setLaunchAtLogin(enabled: boolean): Promise<void> | void;
  setUpdateInterval?(minutes: number): Promise<void> | void;
  setPauseWhenHidden?(enabled: boolean): Promise<void> | void;
  resetPosition?(): void;
  quit(): void;
}

export interface TrayMenuOptions {
  getUpdateIntervalMinutes?: () => number;
  getPauseWhenHidden?: () => boolean;
}

export interface BeforeQuitEvent {
  preventDefault(): void;
}

export const createBeforeQuitHandler = ({
  hide,
  shutdown,
  quit,
}: {
  hide(): void;
  shutdown(): Promise<void>;
  quit(): void;
}) => {
  let quittingAllowed = false;
  let shutdownPromise: Promise<void> | undefined;
  let quitScheduled = false;

  return (event: BeforeQuitEvent): void => {
    hide();
    if (quittingAllowed) return;
    event.preventDefault();
    shutdownPromise ??= shutdown();
    if (quitScheduled) return;
    quitScheduled = true;
    void shutdownPromise
      .catch(() => undefined)
      .finally(() => {
        quittingAllowed = true;
        quit();
      });
  };
};

export const createTrayMenuTemplate = (
  getLaunchAtLogin: () => boolean,
  actions: TrayMenuActions,
  platform: NodeJS.Platform = process.platform,
  locale: Locale = "en",
  options?: TrayMenuOptions,
) => {
  const messages = getMessages(locale).tray;
  const currentInterval = options?.getUpdateIntervalMinutes?.();
  const intervalSubmenu =
    actions.setUpdateInterval && typeof currentInterval === "number"
      ? [
          {
            label: messages.updateInterval,
            submenu: Array.from(
              { length: MAX_UPDATE_INTERVAL_MINUTES - MIN_UPDATE_INTERVAL_MINUTES + 1 },
              (_, index) => {
                const minutes = MIN_UPDATE_INTERVAL_MINUTES + index;
                return {
                  label: messages.intervalMinutes(minutes),
                  type: "radio" as const,
                  checked: currentInterval === minutes,
                  click: () => {
                    void Promise.resolve()
                      .then(() => actions.setUpdateInterval?.(minutes))
                      .catch(() => undefined);
                  },
                };
              },
            ),
          },
        ]
      : [];
  const pauseWhenHiddenItem =
    actions.setPauseWhenHidden && options?.getPauseWhenHidden
      ? [
          {
            label: messages.pauseWhenHidden,
            type: "checkbox" as const,
            checked: options.getPauseWhenHidden(),
            click: (menuItem: { checked: boolean }) => {
              const requested = menuItem.checked;
              void Promise.resolve()
                .then(() => actions.setPauseWhenHidden?.(requested))
                .catch(() => undefined);
            },
          },
        ]
      : [];

  return [
    { label: `${APP_NAME} v${APP_VERSION}`, enabled: false },
    { type: "separator" as const },
    { label: messages.open, click: actions.open },
    { label: messages.refresh, click: actions.refresh },
    ...intervalSubmenu,
    ...pauseWhenHiddenItem,
    ...(actions.resetPosition
      ? [{ label: messages.resetPosition, click: actions.resetPosition }]
      : []),
    {
      label: getLaunchAtLoginLabel(platform, locale),
      type: "checkbox" as const,
      checked: getLaunchAtLogin(),
      click: (menuItem: { checked: boolean }) => {
        const requestedChecked = menuItem.checked;
        void Promise.resolve()
          .then(() => actions.setLaunchAtLogin(requestedChecked))
          .catch(() => undefined)
          .then(() => {
            try {
              menuItem.checked = getLaunchAtLogin();
            } catch {
              // The existing menu item remains usable when the OS setting is unavailable.
            }
          });
      },
    },
    { type: "separator" as const },
    { label: messages.quit, click: actions.quit },
  ];
};
