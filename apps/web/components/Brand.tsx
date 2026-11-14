import Link from "next/link";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className={`brand ${light ? "brand--light" : ""}`} aria-label="Rasmalai home">
      <span className="brand-mark" aria-hidden="true">
        <span /><span /><span /><span />
      </span>
      <span className="brand-name">rasmalai<span className="brand-period">.</span></span>
    </Link>
  );
}
