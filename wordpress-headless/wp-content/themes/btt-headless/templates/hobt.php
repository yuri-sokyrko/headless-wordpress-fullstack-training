<?php

/**
 * Template Name: HOBT Landing
 * Template Post Type: page
 *
 * This template never renders for a visitor. It exists so that:
 *
 *   1. Wordpress lists "HOBT Landing" in the Page Attributes box, which sets
 *      _wp_page_tamplate to 'templates/hobt.php;
 *   2. the SCF location rule `page_template == templates/hobt.php` can match,
 *      which is what makes the HOBT Promo field group appear.
 *
 * Reaching this output means btt_headless_redirect() did not fire. Treat it as
 * a diagnostic, exactly like the theme's index.php.
 *
 * @package btt-headless
 */

defined('ABSPATH') || exit;

$btt_frontend = defined('BTT_FRONTEND_URL') ? BTT_FRONTEND_URL : '/';
?>

<!doctype html>
<html <?php language_attributes(); ?>>

<head>
	<meta charset="<?php bloginfo('charset'); ?>">
	<meta name="robots" content="noindex, nofollow">
	<title><?php echo esc_html(get_the_title()); ?></title>
</head>

<body>
	<p>This page is rendered by the Next.js application, not by WordPress.</p>
	<p><a href="<?php echo esc_url($btt_frontend); ?>"><?php echo esc_html($btt_frontend); ?></a></p>
</body>

</html>
