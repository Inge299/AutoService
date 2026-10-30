export const MIN_PASSWORD_LENGTH = 6;
export function isValidNewPassword(value: string): boolean {
  return value.length >= MIN_PASSWORD_LENGTH && value.length <= 256;
}
