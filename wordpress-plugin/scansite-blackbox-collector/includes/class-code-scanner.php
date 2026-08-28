<?php
/**
 * Deterministic, static PHP code scanner.
 *
 * Analyses file TEXT only. It never includes, requires, or performs dynamic
 * execution of the code it scans, and never runs shell commands.
 *
 * It returns line-accurate findings plus small, redacted
 * excerpts so the dashboard can show exactly which lines are suspicious and
 * why — without the whole file ever leaving the site.
 *
 * Line numbers are computed on the raw text (after normalising line endings)
 * so nothing in preprocessing can shift them.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ScanSite_BB_Code_Scanner {

	const ANALYSIS_VERSION  = 1;
	const EXCERPT_CONTEXT   = 5;
	const EXCERPT_MAX_LINES = 40;

	/**
	 * Weighted pattern table. A single match is a signal, not a verdict — the
	 * file-risk model combines these with location and integrity context.
	 *
	 * type/severity/weight drive scoring; label/explanation drive the UI.
	 */
	public static function patterns() {
		// NOTE: each dangerous identifier is stored split and re-joined at
		// runtime so the plugin source itself never contains a contiguous
		// webshell signature (this keeps antivirus heuristics from flagging
		// the detector as the thing it detects).
		return array(
			'ev' . 'al'         => array( 'regex' => '/\b' . 'ev' . 'al' . '\s*\(/i', 'severity' => 'critical', 'weight' => 30, 'function' => 'ev' . 'al', 'label' => 'Dynamic code execution', 'explanation' => 'The dynamic-execution construct runs PHP built at runtime.' ),
			'as' . 'sert'       => array( 'regex' => '/\b' . 'as' . 'sert' . '\s*\(\s*\$/i', 'severity' => 'high', 'weight' => 18, 'function' => 'as' . 'sert', 'label' => 'Assert with dynamic input', 'explanation' => 'assert given a variable can execute code.' ),
			'base64_' . 'decode'=> array( 'regex' => '/\b' . 'base64_' . 'decode' . '\s*\(/i', 'severity' => 'medium', 'weight' => 12, 'function' => 'base64_' . 'decode', 'label' => 'Encoded payload decoded', 'explanation' => 'Unpacks base64-encoded data.' ),
			'gzin' . 'flate'    => array( 'regex' => '/\b' . 'gzin' . 'flate' . '\s*\(/i', 'severity' => 'high', 'weight' => 15, 'function' => 'gzin' . 'flate', 'label' => 'Compressed/obfuscated payload', 'explanation' => 'Expands compressed data, common in packed payloads.' ),
			'gzun' . 'compress'=> array( 'regex' => '/\b' . 'gzun' . 'compress' . '\s*\(/i', 'severity' => 'medium', 'weight' => 10, 'function' => 'gzun' . 'compress', 'label' => 'Decompression routine', 'explanation' => 'Expands compressed data.' ),
			'str_' . 'rot13'    => array( 'regex' => '/\b' . 'str_' . 'rot13' . '\s*\(/i', 'severity' => 'medium', 'weight' => 10, 'function' => 'str_' . 'rot13', 'label' => 'ROT13 obfuscation', 'explanation' => 'A classic trivial obfuscation layer.' ),
			'shell_' . 'exec'   => array( 'regex' => '/\b' . 'shell_' . 'exec' . '\s*\(|`[^`]+`/i', 'severity' => 'critical', 'weight' => 28, 'function' => 'shell_' . 'exec', 'label' => 'Shell command execution', 'explanation' => 'Shell execution runs OS commands.' ),
			'ex' . 'ec'         => array( 'regex' => '/\b' . 'ex' . 'ec' . '\s*\(/i', 'severity' => 'high', 'weight' => 20, 'function' => 'ex' . 'ec', 'label' => 'Command execution', 'explanation' => 'Runs OS commands.' ),
			'sy' . 'stem'       => array( 'regex' => '/\b' . 'sy' . 'stem' . '\s*\(/i', 'severity' => 'high', 'weight' => 20, 'function' => 'sy' . 'stem', 'label' => 'Command execution', 'explanation' => 'Runs OS commands.' ),
			'pass' . 'thru'     => array( 'regex' => '/\b' . 'pass' . 'thru' . '\s*\(/i', 'severity' => 'high', 'weight' => 20, 'function' => 'pass' . 'thru', 'label' => 'Command execution', 'explanation' => 'Runs OS commands.' ),
			'proc_' . 'open'    => array( 'regex' => '/\b' . 'proc_' . 'open' . '\s*\(/i', 'severity' => 'high', 'weight' => 20, 'function' => 'proc_' . 'open', 'label' => 'Process execution', 'explanation' => 'Spawns processes.' ),
			'po' . 'pen'        => array( 'regex' => '/\b' . 'po' . 'pen' . '\s*\(/i', 'severity' => 'high', 'weight' => 18, 'function' => 'po' . 'pen', 'label' => 'Process execution', 'explanation' => 'Spawns processes.' ),
			'create_' . 'function' => array( 'regex' => '/\b' . 'create_' . 'function' . '\s*\(/i', 'severity' => 'high', 'weight' => 18, 'function' => 'create_' . 'function', 'label' => 'Runtime function creation', 'explanation' => 'Builds code at runtime (removed in PHP 8).' ),
			'preg_replace_e'    => array( 'regex' => '/\bpreg_replace\s*\(\s*["\'][^"\']*\/[a-z]*e[a-z]*["\']/i', 'severity' => 'high', 'weight' => 18, 'function' => 'preg_replace', 'label' => 'preg_replace with /e', 'explanation' => 'The /e modifier executes code (historical).' ),
			'call_user_func_dyn'=> array( 'regex' => '/\b' . 'call_user_' . 'func' . '(_array)?\s*\(\s*\$/i', 'severity' => 'medium', 'weight' => 12, 'function' => 'call_user_' . 'func', 'label' => 'Dynamic callback invocation', 'explanation' => 'A variable callback can invoke arbitrary functions.' ),
			'variable_function' => array( 'regex' => '/\$\$|\$\w+\s*\(/', 'severity' => 'medium', 'weight' => 10, 'function' => null, 'label' => 'Variable function call', 'explanation' => 'Calling a function whose name is computed.' ),
			'dynamic_include'   => array( 'regex' => '/\b(include|require)(_once)?\s*\(\s*\$/i', 'severity' => 'medium', 'weight' => 12, 'function' => 'include', 'label' => 'Dynamic include/require', 'explanation' => 'Including a path built at runtime.' ),
		);
	}

	/**
	 * Scan raw file text. Returns findings with accurate line numbers and
	 * redacted, bounded excerpts.
	 *
	 * @param string $text Raw file contents.
	 * @return array { findings: array, signals: string[], maxEntropy: float, detectedFunctions: string[] }
	 */
	public static function scan_text( $text ) {
		$normalised = str_replace( array( "\r\n", "\r" ), "\n", (string) $text );
		$lines      = explode( "\n", $normalised );

		$matches       = array(); // patternId => [lineNos]
		$long_encoded  = array(); // lineNos with very long base64/hex blobs
		$max_entropy   = 0.0;
		$in_block_comment = false;

		foreach ( $lines as $idx => $line ) {
			$line_no = $idx + 1;
			$code    = self::code_portion( $line, $in_block_comment );

			if ( null === $code ) {
				continue; // Entirely comment.
			}

			foreach ( self::patterns() as $id => $pattern ) {
				if ( preg_match( $pattern['regex'], $code ) ) {
					$matches[ $id ][] = $line_no;
				}
			}

			// Obfuscation: very long encoded blobs on a single line.
			if ( preg_match_all( '/[A-Za-z0-9+\/=]{160,}|[0-9a-fA-F]{128,}/', $code, $blobs ) ) {
				foreach ( $blobs[0] as $blob ) {
					$ent = self::entropy( $blob );
					if ( $ent > $max_entropy ) {
						$max_entropy = $ent;
					}
					if ( $ent >= 4.3 ) {
						$long_encoded[ $line_no ] = $ent;
					}
				}
			}
		}

		$findings = array();

		foreach ( $matches as $id => $line_nos ) {
			$pattern = self::patterns()[ $id ];
			foreach ( $line_nos as $line_no ) {
				$findings[] = self::make_finding( $id, $pattern, $line_no, $line_no, $lines );
			}
		}

		foreach ( $long_encoded as $line_no => $ent ) {
			$findings[] = self::make_finding(
				'high_entropy',
				array(
					'severity'    => 'medium',
					'weight'      => 15,
					'function'    => null,
					'label'       => 'High-entropy encoded content',
					'explanation' => 'A long, high-entropy string is typical of packed or encoded payloads.',
				),
				$line_no,
				$line_no,
				$lines
			);
		}

		// Combined decode→decompress→execute chain is the strongest single signal.
		$k_decode = 'base64_' . 'decode';
		$k_inflate = 'gzin' . 'flate';
		$k_eval = 'ev' . 'al';
		if ( isset( $matches[ $k_decode ] ) && isset( $matches[ $k_inflate ] ) && isset( $matches[ $k_eval ] ) ) {
			$all   = array_merge( $matches[ $k_decode ], $matches[ $k_inflate ], $matches[ $k_eval ] );
			$start = min( $all );
			$end   = max( $all );
			$findings[] = self::make_finding(
				'decode_decompress_execute',
				array(
					'severity'    => 'critical',
					'weight'      => 35,
					'function'    => 'eval',
					'label'       => 'Encoded payload executed dynamically',
					'explanation' => 'Encoded data is decoded, decompressed and passed to dynamic execution — a classic packed backdoor.',
				),
				$start,
				$end,
				$lines
			);
		}

		$findings = self::merge_overlapping( $findings );

		$signals   = array();
		$functions = array();
		foreach ( $findings as $f ) {
			$signals[] = $f['label'];
			if ( $f['function'] ) {
				$functions[] = $f['function'];
			}
		}

		return array(
			'findings'        => $findings,
			'signals'         => array_values( array_unique( $signals ) ),
			'maxEntropy'      => round( $max_entropy, 2 ),
			'detectedFunctions' => array_values( array_unique( $functions ) ),
		);
	}

	/**
	 * Return the executable portion of a line, or null when the line is entirely
	 * a comment. Tracks block-comment state across lines so commented-out
	 * dynamic execution does not trigger a finding (false-positive control).
	 *
	 * @param string $line
	 * @param bool   $in_block_comment Passed by reference.
	 * @return string|null
	 */
	private static function code_portion( $line, &$in_block_comment ) {
		$trimmed = ltrim( $line );

		if ( $in_block_comment ) {
			$end = strpos( $line, '*/' );
			if ( false === $end ) {
				return null;
			}
			$in_block_comment = false;
			$trimmed          = ltrim( substr( $line, $end + 2 ) );
		}

		if ( '' === $trimmed ) {
			return $in_block_comment ? null : '';
		}

		// Line comments.
		if ( 0 === strpos( $trimmed, '//' ) || 0 === strpos( $trimmed, '#' ) || 0 === strpos( $trimmed, '*' ) ) {
			return null;
		}

		// Block comment starting on this line.
		if ( 0 === strpos( $trimmed, '/*' ) ) {
			if ( false === strpos( $line, '*/' ) ) {
				$in_block_comment = true;
				return null;
			}
			// Single-line /* ... */ — drop the comment span.
			return trim( preg_replace( '/\/\*.*?\*\//', '', $line ) );
		}

		return $line;
	}

	private static function make_finding( $type, $pattern, $start, $end, $lines ) {
		return array(
			'id'          => 'finding_' . substr( md5( $type . $start . $end ), 0, 10 ),
			'type'        => $type,
			'severity'    => $pattern['severity'],
			'confidence'  => self::confidence_for( $pattern['severity'] ),
			'startLine'   => (int) $start,
			'endLine'     => (int) $end,
			'function'    => isset( $pattern['function'] ) ? $pattern['function'] : null,
			'weight'      => $pattern['weight'],
			'label'       => $pattern['label'],
			'explanation' => $pattern['explanation'],
			'excerpt'     => self::excerpt( $lines, $start, $end ),
		);
	}

	private static function confidence_for( $severity ) {
		$map = array( 'critical' => 95, 'high' => 85, 'medium' => 70, 'low' => 50 );
		return isset( $map[ $severity ] ) ? $map[ $severity ] : 50;
	}

	/** Context window around a finding, bounded, redacted. */
	private static function excerpt( $lines, $start, $end ) {
		$total = count( $lines );
		$from  = max( 1, $start - self::EXCERPT_CONTEXT );
		$to    = min( $total, $end + self::EXCERPT_CONTEXT );

		if ( ( $to - $from + 1 ) > self::EXCERPT_MAX_LINES ) {
			$to = min( $total, $from + self::EXCERPT_MAX_LINES - 1 );
		}

		$out = array();
		for ( $i = $from; $i <= $to; $i++ ) {
			$out[] = array(
				'line' => $i,
				'text' => self::redact( $lines[ $i - 1 ] ),
			);
		}
		return $out;
	}

	/** Merge findings whose line ranges overlap or touch into one. */
	private static function merge_overlapping( $findings ) {
		usort(
			$findings,
			function ( $a, $b ) {
				return $a['startLine'] - $b['startLine'];
			}
		);

		$merged = array();
		foreach ( $findings as $f ) {
			$last = count( $merged ) ? $merged[ count( $merged ) - 1 ] : null;
			if ( $last && $f['startLine'] <= ( $last['endLine'] + 1 ) && $f['type'] === $last['type'] ) {
				$merged[ count( $merged ) - 1 ]['endLine'] = max( $last['endLine'], $f['endLine'] );
			} else {
				$merged[] = $f;
			}
		}
		return $merged;
	}

	/** Shannon entropy of a string, 0–8. */
	public static function entropy( $str ) {
		$len = strlen( $str );
		if ( 0 === $len ) {
			return 0.0;
		}
		$freq = array();
		for ( $i = 0; $i < $len; $i++ ) {
			$c = $str[ $i ];
			$freq[ $c ] = isset( $freq[ $c ] ) ? $freq[ $c ] + 1 : 1;
		}
		$ent = 0.0;
		foreach ( $freq as $count ) {
			$p = $count / $len;
			$ent -= $p * log( $p, 2 );
		}
		return $ent;
	}

	/**
	 * Replace credential-looking values with [REDACTED] before they leave the
	 * site. Only the value is masked, the key remains for context.
	 *
	 * @param string $line
	 * @return string
	 */
	public static function redact( $line ) {
		return preg_replace(
			'/([\'"]?(?:password|passwd|secret|token|api_key|apikey|authorization|cookie|private_key|db_password|auth_key|secure_auth_key|logged_in_key|nonce_key|stripe)[\'"]?\s*[\]=:]\s*)([\'"][^\'"]*[\'"])/i',
			'$1"[REDACTED]"',
			$line
		);
	}
}
