# Project Search — Filter-as-you-type

## Problem

The `/projects` and `/admin/projects` pages have dropdown filters but no text search. Users must scroll or paginate to find a specific project. The admin "manage users" page already has a filter-as-you-type input — projects should have the same UX.

## Approach

Server-side search via two new API endpoints. Both pages call the API on keystroke (debounced) and render results in place, hiding the original content. When the search is cleared the original view is restored.

## Search fields

Title and description (case-insensitive substring match via MongoDB `$regex`).

## API endpoints

### `GET /api/projects/search`

Public endpoint. Returns submitted/finalist projects only.

| Param      | Type   | Description                        |
|------------|--------|------------------------------------|
| `q`        | string | Search term (required, min 1 char) |
| `category` | string | Optional category filter           |
| `team`     | string | Optional canonical-team filter     |
| `sort`     | string | `newest` / `stars` / `rating` / `votes` (default `newest`) |

Response (JSON):
```json
{ "projects": [ { "_id", "title", "slug", "category", "canonicalTeam", "avgRating", "voteCount", "status", "logo", "aiTools", "liveliness" } ] }
```

Results capped at 50.

### `GET /admin/projects/search`

Admin-only (requires admin role). Returns projects of any status.

| Param      | Type   | Description                        |
|------------|--------|------------------------------------|
| `q`        | string | Search term (required, min 1 char) |
| `status`   | string | Optional status filter             |
| `category` | string | Optional category filter           |

Response (JSON):
```json
{ "projects": [ { "_id", "title", "slug", "category", "status", "avgRating", "voteCount", "liveliness", "owner": { "profile": { "name" } } } ] }
```

Results capped at 50.

## Client-side behaviour

### Both pages

- A search `<input>` is added to the filters bar.
- Debounce 250 ms on `input` event.
- If query is empty, restore the original server-rendered content.
- If query is non-empty, fetch the relevant API with current dropdown values and render results.
- Existing dropdown filters are sent to the API and combine (AND) with the text query.

### Public `/projects`

- Results rendered as project cards matching the existing `.project-card` markup.
- Pagination is hidden while search is active.
- Sort dropdown applies to search results.

### Admin `/admin/projects`

- Results rendered as table rows matching the existing admin table markup.
- Status and category dropdowns combine with the text query.

## Scaling considerations

- Server-side search — no large JSON payload embedded in pages.
- 50-result cap prevents oversized responses.
- 250 ms debounce prevents request storms.
- Future: add MongoDB text index on `title` + `description` if regex becomes slow at scale.
