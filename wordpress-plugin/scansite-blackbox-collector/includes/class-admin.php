<?php
/**
 * WordPress admin screen.
 *
 * Shows the connection state, lets a user paste a connection code, run a
 * connection test and disconnect. The permanent collector key is never shown
 * again after the initial connection — only a masked placeholder.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ScanSite_BB_Admin {

	const NONCE = 'scansite_blackbox_admin';
	const CAP   = 'manage_options';

	/** @var ScanSite_BB_Admin|null */
	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	public function boot() {
		add_action( 'admin_menu', array( $this, 'register_menu' ) );
		add_action( 'admin_post_scansite_blackbox_connect', array( $this, 'handle_connect' ) );
		add_action( 'admin_post_scansite_blackbox_disconnect', array( $this, 'handle_disconnect' ) );
		add_action( 'admin_post_scansite_blackbox_test', array( $this, 'handle_test' ) );
		add_action( 'admin_post_scansite_blackbox_diagnostics', array( $this, 'handle_diagnostics' ) );
		add_action( 'admin_post_scansite_blackbox_retry', array( $this, 'handle_retry' ) );
	}

	public function register_menu() {
		add_menu_page(
			__( 'ScanSite Black Box', 'scansite-blackbox' ),
			__( 'ScanSite', 'scansite-blackbox' ),
			self::CAP,
			'scansite-blackbox',
			array( $this, 'render' ),
			'dashicons-shield-alt',
			30
		);
	}

	/* ------------------------------ handlers ----------------------------- */

	public function handle_connect() {
		$this->verify();

		$code     = isset( $_POST['scansite_code'] ) ? sanitize_text_field( wp_unslash( $_POST['scansite_code'] ) ) : '';
		$endpoint = isset( $_POST['scansite_endpoint'] ) ? esc_url_raw( wp_unslash( $_POST['scansite_endpoint'] ) ) : '';

		$result = ScanSite_BB_Connection::connect( $code, $endpoint );

		if ( is_wp_error( $result ) ) {
			$this->redirect( 'error', $result->get_error_message() );
		}

		$this->redirect( 'connected' );
	}

	public function handle_disconnect() {
		$this->verify();
		ScanSite_BB_Connection::disconnect();
		$this->redirect( 'disconnected' );
	}

	public function handle_test() {
		$this->verify();

		$result = ScanSite_BB_Collector::instance()->send_test_event();

		if ( is_wp_error( $result ) ) {
			$this->redirect( 'test_failed', $result->get_error_message() );
		}

		$this->redirect( 'test_ok' );
	}

	/** Run the safe diagnostic checks and remember the outcome for display. */
	public function handle_diagnostics() {
		$this->verify();

		$checks = ScanSite_BB_Diagnostics::run();
		update_option(
			'scansite_blackbox_last_diagnostics',
			array(
				'runAt'  => time(),
				'checks' => $checks,
			),
			false
		);

		$failed = 0;
		foreach ( $checks as $check ) {
			if ( 'fail' === $check['status'] ) {
				$failed++;
			}
		}

		$this->redirect( $failed ? 'diagnostics_failed' : 'diagnostics_ok' );
	}

	/** Push the queue immediately instead of waiting for WP-Cron. */
	public function handle_retry() {
		$this->verify();

		ScanSite_BB_Collector::instance()->flush();

		$remaining = ScanSite_BB_Events::queue_size();
		$this->redirect(
			$remaining ? 'retry_partial' : 'retry_ok',
			$remaining
				? sprintf( /* translators: %d: number of events */ __( '%d event(s) are still queued and will be retried.', 'scansite-blackbox' ), $remaining )
				: ''
		);
	}

	private function verify() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'You do not have permission to do that.', 'scansite-blackbox' ) );
		}
		check_admin_referer( self::NONCE );
	}

	private function redirect( $status, $message = '' ) {
		$url = add_query_arg(
			array(
				'page'           => 'scansite-blackbox',
				'scansite_state' => rawurlencode( $status ),
				'scansite_msg'   => rawurlencode( $message ),
			),
			admin_url( 'admin.php' )
		);

		wp_safe_redirect( $url );
		exit;
	}

	/* -------------------------------- view ------------------------------- */

	public function render() {
		if ( ! current_user_can( self::CAP ) ) {
			return;
		}

		$state    = ScanSite_BB_Connection::state();
		$site_id  = ScanSite_BB_Connection::site_id();
		$endpoint = ScanSite_BB_Connection::endpoint();
		$has_key  = (bool) ScanSite_BB_Connection::collector_key();
		$env      = ScanSite_BB_Connection::environment();

		$notices = $this->notices();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'ScanSite Black Box', 'scansite-blackbox' ); ?></h1>

			<?php $this->render_styles(); ?>
			<?php $this->render_hero(); ?>

			<?php foreach ( $notices as $notice ) : ?>
				<div class="notice notice-<?php echo esc_attr( $notice['type'] ); ?>">
					<p><?php echo esc_html( $notice['text'] ); ?></p>
				</div>
			<?php endforeach; ?>

			<h2><?php esc_html_e( 'Connection', 'scansite-blackbox' ); ?></h2>

			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Status', 'scansite-blackbox' ); ?></th>
					<td><strong><?php echo esc_html( $this->state_label( $state ) ); ?></strong></td>
				</tr>

				<?php if ( $site_id ) : ?>
					<tr>
						<th scope="row"><?php esc_html_e( 'ScanSite site ID', 'scansite-blackbox' ); ?></th>
						<td><code><?php echo esc_html( $site_id ); ?></code></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'ScanSite endpoint', 'scansite-blackbox' ); ?></th>
						<td><code><?php echo esc_html( $endpoint ); ?></code></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Collector key', 'scansite-blackbox' ); ?></th>
						<td>
							<?php
							// Never printed once saved.
							echo $has_key ? '<code>&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;</code>' : esc_html__( 'Not set', 'scansite-blackbox' );
							?>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Queued events', 'scansite-blackbox' ); ?></th>
						<td><?php echo esc_html( (string) ScanSite_BB_Events::queue_size() ); ?></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Last heartbeat', 'scansite-blackbox' ); ?></th>
						<td>
							<?php
							$last = (int) get_option( ScanSite_BB_Heartbeat::OPT_LAST, 0 );
							echo $last ? esc_html( gmdate( 'Y-m-d H:i:s', $last ) . ' UTC' ) : esc_html__( 'Not yet', 'scansite-blackbox' );
							?>
						</td>
					</tr>
				<?php endif; ?>

				<tr>
					<th scope="row"><?php esc_html_e( 'WordPress', 'scansite-blackbox' ); ?></th>
					<td><?php echo esc_html( $env['version'] ); ?> &middot; PHP <?php echo esc_html( $env['phpVersion'] ); ?> &middot; <?php esc_html_e( 'Collector', 'scansite-blackbox' ); ?> <?php echo esc_html( SCANSITE_BB_VERSION ); ?></td>
				</tr>
			</table>

			<?php if ( ScanSite_BB_Connection::STATE_CONNECTED === $state ) : ?>

				<div class="scansite-actions">
					<?php
					// Each action is its own form; they are siblings, never nested.
					$actions = array(
						'scansite_blackbox_test'         => array( __( 'Send Test Event', 'scansite-blackbox' ), 'secondary', '' ),
						'scansite_blackbox_diagnostics'  => array( __( 'Run Diagnostics', 'scansite-blackbox' ), 'secondary', '' ),
						'scansite_blackbox_retry'        => array( __( 'Retry Delivery', 'scansite-blackbox' ), 'secondary', '' ),
						'scansite_blackbox_disconnect'   => array( __( 'Disconnect', 'scansite-blackbox' ), 'delete', __( 'Disconnect this website from ScanSite?', 'scansite-blackbox' ) ),
					);
					?>
					<?php foreach ( $actions as $action => $meta ) : ?>
						<?php
						// Built as attributes so no quote escaping is hand-written.
						$attrs = array(
							'method' => 'post',
							'action' => admin_url( 'admin-post.php' ),
							'style'  => 'display:inline-block;margin-right:8px',
						);
						if ( $meta[2] ) {
							$attrs['onsubmit'] = 'return confirm(' . wp_json_encode( $meta[2] ) . ');';
						}
						?>
						<form
							<?php
							foreach ( $attrs as $attr_name => $attr_value ) {
								echo ' ' . esc_attr( $attr_name ) . '="' . esc_attr( $attr_value ) . '"';
							}
							?>
						>
							<input type="hidden" name="action" value="<?php echo esc_attr( $action ); ?>" />
							<?php wp_nonce_field( self::NONCE ); ?>
							<?php submit_button( $meta[0], $meta[1], 'submit', false ); ?>
						</form>
					<?php endforeach; ?>
				</div>

			<?php else : ?>

				<h2><?php esc_html_e( 'Connect to ScanSite', 'scansite-blackbox' ); ?></h2>
				<p class="description">
					<?php esc_html_e( 'Enter the connection code shown in your ScanSite dashboard.', 'scansite-blackbox' ); ?>
				</p>

				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="scansite_blackbox_connect" />
					<?php wp_nonce_field( self::NONCE ); ?>

					<table class="form-table" role="presentation">
						<tr>
							<th scope="row">
								<label for="scansite_code"><?php esc_html_e( 'Connection Code', 'scansite-blackbox' ); ?></label>
							</th>
							<td>
								<input type="text" id="scansite_code" name="scansite_code" class="regular-text code"
									placeholder="K8F3-PQ9X" autocomplete="off" required />
							</td>
						</tr>
						<tr>
							<th scope="row">
								<label for="scansite_endpoint"><?php esc_html_e( 'ScanSite URL', 'scansite-blackbox' ); ?></label>
							</th>
							<td>
								<input type="url" id="scansite_endpoint" name="scansite_endpoint" class="regular-text code"
									value="<?php echo esc_attr( $endpoint ? $endpoint : 'http://localhost:3000' ); ?>" required />
								<p class="description">
									<?php esc_html_e( 'For local development use http://localhost:3000. This website must be able to reach that address.', 'scansite-blackbox' ); ?>
								</p>
							</td>
						</tr>
					</table>

					<?php submit_button( __( 'Connect Website', 'scansite-blackbox' ) ); ?>
				</form>

			<?php endif; ?>

			<?php $this->render_diagnostics(); ?>

			<h2><?php esc_html_e( 'What is monitored', 'scansite-blackbox' ); ?></h2>
			<p class="description">
				<?php
				esc_html_e(
					'Plugins, themes, WordPress core, files, database settings, users, authentication, cron jobs, configuration and redirects. DNS and SSL are not monitored by the collector yet.',
					'scansite-blackbox'
				);
				?>
			</p>
		</div>
		<?php
	}

	/**
	 * Diagnostics results, queue inspector, cron status and last delivery error.
	 * Values shown are metadata only — never the collector secret.
	 */
	/**
	 * Scoped styles for the status panel.
	 *
	 * Kept inline and namespaced rather than enqueued: this renders on a single
	 * admin screen, and an extra request for a few rules is not worth it.
	 */
	private function render_styles() {
		?>
		<style>
			.scansite-bb-hero{
				position:relative;overflow:hidden;margin:16px 0 24px;
				border-radius:14px;color:#e2e8f0;
				background:linear-gradient(135deg,#0f172a 0%,#134e4a 55%,#0f766e 100%);
				box-shadow:0 10px 30px -12px rgba(15,23,42,.55);
			}
			.scansite-bb-hero:after{
				content:"";position:absolute;inset:0;pointer-events:none;
				background:radial-gradient(620px 220px at 88% -20%,rgba(45,212,191,.28),transparent 70%);
			}
			.scansite-bb-hero__inner{position:relative;z-index:1;padding:22px 24px}
			.scansite-bb-hero__top{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:14px}
			.scansite-bb-pill{
				display:inline-flex;align-items:center;gap:8px;
				padding:6px 14px;border-radius:999px;
				font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;
			}
			.scansite-bb-pill i{width:8px;height:8px;border-radius:50%;background:currentColor;display:block}
			.scansite-bb-pill--ok{background:rgba(45,212,191,.16);color:#5eead4;box-shadow:inset 0 0 0 1px rgba(94,234,212,.32)}
			.scansite-bb-pill--err{background:rgba(248,113,113,.16);color:#fca5a5;box-shadow:inset 0 0 0 1px rgba(252,165,165,.32)}
			.scansite-bb-pill--idle{background:rgba(148,163,184,.18);color:#cbd5e1;box-shadow:inset 0 0 0 1px rgba(203,213,225,.28)}
			.scansite-bb-tag{margin:12px 0 0;max-width:56ch;font-size:14px;line-height:1.6;color:#94a3b8}
			.scansite-bb-tag strong{color:#f1f5f9;font-weight:600}
			.scansite-bb-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px;margin-top:20px}
			.scansite-bb-stat{
				padding:12px 14px;border-radius:11px;
				background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px rgba(255,255,255,.09);
			}
			.scansite-bb-stat__k{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:#7dd3c8}
			.scansite-bb-stat__v{margin-top:5px;font-size:19px;font-weight:700;color:#f8fafc;font-variant-numeric:tabular-nums}
			.scansite-bb-stat--warn .scansite-bb-stat__v{color:#fca5a5}
			.scansite-bb-meta{
				display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:18px;padding-top:16px;
				border-top:1px solid rgba(255,255,255,.1);font-size:12px;color:#94a3b8;
			}
			.scansite-bb-meta code{background:rgba(255,255,255,.08);color:#cbd5e1;padding:1px 6px;border-radius:5px;font-size:11px}
			.scansite-bb-meta b{color:#cbd5e1;font-weight:600}
			@media screen and (max-width:600px){
				.scansite-bb-hero__inner{padding:18px}
				.scansite-bb-stat__v{font-size:17px}
			}
		</style>
		<?php
	}

	/**
	 * The status panel shown at the top of the settings screen.
	 *
	 * Shows operational state only — the collector key is never rendered here or
	 * anywhere else on this screen.
	 */
	private function render_hero() {
		$status = ScanSite_BB_Diagnostics::status();
		$state  = (string) $status['state'];

		$tone = 'idle';
		if ( 'connected' === $state ) {
			$tone = 'ok';
		} elseif ( 'error' === $state ) {
			$tone = 'err';
		}

		$failed = (int) $status['failedDeliveries'];

		$tiles = array(
			array(
				'key'   => __( 'Queued events', 'scansite-blackbox' ),
				'value' => number_format_i18n( (int) $status['queuedEvents'] ),
				'warn'  => false,
			),
			array(
				'key'   => __( 'Last delivery', 'scansite-blackbox' ),
				'value' => $this->ago( (int) $status['lastDelivery'] ),
				'warn'  => false,
			),
			array(
				'key'   => __( 'Failed deliveries', 'scansite-blackbox' ),
				'value' => number_format_i18n( $failed ),
				'warn'  => $failed > 0,
			),
			array(
				'key'   => __( 'Heartbeat', 'scansite-blackbox' ),
				'value' => $this->ago( (int) $status['lastHeartbeat'] ),
				'warn'  => false,
			),
		);

		$meta = array_filter(
			array(
				$status['siteId'] ? __( 'Site ID', 'scansite-blackbox' ) . ' <code>' . esc_html( $status['siteId'] ) . '</code>' : '',
				$status['endpoint'] ? __( 'Endpoint', 'scansite-blackbox' ) . ' <code>' . esc_html( $status['endpoint'] ) . '</code>' : '',
				$status['collectorVersion'] ? '<b>' . esc_html__( 'Collector', 'scansite-blackbox' ) . '</b> ' . esc_html( $status['collectorVersion'] ) : '',
				$status['wordpressVersion'] ? '<b>' . esc_html__( 'WordPress', 'scansite-blackbox' ) . '</b> ' . esc_html( $status['wordpressVersion'] ) : '',
				'<b>' . esc_html__( 'PHP', 'scansite-blackbox' ) . '</b> ' . esc_html( $status['phpVersion'] ),
			)
		);
		?>
		<div class="scansite-bb-hero">
			<div class="scansite-bb-hero__inner">
				<div class="scansite-bb-hero__top">
					<span class="scansite-bb-pill scansite-bb-pill--<?php echo esc_attr( $tone ); ?>">
						<i aria-hidden="true"></i><?php echo esc_html( $this->state_label( $state ) ); ?>
					</span>
				</div>

				<?php if ( 'connected' === $state ) : ?>
					<p class="scansite-bb-tag">
						<strong><?php esc_html_e( 'Streaming change and incident data to ScanSite.', 'scansite-blackbox' ); ?></strong>
						<?php esc_html_e( 'Logins, plugin and theme changes, new administrators, cron jobs and suspicious file writes are captured and explained.', 'scansite-blackbox' ); ?>
					</p>
				<?php else : ?>
					<p class="scansite-bb-tag">
						<strong><?php esc_html_e( 'Not connected yet.', 'scansite-blackbox' ); ?></strong>
						<?php esc_html_e( 'Add this website in the ScanSite dashboard and paste the pairing code below to start collecting events.', 'scansite-blackbox' ); ?>
					</p>
				<?php endif; ?>

				<div class="scansite-bb-stats">
					<?php foreach ( $tiles as $tile ) : ?>
						<div class="scansite-bb-stat<?php echo $tile['warn'] ? ' scansite-bb-stat--warn' : ''; ?>">
							<div class="scansite-bb-stat__k"><?php echo esc_html( $tile['key'] ); ?></div>
							<div class="scansite-bb-stat__v"><?php echo esc_html( $tile['value'] ); ?></div>
						</div>
					<?php endforeach; ?>
				</div>

				<div class="scansite-bb-meta">
					<?php foreach ( $meta as $item ) : ?>
						<span><?php echo wp_kses_post( $item ); ?></span>
					<?php endforeach; ?>
				</div>
			</div>
		</div>
		<?php
	}

	/** Human-readable age of a Unix timestamp, or "Never". */
	private function ago( $timestamp ) {
		$timestamp = (int) $timestamp;
		if ( $timestamp < 1 ) {
			return __( 'Never', 'scansite-blackbox' );
		}

		return sprintf(
			/* translators: %s: human-readable time difference, e.g. "3 mins" */
			__( '%s ago', 'scansite-blackbox' ),
			human_time_diff( $timestamp, time() )
		);
	}

	private function render_diagnostics() {
		$status = ScanSite_BB_Diagnostics::status();
		$saved  = get_option( 'scansite_blackbox_last_diagnostics', array() );
		$checks = isset( $saved['checks'] ) && is_array( $saved['checks'] ) ? $saved['checks'] : array();
		?>
		<h2><?php esc_html_e( 'Collector Diagnostics', 'scansite-blackbox' ); ?></h2>

		<?php if ( empty( $checks ) ) : ?>
			<p class="description">
				<?php esc_html_e( 'No diagnostics have been run yet. Diagnostics only read from this website and ScanSite — they never change anything.', 'scansite-blackbox' ); ?>
			</p>
		<?php else : ?>
			<p class="description">
				<?php
				printf(
					/* translators: %s: date and time */
					esc_html__( 'Last run %s UTC.', 'scansite-blackbox' ),
					esc_html( gmdate( 'Y-m-d H:i:s', (int) $saved['runAt'] ) )
				);
				?>
			</p>
			<table class="widefat striped" style="max-width:720px">
				<tbody>
					<?php foreach ( $checks as $check ) : ?>
						<tr>
							<td style="width:2em">
								<?php
								$icon = 'pass' === $check['status'] ? '&#10003;' : ( 'warn' === $check['status'] ? '!' : '&#10007;' );
								echo '<span aria-hidden="true">' . $icon . '</span>';
								?>
							</td>
							<td><strong><?php echo esc_html( $check['label'] ); ?></strong></td>
							<td><?php echo esc_html( $check['message'] ); ?></td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		<?php endif; ?>

		<h3><?php esc_html_e( 'Queue', 'scansite-blackbox' ); ?></h3>
		<p class="description">
			<?php
			printf(
				/* translators: %d: number of queued events */
				esc_html__( 'Queued events: %d', 'scansite-blackbox' ),
				(int) $status['queuedEvents']
			);
			?>
		</p>
		<?php
		$preview = ScanSite_BB_Diagnostics::queue_preview( 10 );
		if ( ! empty( $preview ) ) :
			?>
			<ul style="max-width:720px">
				<?php foreach ( $preview as $item ) : ?>
					<li>
						<code><?php echo esc_html( $item['type'] ); ?></code>
						<?php echo esc_html( $item['timestamp'] ); ?>
					</li>
				<?php endforeach; ?>
			</ul>
		<?php endif; ?>

		<h3><?php esc_html_e( 'Schedule and delivery', 'scansite-blackbox' ); ?></h3>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'Event delivery', 'scansite-blackbox' ); ?></th>
				<td>
					<?php
					$next = wp_next_scheduled( ScanSite_BB_Collector::FLUSH_HOOK );
					echo $next
						? esc_html( sprintf( __( 'Scheduled — next run in about %d minutes.', 'scansite-blackbox' ), max( 0, (int) ceil( ( $next - time() ) / 60 ) ) ) )
						: esc_html__( 'Not scheduled yet.', 'scansite-blackbox' );
					?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Heartbeat', 'scansite-blackbox' ); ?></th>
				<td>
					<?php
					$hb_next = wp_next_scheduled( ScanSite_BB_Heartbeat::HOOK );
					echo esc_html__( 'Every 5 minutes', 'scansite-blackbox' );
					echo $hb_next ? esc_html( sprintf( ' — ' . __( 'next in about %d minutes.', 'scansite-blackbox' ), max( 0, (int) ceil( ( $hb_next - time() ) / 60 ) ) ) ) : '';
					?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Last successful delivery', 'scansite-blackbox' ); ?></th>
				<td>
					<?php
					echo $status['lastDelivery']
						? esc_html( gmdate( 'Y-m-d H:i:s', $status['lastDelivery'] ) . ' UTC' )
						: esc_html__( 'None yet', 'scansite-blackbox' );
					?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Failed deliveries', 'scansite-blackbox' ); ?></th>
				<td><?php echo esc_html( (string) $status['failedDeliveries'] ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Signing mode', 'scansite-blackbox' ); ?></th>
				<td><?php echo esc_html( 'enabled' === $status['signingMode'] ? __( 'HMAC signing enabled', 'scansite-blackbox' ) : __( 'Off (collector key only)', 'scansite-blackbox' ) ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Last delivery error', 'scansite-blackbox' ); ?></th>
				<td>
					<?php
					echo $status['lastError']
						? esc_html( $status['lastError'] )
						: esc_html__( 'No recent delivery errors', 'scansite-blackbox' );
					?>
				</td>
			</tr>
		</table>

		<?php if ( defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON ) : ?>
			<div class="notice notice-warning inline">
				<p><?php esc_html_e( 'WP-Cron automatic triggering is disabled. A real system cron may still be running WordPress cron tasks.', 'scansite-blackbox' ); ?></p>
			</div>
		<?php endif; ?>
		<?php
	}

	private function state_label( $state ) {
		$labels = array(
			ScanSite_BB_Connection::STATE_DISCONNECTED => __( 'Not Connected', 'scansite-blackbox' ),
			ScanSite_BB_Connection::STATE_CONNECTING   => __( 'Connecting', 'scansite-blackbox' ),
			ScanSite_BB_Connection::STATE_CONNECTED    => __( 'Connected', 'scansite-blackbox' ),
			ScanSite_BB_Connection::STATE_ERROR        => __( 'Connection Error', 'scansite-blackbox' ),
		);

		return isset( $labels[ $state ] ) ? $labels[ $state ] : $state;
	}

	/**
	 * Build admin notices from the redirect query args. Error text comes from
	 * our own friendly messages, never from a stack trace.
	 *
	 * @return array
	 */
	private function notices() {
		$state = isset( $_GET['scansite_state'] ) ? sanitize_key( wp_unslash( $_GET['scansite_state'] ) ) : '';
		$msg   = isset( $_GET['scansite_msg'] ) ? sanitize_text_field( wp_unslash( $_GET['scansite_msg'] ) ) : '';

		$stored_error = ScanSite_BB_Connection::last_error();

		switch ( $state ) {
			case 'connected':
				return array( array( 'type' => 'success', 'text' => __( 'Connected to ScanSite.', 'scansite-blackbox' ) ) );
			case 'disconnected':
				return array( array( 'type' => 'info', 'text' => __( 'Disconnected from ScanSite.', 'scansite-blackbox' ) ) );
			case 'test_ok':
				return array( array( 'type' => 'success', 'text' => __( 'Connection verified. Events are reaching ScanSite successfully.', 'scansite-blackbox' ) ) );
			case 'test_failed':
				return array( array( 'type' => 'error', 'text' => $msg ? $msg : __( 'Connection failed.', 'scansite-blackbox' ) ) );
			case 'error':
				return array( array( 'type' => 'error', 'text' => $msg ? $msg : __( 'Connection failed.', 'scansite-blackbox' ) ) );
			default:
				if ( $stored_error && ScanSite_BB_Connection::STATE_ERROR === ScanSite_BB_Connection::state() ) {
					return array( array( 'type' => 'error', 'text' => $stored_error ) );
				}
				return array();
		}
	}
}
