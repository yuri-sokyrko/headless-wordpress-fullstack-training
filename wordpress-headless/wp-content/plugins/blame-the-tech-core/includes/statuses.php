<?php

/**
 * Registered post meta and the moderation statuses.
 *
 * Contract: .lessons/appendix/03-content-model-reference.md §4.1
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core;

defined('ABSPATH') || exit;

/** A moderated submission that will never be published. Not `draft`, not deleted. */
const STATUS_REJECTED = 'btt_rejected';

add_action('init', __NAMESPACE__ . '\\register_moderation_statuses');
add_action('init', __NAMESPACE__ . '\\register_incident_meta');

/** Register the terminal "no": kept, filterable, never publishable. */
function register_moderation_statuses(): void
{
	register_post_status(
		STATUS_REJECTED,
		array(
			'label'                     => _x('Rejected', 'post status', 'blame-the-tech-core'),
			'public'                    => false, // never resolvable on the front end
			'internal'                  => false, // but editors may see and filter it
			'protected'                 => true,
			'exclude_from_search'       => true,
			'show_in_admin_all_list'    => false, // keep the queue clean
			'show_in_admin_status_list' => true,  // but give it a filter link and a count
			// The plural form is identical here; _n_noop() still wants both.
			'label_count'               => _n_noop(
				'Rejected <span class="count">(%s)</span>',
				'Rejected <span class="count">(%s)</span>',
				'blame-the-tech-core'
			),
		)
	);
}

/** Closed value sets. Lesson 06.1 turns these into real GraphQL enums. */
const INCIDENT_ENVIRONMENTS = array('production', 'staging', 'development', 'works-on-my-machine');
const INCIDENT_RESOLUTIONS  = array('open', 'mitigated', 'blamed', 'wontfix');

/** Clamp a numeric meta value into its documented range. */
function clamp_number(mixed $value, float $min, float $max): float
{
	return (float) max($min, min($max, (float) $value));
}

/**
 * Build a sanitiser that only lets a value through if it is in the list.
 *
 * @param string[] $allowed Allowed values; the first is the fallback.
 */
function one_of(array $allowed): callable
{
	return static fn($value): string =>
	in_array((string) $value, $allowed, true) ? (string) $value : $allowed[0];
}

/**
 * Normalise a date-time string, rejecting anything in the future. Returns ''
 * rather than a wrong value: an empty field is visibly missing, where a
 * silently corrected date is a lie the front end will render.
 */
function sanitize_occurred_at(mixed $value): string
{
	$time = strtotime(sanitize_text_field((string) $value));

	return (false === $time || $time > time()) ? '' : gmdate('Y-m-d H:i:s', $time);
}

/**
 * May this user write incident meta at all? Core's `$allowed` guess is
 * deliberately ignored — the signature is fixed by `map_meta_cap()`.
 *
 * @param bool   $allowed   Core's guess.
 * @param string $meta_key  Meta key.
 * @param int    $object_id Post ID.
 * @param int    $user_id   User ID.
 */
function can_edit_incident_meta(bool $allowed, string $meta_key, int $object_id, int $user_id): bool
{
	return user_can($user_id, 'edit_post', $object_id);
}

/**
 * May this user write MODERATOR-ONLY incident meta? `is_verified` is the trust
 * boundary from appendix 03 §4.1: a reporter may edit their own pending
 * incident and still cannot set this. Same four arguments as above.
 */
function can_moderate_incident_meta(bool $allowed, string $meta_key, int $object_id, int $user_id): bool
{
	return user_can($user_id, 'edit_others_incidents');
}

/**
 * Register every non-taxonomy field of `incident`.
 *
 * ACF builds the editing UI for these keys in Module 04 and writes to the same
 * rows; registration gives them a type, a sanitiser, a REST projection and an
 * authorisation callback. The spec array below IS appendix 03 §4.1, in code:
 * key => [ type, sanitize_callback, overrides ].
 */
function register_incident_meta(): void
{
	$editable  = __NAMESPACE__ . '\\can_edit_incident_meta';
	$moderator = __NAMESPACE__ . '\\can_moderate_incident_meta';

	$meta = array(
		'occurred_at'           => array('string', __NAMESPACE__ . '\\sanitize_occurred_at'),
		'downtime_minutes'      => array('number', static fn($v): float => clamp_number($v, 0, 100000)),
		'estimated_cost_usd'    => array('number', static fn($v): float => clamp_number($v, 0, 1000000000)),
		'blame_confidence'      => array('number', static fn($v): float => clamp_number($v, 0, 100), array('default' => 73)),
		'environment'           => array('string', one_of(INCIDENT_ENVIRONMENTS), array('default' => INCIDENT_ENVIRONMENTS[0])),
		'resolution_status'     => array('string', one_of(INCIDENT_RESOLUTIONS), array('default' => INCIDENT_RESOLUTIONS[0])),
		// sanitize_textarea_field, NOT wp_kses_post: a stack trace is not HTML.
		// It renders inside <pre>, escaped on output (Module 14), never through
		// dangerouslySetInnerHTML.
		'stack_trace'           => array('string', 'sanitize_textarea_field'),
		'reporter_display_name' => array('string', 'sanitize_text_field'),
		// The one key with a different auth_callback. That is the whole point.
		'is_verified'           => array(
			'boolean',
			static fn($v): bool => (bool) $v,
			array(
				'default'           => false,
				'auth_callback'     => $moderator,
				'revisions_enabled' => false, // a moderation fact, not editorial content
			),
		),
	);

	foreach ($meta as $key => $spec) {
		register_post_meta(
			'incident',
			$key,
			array_merge(
				array(
					'type'              => $spec[0],
					'single'            => true,
					'show_in_rest'      => true,
					'revisions_enabled' => true,
					'sanitize_callback' => $spec[1],
					'auth_callback'     => $editable,
				),
				$spec[2] ?? array()
			)
		);
	}
}
