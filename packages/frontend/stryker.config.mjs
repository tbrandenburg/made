export default {
  mutate: [
    "src/**/*.ts",
    "src/**/*.tsx",
    "!src/**/*.test.*",
    "!src/**/*.spec.*",
  ],
  testRunner: "vitest",
  reporters: ["html", "json", "progress"],
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
};
