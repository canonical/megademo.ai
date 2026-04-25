# Admin guide

## Dashboard — `/admin`

Stats overview, event settings, Mattermost webhook, test login URLs, and the danger-zone reset.

### Event dates

The Settings card exposes three date/time fields. All times are local browser time.

| Field | Purpose |
|-------|---------|
| **Hackathon Start** | Optional. When set, the homepage countdown shows "Hackathon starts in…" and **all project registration is disabled** until this time. Leave blank to allow registration at any time. Must be earlier than both Submission Deadline and MegaDemo Date. |
| **Submission Deadline** | Closes new project submissions. Must be earlier than MegaDemo Date. |
| **MegaDemo Date** | The event date. Drives the final countdown and the live "MEGADEMO IS NOW!" state. |

The settings card also shows a live **countdown status** line ("Currently: Hackathon starts in 2d 4h") so you can verify the active state at a glance without leaving the page.

#### Hackathon Start flow

1. **Before Hackathon Start** — the homepage countdown shows "Hackathon starts in…" with a note that project registration opens at start. All add-project buttons are greyed out and non-functional. Navigating to `/projects/new` redirects back to home.
2. **After Hackathon Start** — project registration opens. The countdown switches to "Submissions close in…" (if a deadline is configured).
3. **After Submission Deadline** — the countdown switches to "MegaDemo starts in…" (if configured).
4. **After MegaDemo Date** — the strip shows "MEGADEMO IS NOW!".

### Mattermost webhook

Paste a channel webhook URL to receive automatic notifications:
- New project submitted
- Project promoted to finalist
- Voting milestones (5, 10, 25, 50 votes)
- Daily stats summary (3× per day via cron)

### Test login

When `TEST_LOGIN_TOKEN` is set in the environment, the dashboard shows ready-to-copy login URLs for a synthetic **participant** and **admin** account — useful for end-to-end testing without a real GitHub/OIDC session.

### Reset everything

Deletes **all projects and votes** and resets teams, tags, and AI tools to their defaults. User accounts and deadline settings are preserved. Type `RESET` in the confirmation dialog to proceed.

---

## Projects — `/admin/projects`

Filter by status or category. Each project row has inline action buttons.

| Control | Effect |
|---------|--------|
| **Draft** | Move project back to draft (hidden from public). |
| **Submit** | Mark as submitted (public, eligible for voting). |
| **🏆** | Promote to finalist. Triggers a Mattermost notification. |
| **✕** | Delete project and all its votes (requires confirmation). |

Project statuses:
- **draft** — visible only to the owner and team members
- **submitted** — public; appears in listings and is eligible for voting
- **finalist** — public; shown in the kiosk on MegaDemo day

---

## Users — `/admin/users`

Lists all registered accounts. Use the **Role** dropdown on each row to switch a user between **participant** and **admin**. You cannot change your own role.

The page also has a **Danger Zone** at the bottom with one action:

| Action | Effect |
|--------|--------|
| **Clear All Sessions** | Signs every user out immediately. Each user's profile picture is fetched automatically on their next sign-in (via OIDC callback). |

---

## Teams — `/admin/teams`

Controls the Canonical Team dropdown shown in the project form.

- **Add** — enter a name and click Add Team.
- **Rename** — updates the label everywhere, including existing projects.
- **Delete** — only available for teams with no projects assigned.

---

## Tags & AI Tools — `/admin/tags`

Two independent lists: **AI Tools** and **Tech Stack**. Same rules apply to both:

- Tags referenced by at least one project can be **renamed** but not deleted.
- Tags with zero references can be deleted.

---

## CSV export — `/admin/export`

Downloads a spreadsheet-safe CSV of all projects. Columns: Title, Category, Status, Owner, Team, CanonicalTeam, AvgRating, VoteCount, RepoLinks, DemoUrl, AITools, TechStack, CompletionStage, CreatedAt.

---

## Kiosk — `/kiosk`

Full-screen auto-advancing slideshow for MegaDemo day. Only **finalist** projects are shown. The slide interval defaults to 30 seconds; override with the `KIOSK_INTERVAL` environment variable (seconds).

Open in a browser and press F11 for full-screen.
