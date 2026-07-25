
import React, { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';
import MediaViewer from './MediaViewer';

type MediaType = 'image' | 'video';

interface MediaViewerContextType {
    openViewer: (type: MediaType, src: string, title?: string) => void;
    openAssetPreview?: (assetId: string) => void;
    closeViewer: () => void;
}

const MediaViewerContext = createContext<MediaViewerContextType | undefined>(undefined);

export const MediaViewerProvider = ({
    children,
    onOpenAssetPreview,
}: {
    children: ReactNode;
    onOpenAssetPreview?: (assetId: string) => void;
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [type, setType] = useState<MediaType>('image');
    const [src, setSrc] = useState('');
    const [title, setTitle] = useState('');

    const openViewer = useCallback((type: MediaType, src: string, title?: string) => {
        setType(type);
        setSrc(src);
        setTitle(title || '');
        setIsOpen(true);
    }, []);

    const closeViewer = useCallback(() => {
        setIsOpen(false);
        // Clear src after animation to prevent flickering, but for simplicity we can just leave it
        // or use a timeout. For now, let's keep it simple.
    }, []);
    const value = useMemo(
        () => ({ openViewer, openAssetPreview: onOpenAssetPreview, closeViewer }),
        [closeViewer, onOpenAssetPreview, openViewer],
    );

    return (
        <MediaViewerContext.Provider value={value}>
            {children}
            <MediaViewer
                isOpen={isOpen}
                onClose={closeViewer}
                type={type}
                src={src}
                title={title}
            />
        </MediaViewerContext.Provider>
    );
};

export const useMediaViewer = () => {
    const context = useContext(MediaViewerContext);
    if (context === undefined) {
        throw new Error('useMediaViewer must be used within a MediaViewerProvider');
    }
    return context;
};
