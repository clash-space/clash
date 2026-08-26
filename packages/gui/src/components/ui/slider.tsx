import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';

export const Slider = forwardRef<
    ElementRef<typeof SliderPrimitive.Root>,
    ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(function Slider({ className = '', ...props }, ref) {
    return (
        <SliderPrimitive.Root
            {...props}
            ref={ref}
            className={[
                'relative flex touch-none select-none items-center',
                'focus-visible:outline-none',
                className,
            ].filter(Boolean).join(' ')}
        />
    );
});

export const SliderTrack = forwardRef<
    ElementRef<typeof SliderPrimitive.Track>,
    ComponentPropsWithoutRef<typeof SliderPrimitive.Track>
>(function SliderTrack({ className = '', ...props }, ref) {
    return (
        <SliderPrimitive.Track
            {...props}
            ref={ref}
            className={[
                'relative grow overflow-hidden',
                className,
            ].filter(Boolean).join(' ')}
        />
    );
});

export const SliderRange = forwardRef<
    ElementRef<typeof SliderPrimitive.Range>,
    ComponentPropsWithoutRef<typeof SliderPrimitive.Range>
>(function SliderRange({ className = '', ...props }, ref) {
    return (
        <SliderPrimitive.Range
            {...props}
            ref={ref}
            className={[
                'absolute',
                className,
            ].filter(Boolean).join(' ')}
        />
    );
});

export const SliderThumb = forwardRef<
    ElementRef<typeof SliderPrimitive.Thumb>,
    ComponentPropsWithoutRef<typeof SliderPrimitive.Thumb>
>(function SliderThumb({ className = '', ...props }, ref) {
    return (
        <SliderPrimitive.Thumb
            {...props}
            ref={ref}
            className={[
                'block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface',
                className,
            ].filter(Boolean).join(' ')}
        />
    );
});
