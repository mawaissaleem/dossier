# Application Tracker: Software Requirements Specification (v1)

Version 0.1 (draft for review) · 29 October 2026 · Single-user, local-first

## 1. Purpose and scope

### 1.1 Purpose

This document defines what version 1 of the Application Tracker must do. Requirements are numbered (FR = functional, NFR = non-functional) so they can be ticked off during the build.

### 1.2 Problem statement

When applying to hundreds of jobs and PhD programs, each application uses customised files (CV, cover letter, SOP, and so on). When a company or professor replies weeks later, the applicant cannot quickly find exactly what was sent. Tracking is done by hand, which is slow and error-prone.

### 1.3 Goal

Track hundreds of applications without manual labour, and retrieve the exact files sent to any application in under 30 seconds.

### 1.4 In scope (v1)

- Application tracking with flexible tracks, columns, statuses, and table and board views
- File archive with automatic folders, filenames, hashes, and dated submissions
- Rule-based planner ("what should I work on next")
- Dashboard, search, notes and activity log, backup

### 1.5 Out of scope (v1)

- Creating, editing, or AI-tailoring documents (the user writes files elsewhere and uploads the final version)
- Multi-user accounts, login, hosting, phone access
- Google Drive API integration (a Drive-synced folder can be used as the files root)
- Email or push reminders
- Formulas, relations between tables, multi-select columns, custom rule builder
- Insights and charts (response rates, time per stage), offer comparison
- Watching folders for files added outside the app

## 2. Users and environment

- **User:** one person (the owner). No login screen in v1.
- **Runtime:** runs on the owner's own computer. Nothing leaves the machine.
- **Stack:** Next.js, TypeScript, Tailwind. Backend logic lives inside Next.js (server actions and route handlers). SQLite database through Drizzle or Prisma.
- **Future-proofing:** every record carries a user\_id, and database and file access go through a thin layer, so multi-user and hosting (v2) become a configuration change, not a rewrite.

## 3. Definitions

- **Track:** a category of applications with its own columns, statuses, and settings (starter tracks: Job, PhD).
- **Application:** one row in a track (for example, "Acme Corp, Data Analyst").
- **Column:** a user-defined field on a track.
- **Single-select column:** a column with a user-editable list of coloured options. Flags, priority, effort, and status are all single-select columns.
- **Files root:** the folder on disk where the app stores uploaded files.
- **Submission:** a dated record of the set of files sent for an application.
- **Engine slot:** a column designated to feed the planner (Priority, Deadline, Effort, Follow-up date).

## 4. Functional requirements

### FR-1 Tracks and applications

- FR-1.1 The app ships with two starter tracks, Job and PhD, each with default columns, statuses, and expected file labels. All are editable.
- FR-1.2 The user can create applications in a track. Only title and track are required.
- FR-1.3 The add form is generated from the track's columns, so a column added later appears in the form automatically.
- FR-1.4 Every field except title and track may be left blank and filled in later. Blank is a valid state and never an error.
- FR-1.5 The form shows essentials first (title, status, priority, deadline) with remaining fields in an expandable section.
- FR-1.6 The track's default status and any column default values are pre-filled.
- FR-1.7 Editing an application uses the same form as creating one, on its detail page.
- FR-1.8 Files can be attached at creation or later.
- FR-1.9 The user can archive or delete an application. Delete requires confirmation and states how many files will be removed.
- FR-1.10 Creating new custom tracks beyond the two starters is deferred to v2. The starters are fully editable.

### FR-2 Custom columns

- FR-2.1 A column can be added to a track at any time, including when hundreds of applications already exist. Existing rows show it as empty.
- FR-2.2 Supported types: text, number, date, link, checkbox, single-select.
- FR-2.3 Columns can be renamed, reordered, hidden, and deleted. Deleting a column asks for confirmation and states how many rows hold a value in it.
- FR-2.4 Column definitions and values are stored as data, never as database schema changes.
- FR-2.5 Changing a column's type is not supported. The user creates a new column instead.

### FR-3 Statuses and single-select options

