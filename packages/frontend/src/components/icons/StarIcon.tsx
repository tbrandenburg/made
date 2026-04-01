import React from "react";

interface StarIconProps {
  filled?: boolean;
}

export const StarIcon: React.FC<StarIconProps> = ({ filled = false }) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "white" : "none"}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M12 3.5L14.86 9.29L21.25 10.22L16.62 14.73L17.72 21.1L12 18.09L6.28 21.1L7.38 14.73L2.75 10.22L9.14 9.29L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
};
