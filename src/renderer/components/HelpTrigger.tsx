import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FC,
  type ReactNode,
} from "react";
import { placeTooltip } from "../presentation";

export interface HelpTriggerProps {
  id: string;
  label: ReactNode;
  value?: string;
  description: ReactNode;
  tone?: "neutral" | "input" | "output" | "cache" | "partial";
  className?: string;
  testId?: string;
  activeHelp?: string;
  onActiveHelpChange(id?: string): void;
  onClick?: () => void;
  ariaLabel?: string;
  ariaPressed?: boolean;
  ariaKeyshortcuts?: string;
  disabled?: boolean;
}

export const HelpTrigger: FC<HelpTriggerProps> = ({
  id,
  label,
  value,
  description,
  tone = "neutral",
  className,
  testId,
  activeHelp,
  onActiveHelpChange,
  onClick,
  ariaLabel,
  ariaPressed,
  ariaKeyshortcuts,
  disabled,
}) => {
  const tooltipId = `${id}-tooltip`;
  const isOpen = activeHelp === id;
  const helpRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const activeHelpRef = useRef<string | undefined>(undefined);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>();

  useEffect(() => {
    activeHelpRef.current = activeHelp;
  }, [activeHelp]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current || !tooltipRef.current) return;

    const updatePosition = (closeWhenHidden = false): void => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      const tooltipElement = tooltipRef.current;
      if (!anchor || !tooltipElement) return;
      const providerList = document.querySelector<HTMLElement>(".provider-list");
      const listBounds = providerList?.getBoundingClientRect();
      if (
        closeWhenHidden &&
        providerList?.contains(buttonRef.current) &&
        listBounds &&
        (anchor.bottom <= listBounds.top || anchor.top >= listBounds.bottom)
      ) {
        onActiveHelpChange(undefined);
        return;
      }
      const previousMaxHeight = tooltipElement.style.maxHeight;
      tooltipElement.style.maxHeight = "none";
      const tooltipBounds = tooltipElement.getBoundingClientRect();
      const tooltipComputed = getComputedStyle(tooltipElement);
      const naturalHeight = Math.max(
        tooltipBounds.height,
        tooltipElement.scrollHeight +
          Number.parseFloat(tooltipComputed.borderTopWidth) +
          Number.parseFloat(tooltipComputed.borderBottomWidth),
      );
      tooltipElement.style.maxHeight = previousMaxHeight;
      const isHeader = Boolean(buttonRef.current?.closest(".app-header"));
      const footerTop = document.querySelector<HTMLElement>(".app-footer")?.getBoundingClientRect().top;
      let next = placeTooltip({
        anchor,
        tooltip: { width: tooltipBounds.width, height: naturalHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        footerTop,
        preferAbove: !isHeader,
      });
      const overlapsAnotherTrigger =
        !isHeader &&
        next.placement === "below" &&
        [...document.querySelectorAll<HTMLElement>(".local-token-trigger")].some(
          (trigger) => {
            if (trigger === buttonRef.current) return false;
            const bounds = trigger.getBoundingClientRect();
            return (
              bounds.left < next.left + tooltipBounds.width &&
              bounds.right > next.left &&
              bounds.top < next.top + naturalHeight &&
              bounds.bottom > next.top
            );
          },
        );
      if (overlapsAnotherTrigger) {
        next = placeTooltip({
          anchor,
          tooltip: { width: tooltipBounds.width, height: naturalHeight },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          footerTop,
          preferAbove: true,
        });
      }
      setTooltipStyle({ left: next.left, top: next.top, maxHeight: next.maxHeight });
    };

    updatePosition();
    const providerList = document.querySelector<HTMLElement>(".provider-list");
    const closeIfScrolledOut = (): void => updatePosition(true);
    providerList?.addEventListener("scroll", closeIfScrolledOut, true);
    const reposition = (): void => updatePosition();
    window.addEventListener("resize", reposition);
    const observer = new ResizeObserver(reposition);
    observer.observe(buttonRef.current);
    observer.observe(tooltipRef.current);
    return () => {
      providerList?.removeEventListener("scroll", closeIfScrolledOut, true);
      window.removeEventListener("resize", reposition);
      observer.disconnect();
    };
  }, [description, isOpen, onActiveHelpChange]);

  const show = (): void => {
    window.clearTimeout(closeTimer.current);
    onActiveHelpChange(id);
  };

  const closeLater = (): void => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      if (
        activeHelpRef.current === id &&
        !helpRef.current?.contains(document.activeElement) &&
        !helpRef.current?.matches(":hover")
      ) {
        onActiveHelpChange(undefined);
      }
    }, 400);
  };

  return (
    <span
      ref={helpRef}
      className={`local-token-help tone-${tone}${className ? ` ${className}` : ""}`}
      onMouseEnter={show}
      onMouseLeave={closeLater}
    >
      <button
        ref={buttonRef}
        type="button"
        className="local-token-trigger"
        data-testid={testId}
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
        aria-keyshortcuts={ariaKeyshortcuts}
        aria-describedby={isOpen ? tooltipId : undefined}
        disabled={disabled}
        onClick={() => {
          if (onClick) {
            onClick();
          } else {
            show();
          }
        }}
        onFocus={show}
        onBlur={closeLater}
      >
        <span>{label}</span>
        {value ? <strong>{value}</strong> : null}
      </button>
      {isOpen ? (
        <span
          ref={tooltipRef}
          id={tooltipId}
          className="local-token-tooltip"
          role="tooltip"
          style={tooltipStyle}
        >
          {description}
        </span>
      ) : null}
    </span>
  );
};
