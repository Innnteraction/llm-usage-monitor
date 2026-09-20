import { useLayoutEffect, useRef } from "react";

export interface UseWindowAutoResizeOptions {
  appShellRef: React.RefObject<HTMLElement | null>;
  providerListRef: React.RefObject<HTMLElement | null>;
  providerListContentRef: React.RefObject<HTMLDivElement | null>;
  appHeaderRef: React.RefObject<HTMLElement | null>;
  appFooterRef: React.RefObject<HTMLElement | null>;
  compactMode: boolean;
  tokensVisible: boolean;
  displayError: string;
  error: boolean;
  onResizeError(msg: string): void;
  onResizeComplete(): void;
}

export const useWindowAutoResize = ({
  appShellRef,
  providerListRef,
  providerListContentRef,
  appHeaderRef,
  appFooterRef,
  compactMode,
  tokensVisible,
  displayError,
  error,
  onResizeError,
  onResizeComplete,
}: UseWindowAutoResizeOptions) => {
  const resizeFrame = useRef<number | undefined>(undefined);
  const lastWindowSizeRequest = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const shell = appShellRef.current;
    const providerList = providerListRef.current;
    const content = providerListContentRef.current;
    const header = appHeaderRef.current;
    const footer = appFooterRef.current;
    if (!shell || !providerList || !content || !header || !footer) return;
    let active = true;

    const requestSize = (): void => {
      if (resizeFrame.current !== undefined) {
        window.cancelAnimationFrame(resizeFrame.current);
      }
      resizeFrame.current = window.requestAnimationFrame(() => {
        const shellBounds = shell.getBoundingClientRect();
        const listBounds = providerList.getBoundingClientRect();
        const footerBounds = footer.getBoundingClientRect();
        const shellStyle = getComputedStyle(shell);
        const footerStyle = getComputedStyle(footer);
        const footerMarginTop = Number.parseFloat(footerStyle.marginTop) || 0;
        const paddingBottom = Number.parseFloat(shellStyle.paddingBottom) || 0;
        const contentHeight = Math.min(
          4096,
          Math.ceil(
            listBounds.top -
              shellBounds.top +
              content.scrollHeight +
              footerMarginTop +
              footerBounds.height +
              paddingBottom +
              4,
          ),
        );
        const requestKey = `${compactMode}:${tokensVisible}:${contentHeight}`;
        if (lastWindowSizeRequest.current === requestKey) return;
        lastWindowSizeRequest.current = requestKey;
        void window.usageMonitor
          .setTokensVisible(tokensVisible, contentHeight)
          .catch(() => {
            if (active) onResizeError("Failed to adjust window height.");
          })
          .finally(() => {
            if (active) {
              onResizeComplete();
            }
          });
      });
    };

    requestSize();
    const observer = new ResizeObserver(requestSize);
    observer.observe(content);
    observer.observe(header);
    observer.observe(footer);
    return () => {
      active = false;
      if (resizeFrame.current !== undefined) {
        window.cancelAnimationFrame(resizeFrame.current);
      }
      observer.disconnect();
    };
  }, [
    appFooterRef,
    appHeaderRef,
    appShellRef,
    compactMode,
    displayError,
    error,
    onResizeComplete,
    onResizeError,
    providerListContentRef,
    providerListRef,
    tokensVisible,
  ]);
};
