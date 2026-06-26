import React from "react";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Generic skeleton placeholder that reserves layout space during async loads.
 * Use the higher-level CSS skeleton classes (e.g. .file-tree-skeleton) for
 * complex multi-element patterns; use this component for simple single-element
 * placeholders.
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  width,
  height,
  borderRadius,
  className = "",
  style,
}) => (
  <span
    className={`skeleton ${className}`}
    style={{
      width,
      height,
      borderRadius,
      ...style,
    }}
    aria-hidden="true"
  />
);
