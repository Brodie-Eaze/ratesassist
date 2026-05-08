import Link from "next/link";

export function Wordmark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const cls =
    size === "sm"
      ? "text-base"
      : size === "lg"
        ? "text-2xl"
        : "text-lg";
  return (
    <Link href="/" className={`font-semibold tracking-tight ${cls}`}>
      <span className="text-ink-900">Rates</span>
      <span className="text-accent-600">Assist</span>
    </Link>
  );
}

export function ProductBadge({ name }: { name: string }) {
  return (
    <span className="badge bg-ink-100 text-ink-600 text-[10px] uppercase tracking-widest">
      {name}
    </span>
  );
}
