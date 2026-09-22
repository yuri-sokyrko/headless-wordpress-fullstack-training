# Blame The Tech — API contract

## Mutations we expose

| Operation                 | Credential        | Forced server-side                                                           | Built in    |
| ------------------------- | ----------------- | ---------------------------------------------------------------------------- | ----------- |
| `createIncident` (custom) | user JWT          | `post_status = pending`, `post_author = current user`, `is_verified` ignored | Lesson 06.2 |
| `registerDeveloper`       | application token | role = `incident_reporter`, `btt_verified = 0`                               | Lesson 06.2 |
| `submitHobtLead`          | application token | stored in `wp_btt_leads`, IP stored as an HMAC                               | Lesson 06.2 |
| `login` (JWT plugin)      | credentials       | —                                                                            | Module 15   |

## Mutations we deliberately do NOT use

- `registerUser` — requires `users_can_register`, which opens a second registration door;
  assigns `get_option('default_role')` rather than our role.
- The generated `createIncident` — accepts a client-supplied `status` and `authorId`.

## Rules

- The browser never calls `/graphql`. Only the Next.js server runtime does. No CORS plugin.
- Validation on the Next side is a UX feature. Validation in WordPress is the security control.
- A field appearing in an input type is not permission to set it.
