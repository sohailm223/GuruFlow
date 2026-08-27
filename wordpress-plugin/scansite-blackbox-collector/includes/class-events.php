<?php
/**
 * Event capture.
 *
 * Hooks the WordPress actions that actually matter for security and change
 * visibility, normalises them into the ScanSite event shape, sanitises away
 * anything sensitive, and queues them for batched delivery.
 *
 * Nothing here performs a network request.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ScanSite_BB_Events {

	const OPT_QUEUE   = 'scansite_blackbox_queue';
	const MAX_QUEUE   = 1000;
	const MAX_BATCH   = 50;

	/** Failed-login aggregation window. */
	const LOGIN_WINDOW   = 300;   // seconds
	const LOGIN_FLUSH_AT = 10;

	/** @var int[] failed login counters, keyed by user login */
	private $login_counts = array();

	public function register_hooks() {
		// Plugins.
		add_action( 'activated_plugin', array( $this, 'on_plugin_activated' ), 10, 2 );
		add_action( 'deactivated_plugin', array( $this, 'on_plugin_deactivated' ), 10, 2 );
		add_action( 'deleted_plugin', array( $this, 'on_plugin_deleted' ), 10, 2 );
		add_action( '_core_updated_successfully', array( $this, 'on_core_updated' ) );
		add_action( 'upgrader_process_complete', array( $this, 'on_upgrader_complete' ), 10, 2 );

		// Themes.
		add_action( 'switch_theme', array( $this, 'on_theme_activated' ), 10, 3 );
		add_action( 'deleted_theme', array( $this, 'on_theme_deleted' ), 10, 2 );

		// Users.
		add_action( 'user_register', array( $this, 'on_user_created' ), 10, 1 );
		add_action( 'delete_user', array( $this, 'on_user_deleted' ), 10, 1 );
		add_action( 'set_user_role', array( $this, 'on_user_role_changed' ), 10, 3 );
		add_action( 'retrieve_password', array( $this, 'on_password_reset' ), 10, 1 );

		// Authentication.
		add_action( 'wp_login', array( $this, 'on_login_success' ), 10, 2 );
		add_action( 'wp_login_failed', array( $this, 'on_login_failed' ), 10, 1 );
		add_action( 'wp_logout', array( $this, 'on_logout' ), 10, 1 );
		add_action( 'wp_insert_application_password', array( $this, 'on_app_password_created' ), 10, 3 );
		add_action( 'wp_delete_application_password', array( $this, 'on_app_password_deleted' ), 10, 2 );

		// Options that matter.
		add_action( 'update_option_siteurl', array( $this, 'on_siteurl_changed' ), 10, 2 );
		add_action( 'update_option_home', array( $this, 'on_home_changed' ), 10, 2 );
		add_action( 'update_option_active_plugins', array( $this, 'on_active_plugins_changed' ), 10, 2 );
		add_action( 'update_option_users_can_register', array( $this, 'on_registration_changed' ), 10, 2 );

		// Cron.
		add_action( 'schedule_event', array( $this, 'on_cron_added' ), 10, 1 );
		add_action( 'unschedule_event', array( $this, 'on_cron_removed' ), 10, 1 );

		// Files and configuration.
		add_action( 'admin_init', array( $this, 'watch_config_files' ) );
	}

	/* ------------------------------ plugins ------------------------------ */

	public function on_plugin_activated( $plugin, $network_wide ) {
		$this->enqueue(
			'plugin_activated',
			'plugin',
			array(
				'target' => array(
					'plugin' => $plugin,
					'name'   => $this->plugin_name( $plugin ),
				),
			)
		);
	}

	public function on_plugin_deactivated( $plugin, $network_wide ) {
		$this->enqueue(
			'plugin_deactivated',
			'plugin',
			array( 'target' => array( 'plugin' => $plugin, 'name' => $this->plugin_name( $plugin ) ) )
		);
	}

	public function on_plugin_deleted( $plugin_file, $deleted ) {
		$this->enqueue(
			'plugin_deleted',
			'plugin',
			array( 'target' => array( 'plugin' => $plugin_file ) )
		);
	}

	public function on_core_updated( $wp_version ) {
		$this->enqueue(
			'wordpress_updated',
			'core',
			array( 'changes' => array( 'to' => $wp_version ) )
		);
	}

	/**
	 * Fires for plugin, theme and core updates performed through the updater.
	 *
	 * @param WP_Upgrader $upgrader
	 * @param array       $hook_extra
	 */
	public function on_upgrader_complete( $upgrader, $hook_extra ) {
		$type = isset( $hook_extra['type'] ) ? $hook_extra['type'] : '';
		if ( 'plugin' !== $type && 'theme' !== $type ) {
			return;
		}

		$slug = $this->upgrader_slug( $upgrader, $hook_extra );
		if ( ! $slug ) {
			return;
		}

		$version = $this->component_version( $type, $slug );

		$this->enqueue(
			$type . '_updated',
			$type,
			array(
				'target'  => array( $type => $slug, 'name' => $slug ),
				'changes' => array( 'to' => $version ),
			)
		);
	}

	/* ------------------------------- themes ------------------------------ */

	public function on_theme_activated( $new_name, $new_theme, $old_theme ) {
		$this->enqueue(
			'theme_activated',
			'theme',
			array(
				'target' => array(
					'theme'   => $new_theme ? $new_theme->get_stylesheet() : $new_name,
					'name'    => $new_name,
				),
			)
		);
	}

	public function on_theme_deleted( $stylesheet, $deleted ) {
		$this->enqueue( 'theme_deleted', 'theme', array( 'target' => array( 'theme' => $stylesheet ) ) );
	}

	/* -------------------------------- users ------------------------------ */

	public function on_user_created( $user_id ) {
		$user = get_userdata( $user_id );
		if ( ! $user ) {
			return;
		}

		$roles = (array) $user->roles;
		$is_admin = in_array( 'administrator', $roles, true );

		$this->enqueue(
			$is_admin ? 'administrator_created' : 'user_created',
			'user',
			array(
				'target'  => array(
					'username' => $user->user_login,
					'userId'   => (int) $user_id,
					'role'     => implode( ', ', $roles ),
				),
				'changes' => array( 'to' => implode( ', ', $roles ) ),
			)
		);
	}

	public function on_user_deleted( $user_id ) {
		$this->enqueue(
			'user_deleted',
			'user',
			array( 'target' => array( 'userId' => (int) $user_id ) )
		);
	}

	public function on_user_role_changed( $user_id, $new_role, $old_roles ) {
		$user = get_userdata( $user_id );

		$this->enqueue(
			( 'administrator' === $new_role ) ? 'administrator_created' : 'user_role_changed',
			'user',
			array(
				'target'  => array(
					'username' => $user ? $user->user_login : null,
					'userId'   => (int) $user_id,
				),
				'changes' => array(
					'from' => implode( ', ', (array) $old_roles ),
					'to'   => $new_role,
				),
			)
		);
	}

	public function on_password_reset( $user_login ) {
		$this->enqueue(
			'password_reset',
			'user',
			array( 'target' => array( 'username' => $user_login ) )
		);
	}

	/* -------------------------------- auth ------------------------------- */

	public function on_login_success( $user_login, $user ) {
		$this->enqueue(
			'login_success',
			'auth',
			array(
				'target' => array( 'username' => $user_login ),
				'actor'  => array(
					'username' => $user_login,
					'userId'   => $user ? (int) $user->ID : null,
					'role'     => $user && isset( $user->roles[0] ) ? $user->roles[0] : null,
					'ip'       => $this->client_ip(),
				),
			)
		);
	}

	/**
	 * Failed logins are aggregated instead of streamed: a brute-force attack
	 * must not turn into hundreds of individual events.
	 *
	 * @param string $username
	 */
	public function on_login_failed( $username ) {
		$key   = sanitize_user( (string) $username );
		$store = get_option( 'scansite_blackbox_login_counts', array() );

		if ( ! is_array( $store ) ) {
			$store = array();
		}

		$now = time();

		// Drop counters outside the window.
		foreach ( $store as $name => $entry ) {
			if ( ! is_array( $entry ) || ( $now - (int) $entry['started'] ) > self::LOGIN_WINDOW ) {
				unset( $store[ $name ] );
			}
		}

		if ( ! isset( $store[ $key ] ) ) {
			$store[ $key ] = array(
				'started' => $now,
				'count'   => 0,
				'ips'     => array(),
			);
		}

		$store[ $key ]['count']++;
		$ip = $this->client_ip();
		if ( $ip ) {
			$store[ $key ]['ips'][ $ip ] = true;
		}

		update_option( 'scansite_blackbox_login_counts', $store, false );

		$count = (int) $store[ $key ]['count'];

		if ( $count >= self::LOGIN_FLUSH_AT ) {
			$this->enqueue(
				'login_failed_burst',
				'auth',
				array(
					'target'   => array( 'username' => $key ),
					'count'    => $count,
					'metadata' => array(
						'windowMinutes' => (int) ceil( self::LOGIN_WINDOW / 60 ),
						'ipCount'       => count( $store[ $key ]['ips'] ),
					),
				)
			);

			unset( $store[ $key ] );
			update_option( 'scansite_blackbox_login_counts', $store, false );
			return;
		}

		$this->enqueue(
			'login_failed',
			'auth',
			array(
				'target' => array( 'username' => $key ),
				'actor'  => array( 'username' => $key, 'ip' => $ip ),
			)
		);
	}

	public function on_logout( $user_id ) {
		$user = get_userdata( $user_id );
		$this->enqueue(
			'logout',
			'auth',
			array( 'target' => array( 'username' => $user ? $user->user_login : null ) )
		);
	}

	public function on_app_password_created( $user_id, $item, $password ) {
		$this->enqueue(
			'application_password_created',
			'auth',
			array(
				'target' => array(
					'userId' => (int) $user_id,
					// Name only — the password itself is never touched.
					'name'   => isset( $item['name'] ) ? $item['name'] : null,
				),
			)
		);
	}

	public function on_app_password_deleted( $user_id, $uuid ) {
		$this->enqueue(
			'application_password_deleted',
			'auth',
			array( 'target' => array( 'userId' => (int) $user_id ) )
		);
	}

	/* ------------------------------- options ----------------------------- */

	public function on_siteurl_changed( $old, $new ) {
		$this->url_option_changed( 'siteurl_changed', $old, $new );
	}

	public function on_home_changed( $old, $new ) {
		$this->url_option_changed( 'home_changed', $old, $new );
	}

	private function url_option_changed( $type, $old, $new ) {
		if ( $old === $new ) {
			return;
		}
		$this->enqueue(
			$type,
			'db',
			array( 'changes' => array( 'from' => $old, 'to' => $new ) )
		);
	}

	public function on_active_plugins_changed( $old, $new ) {
		$this->enqueue(
			'active_plugins_changed',
			'db',
			array( 'target' => array( 'name' => 'active_plugins' ) )
		);
	}

	public function on_registration_changed( $old, $new ) {
		$this->enqueue(
			'registration_setting_changed',
			'db',
			array( 'changes' => array( 'from' => $old, 'to' => $new ) )
		);
	}

	/* -------------------------------- cron ------------------------------- */

	public function on_cron_added( $event ) {
		if ( ! is_object( $event ) || empty( $event->hook ) ) {
			return;
		}
		// Skip our own scheduling noise.
		if ( 0 === strpos( $event->hook, 'scansite_blackbox_' ) ) {
			return;
		}

		$this->enqueue(
			'cron_added',
			'cron',
			array(
				'target'   => array( 'hook' => $event->hook, 'name' => $event->hook ),
				'metadata' => array(
					'schedule' => isset( $event->schedule ) ? $event->schedule : null,
					'nextRun'  => isset( $event->timestamp ) ? gmdate( 'c', (int) $event->timestamp ) : null,
				),
			)
		);
	}

	public function on_cron_removed( $event ) {
		if ( ! is_object( $event ) || empty( $event->hook ) ) {
			return;
		}
		if ( 0 === strpos( $event->hook, 'scansite_blackbox_' ) ) {
			return;
		}

		$this->enqueue(
			'cron_removed',
			'cron',
			array( 'target' => array( 'hook' => $event->hook, 'name' => $event->hook ) )
		);
	}

	/* ------------------------- files / configuration --------------------- */

	/**
	 * Cheap checkpoint-based watch on the two configuration files that matter.
	 *
	 * A hash is stored in wp_options and only recomputed on admin_init, so no
	 * file is hashed during a frontend request and no file contents are ever
	 * transmitted.
	 */
	public function watch_config_files() {
		$targets = array(
			'wp_config_modified' => array(
				'path' => ABSPATH . 'wp-config.php',
				'rel'  => '/wp-config.php',
			),
			'htaccess_modified'  => array(
				'path' => ABSPATH . '.htaccess',
				'rel'  => '/.htaccess',
			),
		);

		$stored = get_option( 'scansite_blackbox_file_hashes', array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}

		$changed = false;

		foreach ( $targets as $type => $target ) {
			if ( ! is_readable( $target['path'] ) ) {
				continue;
			}

			$hash = hash_file( 'sha256', $target['path'] );
			if ( false === $hash ) {
				continue;
			}

			if ( ! isset( $stored[ $type ] ) ) {
				$stored[ $type ] = $hash;
				$changed         = true;
				continue;
			}

			if ( $stored[ $type ] !== $hash ) {
				$stored[ $type ] = $hash;
				$changed         = true;

				$this->enqueue(
					$type,
					'config',
					array(
						'path'     => $target['rel'],
						// Hash and metadata only — never the file contents.
						'metadata' => array( 'sha256' => $hash ),
					)
				);
			}
		}

		if ( $changed ) {
			update_option( 'scansite_blackbox_file_hashes', $stored, false );
		}
	}

	/* ------------------------------- helpers ----------------------------- */

	/**
	 * Build a normalised event and push it onto the local queue.
	 *
	 * @param string $type
	 * @param string $category
	 * @param array  $extra
	 */
	public function enqueue( $type, $category, $extra = array() ) {
		$event = array_merge(
			array(
				'eventId'   => $this->event_id( $type ),
				'site'      => ScanSite_BB_Connection::site_id(),
				'category'  => $category,
				'type'      => $type,
				'timestamp' => gmdate( 'c' ),
				'actor'     => $this->current_actor(),
				'metadata'  => array(),
			),
			$extra
		);

		$event = $this->sanitize( $event );

		$queue = get_option( self::OPT_QUEUE, array() );
		if ( ! is_array( $queue ) ) {
			$queue = array();
		}

		$queue[] = $event;

		// Bound the queue: drop the oldest events rather than grow forever.
		if ( count( $queue ) > self::MAX_QUEUE ) {
			$queue = array_slice( $queue, count( $queue ) - self::MAX_QUEUE );
		}

		update_option( self::OPT_QUEUE, $queue, false );
	}

	/** Take up to $limit events off the front of the queue. */
	public static function take_batch( $limit = self::MAX_BATCH ) {
		$queue = get_option( self::OPT_QUEUE, array() );
		if ( ! is_array( $queue ) || empty( $queue ) ) {
			return array();
		}

		$batch = array_slice( $queue, 0, $limit );
		update_option( self::OPT_QUEUE, array_slice( $queue, count( $batch ) ), false );

		return $batch;
	}

	public static function queue_size() {
		$queue = get_option( self::OPT_QUEUE, array() );
		return is_array( $queue ) ? count( $queue ) : 0;
	}

	/**
	 * Strip anything that could be a secret before an event leaves the site.
	 * Metadata is kept to scalar values only.
	 *
	 * @param array $event
	 * @return array
	 */
	private function sanitize( $event ) {
		$forbidden = array(
			'password', 'pass', 'secret', 'token', 'cookie', 'salt', 'auth_key',
			'private_key', 'api_key', 'apikey', 'authorization', 'session',
			'card', 'cvv', 'stripe',
		);

		$walk = function ( $value ) use ( &$walk, $forbidden ) {
			if ( is_array( $value ) ) {
				$out = array();
				foreach ( $value as $key => $item ) {
					$lower = strtolower( (string) $key );
					foreach ( $forbidden as $bad ) {
						if ( false !== strpos( $lower, $bad ) ) {
							continue 2;
						}
					}
					$out[ $key ] = $walk( $item );
				}
				return $out;
			}

			if ( is_scalar( $value ) || null === $value ) {
				return $value;
			}

			return null;
		};

		return $walk( $event );
	}

	/**
	 * Current actor — username and role only, never a password hash or cookie.
	 *
	 * @return array|null
	 */
	private function current_actor() {
		$user_id = get_current_user_id();
		if ( ! $user_id ) {
			return null;
		}

		$user = get_userdata( $user_id );
		if ( ! $user ) {
			return null;
		}

		return array(
			'userId'   => (int) $user_id,
			'username' => $user->user_login,
			'role'     => isset( $user->roles[0] ) ? $user->roles[0] : null,
			'ip'       => $this->client_ip(),
		);
	}

	/**
	 * Client IP. Only REMOTE_ADDR is trusted — forwarded headers can be
	 * forged, and this value feeds security conclusions.
	 *
	 * @return string|null
	 */
	private function client_ip() {
		return isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : null;
	}

	private function event_id( $type ) {
		return 'evt_' . substr( md5( $type . microtime( true ) . wp_rand() ), 0, 16 );
	}

	private function plugin_name( $plugin_file ) {
		if ( ! function_exists( 'get_plugin_data' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$path = WP_PLUGIN_DIR . '/' . $plugin_file;
		if ( ! is_readable( $path ) ) {
			return $plugin_file;
		}

		$data = get_plugin_data( $path, false, false );
		return ! empty( $data['Name'] ) ? $data['Name'] : $plugin_file;
	}

	private function component_version( $type, $slug ) {
		if ( 'theme' === $type ) {
			$theme = wp_get_theme( $slug );
			return $theme->exists() ? $theme->get( 'Version' ) : null;
		}

		$plugins = get_plugins();
		foreach ( $plugins as $file => $data ) {
			if ( 0 === strpos( $file, $slug . '/' ) || $file === $slug ) {
				return isset( $data['Version'] ) ? $data['Version'] : null;
			}
		}
		return null;
	}

	/**
	 * @param WP_Upgrader $upgrader
	 * @param array       $hook_extra
	 * @return string|null
	 */
	private function upgrader_slug( $upgrader, $hook_extra ) {
		if ( isset( $upgrader->new_plugin_data['TextDomain'] ) ) {
			return $upgrader->new_plugin_data['TextDomain'];
		}
		if ( isset( $hook_extra['plugin'] ) ) {
			return dirname( $hook_extra['plugin'] );
		}
		if ( isset( $hook_extra['theme'] ) ) {
			return $hook_extra['theme'];
		}
		return null;
	}
}
