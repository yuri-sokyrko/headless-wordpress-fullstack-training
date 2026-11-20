<?php
/**
 * The revalidation webhook: WordPress tells Next what changed.
 *
 * THREE TRIGGERS, ONE PAYLOAD BUILDER, ONE SIGNED POST — and no cache tag
 * strings anywhere in this file. The payload carries WordPress IDENTIFIERS
 * (`post_type`, `taxonomy`, `post_name`, `term_id`) and Next builds the tags
 * from them with src/lib/graphql/tags.ts. That way there is exactly one tag
 * builder in the system, and an identifier this app does not recognise is a
 * loud 400 rather than a tag nothing carries. Lesson 18.3 §8.
 *
 * `blocking => false` means WordPress never sees the response, so there is no
 * error handling here to write and none to read. Every diagnostic is on the
 * Next side; the error_log() line below records the INTENT and nothing more.
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core;

defined('ABSPATH') || exit;

/**
 * Post types the front end renders. A type that is absent is not an omission:
 * `nav_menu_item`, `attachment`, `revision` and `acf-field-group` all
 * transition statuses and none of them has a page.
 */
const REVALIDATE_POST_TYPES = array('incident', 'post', 'tech_review', 'page');

/**
 * Taxonomies the front end renders. `nav_menu` is deliberately absent — the tag
 * is keyed on the theme LOCATION, not the menu's slug, and the payload's `type`
 * enum has no shape for it. Recorded as a gap in docs/api-contract.md.
 */
const REVALIDATE_TAXONOMIES = array('scapegoat', 'severity', 'tech_stack');

add_action('transition_post_status', __NAMESPACE__ . '\\revalidate_on_transition', 10, 3);
add_action('saved_term', __NAMESPACE__ . '\\revalidate_on_saved_term', 10, 3);

// Priority 20, AFTER SCF has written the fields. At 10 you can win the race and
// send a webhook describing the previous values.
add_action('acf/save_post', __NAMESPACE__ . '\\revalidate_on_acf_save', 20);

/**
 * A post's status changed, or a published post was saved.
 *
 * A SECOND, INDEPENDENT handler on this hook. includes/admin/moderation-queue.php
 * (Lesson 16.4) already registered notify_reporter_on_transition() with the same
 * guard set, and it stays there: mailing a reporter and invalidating a cache
 * have nothing to say to each other, and neither must be able to prevent the
 * other. Lesson 18.3 §2.
 */
function revalidate_on_transition(string $new_status, string $old_status, \WP_Post $post): void {
	if(!in_array($post->post_type, REVALIDATE_POST_TYPES, true)) {
		return;
	}

	// Autosaves and revisions transition statuses too. Without these two the
	// block editor fires a webhook every sixty seconds, forever, invisibly.
	if(wp_is_post_revision($post) || wp_is_post_autosave($post)) {
		return;
	}

	// The public site only changes when `publish` is on one side of the
	// transition. draft -> pending is an editorial event with no public
	// consequence; publish -> trash is very much one; publish -> publish is a
	// title or content edit and MUST fire. Lesson 16.4 Key Concept 4 has the
	// full table.
	if('publish' !== $new_status && 'publish' !== $old_status) {
		return;
	}

	revalidate_send(
		array(
			'type' => 'post',
			'postType' => $post->post_type,
			// post_name, never post_title: the slug is what the front end
			// routes on and what tags.ts tagged with.
			'slug' => $post->post_name,
			'locale' => revalidate_locale_of_post($post),
		)
	);
}

/**
 * A term was created, renamed or re-slugged.
 *
 * `saved_term` fires for every taxonomy, including `nav_menu` — hence the
 * allowlist. It also fires on term creation, which is correct: a new scapegoat
 * appears in the leaderboard and in the submit form's allowlist.
 */
function revalidate_on_saved_term(int $term_id, int $tt_id, string $taxonomy): void {
	if(!in_array($taxonomy, REVALIDATE_TAXONOMIES, true)) {
		return;
	}

	revalidate_send_term($term_id);
}

/**
 * An SCF field group was saved.
 *
 * This is the trigger that is easy to leave out and expensive to leave out. An
 * SCF-only edit to a PUBLISHED post changes no status, so the transition hook
 * above sees `publish -> publish` and this hook is what carries the detail
 * about which fields moved. After Lesson 18.1 made /hobt `revalidate: false`,
 * it is the only thing that keeps `seatsLeft` current.
 *
 * SCF's $post_id has three shapes and they are not documented next to each
 * other: an integer post ID, the string `options` for an options page, and
 * `term_<id>` for a term field group.
 *
 * @param int|string $post_id SCF's polymorphic identifier.
 */
