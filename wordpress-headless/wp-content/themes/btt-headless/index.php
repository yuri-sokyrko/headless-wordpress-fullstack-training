<?php
// The mandatory last-resort template. WordPress falls back here when nothing more
// specific matches, so the file must exist for the theme to be valid.
//
// Reaching this page means the template_redirect hook in functions.php did NOT fire.
// Treat it as a diagnostic, not a page: check the guards in btt_headless_redirect().

$btt_frontend = defined('BTT_FRONTEND_URL') ? BTT_FRONTEND_URL : '/';
?>

<!DOCTYPE html>
<html <?php language_attributes(); ?>>

<head>
	<meta charset="<?php bloginfo('charset'); ?>">
	<meta name="robots" content="noindex, nofollow">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title><?php echo esc_html(get_bloginfo('name')); ?></title>
</head>
</head>

<body>
	<p>This WordPress install is headless. It serves an API, not pages.</p>
	<p><a href="<?php echo esc_url($btt_frontend); ?>"><?php echo esc_html($btt_frontend); ?></a></p>
</body>

</html>
