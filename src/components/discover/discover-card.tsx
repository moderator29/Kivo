import Image from "next/image";
import Link from "next/link";

export function DiscoverCard({
  href,
  icon,
  label,
  count,
  countLabel,
  description,
}: {
  href: string;
  icon: string;
  label: string;
  count: number;
  countLabel: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="kivo-glass-sharp flex flex-col gap-3 rounded-2xl p-5 transition-all hover:-translate-y-0.5 hover:bg-white/[0.06]"
    >
      <Image src={icon} alt="" width={48} height={48} className="h-12 w-12 object-contain" />
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">{label}</h2>
        <p className="text-sm leading-relaxed text-foreground-muted">{description}</p>
      </div>
      <span className="text-xs font-medium text-kivo-cyan">
        {count.toLocaleString()} {countLabel}
      </span>
    </Link>
  );
}
