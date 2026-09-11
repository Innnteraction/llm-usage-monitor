import { APP_NAME, APP_VERSION, getMessages, type Locale } from "../shared/index";
import { getLaunchAtLoginLabel } from "./platform/index";

export interface TrayMenuActions {
  open(): void;
  refresh(): void;
  setLaunchAtLogin(enabled: boolean): Promise<void> | void;
  resetPosition?(): void;
  quit(): void;
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
) => {
  const messages = getMessages(locale).tray;
  return [
    { label: `${APP_NAME} v${APP_VERSION}`, enabled: false },
    { type: "separator" as const },
    { label: messages.open, click: actions.open },
    { label: messages.refresh, click: actions.refresh },
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
