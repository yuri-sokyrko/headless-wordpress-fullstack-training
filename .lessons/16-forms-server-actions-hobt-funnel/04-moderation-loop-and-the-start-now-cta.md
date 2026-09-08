---
title: 'The Moderation Loop & the Start Now CTA'
module: 16
lesson: 4
teaches: [moderation-workflow, status-transitions, structural-authorization, kill-switch, conversion-cta]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/admin/moderation-queue.php', 'next-app/src/components/hobt/StartNowButton.tsx', 'next-app/e2e/funnel.spec.ts']
requires: [3.4, 16.3]
---

# Lesson 16.4 — The Moderation Loop & the Start Now CTA

## Quick Overview

Everything is in place except the last link. Registered developers can submit incidents; those
incidents sit at `pending`; nobody has yet made it pleasant for an editor to do something about
them. This lesson builds the wp-admin side of the moderation queue — a filtered list view, an
admin column showing scapegoat and severity at a glance, row actions for Approve and Reject, and
a mail to the reporter on transition — and then closes the loop: **editor approves in wp-admin →
`transition_post_status` fires → the webhook posts to Next (Module 18) → the incident appears
publicly.** Until Module 18 lands that webhook, the incident appears at the end of the ISR window
instead of within a second, and watching the difference is the best possible motivation for the
next-but-one module.

