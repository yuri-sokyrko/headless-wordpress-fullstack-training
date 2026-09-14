<?php

/**
 * Runs when the plugin is DELETED from the plugins screen or by
 * `wp plugin delete`. Never on deactivation.
 *
 * WordPress loads this file in isolation with WP_UNINSTALL_PLUGIN defined and
 * no plugin code loaded, so it can use core functions and nothing else.
 *
 * @package Blame\Core
 */

declare(strict_types=1);

// Without this guard the file is directly requestable over HTTP.
defined('WP_UNINSTALL_PLUGIN') || exit;

// Our own bookkeeping. Safe to delete.
delete_option('btt_core_version');
delete_option('btt_db_version');

// Rules that mention post types nothing will register any more.
delete_option('rewrite_rules');

// Lesson 03.5 adds `remove_role( 'incident_reporter' );` here.

/*
 * Deliberately NOT deleted: posts, terms, post meta, uploads, wp_btt_leads.
 * The content is the user's, not the plugin's. A destructive teardown belongs
 * behind an explicit `wp blame reset` (Module 12), typed by a human.
 */
