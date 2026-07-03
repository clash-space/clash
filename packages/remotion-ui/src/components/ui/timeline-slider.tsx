import React from 'react';

export type TimelineSliderProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const TimelineSlider = React.forwardRef<HTMLInputElement, TimelineSliderProps>(
  function TimelineSlider({ className, ...props }, ref) {
    const sliderClassName = className ? `timeline-slider ${className}` : 'timeline-slider';

    return <input ref={ref} type="range" {...props} className={sliderClassName} />;
  },
);
