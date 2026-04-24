
import React, { createContext, useContext, useState, ReactNode } from 'react';
import MediaViewer from './MediaViewer';

type MediaType = 'image' | 'video';

interface MediaViewerContextType {
    openViewer: (type: MediaType, src: string, title?: string) => void;
    closeViewer: () => void;
}

const MediaViewerContext = createContext<MediaViewerContextType | undefined>(undefined);

export const MediaViewerProvider = ({ children }: { children: ReactNode }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [type, setType] = useState<MediaType>('image');
    const [src, setSrc] = useState('');
    const [title, setTitle] = useState('');

    const openViewer = (type: MediaType, src: string, title?: string) => {
        setType(type);
        setSrc(src);
        setTitle(title || '');
        setIsOpen(true);
    };

    const closeViewer = () => {
        setIsOpen(false);
        // Clear src after animation to prevent flickering, but for simplicity we can just leave it
        // or use a timeout. For now, let's keep it simple.
    };

    return (
        <MediaViewerContext.Provider value={{ openViewer, closeViewer }}>
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
