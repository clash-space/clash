import { BrandAsset } from "../BrandAsset";

type ClashWordmarkProps = {
  className?: string;
};

export default function ClashWordmark({
  className = "",
}: ClashWordmarkProps) {
  return (
    <span
      role="img"
      aria-label="Clash"
      className={`inline-flex items-center gap-[0.3em] font-display font-semibold leading-none tracking-tight text-slate-950 dark:text-slate-50 ${className}`}
    >
      <BrandAsset
        name="mark"
        alt=""
        className="h-[1.15em] w-[1.15em] shrink-0 object-contain dark:hidden"
      />
      <BrandAsset
        name="markDark"
        alt=""
        className="hidden h-[1.15em] w-[1.15em] shrink-0 object-contain dark:block"
      />
      <span aria-hidden="true">Clash</span>
    </span>
  );
}
