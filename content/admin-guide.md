# Admin guide

## Dashboard — `/admin`

Stats overview, event settings, Mattermost webhook, test login URLs, and the danger-zone reset.

### Submission & event dates

Set **Submission Deadline** and **MegaDemo Date** in the Settings card. The deadline closes new project submissions; both dates drive the countdowns on the homepage. MegaDemo date must be later than the deadline.

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

Open in a browser and press F11 for full-screen. No login required.