- FR-3.1 Status is a special single-select column per track. The board view groups by it.
- FR-3.2 Options can be added, renamed, recoloured, and reordered at any time.
- FR-3.3 Renaming or recolouring an option keeps the value on every row that uses it.
- FR-3.4 Deleting an option that is in use warns ("12 applications use this") and lets the user reassign those rows or leave them blank. Data is never silently wiped.
- FR-3.5 The user designates in settings which status or statuses count as "submitted".

### FR-4 Views

- FR-4.1 **Table view:** one row per application, sortable and filterable (see FR-10), with inline editing of cell values.
- FR-4.2 **Board view:** cards grouped by status. Dragging a card to another column changes its status.
- FR-4.3 Both views show the same data and respect the same filters.
- FR-4.4 The table stays responsive with 500+ rows (see NFR-1).

### FR-5 File archive

- FR-5.1 On first run, the user chooses a files root folder. It can be changed later through a relocate setting.
- FR-5.2 Uploading a file copies it into an app-created folder for that application (for example, Root/Company\_Role\_2026-10/). The user's original working files are never touched.
- FR-5.3 Each file gets a label (CV, cover letter, SOP, transcript, writing sample, or custom). The label list is editable.
- FR-5.4 On upload the app stores a SHA-256 hash and the original filename in the database, and sets the stored file read-only at the OS level.
- FR-5.5 The app verifies hashes on demand and automatically when a file is opened. A mismatch or missing file is flagged visibly.
- FR-5.6 The database stores paths relative to the files root so the root can be moved.
- FR-5.7 If an uploaded file has the same hash as one already stored for that application, the app warns "identical file already uploaded" instead of storing a duplicate.
- FR-5.8 Deleting a file is a deliberate action: confirm, unlock, remove. Files that belong to a submission require an extra warning.
- FR-5.9 PDF files can be previewed inside the app. (Nice-to-have.)
- FR-5.10 All files for one application can be downloaded as a single zip.
- FR-5.11 The app tracks only files uploaded through it. Files dropped into the root manually are ignored.

### FR-6 Filename convention

Stored files are named **NN-YYYYMMDD-file\_name.ext**, applied automatically.

- FR-6.1 The first upload of a file on a given day gets 01. Another upload of the same file on the same day increments it (02, 03, and so on). On a different day the date changes and the counter resets to 01.
- FR-6.2 The counter is tracked per application, per base name, per date, per extension. So CV.docx and CV.pdf uploaded together are both 01.
- FR-6.3 If an uploaded file already follows the pattern, the app strips the prefix and reads the base name, avoiding doubled prefixes.
- FR-6.4 The date is the user's local upload date, editable at upload time.
- FR-6.5 Past 99 uploads in a day the counter grows to three digits.
- FR-6.6 Characters invalid on Windows or macOS are replaced, and spaces become underscores.
- FR-6.7 The original uploaded filename is kept in the database.

### FR-7 Submissions

- FR-7.1 A submission is a database record with a date, an optional note, and a set of files.
- FR-7.2 Moving an application to a "submitted" status creates its first submission from the files currently attached. The user reviews the list before confirming.
- FR-7.3 Before creating it, the app warns if no files are attached or if an expected label for the track is missing (for example, no CV). Expected labels are editable per track.
- FR-7.4 The user can create further submissions at any time, with or without a status change, by choosing files, a date, and a note.
- FR-7.5 A file may belong to more than one submission without being stored twice.
- FR-7.6 Submissions cannot be edited after creation except for their note. Mistakes are corrected by adding a new submission.
- FR-7.7 A corrected file is uploaded as a new file (a new NN-date version). The old file stays attached to the submission it went out with.
- FR-7.8 Moving the status backward never deletes a submission.
- FR-7.9 The application detail page shows submissions as a timeline, newest first, each expandable to its files, with one-click open or download.

### FR-8 Planner ("what should I work on next")

The planner ranks applications that are still to do. All rules live in the database as editable settings, never in code.

