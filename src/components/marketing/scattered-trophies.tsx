import Image from "next/image";
import kivoTrophyCrown from "../../../public/brand/kivo-trophy-crown.webp";

// Hand-placed, not tiled — a repeating grid reads as a mistake. Small, low
// opacity, and scattered rather than arranged in a pattern, per the brand
// direction: visible enough to register as texture, never competing with
// real content. The artwork is portrait (2:3), so each size below is a
// width; height follows from next/image's own aspect-ratio handling.
const SCATTERED: { size: number; top: string; left?: string; right?: string; opacity: number; rotate: number }[] = [
  { size: 34, top: "6%", left: "3%", opacity: 0.16, rotate: -6 },
  { size: 22, top: "16%", left: "11%", opacity: 0.1, rotate: 8 },
  { size: 44, top: "30%", left: "1%", opacity: 0.14, rotate: -4 },
  { size: 26, top: "46%", left: "8%", opacity: 0.11, rotate: 5 },
  { size: 20, top: "57%", left: "2%", opacity: 0.09, rotate: -9 },
  { size: 30, top: "70%", left: "6%", opacity: 0.13, rotate: 4 },
  { size: 24, top: "84%", left: "12%", opacity: 0.1, rotate: -5 },
  { size: 18, top: "13%", right: "4%", opacity: 0.08, rotate: 7 },
  { size: 28, top: "60%", right: "7%", opacity: 0.11, rotate: -6 },
];

export function ScatteredTrophies({ className = "" }: { className?: string }) {
  return (
    <div className={`pointer-events-none fixed inset-0 z-0 overflow-hidden ${className}`} aria-hidden="true">
      {SCATTERED.map((item, index) => (
        <div
          key={index}
          className="absolute"
          style={{
            top: item.top,
            left: item.left,
            right: item.right,
            opacity: item.opacity,
            transform: `rotate(${item.rotate}deg)`,
            width: item.size,
          }}
        >
          <Image src={kivoTrophyCrown} alt="" width={item.size} height={item.size * 1.5} className="h-auto w-full" />
        </div>
      ))}
    </div>
  );
}
