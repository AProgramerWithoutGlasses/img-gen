// Public demo credentials for the local preview only. Replace with server auth.
export function acceptsPreviewCredentials(username: string, password: string) {
  return ["admin", "user1"].includes(username) && password === "preview1234";
}