- FR-8.1 **Engine slots:** Priority (single-select), Deadline (date), Effort (single-select), and Follow-up date (date). Each slot is optional and can be re-pointed to a different column in planner settings.
- FR-8.2 Each Priority option and each Effort option has an editable buffer in days.
- FR-8.3 Score = days left to deadline − priority buffer − effort buffer. Lowest score ranks first.
- FR-8.4 Only applications in statuses the user marks as "still to do" are ranked.
- FR-8.5 **Overdue handling** is a setting: pin to top and flag, hide, or rank normally.
- FR-8.6 **No-deadline handling** is a setting: rank by time since last touched, rank last, or ignore.
- FR-8.7 An application with no priority is treated as the lowest priority option.
- FR-8.8 **Weekly capacity** is a setting (for example, 4). The top N ranked applications form "this week's plan".
- FR-8.9 Every suggestion shows its reasoning, for example "Priority (+3), Heavy effort (+2), due in 5 days".
- FR-8.10 The Follow-up date slot drives a separate "Follow-ups due" list of submitted applications whose follow-up date has arrived. It does not affect the ranking.
- FR-8.11 Planner settings changes apply immediately. A "reset to defaults" action restores the shipped settings.
- FR-8.12 The planner is a pure TypeScript module with automated tests, so rule changes can be verified.

### FR-9 Dashboard

Must-have:

- FR-9.1 **This week's plan:** top N applications from the planner, with reasoning.
- FR-9.2 **Follow-ups due.**
- FR-9.3 **Deadline countdown:** the nearest deadline shown prominently.
- FR-9.4 **Weekly progress:** applications submitted this week against capacity (for example, 3 of 4), plus a streak.
- FR-9.5 **Overdue alerts:** anything past its deadline and not yet submitted.

Nice-to-have:

- FR-9.6 Pipeline counts per status.
- FR-9.7 Wins (interviews and offers) kept visible.
- FR-9.8 The dashboard is designed to be understood at a glance: cards and progress indicators, not tables.

### FR-10 Search, sort, and filter

- FR-10.1 Global search across title, text columns, and notes, returning results fast enough to use while reading an email.
- FR-10.2 Search results open the application's detail page directly.
- FR-10.3 The table can be sorted by any column and filtered by status, priority, and track, plus any single-select column.
- FR-10.4 The user can save the current filter and sort as a named view. (Nice-to-have.)

### FR-11 Notes and activity log

- FR-11.1 Each application has free-text notes, with timestamps.
- FR-11.2 The app automatically logs status changes, submissions, and file uploads with dates.
- FR-11.3 Notes and the log appear on the detail page in one timeline.

### FR-12 Backup and restore

- FR-12.1 A "Back up now" action creates a zip of the database and the files root at a location the user chooses.
- FR-12.2 The app reminds the user if no backup has been made in a configurable number of days.
- FR-12.3 A restore action reads a backup zip and rebuilds the database and files, after confirmation.
- FR-12.4 Data export: the table can be exported to CSV at any time.

### FR-13 Settings

- FR-13.1 Files root location, with relocate.
- FR-13.2 Planner settings (FR-8).
- FR-13.3 Submitted statuses, still-to-do statuses, expected labels per track.
- FR-13.4 Backup reminder interval.
- FR-13.5 All settings are stored in the database.

### FR-14 Contacts (nice-to-have)

- FR-14.1 Contacts (recruiters, professors, recommenders) with name, email, role, and notes.
- FR-14.2 A contact can be linked to several applications.
- FR-14.3 Until built, a text column or note covers the same need.

## 5. Data model overview

Entities and relationships only. Every table carries user\_id and timestamps.

- **tracks:** name, default status, settings.
- **columns:** belongs to a track, with name, type, order, visibility, default value, and options (for single-select).
- **column\_options:** belongs to a single-select column, with label, colour, order, and optional buffer days (planner).
- **applications:** belongs to a track, with title and archived flag.
- **cell\_values:** one value per application per column (stored typed, so sort and filter stay fast).
- **files:** belongs to an application, with label, original name, stored name, relative path, SHA-256 hash, size, and upload date.
- **submissions:** belongs to an application, with date and note.
- **submission\_files:** links submissions to files (many to many).
- **notes and activity\_events:** belong to an application, timestamped.
- **settings:** key-value store for planner rules, engine slot mappings, files root, backup reminder, and similar.
- **contacts and application\_contacts:** (nice-to-have).

