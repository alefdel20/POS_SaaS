import { CSSProperties } from "react";

const PUBLIC_ANKODE_LOGO_PATH = "/favicon.png";

type AnkodeLogoProps = {
  size?: number | string;
  className?: string;
  variant?: "full" | "icon";
  alt?: string;
};

export function AnkodeLogo({ size = 48, className, variant = "icon", alt = "Ankode" }: AnkodeLogoProps) {
  const resolvedSize = typeof size === "number" ? `${size}px` : size;
  const isFull = variant === "full";
  const style: CSSProperties = {
    width: resolvedSize,
    height: isFull ? "auto" : resolvedSize
  };
  const src = PUBLIC_ANKODE_LOGO_PATH;
  const resolvedAlt = alt || (isFull ? "ANKODE" : "ANKODE K");

  return (
    <img
      alt={resolvedAlt}
      className={className}
      draggable={false}
      loading="eager"
      src={src}
      style={style}
    />
  );
}
