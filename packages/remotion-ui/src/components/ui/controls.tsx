import React from 'react';

export type TimelineIconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const TimelineIconButton = React.forwardRef<HTMLButtonElement, TimelineIconButtonProps>(
  function TimelineIconButton({ type = 'button', ...props }, ref) {
    return <button ref={ref} type={type} {...props} />;
  },
);

export type TimelineRangeInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const TimelineRangeInput = React.forwardRef<HTMLInputElement, TimelineRangeInputProps>(
  function TimelineRangeInput(props, ref) {
    return <input ref={ref} type="range" {...props} />;
  },
);

export type TimelineTextInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const TimelineTextInput = React.forwardRef<HTMLInputElement, TimelineTextInputProps>(
  function TimelineTextInput(props, ref) {
    return <input ref={ref} type="text" {...props} />;
  },
);

export type TimelineColorInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const TimelineColorInput = React.forwardRef<HTMLInputElement, TimelineColorInputProps>(
  function TimelineColorInput(props, ref) {
    return <input ref={ref} type="color" {...props} />;
  },
);
