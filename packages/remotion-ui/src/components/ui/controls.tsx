import React from 'react';

export type TimelineIconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const TimelineIconButton = React.forwardRef<HTMLButtonElement, TimelineIconButtonProps>(
  function TimelineIconButton({ type = 'button', ...props }, ref) {
    return <button ref={ref} type={type} {...props} />;
  },
);

export const RemotionIconButton = TimelineIconButton;

export type RemotionButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const RemotionButton = React.forwardRef<HTMLButtonElement, RemotionButtonProps>(
  function RemotionButton({ type = 'button', ...props }, ref) {
    return <button ref={ref} type={type} {...props} />;
  },
);

export type RemotionFileInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const RemotionFileInput = React.forwardRef<HTMLInputElement, RemotionFileInputProps>(
  function RemotionFileInput(props, ref) {
    return <input ref={ref} type="file" {...props} />;
  },
);

export type RemotionInputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const RemotionInput = React.forwardRef<HTMLInputElement, RemotionInputProps>(
  function RemotionInput(props, ref) {
    return <input ref={ref} {...props} />;
  },
);

export type RemotionSelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const RemotionSelect = React.forwardRef<HTMLSelectElement, RemotionSelectProps>(
  function RemotionSelect(props, ref) {
    return <select ref={ref} {...props} />;
  },
);

export type RemotionTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const RemotionTextarea = React.forwardRef<HTMLTextAreaElement, RemotionTextareaProps>(
  function RemotionTextarea(props, ref) {
    return <textarea ref={ref} {...props} />;
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
