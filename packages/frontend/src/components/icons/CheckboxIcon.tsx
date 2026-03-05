import React from "react";

type CheckboxIconProps = {
  checked: boolean;
};

export const CheckboxIcon: React.FC<CheckboxIconProps> = ({ checked }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <rect x="3" y="3" width="14" height="14" rx="2" />
    {checked && <path d="M6.5 10.5 9 13l4.5-5" strokeLinecap="round" strokeLinejoin="round" />}
  </svg>
);
