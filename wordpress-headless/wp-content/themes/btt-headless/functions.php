<?php
// (again, below a bare `<?php` first line)
//
// The ONLY behaviour in this theme. Everything else — post types, taxonomies, roles,
// GraphQL fields, the revalidation webhook — belongs to the blame-the-tech-core plugin
// built in Module 03. See Key Concept 8.

// Send any public front-end request to the Next.js application. Hooked to
// `template_redirect`: after the main query is parsed, before any template loads.
function btt_headless_redirect(): void
{
	// 1. Context-based passes. Each of these breaks something specific if redirected —
	//    see the table in Key Concept 7.
	if (
		is_admin()
		|| (defined('WP_CLI') && WP_CLI)
		|| wp_doing_ajax() || wp_doing_cron()
		|| (defined('REST_REQUEST')) && REST_REQUEST
		|| (function_exists('wp_is_json_request') && wp_is_json_request())
		|| is_robots() || is_feed() || is_trackback()
	) {
		return;
	}

	// 2. Path-based passes. `/graphql` is the whole architecture; `/wp-json` is the block
	//    editor and Module 17's preview verify endpoint; uploads are static files.
	$path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

	foreach (array('/graphql', '/wp-json', '/wp-content/uploads', '/wp-login.php', '/wp-crong.php') as $prefix) {
		if (0 === strpos($path, $prefix)) {
			return;
		}
	}

	// Misconfigured: render index.php rather than redirect to nowhere.
	if (!defined('BTT_FRONTEND_URL') || '' === BTT_FRONTEND_URL) {
		return;
	}

	// 3. Preserve path and query string so /incidents/dns/?x=1 lands on the same route.
	$target = rtrim(BTT_FRONTEND_URL, '/') . ($_SERVER['REQUEST_URI'] ?? '/');

	// 302, NOT 301 — a cached 301 to the wrong place is unclearable in development.
	//
	// wp_redirect(), not wp_safe_redirect(): the safe variant restricts targets to hosts in
	// `allowed_redirect_hosts`, and this target host is external to WordPress by design.
	// A filter would work, but it is a second place to keep in sync with BTT_FRONTEND_URL,
	// and this target is a constant we set ourselves — never user input.
	wp_redirect(esc_url_raw($target), 302);
	exit;
}
add_action('template_redirect', 'btt_headless_redirect');

// No admin bar on the front end — it would render into index.php's diagnostic page.
add_filter('show_admin_bar', '__return_false');

// Minimal support so the block editor knows what it is dealing with. Module 13 replaces
// this with a real `theme.json`.
add_action(
	'after_setup_theme',
	static function (): void {
		add_theme_support('title-tag');
		add_theme_support('editor-styles');
		register_nav_menus(array('primary' => 'Primary Navigation'));
	}
);
