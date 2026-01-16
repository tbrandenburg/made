const ACCESS_POLICY_BLOCK = (fileName: string) => `---
mode: restricted
file: ${fileName}
access_policy: >
  By default, you may access ONLY the referenced file if needed.
  All other files are inaccessible unless the prompt explicitly
  requests broader access.
  If required information is not accessible under the default scope,
  respond with: "Not answerable with the provided files."
---`;

export const appendRestrictedAccessPolicy = (
  message: string,
  fileName: string,
): string => {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;
  return `${trimmed}\n\n${ACCESS_POLICY_BLOCK(fileName)}`;
};
