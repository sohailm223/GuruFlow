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

		$result = ScanSite_BB_Collector::run_connection_test();

		if ( is_wp_error( $result ) ) {
			$this->redirect( 'test_failed', $result->get_error_message() );
		}

		$this->redirect( 'test_ok' );
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
			<p class="description">
				<?php esc_html_e( 'Protect your website with complete change and incident visibility.', 'scansite-blackbox' ); ?>
			</p>

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

				<p>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline">
						<input type="hidden" name="action" value="scansite_blackbox_test" />
						<?php wp_nonce_field( self::NONCE ); ?>
						<?php submit_button( __( 'Run Connection Test', 'scansite-blackbox' ), 'secondary', 'submit', false ); ?>
					</form>

					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline"
						onsubmit="return confirm('<?php echo esc_js( __( 'Disconnect this website from ScanSite?', 'scansite-blackbox' ) ); ?>');">
						<input type="hidden" name="action" value="scansite_blackbox_disconnect" />
						<?php wp_nonce_field( self::NONCE ); ?>
						<?php submit_button( __( 'Disconnect', 'scansite-blackbox' ), 'delete', 'submit', false ); ?>
					</form>
				</p>

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
