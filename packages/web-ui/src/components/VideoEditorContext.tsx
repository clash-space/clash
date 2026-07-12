import { createContext, useCallback, useContext, type ReactNode } from 'react';

interface VideoEditorContextType {
    openTimeline: (timelineId: string) => void;
}

const VideoEditorContext = createContext<VideoEditorContextType | undefined>(undefined);

export function VideoEditorProvider({
    children,
    onOpenTimeline,
}: {
    children: ReactNode;
    onOpenTimeline: (timelineId: string) => void;
}) {
    const openTimeline = useCallback((timelineId: string) => {
        if (!timelineId) return;
        onOpenTimeline(timelineId);
    }, [onOpenTimeline]);

    return (
        <VideoEditorContext.Provider value={{ openTimeline }}>
            {children}
        </VideoEditorContext.Provider>
    );
}

export function useVideoEditor() {
    const context = useContext(VideoEditorContext);
    if (!context) {
        throw new Error('useVideoEditor must be used within VideoEditorProvider');
    }
    return context;
}
