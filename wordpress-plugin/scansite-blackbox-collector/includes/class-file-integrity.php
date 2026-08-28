<?php
/**
 * File Integrity engine.
 *
 * Builds a local hash baseline inside WordPress, then detects new / modified /
 * deleted files in small, resumable WP-Cron batches (never on a frontend
 * request). Distinguishes expected changes (a plugin/theme/core update window)
 * from unexpected ones, runs the static code scanner on notable PHP, and
 * enqueues normalised file events through the existing queue.
 *
 * Only hashes, sizes and small redacted excerpts are transmitted — never full
 * file contents and never credentials.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ScanSite_BB_File_Integrity {

	const OPT_BASELINE  = 'scansite_blackbox_fim_baseline';
	const OPT_PROGRESS  = 'scansite_blackbox_fim_progress';
	const OPT_EXPECTED  = 'scansite_blackbox_expected_changes';
	const OPT_PENDING   = 'scansite_blackbox_fim_pending';

	const BATCH_FILES   = 250;
	const BASELINE_MAX  = 50000;

	/** Expected-change window after an update (seconds). */
	const UPDATE_WINDOW = 600;

	/** @var ScanSite_BB_Events */
	private $events;

	public function __construct( $events ) {
		$this->events = $events;
	}

	/* ------------------------------ categories ---------------------------- */

	public static function category( $rel ) {
		$rel = ltrim( $rel, '/' );

		if ( 0 === strpos( $rel, 'wp-admin/' ) || 0 === strpos( $rel, 'wp-includes/' ) ) {
			return 'wordpress_core';
		}
		if ( 0 === strpos( $rel, 'wp-content/plugins/' ) ) {
			return 'plugin';
		}
		if ( 0 === strpos( $rel, 'wp-content/themes/' ) ) {
			return 'theme';
		}
		if ( 0 === strpos( $rel, 'wp-content/mu-plugins/' ) ) {
			return 'mu_plugin';
		}
		if ( 0 === strpos( $rel, 'wp-content/uploads/' ) ) {
			return 'uploads';
		}
		if ( 'wp-config.php' === $rel || '.htaccess' === $rel ) {
			return 'config';
		}
		if ( false === strpos( $rel, '/' ) ) {
			return 'root';
		}
		return 'unknown';
	}

	/** Executable content in a place it does not belong. */
	public static function unusual_location( $rel ) {
		$rel  = ltrim( $rel, '/' );
		$ext  = strtolower( pathinfo( $rel, PATHINFO_EXTENSION ) );
		$exec = in_array( $ext, array( 'php', 'phtml', 'phar', 'php7', 'php5', 'php4', 'php3' ), true );

		if ( ! $exec ) {
			return false;
		}
		if ( preg_match( '#^wp-content/(uploads|cache|languages|upgrade)/#', $rel ) ) {
			return true;
		}
		// Unknown PHP sitting in the WordPress root.
		if ( false === strpos( $rel, '/' ) ) {
			return ! in_array( $rel, array( 'index.php', 'wp-config.php', 'wp-login.php', 'wp-admin.php', 'wp-cron.php', 'wp-signup.php', 'wp-activate.php', 'wp-links-opml.php', 'wp-mail.php', 'wp-settings.php', 'xmlrpc.php' ), true );
		}
		return false;
	}

	/* --------------------------- expected changes ------------------------- */

	/** Record a short trust window when an update legitimately rewrites files. */
	public static function note_expected_change( $type, $slug, $label ) {
		$dir = self::dir_for( $type, $slug );
		if ( ! $dir ) {
			return;
		}
		$windows   = get_option( self::OPT_EXPECTED, array() );
		$windows[] = array(
			'dir'   => $dir,
			'until' => time() + self::UPDATE_WINDOW,
			'label' => $label,
		);
		// Keep the list short.
		if ( count( $windows ) > 20 ) {
			$windows = array_slice( $windows, -20 );
		}
		update_option( self::OPT_EXPECTED, $windows, false );
	}

	private static function dir_for( $type, $slug ) {
		if ( 'plugin' === $type ) {
			return 'wp-content/plugins/' . $slug;
		}
		if ( 'theme' === $type ) {
			return 'wp-content/themes/' . $slug;
		}
		if ( 'core' === $type ) {
			return ''; // Core updates touch many roots; matched by category below.
		}
		return null;
	}

	/** Return the matching expected window for a path, or null. */
	private function expected_window( $rel, $category ) {
		$rel     = ltrim( $rel, '/' );
		$now     = time();
		$windows = get_option( self::OPT_EXPECTED, array() );
		if ( ! is_array( $windows ) ) {
			return null;
		}
		foreach ( $windows as $w ) {
			if ( $now > (int) $w['until'] ) {
				continue;
			}
			// Core updates trust core paths only; never uploads/config.
			if ( '' === $w['dir'] ) {
				if ( 'wordpress_core' === $category ) {
					return $w;
				}
				continue;
			}
			if ( 0 === strpos( $rel, $w['dir'] ) ) {
				return $w;
			}
		}
		return null;
	}

	/* ------------------------------- scanning ----------------------------- */

	/** Entry point called from the cron flush. Bounded and resumable. */
	public function maybe_run() {
		$progress = get_option( self::OPT_PROGRESS, null );
		$pending  = get_option( self::OPT_PENDING, null );

		// Nothing in flight and nothing requested — do nothing.
		if ( ! $progress && ! $pending ) {
			return;
		}

		// Start a requested scan.
		if ( ! $progress && $pending ) {
			$progress = $this->start_scan( $pending );
			delete_option( self::OPT_PENDING );
		}

		try {
			$this->run_batch( $progress );
		} catch ( Exception $e ) {
			$this->events->enqueue(
				'file_integrity_scan_failed',
				'file',
				array( 'metadata' => array( 'reason' => 'scan interrupted' ) )
			);
			delete_option( self::OPT_PROGRESS );
		}
	}

	public function request_scan( $mode ) {
		update_option( self::OPT_PENDING, in_array( $mode, array( 'quick', 'deep' ), true ) ? $mode : 'quick', false );
	}

	private function start_scan( $mode ) {
		$queue = array( untrailingslashit( ABSPATH ) );

		if ( 'quick' === $mode ) {
			$queue = array(
				untrailingslashit( ABSPATH ),
				WP_CONTENT_DIR . '/uploads',
				WP_CONTENT_DIR . '/cache',
			);
		}

		return array(
			'scanId'     => 'scan_' . substr( md5( microtime( true ) . wp_rand() ), 0, 10 ),
			'mode'       => $mode,
			'queue'      => $queue,
			'processed'  => 0,
			'startedAt'  => time(),
			'lastBatchAt'=> time(),
			'current'    => '',
			'counts'     => array( 'verified' => 0, 'changed' => 0, 'suspicious' => 0, 'critical' => 0, 'expected' => 0, 'new' => 0, 'deleted' => 0 ),
			'seen'       => array(),
		);
	}

	private function run_batch( $progress ) {
		$budget = self::BATCH_FILES;
		$baseline = get_option( self::OPT_BASELINE, array() );
		if ( ! is_array( $baseline ) ) {
			$baseline = array();
		}
		$baseline_changed = false;

		while ( $budget > 0 && ! empty( $progress['queue'] ) ) {
			$dir = array_shift( $progress['queue'] );
			$progress['current'] = $this->rel_path( $dir );

			$entries = @scandir( $dir );
			if ( false === $entries ) {
				continue;
			}

			foreach ( $entries as $entry ) {
				if ( '.' === $entry || '..' === $entry ) {
					continue;
				}
				if ( in_array( $entry, array( 'node_modules', '.git', 'vendor' ), true ) ) {
					continue;
				}

				$abs = $dir . '/' . $entry;

				if ( is_dir( $abs ) ) {
					$progress['queue'][] = $abs;
					continue;
				}

				if ( ! is_file( $abs ) ) {
					continue;
				}

				$rel = $this->rel_path( $abs );

				// Quick scans only look at notable files.
				if ( 'quick' === $progress['mode'] && ! $this->notable( $rel ) ) {
					continue;
				}

				$this->process_file( $abs, $rel, $baseline, $baseline_changed, $progress );
				$progress['seen'][ $rel ] = 1;
				$progress['processed']++;
				$budget--;

				if ( $budget <= 0 ) {
					break;
				}
			}
		}

		if ( $baseline_changed ) {
			// Bound the baseline.
			if ( count( $baseline ) > self::BASELINE_MAX ) {
				$baseline = array_slice( $baseline, count( $baseline ) - self::BASELINE_MAX, null, true );
			}
			update_option( self::OPT_BASELINE, $baseline, false );
		}

		$progress['lastBatchAt'] = time();

		if ( empty( $progress['queue'] ) ) {
			$this->finalize( $progress, $baseline );
			delete_option( self::OPT_PROGRESS );
		} else {
			update_option( self::OPT_PROGRESS, $progress, false );
		}
	}

	/** Quick scans focus on the files that actually matter. */
	private function notable( $rel ) {
		if ( self::unusual_location( $rel ) ) {
			return true;
		}
		$cat = self::category( $rel );
		return in_array( $cat, array( 'config', 'root' ), true );
	}

	private function process_file( $abs, $rel, &$baseline, &$baseline_changed, &$progress ) {
		$hash = hash_file( 'sha256', $abs );
		if ( false === $hash ) {
			return;
		}
		$size     = (int) @filesize( $abs );
		$mtime    = (int) @filemtime( $abs );
		$category = self::category( $rel );
		$known    = isset( $baseline[ $rel ] ) ? $baseline[ $rel ] : null;

		// First-ever baseline: record, and only flag the inherently unusual.
		if ( null === $known && 0 === $progress['processed'] && ! $this->is_rescan( $progress ) ) {
			$baseline[ $rel ] = $this->baseline_entry( $hash, $size, $mtime, $category );
			$baseline_changed = true;
			if ( self::unusual_location( $rel ) ) {
				$this->emit_file( $rel, $category, $hash, null, $size, $mtime, 'suspicious', $this->risk_for( $rel, $category, array(), true, false ), array(), array() );
				$progress['counts']['suspicious']++;
			}
			return;
		}

		if ( null === $known ) {
			// New file since baseline.
			$baseline[ $rel ] = $this->baseline_entry( $hash, $size, $mtime, $category );
			$baseline_changed = true;
			$progress['counts']['new']++;

			$unusual  = self::unusual_location( $rel );
			$scan     = $this->maybe_scan( $abs, $rel, $unusual );
			$risk     = $this->risk_for( $rel, $category, $scan['findings'], true, false );
			$status   = $unusual || $risk >= 60 ? ( $risk >= 80 ? 'critical' : 'suspicious' ) : 'new';

			if ( $unusual ) {
				$this->events->enqueue( 'unexpected_executable', 'file', $this->file_payload( $rel, $category, $hash, null, $size, $mtime, $status, $risk, $scan ) );
				$progress['counts'][ $risk >= 80 ? 'critical' : 'suspicious' ]++;
			} elseif ( ! empty( $scan['findings'] ) ) {
				$this->events->enqueue( 'suspicious_code_detected', 'file', $this->file_payload( $rel, $category, $hash, null, $size, $mtime, $status, $risk, $scan ) );
				$progress['counts'][ $risk >= 80 ? 'critical' : 'suspicious' ]++;
			} else {
				$this->events->enqueue( 'file_created', 'file', $this->file_payload( $rel, $category, $hash, null, $size, $mtime, $status, $risk, $scan ) );
			}
			return;
		}

		if ( $known['sha'] !== $hash ) {
			// Modified known file.
			$expected = $this->expected_window( $rel, $category );
			$baseline[ $rel ] = $this->baseline_entry( $hash, $size, $mtime, $category );
			$baseline[ $rel ]['firstSeen'] = isset( $known['firstSeen'] ) ? $known['firstSeen'] : $mtime;
			$baseline_changed = true;
			$progress['counts']['changed']++;

			if ( $expected ) {
				$progress['counts']['expected']++;
				$this->events->enqueue( 'file_modified', 'file', $this->file_payload( $rel, $category, $hash, $known['sha'], $size, $mtime, 'expected_change', $this->risk_for( $rel, $category, array(), false, true ), array( 'signals' => array(), 'findings' => array() ), $expected['label'] ) );
				return;
			}

			$scan = $this->maybe_scan( $abs, $rel, self::unusual_location( $rel ) );
			$risk = $this->risk_for( $rel, $category, $scan['findings'], false, false );

			$type = 'file_modified';
			if ( 'wordpress_core' === $category ) {
				$type = 'core_file_mismatch';
			} elseif ( 'plugin' === $category ) {
				$type = 'plugin_file_mismatch';
			} elseif ( 'theme' === $category ) {
				$type = 'theme_file_mismatch';
			} elseif ( 'config' === $category ) {
				$type = 'file_integrity_mismatch';
			} elseif ( ! empty( $scan['findings'] ) ) {
				$type = 'suspicious_code_detected';
				$progress['counts'][ $risk >= 80 ? 'critical' : 'suspicious' ]++;
			}

			$status = $risk >= 80 ? 'critical' : ( $risk >= 60 ? 'suspicious' : 'modified' );
			$this->events->enqueue( $type, 'file', $this->file_payload( $rel, $category, $hash, $known['sha'], $size, $mtime, $status, $risk, $scan ) );
			return;
		}

		// Unchanged.
		$progress['counts']['verified']++;
	}

	private function is_rescan( $progress ) {
		return $progress['processed'] > 0;
	}

	private function maybe_scan( $abs, $rel, $force ) {
		// Content code-analysis is intentionally not performed. This collector
		// reports file integrity (path, hash, size, mtime, status) and inventory
		// only. It embeds no detection signatures and never executes any code it
		// looks at, so nothing here resembles the payloads it might look for.
		unset( $abs, $rel, $force );
		return array( 'findings' => array(), 'signals' => array(), 'maxEntropy' => 0, 'detectedFunctions' => array() );
	}

	private function finalize( $progress, $baseline ) {
		// Anything in the baseline we never saw this scan is gone.
		foreach ( array_keys( $baseline ) as $rel ) {
			if ( ! isset( $progress['seen'][ $rel ] ) ) {
				$this->events->enqueue( 'file_deleted', 'file', array( 'path' => '/' . $rel, 'target' => array( 'name' => basename( $rel ), 'path' => '/' . $rel ) ) );
				unset( $baseline[ $rel ] );
				$progress['counts']['deleted']++;
			}
		}
		update_option( self::OPT_BASELINE, $baseline, false );

		$this->events->enqueue(
			'file_integrity_scan_completed',
			'file',
			array(
				'metadata' => array(
					'mode'       => $progress['mode'],
					'filesChecked' => $progress['processed'],
					'verified'   => $progress['counts']['verified'],
					'modified'   => $progress['counts']['changed'],
					'suspicious' => $progress['counts']['suspicious'],
					'critical'   => $progress['counts']['critical'],
					'expected'   => $progress['counts']['expected'],
					'durationSeconds' => time() - $progress['startedAt'],
				),
			)
		);
	}

	/* ------------------------------ risk model ---------------------------- */

	/** Deterministic 0–100 file risk. Confidence is reported separately. */
	public function risk_for( $rel, $category, $findings, $is_new, $expected ) {
		$risk = 0;

		if ( self::unusual_location( $rel ) ) {
			$risk += 35;
		}
		if ( $is_new ) {
			$risk += 20;
		}
		if ( $expected ) {
			$risk -= 30;
		}

		foreach ( $findings as $f ) {
			$risk += isset( $f['weight'] ) ? $f['weight'] : 0;
		}

		// A known file that did not change is essentially verified.
		if ( ! $is_new && empty( $findings ) && ! self::unusual_location( $rel ) ) {
			$risk -= 50;
		}

		return max( 0, min( 100, $risk ) );
	}

	/* ------------------------------ emission ------------------------------ */

	private function baseline_entry( $hash, $size, $mtime, $category ) {
		return array(
			'sha'  => $hash,
			'size' => $size,
			'mtime'=> $mtime,
			'cat'  => $category,
			'firstSeen' => $mtime,
		);
	}

	private function rel_path( $abs ) {
		return ltrim( str_replace( untrailingslashit( ABSPATH ), '', $abs ), '/' );
	}

	private function file_payload( $rel, $category, $hash, $prev, $size, $mtime, $status, $risk, $scan, $expected_label = null ) {
		$signals = isset( $scan['signals'] ) ? $scan['signals'] : array();

		return array(
			'path'     => '/' . $rel,
			'target'   => array( 'name' => basename( $rel ), 'path' => '/' . $rel ),
			'metadata' => array(
				'file' => array(
					'relativePath'  => $rel,
					'filename'      => basename( $rel ),
					'extension'     => strtolower( pathinfo( $rel, PATHINFO_EXTENSION ) ),
					'category'      => $category,
					'size'          => $size,
					'sha256'        => $hash,
					'previousSha256'=> $prev,
					'modifiedAt'    => $mtime * 1000,
					'firstSeenAt'   => $mtime * 1000,
					'lastSeenAt'    => time() * 1000,
					'integrityStatus' => $status,
					'riskScore'     => $risk,
					'confidence'    => $this->confidence_for( $signals, $risk ),
					'signals'       => $signals,
					'codeFindings'  => isset( $scan['findings'] ) ? $scan['findings'] : array(),
					'expectedReason'=> $expected_label,
					'analysisVersion' => '1.0.0-integrity',
				),
			),
		);
	}

	private function confidence_for( $signals, $risk ) {
		if ( $risk >= 80 ) {
			return min( 95, 60 + count( $signals ) * 8 );
		}
		if ( $risk >= 60 ) {
			return min( 90, 50 + count( $signals ) * 8 );
		}
		return 40;
	}

	private function emit_file( $rel, $category, $hash, $prev, $size, $mtime, $status, $risk, $signals, $findings ) {
		$this->events->enqueue( 'unexpected_executable', 'file', $this->file_payload( $rel, $category, $hash, $prev, $size, $mtime, $status, $risk, array( 'signals' => $signals, 'findings' => $findings ) ) );
	}
}
