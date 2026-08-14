import Image from "next/image";
import type { LucideIcon } from "lucide-react";

interface ComingSoonProps {
  icon: LucideIcon;
  /** 3D icon path from the sliced asset library — used in place of the vector
   * icon when a manifest icon unambiguously matches this feature. */
  image?: string;
  title: string;
  description: string;
}

export function ComingSoon({ icon: Icon, image, title, description }: ComingSoonProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      {image ? (
        <Image src={image} alt="" width={96} height={96} className="h-24 w-24" />
      ) : (
        <div className="kivo-gradient-intelligence flex h-16 w-16 items-center justify-center rounded-2xl">
          <Icon className="h-8 w-8 text-kivo-white" strokeWidth={1.75} />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-kivo-cyan">Coming soon</span>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      </div>
      <p className="max-w-md text-sm leading-relaxed text-foreground-muted">{description}</p>
    </div>
  );
}
