import { CSSProperties, useId } from "react";

type AnkodeLogoProps = {
  size?: number | string;
  className?: string;
  withBackground?: boolean;
  backgroundColor?: string;
};

export function AnkodeLogo({
  size = 48,
  className,
  withBackground = false,
  backgroundColor = "#020617"
}: AnkodeLogoProps) {
  const gradientId = useId();
  const resolvedSize = typeof size === "number" ? `${size}px` : size;
  const style: CSSProperties = {
    width: resolvedSize,
    height: resolvedSize
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      style={style}
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="70" x2="190" y1="190" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6D28D9" />
          <stop offset="55%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#22C55E" />
        </linearGradient>
      </defs>

      {withBackground ? <rect width="256" height="256" rx="40" fill={backgroundColor} /> : null}

      <rect x="42" y="20" width="30" height="210" rx="8" fill="#F8FAFC" />

      <path
        d="M72 154 L145 81 L145 56 L214 42 L200 111 L176 111 L101 186 L72 186 Z"
        fill={`url(#${gradientId})`}
      />

      <path d="M132 150 L165 150 L205 230 L170 230 L132 186 Z" fill={`url(#${gradientId})`} />
    </svg>
  );
}
