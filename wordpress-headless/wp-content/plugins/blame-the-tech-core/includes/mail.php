<?php
/**
 * Route development mail to the configured SMTP sink.
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core;

use PHPMailer\PHPMailer\Exception;
use PHPMailer\PHPMailer\PHPMailer;

defined( 'ABSPATH' ) || exit;

/**
 * PHPMailer rejects WordPress's default sender for a localhost site.
 *
 * @param string $email Sender address.
 */
function mailpit_default_sender( string $email ): string {
	if ( 'mailpit' === getenv( 'BTT_SMTP_HOST' ) && 'wordpress@localhost' === $email ) {
		return 'wordpress@blame-the-tech.test';
	}

	return $email;
}
add_filter( 'wp_mail_from', __NAMESPACE__ . '\\mailpit_default_sender' );

/**
 * Use the unauthenticated Mailpit transport when explicitly configured.
 *
 * @param PHPMailer $mailer WordPress's mail transport.
 * @throws Exception On an invalid SMTP port.
 */
function configure_smtp( PHPMailer $mailer ): void {
	$host = getenv( 'BTT_SMTP_HOST' );
	if ( false === $host || '' === $host ) {
		return;
	}

	$port = getenv( 'BTT_SMTP_PORT' );
	$port = filter_var(
		false === $port || '' === $port ? '1025' : $port,
		FILTER_VALIDATE_INT,
		array(
			'options' => array(
				'min_range' => 1,
				'max_range' => 65535,
			),
		)
	);

	if ( false === $port ) {
		throw new Exception( 'BTT_SMTP_PORT must be an integer between 1 and 65535.' );
	}

	$mailer->isSMTP();
	// phpcs:disable WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- PHPMailer property names.
	$mailer->Host        = $host;
	$mailer->Port        = $port;
	$mailer->SMTPAuth    = false;
	$mailer->SMTPSecure  = '';
	$mailer->SMTPAutoTLS = false;
	// phpcs:enable WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
}
add_action( 'phpmailer_init', __NAMESPACE__ . '\\configure_smtp' );

/**
 * Log transport failures without exposing recipients or message contents.
 *
 * @param \WP_Error $error Mail transport error.
 */
function log_mail_failure( \WP_Error $error ): void {
	// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- Delivery failures need an operational log.
	error_log( 'Blame The Tech mail failure: ' . $error->get_error_message() );
}
add_action( 'wp_mail_failed', __NAMESPACE__ . '\\log_mail_failure' );
