import React from "react";

export const RecurringTasksIcon: React.FC<React.SVGProps<SVGSVGElement>> = (
  props,
) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="4" y="5" width="11" height="14" rx="2" />
      <path d="m7.5 9 1.4 1.4L11 8.2" />
      <path d="m7.5 13 1.4 1.4L11 12.2" />
      <path d="M16.8 9.4a4.2 4.2 0 1 1-1 8.28" />
      <path d="m15.6 16.8.2 1.95 1.85-.66" />
    </svg>
  );
};
