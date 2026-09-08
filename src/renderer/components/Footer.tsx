import type { FC, RefObject } from "react";

export interface FooterProps {
  footerRef: RefObject<HTMLElement | null>;
}

export const Footer: FC<FooterProps> = ({ footerRef }) => {
  return <footer ref={footerRef} className="app-footer" aria-hidden="true" />;
};