Notice what you do **not** build: a permission check on the Approve action. `incident_reporter`
has no `publish_incidents` capability at all
([appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities)), so the
row action simply does not render for it, and a hand-crafted POST to `post.php` fails inside
WordPress's own authorization layer before your code runs. That is what structural authorization
buys: there is no code path to audit, because there is no capability to abuse. The second half of
the lesson wires the **Start Now** CTA on `/hobt` to `start_now_url` from the HOBT Promo field
group, honours the `incident_submission_open` kill switch from
[appendix 03 §4.5](../appendix/03-content-model-reference.md#45-site-settings-options-page) in the
submit action, and adds the Playwright spec that walks the whole funnel end to end.

By the end of this lesson you will have:

- `includes/admin/moderation-queue.php` — a pending-incidents view with scapegoat and severity
  columns, Approve and Reject row actions, and a reporter notification on transition
- A `transition_post_status` handler that notifies the reporter by mail, visible in Mailpit, and
  that Module 18 will extend into the revalidation webhook
- `StartNowButton.tsx` reading `startNowUrl` from the block-composed HOBT page, with the outbound
  link attributed so conversions are attributable
- The `incident_submission_open` kill switch honoured by `submitIncident` — flip it off in wp-admin
  and the form refuses politely instead of erroring
- A Playwright spec covering the full loop: register, log in, submit, approve as editor, assert the
  incident is publicly visible
- A proof that a reporter cannot publish: their token against `/graphql`, and a direct POST to
  `post.php` with `post_status=publish`, both refused

## Classic WP Analogy

This is the most familiar lesson in Phase 3, because it is pure Classic WordPress. A Contributor
writes a post, it lands as `pending`, an Editor sees it under Posts → Pending, reviews it, and
clicks Publish. That workflow has shipped in core since 2003 and it is the reason `pending` exists
as a status. Everything in this lesson is `manage_edit-incident_columns`,
`manage_incident_posts_custom_column`, `post_row_actions`, `pre_get_posts` on the list screen, and
`transition_post_status` — hooks you have all used.

| Classic WordPress | This stack |
|---|---|
| Contributor → `pending` → Editor publishes | unchanged, and deliberately so |
| `post_row_actions` + `admin_action_*` | unchanged — moderation stays in wp-admin |
| `manage_edit-{$type}_columns` | unchanged |
| `transition_post_status` → `wp_mail()` | unchanged, plus `wp_remote_post()` to Next in Module 18 |
| an option-based feature flag | `incident_submission_open` in Site Settings, honoured by the Server Action |
| the post appears the moment you publish | it appears when Next's cache is invalidated — Module 18 |

The design decision worth naming: moderation stays in **wp-admin**, not in a bespoke Next.js
dashboard. Editors already know that screen, it already has revisions, autosave, the block editor,
capability enforcement, keyboard shortcuts and bulk actions, and rebuilding a worse version of it
in React would be several weeks of work that makes the product worse. Headless does not mean
"reimplement the admin".

**Where the analogy breaks down:** in Classic WordPress, publishing *is* the deploy. `wp_publish_post()`
runs, the object cache entry is invalidated, and the very next front-end request renders the new
post — the loop closes inside one PHP process. Here, publishing changes state in a system that has
no idea what Next.js has cached. Next holds a static page it is perfectly happy with, and no amount
of clicking Publish tells it otherwise. That gap between "published in WordPress" and "visible to
the public" is new, it is the single most common complaint about headless CMS setups, and it does
not close until Lesson 18.3 signs a webhook. Feel the delay in this lesson so that the webhook
lands as a fix rather than a formality.

The second break: `wp_mail()` to a reporter now needs to link to `/en/account`, not to wp-admin —
the recipient has no dashboard. Every editorial notification in a headless build needs its
destination re-pointed at the front end, and it is easy to miss because the mail still sends
perfectly.

---

## Key Concepts

### 1. The moderation workflow is five hooks you already know

Nothing in the wp-admin half of this lesson is headless. It is the Classic WordPress list-table API,
and it is worth naming each hook against the job it does, because the names are unmemorable and the
jobs are obvious.

| Hook | Kind | Job |
|---|---|---|
| `manage_edit-{$type}_columns` / `manage_{$type}_posts_columns` | filter | which columns exist, and in what order |
| `manage_{$type}_posts_custom_column` | action | render one cell. It **echoes**, so everything is escaped here |
| `manage_edit-{$type}_sortable_columns` | filter | which headers are clickable, and the `orderby` value each sends |
| `pre_get_posts` | action | change the query behind the list — this is where a "queue" comes from |
| `post_row_actions` | filter | the links under a row title: Edit, Trash, and yours |
| `admin_post_{$action}` | action | the handler your row-action link points at |
| `transition_post_status` | action | fires on every status change, with old and new |

**Lesson 03.4 already built most of this.** `includes/admin/incident-columns.php` has the columns,
the sortable headers, the taxonomy-join sorting, the scapegoat filter dropdown, the **Approve** row
action, its `admin_post_btt_approve_incident` handler and the matching bulk action. Lesson 03.3's
`show_admin_column` gave you Severity and Scapegoat columns before that.

So be precise about what this lesson adds, because re-adding a column produces two columns and
re-adding a handler produces a fatal:

| Already exists | Lesson |
|---|---|
| Severity and Scapegoat columns | 03.3, via `show_admin_column` |
| Downtime and Verified columns, sortable headers, the scapegoat filter | 03.4 |
| The **Approve** row action, its nonce, its handler, the bulk action | 03.4 |
| **The queue view** — `post_status=pending` as the default for moderators | **this lesson** |
| **Column order for moderation** — severity and scapegoat promoted to sit beside the title | **this lesson** |
| **A Reporter column** — who submitted it, from `reporter_display_name` | **this lesson** |
| **A Reject row action** and its handler | **this lesson** |
| **`transition_post_status`** → mail the reporter, pointing at the front end | **this lesson** |

### 2. Moderation stays in wp-admin, and that is a decision

The tempting alternative is a moderation dashboard in Next.js: a table at `/en/moderate`, a couple
of Server Actions, tasteful typography. Do not build it.

| | wp-admin | A bespoke Next dashboard |
|---|---|---|
| Revisions and autosave on the edit screen | ✅ free | ❌ weeks of work |
| The block editor, for fixing a submission before publishing | ✅ free | ❌ or you reimplement Gutenberg |
| Capability enforcement on every action | ✅ WordPress's own layer | ❌ yours to write, and yours to forget |
| Bulk actions over forty submissions | ✅ free | ❌ |
| Search, sort, filter, pagination, screen options | ✅ free | ❌ |
| Keyboard shortcuts editors already have muscle memory for | ✅ free | ❌ |
| Matches your design system | ❌ | ✅ |
| One fewer login for the editor | ❌ | ✅ |
| **Verdict** | ✅ **this course** | only if editors are also your end users |

**Headless does not mean "reimplement the admin".** The thing you went headless for is the *public*
experience — routing, caching, Core Web Vitals, a component system. None of those are properties of
an internal list table used by four people on a desktop. Spending a fortnight rebuilding a worse
`edit.php` is how a headless project acquires the reputation of being slower to deliver.

The condition that would reverse this: if moderators were untrained members of the public rather
than staff, wp-admin's information density and vocabulary would be a genuine barrier, and a narrow
purpose-built screen would win. That is not this product.

### 3. Structural authorization, and the thing it is easy to over-read

`incident_reporter` has **no** `publish_incidents` capability
([appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities)). Not "we check
that it does not"; the capability is not in the role. Follow what that buys, in order:

```
   A reporter loads edit.php?post_type=incident
        └─▶ redirect_reporters_away_from_admin()  (03.5)  → they never arrive

   A reporter who somehow arrived sees no Approve link
        └─▶ incident_row_actions() returns early    (03.4)  → nothing rendered

   A reporter hand-crafts the POST to admin-post.php with a valid nonce
        └─▶ handle_approve_incident()'s current_user_can  (03.4)  → wp_die(403)

   A reporter hand-crafts a POST to wp-admin/post.php with post_status=publish
        └─▶ WordPress's OWN edit_post() capability layer   → dies before any of
            our code runs

   A reporter calls createIncident over /graphql asking for PUBLISH
        └─▶ the mutation forces `pending`, AND wp_insert_post() downgrades the
            status anyway for an author without publish_incidents  (06.2 §5)
```

Five gates, and only the middle three are code anyone wrote. **The bottom two hold even if you
delete every check above them**, because there is no capability to abuse. That is what "structural"
means: the authorization decision is data in the role definition, not a branch in a function that
somebody has to remember to write.

Now the part that is easy to over-read, and it matters:

> **A nonce is not an authorization check, and structural authorization does not remove the need
> for one.** They defend against different attacks. A capability answers "may *this user* do this";
> a nonce answers "did this request come from a form *my site rendered for this user in this
> session*". CSRF against a legitimately-capable editor — a link in an email that fires Approve on
> the wrong incident while they are logged in — passes every capability check in the list above,
> because the editor genuinely does have the capability. `wp_nonce_url()` on the link and
> `check_admin_referer()` in the handler is the control, and it is required on **every** state-
> changing row action, including the Reject action you write in Step 1.

The ordering inside the handler is also not arbitrary: `check_admin_referer()` **first**, because it
`wp_die()`s on failure and there is no point checking capabilities on a request you are about to
reject. Then `current_user_can()`. Then the work. Lesson 03.4's `handle_approve_incident()` is
already written that way; copy the shape.

### 4. `transition_post_status`, and the two guards nobody writes the first time

```php
// (illustration) the signature. Old status FIRST is the argument order people
// get backwards, and getting it backwards means your handler fires never.
add_action( 'transition_post_status', $callback, 10, 3 );
function callback( string $new_status, string $old_status, \WP_Post $post ): void {}
```

It fires on **every** status change of **every** post type, including changes you did not think of:

| Transition | When | Your handler must |
|---|---|---|
| `new` → `auto-draft` | somebody opened "Add New" | ignore |
| `auto-draft` → `draft` | the first autosave | ignore |
| `draft` → `draft` | a save with no status change | ignore — `$new === $old` |
| `inherit` → `inherit` | a revision was written | ignore — `wp_is_post_revision()` |
| `pending` → `publish` | **a moderator approved it** | mail the reporter |
| `pending` → `draft` | **a moderator rejected it** | mail the reporter |
| `publish` → `trash` | somebody deleted a live incident | not this lesson's job |

Miss the `$new === $old` guard and every save sends mail. Miss the revision guard and every
autosave sends mail. Both are the kind of bug you discover in Mailpit with forty identical
messages, which is at least a fast diagnosis.

**The headless-specific part is the destination, and it is easy to miss because the mail still
sends perfectly.** `wp_mail()` to a reporter must link to `/{locale}/account`, not to
`wp-admin/edit.php`, because the recipient has no dashboard — `incident_reporter` is redirected away
from wp-admin on `admin_init` and has no `edit_posts` at all. Every editorial notification in a
headless build needs its destination repointed at the front end, and nothing errors when you forget.
The base URL comes from `BTT_FRONTEND_URL`, exactly as `registerDeveloper`'s verification mail does.

> **Locally `BTT_FRONTEND_URL` is `http://host.docker.internal:3000`, which your browser cannot
> resolve.** The link in Mailpit is therefore not clickable from your machine, and that is correct
> rather than broken: the value is the address WordPress-in-a-container uses to reach Next-on-your-
> host, and production sets it to the public origin. So the Verification block asserts on the mail's
> **path** — `/en/account` present, `wp-admin` absent — and not on its clickability.

### 5. The kill switch, and knowing when to fail closed

`incident_submission_open` is a true/false field on the Site Settings options page
([appendix 03 §4.5](../appendix/03-content-model-reference.md#45-site-settings-options-page)). Two
places read it, and both fail **politely**:

| Reader | Behaviour when the switch is off |
|---|---|
| `src/app/[locale]/incidents/submit/page.tsx` | renders an explanatory panel instead of the form |
| `submitIncident`, between step 1 and step 2 | returns an error state before it validates anything |

The page alone is not enough — anyone with the action's reference can still POST — and the action
alone is not enough, because a form that accepts input and then refuses it is a worse experience
than a form that is not there. Lesson 04.3's table said exactly this, and neither reader is a
security control.

And now the sharp bit, which is the reason this concept exists rather than being one line in a Task
step. **An unsaved ACF options page returns `null`.** So the reader has to decide what `null` means,
and this application makes opposite decisions in two places:

| Missing value | Treated as | Because |
|---|---|---|
| `incidentSubmissionOpen` is `null` | **open** | it is a *content setting*. `null` means nobody has decided, and the pre-switch behaviour is the honest default. Treating it as closed means a fresh environment where nobody has clicked Update in wp-admin has a dead submission form, for a reason no error message will ever mention |
| `UPSTASH_REDIS_REST_URL` is unset | **unavailable — refuse** | it is a *security control*. A forgotten variable must not switch it off (Lesson 16.2 §5) |
| `BTT_APP_TOKEN` is `''` | **not authorized** | same, in PHP: `hash_equals('', '')` is `true`, and that would authenticate everybody (Lesson 06.2 Step 2) |

Knowing which of your `null` branches is which is the skill. The test is one question: **if this
value is missing because somebody forgot, does the safe outcome look like "off" or like
"unrestricted"?** A rate limiter that defaults to unrestricted is a vulnerability. A submission form
that defaults to closed is an outage. Same code shape, opposite correct answer.

Lesson 06.2's resolver carries the other half of this argument in a comment you can still read: the
switch is deliberately **not** checked in `createIncident`, because a mutation failing closed on an
unsaved options page takes the form down for a reason nobody can see. The switch is a content
setting, so it lives where content decisions live.

### 6. The gap between "published" and "visible", felt on purpose

Click Publish in Classic WordPress and the loop closes inside one PHP process:
`wp_publish_post()` runs, the object cache entry is invalidated, and the next front-end request
renders the new post. Publishing *is* the deploy.

Here it is not, and the shape of the gap is worth knowing precisely, because "it is cached" is too
vague to act on:

```
   Editor clicks Approve                          WordPress: post_status = publish
        │                                                 │
        │                                    Next.js has NO IDEA this happened
        │                                                 │
   ┌────▼─────────────────────────────────────────────────▼────────────────────┐
   │ /en/incidents/<new-slug>   NEVER RENDERED BEFORE → no cache entry →       │
   │                            rendered on demand → VISIBLE IMMEDIATELY   ✅  │
   │                                                                          │
   │ /en/incidents              rendered an hour ago → a cache entry EXISTS →  │
   │                            served from it → the new incident is MISSING   │
   │                            until the revalidate window expires        ❌  │
   │                                                                          │
   │ /en/scapegoats/the-intern  same, and its count is stale too           ❌  │
   └──────────────────────────────────────────────────────────────────────────┘
```

That asymmetry surprises everybody and it is the single most common complaint about headless CMS
setups — not "the site is stale", but "*some* of it is stale and I cannot predict which". The detail
page works, so the editor thinks publishing worked; the archive does not, so a reader who arrives via
the archive sees nothing.

Feel it in this lesson. Approve an incident, load the detail URL directly (it is there), then load
the archive (it is not). Do not fix it, do not shorten the window to one second, and do not add a
`revalidateTag` in the wrong place to make the symptom go away. Lesson 18.3 signs a webhook from
`transition_post_status` — the very hook you are adding here — and the fix lands as a fix rather
than a formality precisely because you spent ten minutes annoyed by the gap.

### 7. Conversion attribution on Start Now, and the interstitial you are not building

`startNowUrl` is an off-site checkout URL from the `hobtPromo` field group
([appendix 03 §4.4](../appendix/03-content-model-reference.md#44-hobt-promo)). Module 14 made
`/hobt`'s body block-composed, and `hobtPromo` stayed **page-mounted**: `priceUsd`, `seatsLeft` and
the two repeaters are commerce data an editor must not be able to reorder away, so
`src/app/[locale]/hobt/page.tsx` still queries `hobtPromo` alongside `editorBlocks`. That is where
`startNowUrl` comes from, and it is a prop, not a fetch inside the button.

Three decisions in one small component.

**It is an `<a href>`, not `next/link` and not a `<button onClick>`.** The target is off-site, so
there is no client-side navigation to prefetch, and a `button` would break middle-click, Cmd-click,
"copy link address" and every accessibility expectation of a link. `Button asChild` renders one
`<a>` carrying the button classes (Lesson 11.2 Key Concept 7).

**Attribution is URL parameters, so it needs no JavaScript.**

| Parameter | Value | Why |
|---|---|---|
| `utm_source` | your site's host | which property sent the click |
| `utm_medium` | `cta` | distinguishes it from an email or an ad |
| `utm_campaign` | `hobt` | the funnel |
| `utm_content` | the kebab `leadSource` — `hobt-hero`, `hobt-footer`, `hobt-cta-block` | **which band on the page**, and the same vocabulary as `wp_btt_leads.source`. One taxonomy for leads and clicks, or you cannot compare them |

**`rel="noopener noreferrer"`, and `noreferrer` is the interesting half.** `noopener` severs
`window.opener` so the destination cannot script your page. `noreferrer` additionally suppresses the
`Referer` header — which means the destination learns nothing about the page the click came from.
That is a *deliberate* trade you can only afford because the UTM parameters carry the attribution
explicitly: you have replaced an implicit channel that leaks your full URL to a third party with an
explicit one that carries exactly the four facts you chose.

> **What you are choosing not to build:** an interstitial `/go/checkout` route that records the
> click server-side and then redirects. It is the more accurate design — it survives an ad blocker
> stripping UTM parameters, and it gives you a click count you own. It also adds a route, a redirect
> hop before a revenue action, another cached surface, and a table. For a course project, four URL
> parameters is the right amount of engineering, and Module 21 would make you defend the extra
> latency anyway.

### 8. What an end-to-end test of a moderation loop must control

`e2e/funnel.spec.ts` is the most fragile spec in the suite, and it is fragile for a reason worth
understanding rather than working around: it is the only test that crosses **both** applications,
**two** authentication systems, a cache and an email server.

| It must control | How, in this spec |
|---|---|
| A fresh developer | registered through `/en/register` with a per-run email, so a re-run never collides on `email_exists()` |
| Email verification | read out of **Mailpit's API**, not guessed. The link's origin is rewritten from `host.docker.internal` to the test base URL |
| A reporter session | the **seeded** `reporter` account, because `registerDeveloper` generates a password it deliberately never returns (Lesson 06.2 Step 4) — there is no password for the account it just created until Module 15's reset flow |
| A predictable slug | the title carries the run id, so the slug is `funnel-probe-<runId>`: computed from what the spec typed, not guessed, and unique so WordPress never appends `-2` |
| An editor session | `wp-login.php`, filled from `BTT_EDITOR_PASSWORD` in the invoking shell |
| Not depending on 40 incidents | **it asserts no counts at all.** It creates one incident and asserts on that one |
| Cleanup | Lesson 12.4's `e2e/global-setup.ts` fixture reset, gated on `E2E_MODE=1` |

Four rules that are not negotiable, and one honest exception.

- **`getByRole` plus the accessible name.** No `data-testid`, no CSS class, no `nth-child`, no
  XPath — including in a troubleshooting workaround, which is where they always creep in. A
  `data-testid` locator passes while the button is invisible, unlabelled and unreachable by
  keyboard; that is the opposite of what an end-to-end test is for.
- **`127.0.0.1` for Next**, because since Node 17 `localhost` may resolve to `::1` while the dev
  server listens on IPv4 (Lesson 12.3 Key Concept 5). **`localhost:8080` for WordPress**, because
  `WP_HOME` is `http://localhost:8080` and WordPress canonical-redirects anything else. Two
  different hosts, two different reasons, and both are correct.
- **No `waitForTimeout`.** Every wait is a web-first assertion on a condition.
- **The one exception, stated plainly:** `<input type="password">` has no ARIA role, so
  `getByRole('textbox')` cannot match it, in any browser. Password fields use `getByLabel`, which
  resolves through the same accessible-name computation. That is a limitation of the platform, not
  a shortcut, and it is the only non-`getByRole` locator in the file.

**Why storage state is deferred to Lesson 23.6.** Playwright can save a logged-in browser profile
once and reuse it across specs, which is faster. It also hides the login path — the thing this spec
exists to prove — and makes specs order-dependent, which is how a suite starts needing
`--workers=1`. 23.6 introduces it with the least-privilege `e2e_agent` account, once there are
enough authenticated specs for the speed to be worth the coupling.

The spec runs under the **`smoke`** project, because that is the only project defined until Lesson
22.4 adds `a11y`. Module 17's Starting State runs `npx playwright test e2e/funnel.spec.ts` with no
`--project` flag, so it lands in `smoke` either way. Lesson 23.6 moves it to `mutations`, where a
slow state-changing spec belongs.

### 9. Where the loop is now complete, and where it is not

```
 developer      Next.js               WordPress            wp-admin        public
     │             │                      │                   │              │
     ├─ register ─▶│── registerDeveloper ▶│── wp_mail ────────────────────▶ inbox
     │             │                      │                   │              │
     ├─ verify ───▶│── verifyDeveloper ──▶│  btt_verified = 1  │              │
     ├─ log in ───▶│── login ────────────▶│  JWT               │              │
     ├─ submit ───▶│── createIncident ───▶│  FORCED pending    │              │
     │             │                      ├── queue ─────────▶│  Approve     │
     │             │                      │◀── publish ───────┤              │
     │◀─ mail ─────────────────────────────  transition_post_status          │
     │             │                      │                   │              │
     │             │  detail page: no cache entry → renders on demand ──────▶ ✅
     │             │  archive page: cache entry exists → stale ─────────────▶ ⏳
     │             │◀── POST /api/revalidate ── HMAC-signed ── MODULE 18 ────┘
```

Everything above the dashed line is done as of this lesson. The last arrow is Module 18, and the
`transition_post_status` handler you write in Step 1 is where it attaches — which is the second
reason to write that handler now rather than in Module 18: the guards against autosaves and
revisions are the same guards, and getting them wrong once is enough.

---

## Task

### Step 1: Build the moderation queue

One new file. It **extends** what Lessons 03.3 and 03.4 registered and re-registers nothing.

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/admin/moderation-queue.php
/**
 * The incident moderation queue.
 *
 * EXTENDS includes/admin/incident-columns.php (Lesson 03.4), which already owns
 * the columns, the sortable headers, the scapegoat filter, the Approve row
 * action and its handler. This file adds the four things that did not exist:
 * a pending-by-default queue view, moderation column ORDER, a Reject action,
 * and the reporter notification on transition. Lesson 16.4 §1.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

add_action( 'pre_get_posts', __NAMESPACE__ . '\\default_incident_queue_to_pending' );
add_filter( 'manage_incident_posts_columns', __NAMESPACE__ . '\\promote_moderation_columns', 20 );
add_action( 'manage_incident_posts_custom_column', __NAMESPACE__ . '\\render_reporter_column', 10, 2 );
add_filter( 'post_row_actions', __NAMESPACE__ . '\\incident_reject_row_action', 20, 2 );
add_action( 'admin_post_btt_reject_incident', __NAMESPACE__ . '\\handle_reject_incident' );
add_action( 'transition_post_status', __NAMESPACE__ . '\\notify_reporter_on_transition', 10, 3 );

/**
 * Default the incident list to `pending` for anyone who can publish.
 *
 * This IS the queue: no new screen, no new menu item, no second list table.
 * The "All (n)" link at the top of the screen still works, so the default is a
 * starting point rather than a filter you have to defeat.
 *
 * `is_incident_admin_query()` is Lesson 03.4's helper and does the is_admin(),
 * is_main_query() and post_type checks in one place.
 */
function default_incident_queue_to_pending( \WP_Query $query ): void {
	if ( ! is_incident_admin_query( $query ) ) {
		return;
	}

	// A reporter never reaches wp-admin (03.5), and an author with no
	// publishing capability has no queue to work.
	if ( ! current_user_can( 'publish_incidents' ) ) {
		return;
	}

	// Respect any explicit choice the editor made. `all_posts` is what the
	// "All" status link sends; `post_status` is every other link; `s` is a
	// search, which must never be scoped to one status silently.
	// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only list filters.
	if ( isset( $_GET['post_status'] ) || isset( $_GET['all_posts'] ) || isset( $_GET['s'] ) ) {
		return;
	}
	// phpcs:enable WordPress.Security.NonceVerification.Recommended

	$query->set( 'post_status', 'pending' );
}

/**
 * Promote Severity and Scapegoat to sit immediately after the title, and add a
 * Reporter column.
 *
 * The two taxonomy columns ALREADY EXIST — Lesson 03.3's show_admin_column put
 * them there. Adding them again would produce two Severity columns. What a
 * moderator needs is them FIRST, because triage is "how bad, who is blamed,
 * who says so" and those three answers should not be at the far right of a
 * 1600px table. Priority 20, so this runs after 03.4's filter at 10.
 *
 * @param array<string, string> $columns Existing columns.
 * @return array<string, string>
 */
function promote_moderation_columns( array $columns ): array {
	$promoted = array( 'taxonomy-severity', 'taxonomy-scapegoat' );
	$out      = array();

	foreach ( $columns as $key => $label ) {
		$out[ $key ] = $label;

		if ( 'title' !== $key ) {
			continue;
		}

		foreach ( $promoted as $moved ) {
			if ( isset( $columns[ $moved ] ) ) {
				$out[ $moved ] = $columns[ $moved ];
			}
		}

		$out['btt_reporter'] = __( 'Reporter', 'blame-the-tech-core' );
	}

	// No de-duplication step is needed, and the reason is a PHP detail worth
	// knowing: re-assigning an EXISTING key does not move it. When the loop
	// later reaches `taxonomy-severity` it overwrites a key that is already in
	// position two, so the column appears once, early. Try it in `php -a`
	// before you believe it.
	return $out;
}

/** Render the Reporter cell. This ECHOES, so it escapes. */
function render_reporter_column( string $column, int $post_id ): void {
	if ( 'btt_reporter' !== $column ) {
		return;
	}

	// The DENORMALISED display name (appendix 03 §4.1) first, because public
	// reporters are not classic WordPress authors and the meta is what the
	// front end shows.
	$name = (string) get_post_meta( $post_id, 'reporter_display_name', true );

	if ( '' === $name ) {
		$author = get_userdata( (int) get_post_field( 'post_author', $post_id ) );
		$name   = $author instanceof \WP_User ? $author->display_name : __( 'unknown', 'blame-the-tech-core' );
	}

	// The email address is deliberately NOT printed. A list table is a screen
	// people screenshot into Slack.
	echo esc_html( $name );
}

/**
 * A "Reject" row action beside Lesson 03.4's Approve, on pending incidents.
 *
 * Same three ingredients as Approve, and the nonce is one of them: a
 * capability answers "may this user", a nonce answers "did this request come
 * from a form we rendered for them". Structural authorization does not replace
 * it, because CSRF against a legitimately-capable editor passes every
 * capability check there is. Lesson 16.4 §3.
 *
 * @param array<string, string> $actions Existing row actions.
 */
function incident_reject_row_action( array $actions, \WP_Post $post ): array {
	if ( 'incident' !== $post->post_type || 'pending' !== $post->post_status ) {
		return $actions;
	}

	if ( ! current_user_can( 'publish_incidents' ) || ! current_user_can( 'edit_post', $post->ID ) ) {
		return $actions;
	}

	$url = wp_nonce_url(
		add_query_arg(
			array(
				'action' => 'btt_reject_incident',
				'post'   => $post->ID,
			),
			admin_url( 'admin-post.php' )
		),
		'btt_reject_incident_' . $post->ID
	);

	$actions['btt_reject'] = sprintf(
		'<a href="%s">%s</a>',
		esc_url( $url ),
		esc_html__( 'Reject', 'blame-the-tech-core' )
	);

	return $actions;
}

/**
 * Send a pending incident back to `draft`.
 *
 * Draft, not trash: the reporter can still see it on /account, an editor can
 * still fix and publish it, and nothing is destroyed by a mis-click.
 *
 * Nonce FIRST — it wp_die()s, and there is no point checking capabilities on a
 * request you are about to reject. Capability second. Work third. Same shape as
 * handle_approve_incident() in Lesson 03.4.
 */
function handle_reject_incident(): void {
	$post_id = isset( $_GET['post'] ) ? absint( wp_unslash( $_GET['post'] ) ) : 0;

	check_admin_referer( 'btt_reject_incident_' . $post_id );

	if ( 0 === $post_id || ! current_user_can( 'publish_incidents' ) || ! current_user_can( 'edit_post', $post_id ) ) {
		wp_die( esc_html__( 'Not allowed.', 'blame-the-tech-core' ), '', array( 'response' => 403 ) );
	}

	$post = get_post( $post_id );

	if ( ! $post instanceof \WP_Post || 'incident' !== $post->post_type ) {
		wp_die( esc_html__( 'Not allowed.', 'blame-the-tech-core' ), '', array( 'response' => 403 ) );
	}

	// wp_update_post() fires transition_post_status, which sends the mail.
	wp_update_post(
		array(
			'ID'          => $post_id,
			'post_status' => 'draft',
		)
	);

	wp_safe_redirect( add_query_arg( 'btt_rejected', 1, admin_url( 'edit.php?post_type=incident' ) ) );
	exit;
}

/**
 * Mail the reporter when their incident leaves `pending`.
 *
 * Argument order is NEW, OLD, POST. Getting it backwards means this handler
 * fires never, which is a quiet way to lose an afternoon.
 *
 * The destination is the FRONT END. `incident_reporter` is redirected away
 * from wp-admin on admin_init (03.5) and has no edit_posts at all, so a link
 * to edit.php is a link to a redirect. Nothing errors when you get this wrong;
 * the mail sends perfectly and the recipient bounces. Lesson 16.4 §4.
 *
 * Module 18 attaches the revalidation webhook to this same hook, and reuses
 * these same guards.
 */
function notify_reporter_on_transition( string $new_status, string $old_status, \WP_Post $post ): void {
	if ( 'incident' !== $post->post_type || $new_status === $old_status ) {
		return;
	}

	// Autosaves and revisions transition statuses too, and mailing on those is
	// how you end up with forty identical messages in Mailpit.
	if ( wp_is_post_autosave( $post ) || wp_is_post_revision( $post ) ) {
		return;
	}

	// Only a moderation decision on a submission. Not `auto-draft` → `draft`,
	// not `publish` → `trash`.
	if ( 'pending' !== $old_status || ! in_array( $new_status, array( 'publish', 'draft' ), true ) ) {
		return;
	}

	$author = get_userdata( (int) $post->post_author );

	if ( ! $author instanceof \WP_User || ! is_email( $author->user_email ) ) {
		return;
	}

	// The locale registerDeveloper stored, so a German reporter gets /de/account.
	$stored = (string) get_user_meta( $author->ID, 'locale', true );
	$locale = in_array( $stored, array( 'uk', 'de' ), true ) ? $stored : 'en';

	// BTT_FRONTEND_URL, exactly as the verification mail does. Locally that is
	// host.docker.internal:3000, which is unresolvable from your browser and
	// correct anyway — it is the address WordPress uses to reach Next.
	$account = trailingslashit( (string) getenv( 'BTT_FRONTEND_URL' ) ) . $locale . '/account';

	$approved = 'publish' === $new_status;

	wp_mail(
		$author->user_email,
		$approved
			? __( 'Your incident is live', 'blame-the-tech-core' )
			: __( 'Your incident needs another look', 'blame-the-tech-core' ),
		sprintf(
			$approved
				/* translators: 1: incident title, 2: account URL. */
				? __( "“%1\$s” has been approved and is now public.\n\nYour submissions: %2\$s\n", 'blame-the-tech-core' )
				/* translators: 1: incident title, 2: account URL. */
				: __( "“%1\$s” was sent back for revision. A moderator will have left a note.\n\nYour submissions: %2\$s\n", 'blame-the-tech-core' ),
			$post->post_title,
			esc_url_raw( $account )
		)
	);
}
```

### Step 2: Load it

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
		'includes/admin/incident-columns.php',              // Lesson 03.4
		'includes/admin/moderation-queue.php',              // Lesson 16.4
```

The order matters here in a way it usually does not: `moderation-queue.php` calls
`is_incident_admin_query()` from `incident-columns.php`, and it calls it from a `pre_get_posts`
handler that runs long after every `require_once` has completed. So the order is for a reader, not
for PHP — but a reader is who you are writing for.

**Verify §2:**

- [ ] `docker compose logs --tail=40 wordpress` shows no fatal and no `Failed opening required`.
- [ ] `http://localhost:8080/wp-admin/edit.php?post_type=incident` as `btt_admin` shows **only
      pending** incidents, with Severity, Scapegoat and Reporter immediately after the title.
- [ ] The "All" link at the top of that screen shows all 40. If it does not, the `all_posts` guard
      in `default_incident_queue_to_pending()` is missing and you have built a filter nobody can
      turn off.
- [ ] Hovering a pending row shows **Approve** and **Reject**. Exactly one of each. Two Approves
      means you re-registered Lesson 03.4's action.

### Step 3: Honour the kill switch in the action

An anchored edit to `src/actions/incidents.ts`, between step 1 and step 2. Lesson 04.3 promised the
Server Action "refuses before it validates anything", and that is where this goes.

```ts
// next-app/src/actions/incidents.ts — add to the imports
import { SiteChromeDocument } from '@/gql/graphql';
import { siteTag } from '@/lib/graphql/tags';
```

```ts
// next-app/src/actions/incidents.ts — anchored edit, after the step 1 block and
// before `// ── 2. VALIDATE ──`
  // ── 1b. KILL SWITCH ────────────────────────────────────────────────
  // Lesson 04.3 promised this refuses BEFORE it validates anything, so it sits
  // here rather than inside step 3. It is a CONTENT setting, not an
  // authorisation decision (Lesson 16.4 §5) — which is why it is read here and
  // deliberately not in createIncident.
  const chrome = await fetchGraphQL(SiteChromeDocument, undefined, {
    revalidate: 60,
    tags: [siteTag()],
  });

  // `!== false`, not `=== true`. An ACF options page nobody has saved returns
  // null, and treating null as "closed" gives a fresh environment a dead
  // submission form for a reason no error message mentions. Compare the rate
  // limiter above, which fails CLOSED on a missing variable, because that one
  // IS a security control. Lesson 16.4 §5 has the test for telling them apart.
  if (chrome.siteSettings?.incidentSubmissionOpen === false) {
    return {
      status: 'error',
      message: 'Incident submission is paused right now. Nothing you typed was sent — try again later.',
    };
  }
```

Then the polite branch in the page, so a closed form is not a form at all:

```tsx
// next-app/src/app/[locale]/incidents/submit/page.tsx — anchored edit, after
// the requireCapability() call and before the term fetch
  const chrome = await fetchGraphQL(SiteChromeDocument, undefined, {
    revalidate: 60,
    tags: [siteTag()],
  });

  if (chrome.siteSettings?.incidentSubmissionOpen === false) {
    // POLITE, not an error. The route still resolves, the layout still renders,
    // and the reader is told a true thing. An error boundary here would look
    // like a bug and generate a support ticket.
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Submissions are paused</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We are catching up on the moderation queue. Incident submission will reopen shortly — nothing you
          submitted before is affected.
        </p>
      </main>
    );
  }
```

**Verify §3:**

- [ ] `npm run type-check` is silent. If `incidentSubmissionOpen` is unknown, `SiteChrome` in
      `src/graphql/siteSettings.graphql` never selected it — Lesson 10.5 did, so check the document
      before you edit it.
- [ ] `grep -c '=== false' src/actions/incidents.ts` returns `1`. A `!== true` there is the outage
      described in Key Concept 5.

### Step 4: Write the Start Now button

```tsx
// next-app/src/components/hobt/StartNowButton.tsx
// NOT a client component. Attribution here is four URL parameters, and URL
// parameters need no JavaScript — which is the whole reason this design was
// chosen over an interstitial redirect route. Lesson 16.4 §7.
import { Button } from '@/components/ui/button';
import type { LEAD_SOURCES } from '@/lib/validation/schemas';

/**
 * Append attribution to an off-site checkout URL.
 *
 * Returns null for an absent or unparseable value rather than rendering a
 * broken link: `startNowUrl` is editor-entered and an editor can type anything.
 * `new URL()` throws on a relative path, which is the check.
 */
function attributed(startNowUrl: string | null, leadSource: string, locale: string): string | null {
  if (startNowUrl === null || startNowUrl === '') {
    return null;
  }

  try {
    const url = new URL(startNowUrl);

    // The SAME vocabulary as wp_btt_leads.source and the btt/hobt-cta block's
    // `leadSource` attribute. One taxonomy for clicks and leads, or the two
    // numbers cannot be compared.
    url.searchParams.set('utm_source', new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').host);
    url.searchParams.set('utm_medium', 'cta');
    url.searchParams.set('utm_campaign', 'hobt');
    url.searchParams.set('utm_content', leadSource);
    url.searchParams.set('btt_locale', locale);

    return url.toString();
  } catch {
    return null;
  }
}

export function StartNowButton({
  startNowUrl,
  locale,
  leadSource,
  label = 'Start Now',
}: {
  // From `hobtPromo` on src/app/[locale]/hobt/page.tsx. Module 14 made the
  // /hobt BODY block-composed and left the field group PAGE-mounted, because
  // priceUsd and seatsLeft are commerce facts an editor must not be able to
  // reorder away — so this value is still a prop from the page query.
  readonly startNowUrl: string | null;
  readonly locale: string;
  readonly leadSource: (typeof LEAD_SOURCES)[number];
  readonly label?: string;
}) {
  const href = attributed(startNowUrl, leadSource, locale);

  if (href === null) {
    return null;
  }

  return (
    <Button asChild variant="blame" size="xl">
      {/*
        A real <a href>, not next/link: the target is off-site, so there is
        nothing to prefetch and nothing to client-side navigate.

        `noopener` severs window.opener so the destination cannot script this
        page. `noreferrer` also suppresses the Referer header — deliberately.
        The UTM parameters carry the attribution explicitly, so we can afford to
        stop leaking the full URL of the page to a third party. That trade only
        works because the parameters are there. Lesson 16.4 §7.
      */}
      <a href={href} rel="noopener noreferrer">
        {label}
      </a>
    </Button>
  );
}
```

### Step 5: Swap the CTA band's inline anchor

```tsx
// next-app/src/components/hobt/HobtCtaBand.tsx
// Anchored edit: replace the inline Start Now <Button asChild><a> block from
// Lesson 11.5 with the component. The null-and-empty-string check moves inside
// StartNowButton, which is where it belongs — it is a property of the value,
// not of the band.
import { GetDemoDialog } from '@/components/hobt/GetDemoDialog';
import { StartNowButton } from '@/components/hobt/StartNowButton';

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <StartNowButton startNowUrl={startNowUrl} locale={locale} leadSource={leadSource} />
        <GetDemoDialog source={leadSource} locale={locale} demoBookingUrl={demoBookingUrl} />
      </div>
```

**Verify §5:**

- [ ] `grep -c 'Start Now' src/components/hobt/HobtCtaBand.tsx` returns `0` — the string now lives
      in `StartNowButton`.
- [ ] `curl -s http://localhost:3000/en/hobt | grep -c 'utm_content=hobt-hero'` returns `1` or more.
- [ ] `curl -s http://localhost:3000/en/hobt | grep -c 'utm_content=hobt-footer'` returns `1` or
      more. Both bands are attributed, and distinguishably.

### Step 6: Write the funnel spec

Module 17's Starting State runs `npx playwright test e2e/funnel.spec.ts`. The filename is a
contract.

```ts
// next-app/e2e/funnel.spec.ts
// THE FUNNEL, end to end, across both applications.
//
// Locators are getByRole + accessible name ONLY, with one documented exception:
// <input type="password"> has no ARIA role, so getByRole('textbox') cannot
// match it in any browser and password fields use getByLabel. No data-testid,
// no CSS class, no nth-child, no XPath — a data-testid locator passes while the
// control is invisible, unlabelled and unreachable by keyboard, which is the
// opposite of what an end-to-end test is for.
//
// 127.0.0.1 for Next (baseURL, from playwright.config.ts — since Node 17
// `localhost` may resolve to ::1). localhost:8080 for WordPress, because
// WP_HOME is http://localhost:8080 and WordPress canonical-redirects anything
// else. Two hosts, two reasons, both deliberate.
//
// Playwright does NOT read .env.local (appendix 04 §3.1), so the two passwords
// come from the invoking shell:
//   BTT_REPORTER_PASSWORD=… BTT_EDITOR_PASSWORD=… npx playwright test e2e/funnel.spec.ts
//
// Cleanup is Lesson 12.4's e2e/global-setup.ts fixture reset, gated on
// E2E_MODE=1. This spec deletes nothing itself; run it without E2E_MODE and you
// accumulate one probe incident and one probe user per run.
import { expect, test } from '@playwright/test';

const WP = 'http://localhost:8080';
const MAILPIT = 'http://localhost:8025';

const REPORTER_PASSWORD = process.env.BTT_REPORTER_PASSWORD ?? '';
const EDITOR_PASSWORD = process.env.BTT_EDITOR_PASSWORD ?? '';

test.describe('the incident funnel', () => {
  test.skip(
    REPORTER_PASSWORD === '' || EDITOR_PASSWORD === '',
    'BTT_REPORTER_PASSWORD and BTT_EDITOR_PASSWORD must be in the invoking shell — appendix 04 §2'
  );

  test('a developer registers, submits, an editor approves, and the public sees it', async ({ page, request }) => {
    // Two applications, two logins, a cache and an email server. It is slow on
    // purpose rather than flaky on purpose.
    test.setTimeout(120_000);

    // A per-run identity. Registration MUST use a fresh address, because
    // registerDeveloper returns the same payload for an already-registered one
    // (Lesson 06.2 §8) and the spec would then assert nothing.
    const runId = `${Date.now().toString(36)}`;
    const email = `funnel-${runId}@example.test`;
    const title = `Funnel probe ${runId}`;
    // DERIVED from the title, not guessed. Unique, so WordPress never has to
    // append `-2` and the assertion below cannot drift.
    const slug = `funnel-probe-${runId}`;

    // ── 1. REGISTER ──────────────────────────────────────────────────
    await page.goto('/en/register');
    await page.getByRole('textbox', { name: 'Email address' }).fill(email);
    await page.getByRole('textbox', { name: 'Display name' }).fill(`Funnel ${runId}`);
    await page.getByRole('button', { name: 'Register' }).click();

    await expect(page.getByRole('status')).toContainText('Check your inbox');

    // ── 2. VERIFY, using the link WordPress actually mailed ──────────
    // Read it out of Mailpit rather than constructing it: the point of the
    // check is that the mail carries a working link.
    const inbox = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    expect(inbox.ok()).toBeTruthy();

    const messages = (await inbox.json()) as { messages: { ID: string; Subject: string }[] };
    expect(messages.messages.length).toBeGreaterThan(0);
    expect(messages.messages[0].Subject).toContain('Confirm your');

    const body = await request.get(`${MAILPIT}/api/v1/message/${messages.messages[0].ID}`);
    const text = ((await body.json()) as { Text: string }).Text;

    // The mailed URL is BTT_FRONTEND_URL-based — host.docker.internal:3000
    // locally, which the browser cannot resolve (Lesson 16.4 §4). Take the two
    // parameters and rebuild the path against baseURL.
    const uid = /[?&]uid=(\d+)/.exec(text)?.[1];
    const token = /[?&]token=([A-Za-z0-9]+)/.exec(text)?.[1];
    expect(uid, 'the verification mail carries a uid').toBeTruthy();
    expect(token, 'the verification mail carries a token').toBeTruthy();

    await page.goto(`/en/verify?uid=${uid}&token=${token}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // ── 3. LOG IN as the SEEDED reporter ─────────────────────────────
    // Not as the account just registered: registerDeveloper generates a
    // password with wp_generate_password() and deliberately never returns it
    // (Lesson 06.2 Step 4), so there is no credential for that account until
    // the reset flow. Step 1 proved registration and verification work; this
    // step needs a password that exists.
    await page.goto('/en/login');
    await page.getByRole('textbox', { name: /username|email/i }).fill('reporter');
    // The documented exception: password inputs expose no ARIA role.
    await page.getByLabel(/password/i).fill(REPORTER_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    // ── 4. SUBMIT ────────────────────────────────────────────────────
    await page.goto('/en/incidents/submit');
    await expect(page.getByRole('heading', { level: 1, name: 'Submit an incident' })).toBeVisible();

    await page.getByRole('textbox', { name: 'What happened' }).fill(title);
    await page.getByRole('textbox', { name: 'The full story' }).fill('Reproduced by e2e/funnel.spec.ts.');

    // Radix Select renders a combobox and a listbox of options, both with
    // accessible names. This is why the locator rule is not a burden.
    await page.getByRole('combobox', { name: 'Who is to blame' }).click();
    await page.getByRole('option', { name: 'The Intern' }).click();
    await page.getByRole('combobox', { name: 'How bad' }).click();
    await page.getByRole('option', { name: 'S2 — Major' }).click();

    await page.getByRole('textbox', { name: 'When it happened' }).fill('2024-06-01T09:00');
    await page.getByRole('spinbutton', { name: 'Downtime (minutes)' }).fill('42');

    await page.getByRole('button', { name: 'Submit for review' }).click();

    await expect(page.getByRole('heading', { name: 'Queued for review' })).toBeVisible();

    // ── 5. APPROVE, as a real editor, in real wp-admin ───────────────
    await page.goto(`${WP}/wp-login.php`);
    await page.getByRole('textbox', { name: /username or email/i }).fill('editor');
    await page.getByLabel(/^password$/i).fill(EDITOR_PASSWORD);
    await page.getByRole('button', { name: /log in/i }).click();

    // The queue defaults to `post_status=pending` for anyone who can publish,
    // so no query string is needed — which is also an assertion about Step 1.
    await page.goto(`${WP}/wp-admin/edit.php?post_type=incident`);

    const row = page.getByRole('row', { name: new RegExp(title) });
    await expect(row).toBeVisible();

    // WordPress hides `.row-actions` until the row is hovered or focused, so a
    // bare click would time out waiting for a visible element. Hover first.
    // This is the sort of thing that makes the spec fragile, and the remedy is
    // still a user-facing interaction rather than a CSS locator.
    await row.hover();
    await row.getByRole('link', { name: 'Approve' }).click();

    // ── 6. THE PUBLIC SEES IT ────────────────────────────────────────
    // The DETAIL page has never been rendered, so it has no cache entry and is
    // rendered on demand: visible immediately. The ARCHIVE does have a cache
    // entry and will not contain it until the revalidate window expires — which
    // is why this spec asserts the detail page and Lesson 18.3 fixes the rest.
    await page.goto(`/en/incidents/${slug}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

    // The reporter was told. Assert on the PATH, not on clickability: the URL
    // is BTT_FRONTEND_URL-based and points at host.docker.internal locally.
    const notice = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent('subject:Your incident is live')}`);
    const notices = (await notice.json()) as { messages: { ID: string }[] };
    expect(notices.messages.length).toBeGreaterThan(0);

    const noticeBody = await request.get(`${MAILPIT}/api/v1/message/${notices.messages[0].ID}`);
    const noticeText = ((await noticeBody.json()) as { Text: string }).Text;
    expect(noticeText).toContain('/en/account');
    expect(noticeText).not.toContain('wp-admin');
  });
});
```

**Verify §6:**

- [ ] `npx playwright test --list e2e/funnel.spec.ts` prints exactly **one** test, under the
      `smoke` project.
- [ ] `grep -c 'data-testid' e2e/funnel.spec.ts` returns `0`.
- [ ] `grep -c 'waitForTimeout' e2e/funnel.spec.ts` returns `0`.
- [ ] `grep -c 'getByLabel' e2e/funnel.spec.ts` returns `3` — the three password fields, and
      nothing else.

### Step 7: Write the two notes

```markdown
<!-- docs/testing-strategy.md — append to the document Lesson 12.1 created -->
## 7. The funnel spec (Lesson 16.4)

`e2e/funnel.spec.ts` is one test that crosses both applications, two authentication systems, a
cache and an email server. It is the most fragile spec in the suite and it is worth having anyway,
because it is the only thing that answers "does the product work".

| It controls | How |
|---|---|
| A fresh developer | a per-run email, so `email_exists()` never makes the registration a no-op |
| Email verification | read from Mailpit's API; the link's origin is rebuilt against `baseURL` |
| A reporter session | the **seeded** `reporter`, because `registerDeveloper` never returns a password |
| A predictable slug | derived from a run-id-bearing title, so WordPress never appends `-2` |
| An editor session | `wp-login.php`, from `BTT_EDITOR_PASSWORD` in the invoking shell |
| Cleanup | `e2e/global-setup.ts` with `E2E_MODE=1`. The spec deletes nothing itself |

**It asserts no counts.** It creates one incident and asserts on that one, so it cannot break when
the seed set stops being exactly forty incidents.

**It asserts the detail page, not the archive.** A never-rendered detail URL has no cache entry and
renders on demand; the archive has one and stays stale until the revalidate window expires. Asserting
the archive would mean sleeping, and a spec with a `sleep` in it is a spec that is slow *and* flaky.
Lesson 18.3 makes the archive assertable.

**Storage state is deferred to Lesson 23.6.** Reusing a logged-in profile is faster and hides the
login path this spec exists to prove, and it makes specs order-dependent. 23.6 introduces it with
the least-privilege `e2e_agent` account, once enough authenticated specs exist to pay for the
coupling. Until then the spec runs under `smoke`, the only project defined before Lesson 22.4.
```

```markdown
<!-- docs/runbook.md — append to the document Lesson 15.2 started -->
## The incident moderation queue

**Where.** `http://localhost:8080/wp-admin/edit.php?post_type=incident`. It defaults to
`post_status=pending` for anyone holding `publish_incidents`; the "All" link at the top of the
screen is the escape hatch.

**Who.** `editor` and `administrator`. `incident_reporter` has no `publish_incidents` capability
at all and is redirected away from wp-admin on `admin_init`, so there is nothing to configure and
nothing to audit.

**Approve** publishes the incident and sets `is_verified`. **Reject** returns it to `draft` — not
trash, so nothing is destroyed by a mis-click and an editor can still fix and publish it. Both send
the reporter a mail linking to `/{locale}/account`, never to wp-admin.

**Pausing submissions.** Site Settings → `incident_submission_open` → off. The submit page then
renders an explanatory panel and the Server Action refuses before it validates anything. It is a
content setting, not an authorisation control: a reporter with a valid JWT can still call
`createIncident` directly, and that is by design.

**After approving, the archive is stale.** The detail page appears immediately because it has never
been cached; `/en/incidents` and the scapegoat pages wait for the revalidate window. That gap closes
in Lesson 18.3, which signs a webhook from the same `transition_post_status` hook this queue uses.

**Rotating `BTT_LEAD_IP_HMAC_KEY`** (Lesson 16.3) makes every stored `ip_hash` unlinkable from every
new one. That is a deletion mechanism and it destroys abuse-detection history. Record the date here
when you do it.

**Fixture note.** Module 15's `map_meta_cap` filter withholds `create_incidents` from a reporter
whose `btt_verified` meta is not `1`. A seeded or pre-existing reporter has no such meta, so run
`wp user meta update reporter btt_verified 1` once after a fresh seed, or the submit form refuses a
correctly authenticated reporter with a permission error.
```

### Step 8: Walk it by hand before you trust the spec

A green spec you have never seen fail on a loop you have never walked is not evidence. Do all six,
in order, and watch each one.

```bash
cd wordpress-headless

# The fixture note from Step 7, once per fresh seed.
docker compose run --rm wpcli wp user meta update reporter btt_verified 1

# 1. Sign in at http://localhost:3000/en/login as `reporter`.
# 2. Submit an incident at http://localhost:3000/en/incidents/submit.
# 3. Open http://localhost:8080/wp-admin/edit.php?post_type=incident as an
#    editor. It should already be filtered to pending. Hover the row.
# 4. Click Approve.
# 5. Read the mail in http://localhost:8025 — check the link says /en/account.
# 6. Load http://localhost:3000/en/incidents/<slug> (it is there) and then
#    http://localhost:3000/en/incidents (it is NOT). Sit with that for a minute.
#    That gap is what Lesson 18.3 closes, and it is the whole reason the webhook
#    is worth building.
```

**Verify §8:**

- [ ] Step 3 showed a filtered list without your typing a query string.
- [ ] Step 5's mail contains `/en/account` and no `wp-admin` URL.
- [ ] Step 6's detail page rendered and the archive did not list it. If the archive *did* list it,
      your `/en/incidents` route has no `revalidate` and is rendering on every request — check
      Lesson 10.3's policy table before you celebrate.

---

## Verification

```bash
cd wordpress-headless

# 0. This shell session only. Playwright does not read .env.local.
export BTT_REPORTER_PASSWORD='<the value the seeder used>'
export BTT_EDITOR_PASSWORD='<the value the seeder used>'
test -n "$BTT_EDITOR_PASSWORD" && echo 'passwords loaded' || echo 'MISSING — appendix 04 §2'
# Expected: passwords loaded

docker compose run --rm wpcli wp user meta update reporter btt_verified 1
# Expected: Success — Module 15's map_meta_cap gate needs this on a seeded user

# 1. The queue exists and is pending-by-default
docker compose run --rm wpcli wp post list --post_type=incident --post_status=pending --fields=ID,post_title
# Expected: at least the incident you submitted in Lesson 16.2 or Step 8

# 2. The Approve round trip flips a real incident to `publish`. Do it in
#    wp-admin, hovering the row, then read the result here.
SLUG=$(docker compose run --rm -T wpcli wp post list --post_type=incident \
  --post_status=publish --posts_per_page=1 --orderby=modified --field=post_name --format=ids | tr -d '\r')
docker compose run --rm wpcli wp post get "$SLUG" --field=post_status
# Expected: publish
docker compose run --rm wpcli wp post meta get "$SLUG" is_verified
# Expected: 1 — Lesson 03.4's approve_incident() records the moderation fact

# 3. The reporter was mailed, and the mail points at the FRONT END
curl -s "http://localhost:8025/api/v1/search?query=subject%3AYour%20incident%20is%20live" \
  | jq -r '.messages[0].ID' > /tmp/btt-mail-id
curl -s "http://localhost:8025/api/v1/message/$(cat /tmp/btt-mail-id)" | jq -r '.Text'
# Expected: the body, containing "/en/account"
curl -s "http://localhost:8025/api/v1/message/$(cat /tmp/btt-mail-id)" | jq -r '.Text' | grep -c 'wp-admin'
# Expected: 0 — the recipient has no dashboard (Key Concept 4)
curl -s "http://localhost:8025/api/v1/message/$(cat /tmp/btt-mail-id)" | jq -r '.Text' | grep -c '/en/account'
# Expected: 1

# 4. The incident is publicly visible. The DETAIL page has no cache entry, so it
#    renders on demand and appears immediately.
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000/en/incidents/$SLUG"
# Expected: 200

#    The ARCHIVE does have a cache entry, and does NOT contain it yet. This is
#    the gap, and it is the point (Key Concept 6). No `sleep`: either wait out
#    the revalidate window from Lesson 10.3's policy table, or restart
#    `npm run dev` to drop the in-memory cache. Module 18 removes the wait.
curl -s http://localhost:3000/en/incidents | grep -c "$SLUG"
# Expected: 0 immediately after approving, and 1 after the window expires.
#           If it is 1 straight away, that route is not cached at all.

# 5. THE SPEC. This exact command is Module 17's Starting State.
cd ../next-app
npx playwright test e2e/funnel.spec.ts
# Expected: 1 passed

# 6. NEGATIVE — the kill switch. Turn `incident_submission_open` off in
#    Site Settings in wp-admin, then:
BEFORE=$(cd ../wordpress-headless && docker compose run --rm -T wpcli \
  wp post list --post_type=incident --format=count | tr -d '\r')
curl -s http://localhost:3000/en/incidents/submit | grep -c 'Submissions are paused'
# Expected: 1 — the page refuses POLITELY. Not a 500, not an error boundary.
#    Now submit through the action anyway (the form is not rendered, so use the
#    always-available copy or re-enable JS and submit the stale page):
cd ../wordpress-headless && docker compose run --rm -T wpcli \
  wp post list --post_type=incident --format=count | tr -d '\r'
# Expected: exactly BEFORE. The action refused before it validated anything.
echo "before=$BEFORE"
#    Turn the switch back on before continuing.

# 7. NEGATIVE — a reporter cannot publish, and there is no code path to audit
#    because there is no capability to abuse. This is copy-pasteable and proves
#    more reliably than hand-crafting a POST to post.php.
docker compose run --rm wpcli wp eval '
  wp_set_current_user( get_user_by( "login", "reporter" )->ID );
  var_export( current_user_can( "publish_incidents" ) );
  echo PHP_EOL;'
# Expected: false
docker compose run --rm wpcli wp eval '
  wp_set_current_user( get_user_by( "login", "editor" )->ID );
  var_export( current_user_can( "publish_incidents" ) );
  echo PHP_EOL;'
# Expected: true — the two answers together are the whole argument

# 8. NEGATIVE — a reporter's real token at /graphql cannot publish either.
#    createIncident forces `pending`, AND wp_insert_post() would downgrade it
#    anyway for an author without publish_incidents. Two mechanisms.
JWT=$(curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "{\"query\":\"mutation{login(input:{username:\\\"reporter\\\",password:\\\"$BTT_REPORTER_PASSWORD\\\"}){authToken}}\"}" \
  | jq -r '.data.login.authToken')
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $JWT" \
  -d '{"query":"mutation($i:CreateIncidentInput!){createIncident(input:$i){incident{slug status}}}",
       "variables":{"i":{"title":"Publish probe 164","scapegoatSlug":"dns","severitySlug":"s3-minor",
                         "occurredAt":"2024-06-01 09:00:00","downtimeMinutes":3,
                         "environment":"STAGING","status":"PUBLISH"}}}' \
  | jq -r '.data.createIncident.incident.status'
# Expected: pending

# 9. NEGATIVE — the Reject row action does not render for a reporter, because
#    incident_row_actions() and incident_reject_row_action() both return early
#    on the capability check. Assert the capability, which is the reason.
docker compose run --rm wpcli wp eval '
  wp_set_current_user( get_user_by( "login", "reporter" )->ID );
  $p = get_posts( array( "post_type" => "incident", "post_status" => "pending", "numberposts" => 1 ) );
  var_export( ! empty( $p ) && current_user_can( "edit_post", $p[0]->ID ) );
  echo PHP_EOL;'
# Expected: false — a reporter cannot even edit somebody else's pending incident

# 10. NEGATIVE — every state-changing row action verifies a nonce. Structural
#     authorization does NOT replace this: CSRF against a capable editor passes
#     every capability check there is (Key Concept 3).
grep -c 'check_admin_referer' wp-content/plugins/blame-the-tech-core/includes/admin/moderation-queue.php
# Expected: 1
grep -c 'wp_nonce_url' wp-content/plugins/blame-the-tech-core/includes/admin/moderation-queue.php
# Expected: 1
grep -c 'wp-admin' wp-content/plugins/blame-the-tech-core/includes/admin/moderation-queue.php
# Expected: 0 — every admin URL is built with admin_url(), and the reporter mail
#           is built from BTT_FRONTEND_URL. A literal 'wp-admin' string in this
#           file would be either a hard-coded admin path or a mail destination
#           the recipient cannot use.

# 11. NEGATIVE — the columns were EXTENDED, not re-registered
curl -s -u "editor:$BTT_EDITOR_PASSWORD" \
  'http://localhost:8080/wp-admin/edit.php?post_type=incident' 2>/dev/null | grep -c 'column-taxonomy-severity'
# Expected: 1 — one Severity column header, not two. (If basic auth is not
#           enabled on your wp-admin, read the screen in a browser instead: the
#           assertion is "exactly one of each column".)
grep -c "manage_incident_posts_columns" wp-content/plugins/blame-the-tech-core/includes/admin/moderation-queue.php
# Expected: 1 — a filter at priority 20 that REORDERS. Lesson 03.3's
#           show_admin_column created these columns; adding them again makes two.

# 12. Both suites green, which is Module 17's second Starting State check
cd ../next-app && npm test -- --run && npx playwright test
# Expected: 0 failures

# 13. Clean up the probe
cd ../wordpress-headless
PID=$(docker compose run --rm -T wpcli wp post list --post_type=incident \
  --title='Publish probe 164' --field=ID --format=ids | tr -d '\r')
test -n "$PID" && docker compose run --rm wpcli wp post delete "$PID" --force
rm -f /tmp/btt-mail-id
git status --short
# Expected: no .env, no .env.local
```

Checks 6, 7, 9 and 10 are the four that define this lesson: the kill switch refuses politely and
writes nothing, a reporter has no publishing capability so there is no code path to audit, the row
actions do not render for the user who could not use them anyway, and every state-changing action
still verifies a nonce because a capability and a nonce answer different questions.

## Control Questions

1. Lesson 03.4's `incident_row_actions()` checks `current_user_can( 'publish_incidents' )` before
   rendering Approve, and `handle_approve_incident()` checks it again. Given that
   `incident_reporter` does not hold the capability at all, argue for keeping both checks — and then
   say which of the two you would keep if you had to delete one.
2. A colleague removes `check_admin_referer()` from `handle_reject_incident()`, reasoning that
   `current_user_can( 'publish_incidents' )` already stops reporters. Describe the attack that is
   now available, name whose browser performs it, and explain why the capability check does not
   prevent it.
3. `notify_reporter_on_transition()` has four early returns before it does anything. For each one,
   name the concrete symptom you would see in Mailpit if you deleted it.
4. `incidentSubmissionOpen === false` closes the form, and a `null` leaves it open — while a missing
   `UPSTASH_REDIS_REST_URL` refuses every write. Both are absent values. State the one question that
   tells you which default is correct, and apply it to `BTT_APP_TOKEN` being an empty string.
5. Immediately after approving, `/en/incidents/<slug>` returns 200 and `/en/incidents` does not list
   the incident. Explain the asymmetry in terms of cache entries, say which of the two an editor is
   more likely to check, and describe what Lesson 18.3 has to invalidate to close the gap.

## Learn More

- [`transition_post_status`](https://developer.wordpress.org/reference/hooks/transition_post_status/) —
  the argument order, and the list of transitions core fires that you did not expect
- [`post_row_actions`](https://developer.wordpress.org/reference/hooks/post_row_actions/) — the
  filter, and the `$post` argument that makes a per-row capability check possible
- [`pre_get_posts`](https://developer.wordpress.org/reference/hooks/pre_get_posts/) — read the
  warning about `is_main_query()`; a queue that also filters the front end is the classic mistake
- [WordPress nonces](https://developer.wordpress.org/apis/security/nonces/) — the handbook page that
  states explicitly that a nonce is not an authorisation check
- [`wp_nonce_url()`](https://developer.wordpress.org/reference/functions/wp_nonce_url/) — and
  `check_admin_referer()` beside it, which is the half that `wp_die()`s
- [Roles and capabilities](https://developer.wordpress.org/plugins/users/roles-and-capabilities/) —
  the model that makes withholding `publish_incidents` structural rather than procedural
- [Playwright: best practices](https://playwright.dev/docs/best-practices) — the locator hierarchy
  Key Concept 8 follows, in Playwright's own words
- [Playwright: authentication](https://playwright.dev/docs/auth) — storage state, so you can see
  exactly what Lesson 23.6 is deferring and why
- [Mailpit: API v1](https://mailpit.axllent.org/docs/api-v1/) — the `search` and `message` endpoints
  the funnel spec reads the verification link out of
