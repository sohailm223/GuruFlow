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

	/**
	 * Payload schema version, sent with every event. The plugin version alone
	 * cannot describe the wire format, so consumers negotiate on this instead.
	 */
	const SCHEMA_VERSION = 1;

	/** Failed-login aggregation window. */
	const LOGIN_WINDOW   = 300;   // seconds
	const LOGIN_FLUSH_AT = 10;

	/**
	 * How many individual failed logins are reported before the rest collapse
	 * into the aggregated burst. A few genuine typos stay visible; a brute-force
	 * attempt does not become a wall of near-identical events.
	 */
	const LOGIN_INDIVIDUAL_MAX = 3;

	/** Extensions that have no business being inside wp-content/uploads. */
	const EXECUTABLE_EXTENSIONS = array(
		'php', 'php3', 'php4', 'php5', 'php7', 'phtml', 'phar', 'pht',
		'pl', 'py', 'cgi', 'sh', 'exe', 'suspected',
	);

	/**
	 * Hard ceiling on files examined per uploads scan, so a large media library
	 * cannot turn admin_init into a slow request.
	 */
	const UPLOAD_SCAN_BUDGET = 3000;

	/**
	 * Key fragments that must never leave the site, even nested inside metadata.
	 *
	 * @var string[]
	 */
	const FORBIDDEN_KEY_FRAGMENTS = array(
		'password', 'pass', 'secret', 'token', 'cookie', 'salt', 'auth_key',
		'private_key', 'api_key', 'apikey', 'authorization', 'session',
		'card', 'cvv', 'stripe',
	);

	/** @var int[] failed login counters, keyed by user login */
	private $login_counts = array();

	/** @var bool set when a plugin was toggled during this request */
	private $plugin_toggled = false;

	/** @var bool an active_plugins change is waiting for end-of-request review */
	private $active_plugins_pending = false;

	/** @var array plugin file => display name, captured before deletion */
	private $pending_delete_names = array();

	/**
	 * @var array component key => version, captured before the updater replaced
	 *           the files. WordPress 6.8 does not expose the previous version on
	 *           the upgrader object, so it has to be read while it still exists.
	 */
	private $pre_upgrade_versions = array();

	public function register_hooks() {
		// Plugins.
		add_action( 'activated_plugin', array( $this, 'on_plugin_activated' ), 10, 2 );
		add_action( 'deactivated_plugin', array( $this, 'on_plugin_deactivated' ), 10, 2 );
		// Fires before the files go, so the display name can still be read.
		add_action( 'delete_plugin', array( $this, 'on_plugin_deleting' ), 10, 1 );
		add_action( 'deleted_plugin', array( $this, 'on_plugin_deleted' ), 10, 2 );
		add_action( '_core_updated_successfully', array( $this, 'on_core_updated' ) );
		// Fires at the very start of an upgrade run, while the currently
		// installed version is still on disk.
		add_filter( 'upgrader_package_options', array( $this, 'snapshot_component_versions' ), 10, 1 );
		add_action( 'upgrader_process_complete', array( $this, 'on_upgrader_complete' ), 10, 2 );

		// Themes.
		add_action( 'switch_theme', array( $this, 'on_theme_activated' ), 10, 3 );
		add_action( 'deleted_theme', array( $this, 'on_theme_deleted' ), 10, 2 );

		// Users.
		add_action( 'user_register', array( $this, 'on_user_created' ), 10, 1 );
		add_action( 'delete_user', array( $this, 'on_user_deleted' ), 10, 3 );
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
		//
		// IMPORTANT: 'schedule_event' is a FILTER, not an action. WordPress runs
		// $event = apply_filters( 'schedule_event', $event ) and then treats a
		// falsy result as "a plugin disallowed this event", so the callback MUST
		// return the event or cron scheduling breaks for the whole site.
		add_filter( 'schedule_event', array( $this, 'on_cron_added' ), 10, 1 );

		// There is no 'unschedule_event' action in WordPress. The only removal
		// hooks are filters that fire before the event is dropped, and they are
		// fired by both wp_unschedule_event() and wp_clear_scheduled_hook().
		add_filter( 'pre_unschedule_event', array( $this, 'on_cron_removed' ), 10, 5 );

		// Files and configuration.
		add_action( 'admin_init', array( $this, 'watch_config_files' ) );
		add_action( 'admin_init', array( $this, 'watch_uploads' ) );

		// Media uploaded through the normal WordPress flow.
		add_action( 'add_attachment', array( $this, 'on_attachment_created' ), 10, 1 );
	}

	/* ------------------------------ plugins ------------------------------ */

	public function on_plugin_activated( $plugin, $network_wide ) {
		$this->plugin_toggled = true;
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
		$this->plugin_toggled = true;
		$this->enqueue(
			'plugin_deactivated',
			'plugin',
			array( 'target' => array( 'plugin' => $plugin, 'name' => $this->plugin_name( $plugin ) ) )
		);
	}

	/**
	 * Snapshot the display name while the plugin files still exist. By the time
	 * deleted_plugin fires, get_plugin_data() has nothing left to read.
	 *
	 * @param string $plugin_file
	 */
	public function on_plugin_deleting( $plugin_file ) {
		$this->pending_delete_names[ $plugin_file ] = $this->plugin_name( $plugin_file );
	}

	public function on_plugin_deleted( $plugin_file, $deleted ) {
		$this->enqueue(
			'plugin_deleted',
			'plugin',
			array(
				'target' => array(
					'plugin' => $plugin_file,
					'slug'   => dirname( $plugin_file ),
					'name'   => isset( $this->pending_delete_names[ $plugin_file ] )
						? $this->pending_delete_names[ $plugin_file ]
						: null,
				),
				'metadata' => array( 'deleted' => (bool) $deleted ),
			)
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

		$action = isset( $hook_extra['action'] ) ? $hook_extra['action'] : 'update';
		$old    = $this->upgrader_old_version( $type, $hook_extra );
		$new    = $this->component_version( $type, $slug );

		// A first-time install must never be reported as an update, and there is
		// no "from" version to invent when WordPress does not supply one.
		$is_install = ( 'install' === $action ) || ( null === $old );

		$changes = array( 'to' => $new );
		if ( null !== $old ) {
			$changes['from'] = $old;
		}

		$this->enqueue(
			$type . ( $is_install ? '_installed' : '_updated' ),
			$type,
			array(
				'target'  => array(
					$type   => $slug,
					'slug'  => $slug,
					'name'  => $this->upgrader_name( $type, $slug, $upgrader ),
				),
				'changes' => $changes,
			)
		);

		// A legitimate update rewrites many files; open a short trust window so
		// the integrity engine labels them expected_change, not suspicious.
		if ( ! $is_install ) {
			ScanSite_BB_File_Integrity::note_expected_change( $type, $slug, $this->upgrader_name( $type, $slug, $upgrader ) );
		}
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

	/**
	 * delete_user fires with the user object still intact, so the account's
	 * identity is captured here — after deletion get_userdata() returns false.
	 *
	 * @param int          $user_id
	 * @param int|null     $reassign
	 * @param WP_User|null $user
	 */
	public function on_user_deleted( $user_id, $reassign = null, $user = null ) {
		if ( ! $user instanceof WP_User ) {
			$user = get_userdata( $user_id );
		}

		$this->enqueue(
			'user_deleted',
			'user',
			array(
				'target'  => array(
					'userId'   => (int) $user_id,
					'username' => $user ? $user->user_login : null,
					'role'     => $user && ! empty( $user->roles ) ? implode( ', ', (array) $user->roles ) : null,
					'email'    => null,
				),
				'changes' => array( 'reassignedTo' => $reassign ? (int) $reassign : null ),
			)
		);
	}

	public function on_user_role_changed( $user_id, $new_role, $old_roles ) {
		$user = get_userdata( $user_id );

		// A brand-new account fires set_user_role with no previous roles
		// immediately before user_register. That is an account creation, not a
		// privilege change, and on_user_created() already reports it — so
		// emitting here too produced two events for one action.
		if ( empty( $old_roles ) ) {
			return;
		}

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

		// Only the first few attempts are reported individually; the burst
		// above carries the rest so an attack stays one signal, not hundreds.
		if ( $count <= self::LOGIN_INDIVIDUAL_MAX ) {
			$this->enqueue(
				'login_failed',
				'auth',
				array(
					'target'   => array( 'username' => $key ),
					'actor'    => array( 'username' => $key, 'ip' => $ip ),
					'metadata' => array( 'attempt' => $count ),
				)
			);
		}
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

	/**
	 * Activating or deactivating a plugin also rewrites active_plugins, and the
	 * two hooks fire in opposite orders depending on the direction, so the
	 * decision has to wait until the end of the request. Reporting both would
	 * double every single toggle.
	 *
	 * A direct rewrite of the option (WP-CLI, a database edit, another plugin
	 * forcing the list) produces no plugin event at all and is still reported.
	 */
	public function on_active_plugins_changed( $old, $new ) {
		if ( $old === $new ) {
			return;
		}
		$this->active_plugins_pending = true;
		add_action( 'shutdown', array( $this, 'resolve_active_plugins' ), 5 );
	}

	/** Emit the option change only if no explicit plugin event covered it. */
	public function resolve_active_plugins() {
		if ( ! $this->active_plugins_pending ) {
			return;
		}
		$this->active_plugins_pending = false;

		if ( $this->plugin_toggled ) {
			return;
		}

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

	/**
	 * Observes a cron event as WordPress schedules it.
	 *
	 * This is a FILTER callback. Whatever comes in must go back out — returning
	 * null tells WordPress the event was vetoed and nothing gets scheduled.
	 *
	 * @param object|false $event
	 * @return object|false
	 */
	public function on_cron_added( $event ) {
		if ( ! is_object( $event ) || empty( $event->hook ) ) {
			return $event;
		}
		// Skip our own scheduling noise.
		if ( 0 === strpos( $event->hook, 'scansite_blackbox_' ) ) {
			return $event;
		}

		$args = isset( $event->args ) && is_array( $event->args ) ? $event->args : array();

		$this->enqueue(
			'cron_added',
			'cron',
			array(
				'target'   => array( 'hook' => $event->hook, 'name' => $event->hook ),
				'metadata' => array(
					'schedule' => ( isset( $event->schedule ) && $event->schedule ) ? $event->schedule : 'single',
					'nextRun'  => isset( $event->timestamp ) ? gmdate( 'c', (int) $event->timestamp ) : null,
					// Cron arguments can hold anything a plugin likes, so the
					// values never leave the site — only their count and a
					// one-way digest for correlation.
					'argCount' => count( $args ),
					'argsHash' => empty( $args ) ? null : substr( hash( 'sha256', maybe_serialize( $args ) ), 0, 12 ),
				),
			)
		);

		return $event;
	}

	/**
	 * Observes a cron event being removed.
	 *
	 * Fires from the 'pre_unschedule_event' filter, which WordPress runs for
	 * both wp_unschedule_event() and wp_clear_scheduled_hook(). Also a filter:
	 * the short-circuit value must be returned untouched.
	 *
	 * @param null|bool|WP_Error $pre
	 * @param int|null           $timestamp
	 * @param string             $hook
	 * @param array              $args
	 * @param bool               $wp_error
	 * @return null|bool|WP_Error
	 */
	public function on_cron_removed( $pre, $timestamp = null, $hook = '', $args = array(), $wp_error = false ) {
		if ( is_string( $hook ) && '' !== $hook && 0 !== strpos( $hook, 'scansite_blackbox_' ) ) {
			$this->enqueue(
				'cron_removed',
				'cron',
				array(
					'target'   => array( 'hook' => $hook, 'name' => $hook ),
					'metadata' => array(
						'nextRun'  => $timestamp ? gmdate( 'c', (int) $timestamp ) : null,
						'argCount' => is_array( $args ) ? count( $args ) : 0,
					),
				)
			);
		}

		return $pre;
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

	/**
	 * Bounded watch on wp-content/uploads for executable files.
	 *
	 * Uploads should only ever hold media, so a .php appearing there is the
	 * single highest-value file signal available. The scan is deliberately
	 * narrow — executable extensions only, a hard file budget, and hashes stored
	 * between runs — because this is a change detector, not a malware scanner.
	 */
	public function watch_uploads() {
		$uploads = wp_get_upload_dir();
		if ( empty( $uploads['basedir'] ) || ! is_dir( $uploads['basedir'] ) ) {
			return;
		}

		$stored = get_option( 'scansite_blackbox_upload_hashes', array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}

		$seen    = array();
		$budget  = self::UPLOAD_SCAN_BUDGET;
		$changed = false;

		try {
			$iterator = new RecursiveIteratorIterator(
				new RecursiveDirectoryIterator( $uploads['basedir'], FilesystemIterator::SKIP_DOTS ),
				RecursiveIteratorIterator::SELF_FIRST
			);

			foreach ( $iterator as $file ) {
				if ( $budget-- <= 0 ) {
					break;
				}
				if ( ! $file->isFile() ) {
					continue;
				}

				$ext = strtolower( $file->getExtension() );
				if ( ! in_array( $ext, self::EXECUTABLE_EXTENSIONS, true ) ) {
					continue;
				}

				$absolute = $file->getPathname();
				$relative = substr( $absolute, strlen( untrailingslashit( ABSPATH ) ) );
				$hash     = hash_file( 'sha256', $absolute );
				if ( false === $hash ) {
					continue;
				}

				$seen[ $relative ] = $hash;

				if ( ! isset( $stored[ $relative ] ) ) {
					$stored[ $relative ] = $hash;
					$changed             = true;

					$this->enqueue(
						'executable_created',
						'file',
						array(
							'path'     => $relative,
							'target'   => array( 'name' => $file->getFilename(), 'path' => $relative ),
							'metadata' => array(
								'extension'   => '.' . $ext,
								'executable'  => true,
								'sha256'      => $hash,
								'bytes'       => $file->getSize(),
								'permissions' => substr( sprintf( '%o', $file->getPerms() ), -4 ),
							),
						)
					);
				} elseif ( $stored[ $relative ] !== $hash ) {
					$stored[ $relative ] = $hash;
					$changed             = true;

					$this->enqueue(
						'file_modified',
						'file',
						array(
							'path'     => $relative,
							'target'   => array( 'name' => $file->getFilename(), 'path' => $relative ),
							'metadata' => array( 'extension' => '.' . $ext, 'executable' => true, 'sha256' => $hash ),
						)
					);
				}
			}
		} catch ( Exception $e ) {
			// A permissions problem must never break an admin request.
			return;
		}

		// Anything in the stored map that is gone now was removed.
		foreach ( array_keys( $stored ) as $relative ) {
			if ( ! isset( $seen[ $relative ] ) ) {
				unset( $stored[ $relative ] );
				$changed = true;

				$this->enqueue(
					'file_deleted',
					'file',
					array(
						'path'     => $relative,
						'target'   => array( 'name' => basename( $relative ), 'path' => $relative ),
						'metadata' => array( 'executable' => true ),
					)
				);
			}
		}

		if ( $changed ) {
			update_option( 'scansite_blackbox_upload_hashes', $stored, false );
		}
	}

	/**
	 * A file added through the normal WordPress media flow. Reported as a plain
	 * file event — the executable watch above is what flags anything dangerous.
	 *
	 * @param int $post_id
	 */
	public function on_attachment_created( $post_id ) {
		$attachment = get_post( $post_id );
		if ( ! $attachment ) {
			return;
		}

		$file = get_attached_file( $post_id );
		if ( ! $file ) {
			return;
		}

		$this->enqueue(
			'file_created',
			'file',
			array(
				'path'     => substr( $file, strlen( untrailingslashit( ABSPATH ) ) ),
				'target'   => array( 'name' => basename( $file ), 'path' => $file ),
				'metadata' => array(
					'mime'  => $attachment->post_mime_type,
					'bytes' => filesize( $file ),
				),
			)
		);
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
				'eventId'       => $this->event_id( $type ),
				'schemaVersion' => self::SCHEMA_VERSION,
				'site'          => ScanSite_BB_Connection::site_id(),
				'category'      => $category,
				'type'          => $type,
				'timestamp'     => gmdate( 'c' ),
				'actor'         => $this->current_actor(),
				'metadata'      => array(),
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
		return $this->sanitize_walk( $event );
	}

	/**
	 * Recursively drop forbidden keys and any non-scalar leaf.
	 *
	 * Deliberately a named method rather than a recursive closure: a
	 * `$variable( ... )` call is the only construct in this plugin that a
	 * heuristic malware scanner could mistake for dynamic code execution.
	 *
	 * @param mixed $value
	 * @return mixed
	 */
	private function sanitize_walk( $value ) {
		if ( ! is_array( $value ) ) {
			if ( is_scalar( $value ) || null === $value ) {
				return $value;
			}

			return null;
		}

		$out = array();

		foreach ( $value as $key => $item ) {
			$lower = strtolower( (string) $key );

			foreach ( self::FORBIDDEN_KEY_FRAGMENTS as $bad ) {
				if ( false !== strpos( $lower, $bad ) ) {
					// Skip this key entirely, whatever its depth.
					continue 2;
				}
			}

			$out[ $key ] = $this->sanitize_walk( $item );
		}

		return $out;
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
	 * The folder slug. hook_extra carries the real plugin file, which is the
	 * only reliable source. WordPress 6.8 does not expose plugin metadata on the
	 * upgrader object at all, so nothing else can be depended on here.
	 *
	 * @param WP_Upgrader $upgrader
	 * @param array       $hook_extra
	 * @return string|null
	 */
	private function upgrader_slug( $upgrader, $hook_extra ) {
		if ( ! empty( $hook_extra['plugin'] ) ) {
			return dirname( $hook_extra['plugin'] );
		}
		if ( ! empty( $hook_extra['theme'] ) ) {
			return $hook_extra['theme'];
		}
		// A fresh install has no plugin file yet, but the upgrader knows the
		// folder it just created.
		if ( isset( $upgrader->result['destination_name'] ) && '' !== $upgrader->result['destination_name'] ) {
			return $upgrader->result['destination_name'];
		}
		return null;
	}

	/**
	 * Record the version currently on disk before the updater overwrites it.
	 *
	 * This is a FILTER on the upgrader's package options and must hand the
	 * options straight back.
	 *
	 * @param array $options
	 * @return array
	 */
	public function snapshot_component_versions( $options ) {
		$extra = isset( $options['hook_extra'] ) && is_array( $options['hook_extra'] ) ? $options['hook_extra'] : array();
		$type  = isset( $extra['type'] ) ? $extra['type'] : '';

		if ( 'plugin' === $type && ! empty( $extra['plugin'] ) ) {
			$this->pre_upgrade_versions[ $extra['plugin'] ] = $this->installed_plugin_version( $extra['plugin'] );
		} elseif ( 'theme' === $type && ! empty( $extra['theme'] ) ) {
			$theme = wp_get_theme( $extra['theme'] );
			$this->pre_upgrade_versions[ $extra['theme'] ] = $theme->exists() ? $theme->get( 'Version' ) : null;
		}

		return $options;
	}

	/**
	 * @param string $plugin_file e.g. lab-test-plugin/lab-test-plugin.php
	 * @return string|null
	 */
	private function installed_plugin_version( $plugin_file ) {
		if ( ! function_exists( 'get_plugin_data' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$path = WP_PLUGIN_DIR . '/' . $plugin_file;
		if ( ! is_readable( $path ) ) {
			return null;
		}

		$data = get_plugin_data( $path, false, false );
		return ! empty( $data['Version'] ) ? (string) $data['Version'] : null;
	}

	/**
	 * Version that was installed before the upgrader ran. WordPress keeps it on
	 * the upgrader skin, and it is gone once the files are replaced — so this is
	 * the only place it can be read. Returns null when WordPress does not
	 * provide it; callers must not substitute a guessed value.
	 *
	 * @param string      $type
	 * @param WP_Upgrader $upgrader
	 * @return string|null
	 */
	private function upgrader_old_version( $type, $hook_extra ) {
		$key = '';
		if ( 'plugin' === $type && ! empty( $hook_extra['plugin'] ) ) {
			$key = $hook_extra['plugin'];
		} elseif ( 'theme' === $type && ! empty( $hook_extra['theme'] ) ) {
			$key = $hook_extra['theme'];
		}

		// Only a value that was genuinely read is ever reported — never a guess.
		return isset( $this->pre_upgrade_versions[ $key ] ) ? $this->pre_upgrade_versions[ $key ] : null;
	}

	/**
	 * Human-readable component name, preferring the version that was just
	 * installed so it survives a slug change.
	 *
	 * @param string      $type
	 * @param string      $slug
	 * @param WP_Upgrader $upgrader
	 * @return string
	 */
	private function upgrader_name( $type, $slug, $upgrader ) {
		if ( 'plugin' === $type ) {
			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}
			foreach ( get_plugins() as $file => $data ) {
				if ( 0 === strpos( $file, $slug . '/' ) || $file === $slug ) {
					return ! empty( $data['Name'] ) ? $data['Name'] : $slug;
				}
			}
			return $slug;
		}

		$theme = wp_get_theme( $slug );
		return $theme->exists() ? $theme->get( 'Name' ) : $slug;
	}

	/* ---------------------- users & code snapshots ---------------------- */

	/** Snapshots are cheap to produce but noisy, so they go out once a day. */
	const SNAPSHOT_INTERVAL = 86400;

	/** Hard caps so a large site can never stall WP-Cron or flood the queue. */
	const USERS_SNAP_MAX  = 15;

	/**
	 * Short common-password list for the on-server weak-password audit. Only a
	 * boolean "weak" flag ever leaves the site — never the password, never the
	 * hash, and never which entry matched.
	 *
	 * @var string[]
	 */
	const COMMON_PASSWORDS = array(
		'123456', '123456789', '12345678', '12345', '1234567', 'password',
		'1234567890', 'qwerty', 'abc123', '111111', '123123', 'admin',
		'letmein', 'welcome', 'monkey', 'dragon', 'iloveyou', 'sunshine',
		'princess', 'football', 'charlie', 'aa123456', 'passw0rd', 'qwerty123',
	);

	/** Entry point called from the collector's cron flush. Self-throttling. */
	public function maybe_send_snapshots() {
		$this->maybe_send_users_snapshot();
		$this->maybe_send_site_inventory();
	}

	/** Counts of themes / plugins / uploads / users for the website dashboard. */
	public function maybe_send_site_inventory() {
		$now  = time();
		$last = (int) get_option( 'scansite_blackbox_last_inventory', 0 );
		if ( ( $now - $last ) < self::SNAPSHOT_INTERVAL ) {
			return;
		}
		update_option( 'scansite_blackbox_last_inventory', $now, false );

		$themes  = function_exists( 'wp_get_themes' ) ? count( wp_get_themes() ) : 0;
		$plugins = function_exists( 'get_plugins' ) ? count( get_plugins() ) : 0;
		$active  = count( (array) get_option( 'active_plugins', array() ) );

		$users = 0;
		if ( function_exists( 'count_users' ) ) {
			$u     = count_users();
			$users = isset( $u['total_users'] ) ? (int) $u['total_users'] : 0;
		}

		$uploads = WP_CONTENT_DIR . '/uploads';
		$upload_count = 0;
		$exec_count   = 0;
		if ( is_dir( $uploads ) ) {
			$budget = 5000;
			try {
				$it = new RecursiveIteratorIterator(
					new RecursiveDirectoryIterator( $uploads, FilesystemIterator::SKIP_DOTS )
				);
				foreach ( $it as $f ) {
					if ( $budget-- <= 0 ) {
						break;
					}
					if ( ! $f->isFile() ) {
						continue;
					}
					$upload_count++;
					if ( 'php' === strtolower( $f->getExtension() ) ) {
						$exec_count++;
					}
				}
			} catch ( Exception $e ) {
				// Non-fatal.
			}
		}

		$this->enqueue(
			'site_inventory',
			'user',
			array(
				'metadata' => array(
					'themes'        => $themes,
					'plugins'       => $plugins,
					'activePlugins' => $active,
					'users'         => $users,
					'uploadFiles'   => $upload_count,
					'uploadExecutables' => $exec_count,
				),
			)
		);
	}

	/**
	 * Push a sanitised roster of accounts plus a per-account weak/strong flag
	 * computed on-server. No password or hash ever leaves the site.
	 */
	public function maybe_send_users_snapshot() {
		$now  = time();
		$last = (int) get_option( 'scansite_blackbox_last_users_snapshot', 0 );
		if ( ( $now - $last ) < self::SNAPSHOT_INTERVAL ) {
			return;
		}
		update_option( 'scansite_blackbox_last_users_snapshot', $now, false );

		if ( ! function_exists( 'get_users' ) ) {
			return;
		}

		$users = get_users( array( 'orderby' => 'ID', 'order' => 'ASC' ) );
		$rows  = array();
		$audit = 0;

		foreach ( $users as $user ) {
			$roles = (array) $user->roles;

			// Dictionary-testing is bounded to the first N accounts so a site
			// with thousands of subscribers cannot stall the cron run.
			$weak = null;
			if ( $audit < self::USERS_SNAP_MAX ) {
				$weak = $this->has_common_password( $user );
				$audit++;
			}

			$rows[] = array(
				'userId'      => (int) $user->ID,
				'username'    => $user->user_login,
				'email'       => $user->user_email,
				'roles'       => $roles,
				'isAdmin'     => in_array( 'administrator', $roles, true ),
				'registered'  => $user->user_registered ? gmdate( 'c', strtotime( $user->user_registered ) ) : null,
				'weak'        => $weak,
				'predictable' => $this->predictable_username( $user->user_login ),
			);
		}

		$this->enqueue(
			'users_snapshot',
			'user',
			array(
				'metadata' => array(
					'total'   => count( $users ),
					'audited' => $audit,
					'users'   => $rows,
				),
			)
		);
	}

	/**
	 * On-server dictionary check. Returns true when the account's existing hash
	 * matches a common password, false when it does not, null when the audit
	 * could not run. wp_check_password() compares against the stored hash
	 * locally — the plaintext candidate list never leaves and the hash never
	 * leaves.
	 *
	 * @param WP_User $user
	 * @return bool|null
	 */
	private function has_common_password( $user ) {
		if ( empty( $user->user_pass ) || ! function_exists( 'wp_check_password' ) ) {
			return null;
		}
		foreach ( self::COMMON_PASSWORDS as $candidate ) {
			if ( wp_check_password( $candidate, $user->user_pass, $user->ID ) ) {
				return true;
			}
		}
		return false;
	}

	private function predictable_username( $login ) {
		$common = array( 'admin', 'administrator', 'root', 'test', 'user', 'wp', 'webmaster', 'demo' );
		return in_array( strtolower( (string) $login ), $common, true );
	}

}
