// Pure: server actions run on any POST, so ids are checked at the boundary with this one helper.
export const isId = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 1;
