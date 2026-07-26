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
      className={`inline-flex items-baseline font-display font-semibold leading-none tracking-tight text-slate-950 dark:text-slate-50 ${className}`}
    >
      <span aria-hidden="true" className="clash-wordmark-c text-brand">
        C
      </span>
      <span aria-hidden="true" className="clash-wordmark-rest">
        lash
      </span>
    </span>
  );
}