## 6. Non-functional requirements

- NFR-1 **Performance:** with 500+ applications and several files each, the table loads in under 1 second, search returns in under 500 ms, and dashboard loads in under 1 second.
- NFR-2 **Privacy:** all data stays on the local machine. No network calls to third parties in v1. No telemetry.
- NFR-3 **File integrity:** stored files are read-only and hash-verified (FR-5.4, FR-5.5).
- NFR-4 **Data safety:** no destructive action (delete column, option, file, application) happens without a confirmation that states what will be lost.
- NFR-5 **Recoverability:** a full restore from one backup file must rebuild the entire app state.
- NFR-6 **Portability:** the files root can be relocated, and the database can be moved to Postgres in v2 without changing application logic.
- NFR-7 **Maintainability:** planner rules, statuses, and labels are data, not code. The planner is unit-tested.
- NFR-8 **Usability:** adding an application needs no more than a title. Retrieving sent files from a search takes at most three clicks.
- NFR-9 **Platform:** runs on Windows, macOS, or Linux, with a modern desktop browser.
- NFR-10 **Security baseline:** the server binds to localhost only, and file paths are validated to prevent access outside the files root.

## 7. Build order (high level)

Detailed phases, broken into roughly 30-minute daily tasks, come after the architecture.

1. **Foundation:** project setup, database, thin data and file layers, settings.
2. **Core tracking:** tracks, applications, custom columns, single-select options, table view.
3. **File archive:** files root, upload, naming rule, hashes, read-only, zip download.
4. **Submissions:** submitted status, freeze with warnings, timeline.
5. **Search, sort, filter:** needed for 100s of applications.
6. **Board view.**
7. **Planner:** engine, settings screen, reasoning text, tests.
8. **Dashboard.**
9. **Notes and activity log.**
10. **Backup and restore, CSV export.**
11. **Nice-to-haves:** PDF preview, contacts, saved views, pipeline counts, wins.

## 8. Acceptance tests

- AT-1 Add an application with only a title. It saves and appears in table and board.
- AT-2 With 50 applications present, add a new column. All 50 show it as empty and the add form includes it.
- AT-3 Rename a single-select option that is used by 12 rows. All 12 keep the value under the new name.
- AT-4 Delete an option used by 12 rows. The app warns and offers to reassign. No data is lost silently.
- AT-5 Upload CV.docx and CV.pdf on the same day. Both are stored as 01-date-CV with correct extensions. Uploading a changed CV.pdf the same day produces 02.
- AT-6 Upload a file already named in the convention. No doubled prefix.
- AT-7 Upload an identical file twice. The app warns instead of duplicating.
- AT-8 Edit a stored file outside the app. The app flags a hash mismatch.
- AT-9 Move an application to a submitted status with no CV. The app warns. After confirming, a submission is created with the attached files.
- AT-10 Upload a corrected CV after submitting. The original submission still lists the original file, and a new submission can include the corrected one.
- AT-11 Priority due in 2 days (buffer 3) outranks Good-to-have due in 1 day (buffer 0). With the priority one due in 6 days, the order flips. Changing the buffer in settings changes the result immediately.
- AT-12 Search a company name with 500 applications loaded. The right application opens, and its latest submission is visible, within 30 seconds of starting.
- AT-13 Back up, delete the app data, restore. Applications, columns, files, and submissions are all intact.
- AT-14 Change the files root. Existing files remain accessible.

## 9. Assumptions and open items

Assumptions made without explicit confirmation (please correct any that are wrong):

- Interview dates, recruiter replies, and rejection reasons are tracked with ordinary custom columns, not special features.
- Contacts are nice-to-have.
- Offer comparison, insights, and charts are out of v1.
- Filename date defaults to upload date, editable at upload, and the counter is per extension.
- SQLite is the v1 database. Drizzle versus Prisma is decided during architecture.
- Weekly capacity defaults to 4 and "week" starts on Monday (both editable).

Open items for the architecture phase:

- ORM choice and the typed storage approach for cell values.
- How the app is started day to day (npm script versus packaged local launcher).
- PDF preview approach.
- Zip and backup implementation, and behaviour with very large files folders.
