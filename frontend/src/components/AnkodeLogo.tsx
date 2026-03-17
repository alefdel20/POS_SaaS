import { CSSProperties } from "react";
import ankodeFullLogo from "../assets/ankode-full.png";
import ankodeIconLogo from "../assets/ankode-k.png";

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
  const src = isFull ? ankodeFullLogo : ankodeIconLogo;
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