function revalidate_on_acf_save($post_id): void {
	$id = (string) $post_id;

	// The SCF options page from appendix 03 §4.5 — site settings, one tag.
	if('options' === $id || 'option' === $id) {
		revalidate_send(array('type' => 'options', 'locale' => 'en'));
		return;
	}

	// A term field group. `Scapegoat Profile` (appendix 03 §4.2) arrives here,
	// which is how an editor filling in a tagline invalidates that term's page.
	if(1 === preg_match('/^term_(\d+)$/', $id, $matches)) {
		revalidate_send_term((int) $matches[1]);
		return;
	}

	$post = get_post(absint($post_id));

	if(!$post instanceof \WP_Post || !in_array($post->post_type, REVALIDATE_POST_TYPES, true)) {
		return;
	}

	// A draft's fields changing has no public consequence. When it is published
	// the transition hook fires and picks up everything at once.
	if('publish' !== $post->post_status) {
		return;
	}

	revalidate_send(
		array(
			'type' => 'post',
			'postType' => $post->post_type,
			'slug' => $post->post_name,
			'locale' => revalidate_locale_of_post($post),
		)
	);
}

/**
 * The term payload, including BOTH keys Next needs.
 *
 * `term_id` is here to discharge Lesson 14.4's debt: ScapegoatPicker tags its
 * fetch with termTag('scapegoat', String(termId)) because the block stores a
 * term ID and cannot know the slug before the response arrives. Next emits both
 * the slug-keyed and the ID-keyed tag. Lesson 18.3 §9.
 */
function revalidate_send_term(int $term_id): void {
	$term = get_term($term_id);

	if(!$term instanceof \WP_Term || !in_array($term->taxonomy, REVALIDATE_TAXONOMIES, true)) {
		return;
	}

	revalidate_send(
		array(
			'type' => 'term',
			'taxonomy' => $term->taxonomy,
			'slug' => $term->slug,
			'termId' => $term_id,
			'locale' => 'en',
 		)
	);
}

/**
 * The post's locale.
 *
 * Hard-coded until Module 20 installs Polylang, and a function rather than a
 * literal so 20.4 changes one line. Next already parses this key and
 * deliberately puts nothing from it into a tag — Module 18 emits locale-free
 * tags and 20.4 is where the locale starts mattering.
 */
function revalidate_locale_of_post(\WP_Post $post): string {
	if(function_exists('pll_get_post_language')) {
		$language = pll_get_post_language($post->ID, 'slug');

		if(is_string($language) && '' !== $language) {
			return $language;
		}
	}

	return 'en';
}

/**
 * Sign and fire. The ONLY place BTT_REVALIDATE_SECRET is read.
 *
 * @param array<string, mixed> $payload Identifiers, never tag strings.
 */function revalidate_send(array $payload): void {
	$base = untrailingslashit((string) getenv('BTT_FRONTEND_URL'));
	$secret = (string) getenv('BTT_REVALIDATE_SECRET');

	// FAIL CLOSED AND QUIET. A missing secret must not fire an unsigned request
	// that Next answers with a 401 nobody is watching for.
	if('' === $base || '' === $secret || '__CHANGE_ME__' === $secret) {
		return;
	}

	// Encode ONCE, into a variable. Sign THAT variable and send THAT variable.
	// Encoding twice — once to sign, once to send — is how PHP produces two
	// different byte strings from one array, and the signed bytes and the sent
	// bytes differing is its own vulnerability class. Lesson 18.3 §6.
	$body = wp_json_encode($payload);

	if(!is_string($body)) {
		return;
	}

	$timestamp = (string) time();
	$signature = hash_hmac('sha256', $timestamp . '.' . $body, $secret);

	// The return value is DISCARDED deliberately. With blocking => false there
	// is no response and no WP_Error to inspect — is_wp_error() here would be a
	// check that cannot fail. Lesson 18.3 §4.
	wp_remote_post(
		$base . '/api/revalidate',
		array(
			'headers' => array(
				'Content-Type' => 'application/json',
				'X-BTT-Timestamp' => $timestamp,
				'X-BTT-Signature' => 'sha256=' . $signature,
			),
			'body' => $body,
			// The editor's Publish must NEVER wait on a network call, and a
			// slow front end must never become an editorial outage.
			'blocking' => false,
			'timeout' => 2,
		)
	);

	if(defined('WP_DEBUG') && WP_DEBUG) {
		// The only trace on this side. It records the INTENT — never the
		// secret, never the signature — and it is what makes appendix 06 §4's
		// first diagnostic step possible at all.
		error_log(sprintf('[btt] revalidate -> %s %s', $base . '/api/revalidate', $body));
	}
 }
