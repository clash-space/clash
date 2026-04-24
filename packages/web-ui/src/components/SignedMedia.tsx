
import { useSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';

/**
 * Drop-in replacements for <img>, <video>, <audio> that resolve
 * R2 storageKeys to signed URLs automatically.
 *
 * Pass `src` as a storageKey ("uploads/xxx") or an existing URL — both work.
 */

type ImgProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src?: string };
type VideoProps = Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'> & { src?: string };
type AudioProps = Omit<React.AudioHTMLAttributes<HTMLAudioElement>, 'src'> & { src?: string };

export function SignedImg({ src, alt, ...props }: ImgProps) {
    const url = useSignedUrl(src);
    if (!url) return null;
    /* eslint-disable-next-line @next/next/no-img-element */
    return <img src={url} alt={alt || ''} {...props} />;
}

export function SignedVideo({ src, ...props }: VideoProps) {
    const url = useSignedUrl(src);
    if (!url) return null;
    return <video src={url} {...props} />;
}

export function SignedAudio({ src, ...props }: AudioProps) {
    const url = useSignedUrl(src);
    if (!url) return null;
    return <audio src={url} {...props} />;
}
