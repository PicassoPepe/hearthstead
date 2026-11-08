/** Organization logo, or a brand-colored initial tile when there's no logo. */
export function OrgMark({ name, logoUrl, brand, className = "size-9" }: { name: string; logoUrl?: string | null; brand: string; className?: string }) {
  if (logoUrl)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt="" className={`${className} shrink-0 rounded-lg bg-white object-contain`} />;
  return (
    <span aria-hidden className={`${className} flex shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white`} style={{ background: brand }}>
      {name.slice(0, 1)}
    </span>
  );
}
