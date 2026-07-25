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
      className={`inline-flex items-center gap-1 font-display font-bold leading-none tracking-tighter text-slate-950 dark:text-slate-50 ${className}`}
    >
      <span aria-hidden="true">Clash</span>
      <span
        aria-hidden="true"
        className="clash-wordmark-slash inline-block h-[0.82em] w-[0.16em] origin-center -skew-x-[20deg] rounded-full bg-brand"
      />
    </span>
  );
}
