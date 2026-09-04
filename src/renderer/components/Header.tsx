import type { FC, RefObject } from "react";

export interface HeaderProps {
  headerRef: RefObject<HTMLElement | null>;
  refreshing: boolean;
  onRefresh: () => void;
  disabled: boolean;
}

export const Header: FC<HeaderProps> = ({
  headerRef,
  refreshing,
  onRefresh,
  disabled,
}) => {
  return (
    <header ref={headerRef} className="app-header">
      <h1>LLM Usage Monitor</h1>
      <button
        type="button"
        className={`refresh-button${refreshing ? " is-refreshing" : ""}`}
        onClick={onRefresh}
        disabled={disabled}
      >
        {refreshing ? (
          <span className="cli-shimmer-text">refreshing...</span>
        ) : (
          "refresh"
        )}
      </button>
    </header>
  );
};
