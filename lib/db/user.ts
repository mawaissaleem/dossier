// The single source of user_id. Constant in v1; every query and insert takes it from here.
export function getUserId(): string {
  return "local";
}
