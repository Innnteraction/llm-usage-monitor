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
) => [
  { label: "열기", click: actions.open },
  { label: "새로고침", click: actions.refresh },
  ...(actions.resetPosition
    ? [{ label: "기본 위치로 재설정", click: actions.resetPosition }]
    : []),
  {
    label: "Windows 로그인 시 시작",
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
  { label: "종료", click: actions.quit },
];
