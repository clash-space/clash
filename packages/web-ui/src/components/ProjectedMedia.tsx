import { resolveAssetMediaUrl } from "../features/assets/media-url";

/** Media elements that consume only current-Host URL projections. */
type ImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string;
};
type VideoProps = Omit<React.VideoHTMLAttributes<HTMLVideoElement>, "src"> & {
  src?: string;
};
type AudioProps = Omit<React.AudioHTMLAttributes<HTMLAudioElement>, "src"> & {
  src?: string;
};

export function ProjectedImage({ src, alt, ...props }: ImageProps) {
  const url = resolveAssetMediaUrl(src);
  if (!url) return null;
  /* eslint-disable-next-line @next/next/no-img-element */
  return <img src={url} alt={alt || ""} {...props} />;
}

export function ProjectedVideo({ src, ...props }: VideoProps) {
  const url = resolveAssetMediaUrl(src);
  if (!url) return null;
  return <video src={url} {...props} />;
}

export function ProjectedAudio({ src, ...props }: AudioProps) {
  const url = resolveAssetMediaUrl(src);
  if (!url) return null;
  return <audio src={url} {...props} />;
}
