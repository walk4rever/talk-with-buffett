import type { ReactNode } from "react";

type RoomLayoutProps = {
  rootClassName?: string;
  mainClassName?: string;
  sideClassName?: string;
  main: ReactNode;
  side: ReactNode;
  overlay?: ReactNode;
};

export function RoomLayout({
  rootClassName,
  mainClassName,
  sideClassName,
  main,
  side,
  overlay,
}: RoomLayoutProps) {
  return (
    <div className={rootClassName}>
      <section className={mainClassName}>{main}</section>
      <aside className={sideClassName}>{side}</aside>
      {overlay}
    </div>
  );
}
