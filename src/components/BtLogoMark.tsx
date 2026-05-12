type BtLogoMarkProps = {
  className?: string;
};

const snowballStroke = "#B8872E";

export function BtLogoMark({ className }: BtLogoMarkProps) {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <clipPath id="bt-logo-mountain-clip">
          <path d="M10 47L27 18L38 38L45 28L55 47Z" />
        </clipPath>
      </defs>
      <circle
        cx="32"
        cy="32"
        r="29"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        d="M10 47L27 18L38 38L45 28L55 47"
        stroke="currentColor"
        strokeWidth="3.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 34C23 36 27 39 30 42C33 44 36 46 39 47"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        clipPath="url(#bt-logo-mountain-clip)"
      />
      <path
        d="M34.2 47.8C34.7 44.8 37.4 42.8 40.4 43.5C43.2 44.1 45.1 46.5 44.5 49.4C43.9 52.5 41.2 54.2 38.2 53.5C35.4 52.9 33.7 50.6 34.2 47.8Z"
        fill={snowballStroke}
      />
    </svg>
  );
}
