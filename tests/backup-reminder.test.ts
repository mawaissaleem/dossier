import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { saveReminderDays } from "@/app/actions/backup";
import { backupReminder, DEFAULT_REMINDER_DAYS, parseReminderDays, reminderDaysOrDefault, reminderMessage } from "@/lib/backup-reminder";
import { getBackupReminder, getReminderDays, recordBackup, REMINDER_DAYS_KEY, setReminderDays } from "@/lib/db/backup";
import { applications, settings, tracks } from "@/lib/db/schema";
import { setSetting } from "@/lib/db/settings";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

const DAY = 86_400_000;
const now = new Date("2026-11-10T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const rule = (lastBackupAt: string | null, hasApplications = true, intervalDays = 7) => backupReminder({ lastBackupAt, intervalDays, now, hasApplications });

describe("backupReminder (pure)", () => {
  it("is not overdue at exactly N days, overdue just past it", () => {
    expect(rule(ago(7 * DAY))).toBeNull();
    expect(rule(ago(7 * DAY + 1))).toEqual({ kind: "overdue", days: 7 });
    expect(rule(ago(3 * DAY))).toBeNull();
    expect(rule(ago(10.9 * DAY))).toEqual({ kind: "overdue", days: 10 });
  });
  it("uses the given interval", () => {
    expect(rule(ago(3 * DAY), true, 2)).toEqual({ kind: "overdue", days: 3 });
    expect(rule(ago(3 * DAY), true, 3)).toBeNull();
  });
  it("never backed up: reminds only when the app holds applications", () => {
    expect(rule(null, true)).toEqual({ kind: "never" });
    expect(rule(null, false)).toBeNull();
  });
  it("garbled last-backup time counts as never", () => {
    expect(rule("not a date", true)).toEqual({ kind: "never" });
    expect(rule("not a date", false)).toBeNull();
  });
  it("a future-dated last backup (clock moved back) is not overdue", () => {
    expect(rule(new Date(now.getTime() + 30 * DAY).toISOString())).toBeNull();
  });
  it("words the message", () => {
    expect(reminderMessage({ kind: "never" })).toMatch(/never backed up/);
    expect(reminderMessage({ kind: "overdue", days: 1 })).toBe("Your last backup was 1 day ago.");
    expect(reminderMessage({ kind: "overdue", days: 9 })).toBe("Your last backup was 9 days ago.");
  });
});

describe("parseReminderDays (pure)", () => {
  it("accepts whole numbers 1..365, as number or digit string", () => {
    for (const v of [1, 7, 365, "1", " 30 ", "365"]) expect(parseReminderDays(v).ok).toBe(true);
    expect(parseReminderDays(" 30 ")).toEqual({ ok: true, days: 30 });
  });
  it("refuses everything else", () => {
    for (const v of [0, 366, -1, 1.5, NaN, Infinity, "", "0", "366", "1.5", "-3", "1e2", "abc", "7 days", "00007x", null, undefined, {}, [7], true]) {
      expect(parseReminderDays(v).ok, String(v)).toBe(false);
    }
  });
  it("falls back to the default for a stored value that is not valid", () => {
    expect(reminderDaysOrDefault(14)).toBe(14);
    for (const v of [undefined, "x", 0, 9999, 2.5, null]) expect(reminderDaysOrDefault(v)).toBe(DEFAULT_REMINDER_DAYS);
  });
});

let db: ReturnType<typeof useTestDb>;
beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
});
afterEach(dropTestDb);

const addApplication = () => {
  const t = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get();
  db.insert(applications).values({ userId: "local", trackId: t.id, title: "Acme" }).run();
};

describe("reminder interval (data layer)", () => {
  it("defaults to 7, saves, and is stored owned by the user", async () => {
    expect(await getReminderDays()).toBe(7);
    expect(await setReminderDays("14")).toEqual({ ok: true, days: 14 });
    expect(await getReminderDays()).toBe(14);
    expect(db.select().from(settings).all().find((s) => s.key === REMINDER_DAYS_KEY)).toMatchObject({ userId: "local", value: "14" });
  });
  it("refuses invalid input and keeps the old value", async () => {
    await setReminderDays(10);
    for (const v of [0, 400, "x", 2.5]) expect((await setReminderDays(v)).ok).toBe(false);
    expect(await getReminderDays()).toBe(10);
  });
  it("a hand-edited stored value falls back to the default", async () => {
    await setSetting(REMINDER_DAYS_KEY, "lots");
    expect(await getReminderDays()).toBe(7);
  });
});

describe("getBackupReminder (data layer)", () => {
  it("fresh empty install: nothing; with an application and no backup: never", async () => {
    expect(await getBackupReminder(now)).toBeNull();
    addApplication();
    expect(await getBackupReminder(now)).toEqual({ kind: "never" });
  });
  it("overdue by the saved interval, cleared by a new backup", async () => {
    addApplication();
    await recordBackup(new Date(ago(10 * DAY)));
    expect(await getBackupReminder(now)).toEqual({ kind: "overdue", days: 10 });
    await setReminderDays(30);
    expect(await getBackupReminder(now)).toBeNull();
    await setReminderDays(7);
    await recordBackup(now);
    expect(await getBackupReminder(now)).toBeNull();
  });
});

describe("saveReminderDays (action)", () => {
  it("saves and refreshes", async () => {
    expect(await saveReminderDays("21")).toEqual({ ok: true, days: 21 });
    expect(await getReminderDays()).toBe(21);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("refuses bad input without saving or refreshing", async () => {
    const r = await saveReminderDays("0");
    expect(!r.ok && r.error).toMatch(/whole number of days from 1 to 365/);
    expect(await getReminderDays()).toBe(7);
    expect(refresh).not.toHaveBeenCalled();
  });
});
