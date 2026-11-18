import { describe, expect, it } from "vitest";
import { starredIds, starredKey } from "@/lib/track-star";

describe("starredIds (pure)", () => {
  it("is the ids of the `track.<id>.starred` rows whose value is true", () => {
    expect(
      starredIds([
        { key: "track.1.starred", value: "true" },
        { key: "track.12.starred", value: " true " },
        { key: "track.2.starred", value: "false" },
        { key: "track.3.starred", value: "1" },
        { key: "track.4.starred", value: "{" },
        { key: "track.4.win_statuses", value: "true" },
        { key: "track.x.starred", value: "true" },
        { key: "track.5.starred.more", value: "true" },
        { key: "xtrack.6.starred", value: "true" },
        { key: "files_root", value: "true" },
      ]),
    ).toEqual(new Set([1, 12]));
  });
  it("nothing stored is nobody starred", () => expect(starredIds([])).toEqual(new Set()));
  it("the key is the one the delete cleanup (`track.<id>.%`) already covers", () =>
    expect(starredKey(7)).toBe("track.7.starred"));
});
