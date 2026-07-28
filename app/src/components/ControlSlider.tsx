import { useState } from 'react';

interface ControlSliderProps {
  label: string;
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
  unit?: string;
  onChange?: (value: number) => void;
}

/** Reusable labeled slider used by inspector panels and component parameter editors. */
export function ControlSlider({
  label,
  min,
  max,
  step = 1,
  defaultValue,
  unit = '',
  onChange,
}: ControlSliderProps) {
  const [value, setValue] = useState(defaultValue);

  return (
    <label className="vs-slider">
      <span className="vs-slider-row">
        <span>{label}</span>
        <span className="vs-slider-value">
          {value}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          setValue(v);
          onChange?.(v);
        }}
      />
    </label>
  );
}
