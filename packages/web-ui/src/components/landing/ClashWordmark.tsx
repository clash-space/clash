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
      <img
        src="/brand/logo-mark.svg"
        alt=""
        aria-hidden="true"
        className="h-[1.15em] w-[1.15em] shrink-0 object-contain dark:hidden"
        draggable={false}
      />
      <img
        src="/brand/logo-mark-dark.svg"
        alt=""
        aria-hidden="true"
        className="hidden h-[1.15em] w-[1.15em] shrink-0 object-contain dark:block"
        draggable={false}
      />
      <span aria-hidden="true">Clash</span>
    </span>
  );
}
