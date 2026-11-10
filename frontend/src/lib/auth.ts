export const PASSWORD_MAX_BYTES = 128;
export const REGISTRATION_MIN_BYTES = 8;
export const LOGIN_MIN_BYTES = 4;
export const USERNAME_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{2,31}$/;

export function passwordBytes(password: string) {
  return new TextEncoder().encode(password).length;
}

export function passwordLengthError(password: string, registering = false) {
  const length = passwordBytes(password);
  const minimum = registering ? REGISTRATION_MIN_BYTES : LOGIN_MIN_BYTES;
  if (length > PASSWORD_MAX_BYTES) return "密码过长，最多 128 字节（中文等字符会占用更多长度）。";
  if (length < minimum) return registering ? "密码至少需要 8 字节。" : "密码至少需要 4 字节。";
  return "";
}
