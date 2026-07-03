import React from 'react';

export type TimelineSliderProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const TimelineSlider = React.forwardRef<HTMLInputElement, TimelineSliderProps>(
  function TimelineSlider(props, ref) {
    return <input ref={ref} type="range" {...props} />;
  },
);
