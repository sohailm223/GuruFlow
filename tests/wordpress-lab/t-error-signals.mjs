/**
 * Error signals — REST, mail, database, AJAX and cron errors captured inside a
 * real WordPress on real PHP.
 *
 * The PHP fatal path has its own suite (t-errors.mjs) and is not repeated here.
 * This drives the real WordPress code paths that produce the other families —
 * WP_REST_Server::serve_request(), a wp_mail() that genuinely fails, a
 * $wpdb->query() against a table that does not exist, and a scheduled task
 * whose callback really fatals — and asserts on what the collector queued.
 *
 * The privacy rules are asserted by absence: no SQL statement, no email body,
 * no recipient, no posted form field, no credential-shaped token in any queued
 * event.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { note, matrix, phpRun, queue, flush, LAB } from './harness.mjs';

const PROBE_DIR = join(LAB, 'wp', 'wp-content', 'plugins', 'scansite-signal-probe');
const PROBE_SLUG = 'scansite-signal-probe';
const REQUIRE = `require_once WP_PLUGIN_DIR . '/${PROBE_SLUG}/${PROBE_SLUG}.php';`;

/** A throwaway plugin that owns a REST route and an admin-ajax action. */
function writeProbePlugin() {
  mkdirSync(PROBE_DIR, { recursive: true });
  writeFileSync(
    join(PROBE_DIR, 'scansite-signal-probe.php'),
    `<?php
/*
Plugin Name: ScanSite Signal Probe
Description: Throwaway plugin used by the error signal tests.
Version: 1.0.0
*/

add_action( 'rest_api_init', function () {
	register_rest_route(
		'scansite-probe/v1',
		'/orders',
		array(
			'methods'             => 'POST',
			'callback'            => array( 'ScanSiteSignalProbe', 'handle' ),
			'permission_callback' => array( 'ScanSiteSignalProbe', 'deny' ),
		)
	);
	// A route that is allowed to run, so a successful call can be proved silent.
	register_rest_route(
		'scansite-probe/v1',
		'/health',
		array(
			'methods'             => 'GET',
			'callback'            => array( 'ScanSiteSignalProbe', 'handle' ),
			'permission_callback' => '__return_true',
		)
	);
} );

add_action( 'wp_ajax_scansite_probe_action', array( 'ScanSiteSignalProbe', 'ajax' ) );

class ScanSiteSignalProbe {
	public static function handle() {
		return new WP_REST_Response( array( 'ok' => true ), 200 );
	}

	public static function deny() {
		return new WP_Error( 'rest_forbidden', 'Sorry, you are not allowed to do that.', array( 'status' => 403 ) );
	}

	public static function ajax() {
		wp_send_json_error( array( 'reason' => 'bad request' ), 400 );
	}

	// Used to raise a genuine fatal inside a scheduled task.
	public function undefined_method() {
		$this->method_that_does_not_exist();
	}
}
`
  );
}

/** Clear the queue and the throttle so every test starts from nothing. */
async function reset(php) {
  await phpRun(php, 'lab_login_admin(); lab_clear_queue(); update_option( ScanSite_BB_Error_Capture::OPT_STATE, array(), false );');
}

/** The queued events of one type. */
const of = (list, type) => list.filter((e) => e.type === type);

export async function runErrorSignalTests(php) {
  console.log('\n' + '='.repeat(72));
  console.log('ERROR SIGNALS — REST · MAIL · DATABASE · AJAX · CRON');
  console.log('='.repeat(72));

  writeProbePlugin();

  /* ------------------------------------------------------- registration */
  console.log('\n--- the signals class hooks in ---');

  const reg = await phpRun(php, `
lab_login_admin();
lab_dump('class', class_exists('ScanSite_BB_Error_Signals'));
lab_dump('rest', has_filter('rest_post_dispatch') ? 'yes' : 'no');
lab_dump('mail', has_action('wp_mail_failed') ? 'yes' : 'no');
lab_dump('shutdown', has_action('shutdown') ? 'yes' : 'no');
lab_dump('cron', has_action('init') ? 'yes' : 'no');`);

  note('signals', 'The signals class loads inside WordPress', reg.markers.class === true, `class_exists=${reg.markers.class}`);
  note('signals', 'rest_post_dispatch is hooked', reg.markers.rest === 'yes', String(reg.markers.rest));
  note('signals', 'wp_mail_failed is hooked', reg.markers.mail === 'yes', String(reg.markers.mail));
  note('signals', 'The shutdown sweep is hooked', reg.markers.shutdown === 'yes', String(reg.markers.shutdown));
  note('signals', 'The cron watcher is hooked', reg.markers.cron === 'yes', String(reg.markers.cron));

  /* --------------------------------------------------------------- REST */
  console.log('\n--- a refused REST request ---');

  await reset(php);
  const rest = await phpRun(php, `
${REQUIRE}
lab_login_admin();
$_SERVER['REQUEST_METHOD'] = 'POST';
$_SERVER['REQUEST_URI']    = '/wp-json/scansite-probe/v1/orders';

// Intercept every outbound request so this test can prove capture never
// performs a network call.
$GLOBALS['lab_http'] = 0;
add_filter( 'pre_http_request', function ( $p ) { $GLOBALS['lab_http']++; return new WP_Error( 'blocked', 'lab' ); }, 1, 3 );

$server = rest_get_server();
ob_start();
$server->serve_request( '/scansite-probe/v1/orders' );
ob_end_clean();

lab_dump('outbound', $GLOBALS['lab_http'] );
lab_dump_queue();`);

  const restEvents = of(rest.markers.QUEUE ?? [], 'rest_error');
  const rm = restEvents[0]?.metadata ?? {};

  note('signals', 'A refused REST request is captured', restEvents.length === 1, `queued=${restEvents.length}`);
  note('signals', 'Capture performs no network request', rest.markers.outbound === 0, `outbound=${rest.markers.outbound}`);
  matrix('rest_error', {
    tested: 'Yes',
    detected: restEvents.length === 1 ? 'Yes' : 'No',
    payloadCorrect: rm.endpoint && rm.code ? 'Yes' : 'No',
    notes: restEvents.length ? `${rm.status} ${rm.httpMethod} ${rm.endpoint} ${rm.code}` : 'not captured',
  });

  note('signals', 'The endpoint is recorded', rm.endpoint === '/scansite-probe/v1/orders', String(rm.endpoint));
  note('signals', 'The HTTP method is recorded', rm.httpMethod === 'POST', String(rm.httpMethod));
  note('signals', 'The status is recorded', rm.status === 403, `status=${rm.status}`);
  note('signals', 'The WP_Error code is recorded', rm.code === 'rest_forbidden', String(rm.code));
  note('signals', 'The message is sanitised and present', typeof rm.message === 'string' && rm.message.length > 0, String(rm.message));
  note('signals', 'The owning plugin is resolved from the route callback',
    rm.component === 'plugin' && rm.componentSlug === PROBE_SLUG, `${rm.component}/${rm.componentSlug}`);
  note('signals', 'The plugin display name is resolved',
    rm.componentName === 'ScanSite Signal Probe', String(rm.componentName));
  note('signals', 'The request body is never sent',
    !JSON.stringify(restEvents).includes('card_number'));

  // A successful call must record nothing. This uses a route whose
  // permission_callback really does allow it — filtering
  // rest_authentication_errors would not bypass a route-level callback, so the
  // request would still be refused and the assertion would mean nothing.
  await reset(php);
  const restOk = await phpRun(php, `
${REQUIRE}
lab_login_admin();
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI']    = '/wp-json/scansite-probe/v1/health';
$server = rest_get_server();
ob_start();
$server->serve_request( '/scansite-probe/v1/health' );
$out = ob_get_clean();
lab_dump('body', $out );
lab_dump_queue();`);
  note('signals', 'The allowed route really did answer', String(restOk.markers.body ?? '').includes('ok'), String(restOk.markers.body).slice(0, 80));
  note('signals', 'A successful REST call records nothing',
    of(restOk.markers.QUEUE ?? [], 'rest_error').length === 0,
    `queued=${of(restOk.markers.QUEUE ?? [], 'rest_error').length}`);

  /* --------------------------------------------------------------- mail */
  console.log('\n--- a real wp_mail failure ---');

  await reset(php);
  const mail = await phpRun(php, `
lab_login_admin();
// No pre_wp_mail filter: returning false there short-circuits wp_mail() before
// wp_mail_failed is fired, which would test nothing. There is no mail transport
// in this runtime, so wp_mail() fails on its own and the hook really fires.
add_filter( 'wp_mail_from', function () { return 'no-reply@shop.example'; } );

$sent = wp_mail(
	'buyer@shop.example',
	'Your order #4242 confirmation',
	'Thanks for your order. Card ending 4242424242424242 was charged.'
);
lab_dump('sent', $sent );
lab_dump_queue();`);

  const mailEvents = of(mail.markers.QUEUE ?? [], 'mail_error');
  const mm = mailEvents[0]?.metadata ?? {};
  const mailJson = JSON.stringify(mailEvents);

  note('signals', 'wp_mail really did fail', mail.markers.sent === false, `sent=${mail.markers.sent}`);
  note('signals', 'A real wp_mail failure is captured', mailEvents.length === 1, `queued=${mailEvents.length} sent=${mail.markers.sent}`);
  matrix('mail_error', {
    tested: 'Yes',
    detected: mailEvents.length === 1 ? 'Yes' : 'No',
    payloadCorrect: mm.code ? 'Yes' : 'No',
    notes: mailEvents.length ? `${mm.code} via ${mm.transport}` : 'not captured',
  });

  note('signals', 'The error code is recorded', typeof mm.code === 'string' && mm.code.length > 0, String(mm.code));
  note('signals', 'The transport is recorded', typeof mm.transport === 'string' && mm.transport.length > 0, String(mm.transport));
  note('signals', 'The email body is never sent', !mailJson.includes('Thanks for your order'));
  note('signals', 'The subject is never sent', !mailJson.includes('Your order'));
  note('signals', 'The recipient is never sent', !mailJson.includes('buyer@shop.example'), mailJson.slice(0, 160));
  note('signals', 'A card number in the body is never sent', !mailJson.includes('4242424242424242'));
  note('signals', 'No SMTP credential is sent', !/passw|secret|api[_-]?key/i.test(mailJson));

  /* ----------------------------------------------------------- database */
  console.log('\n--- a real database error ---');

  await reset(php);
  const dbRun = await phpRun(php, `
lab_login_admin();
global $wpdb;
$wpdb->suppress_errors( false );
$wpdb->show_errors();
// A query carrying obviously private data, to prove none of it leaves.
$wpdb->query( "SELECT * FROM wp_missing_table_xyz WHERE user_email = 'buyer@shop.example' AND note = 'secret note'" );
lab_dump('ezsqlCount', isset( $GLOBALS['EZSQL_ERROR'] ) ? count( $GLOBALS['EZSQL_ERROR'] ) : 0 );`);

  // Read the queue from a separate request. Database errors are collected by
  // the shutdown sweep, which by definition has not run yet while the failing
  // request is still executing — dumping the queue inside the same run would
  // always see nothing and pass for the wrong reason.
  const db = await queue(php);
  const dbEvents = of(db, 'db_error');
  const dm = dbEvents[0]?.metadata ?? {};
  const dbJson = JSON.stringify(dbEvents);

  note('signals', 'The query really did fail', (dbRun.markers.ezsqlCount ?? 0) > 0, `ezsql=${dbRun.markers.ezsqlCount}`);
  note('signals', 'A real database error is captured by the shutdown sweep', dbEvents.length === 1,
    `queued=${dbEvents.length} ezsql=${dbRun.markers.ezsqlCount}`);
  matrix('db_error', {
    tested: 'Yes',
    detected: dbEvents.length === 1 ? 'Yes' : 'No',
    payloadCorrect: dm.queryType && dm.table ? 'Yes' : 'No',
    notes: dbEvents.length ? `${dm.queryType} on ${dm.table}` : 'not captured',
  });

  note('signals', 'The query type is recorded', dm.queryType === 'SELECT', `queryType=${dm.queryType}`);
  note('signals', 'The table name is recorded', dm.table === 'wp_missing_table_xyz', `table=${dm.table}`);
  note('signals', 'The complete SQL statement is never sent', !dbJson.includes('wp_missing_table_xyz WHERE'), dbJson.slice(0, 200));
  note('signals', 'No SELECT keyword survives in the message', !/SELECT\s/i.test(String(dm.message)), String(dm.message));
  note('signals', 'No private value survives', !dbJson.includes('buyer@shop.example') && !dbJson.includes('secret note'));
  // "MySQL" appears in wpdb's own wording and is not a credential, so this
  // asserts on credential material specifically rather than on a product name.
  note('signals', 'No database credential is sent',
    !/DB_PASSWORD|DB_USER|DB_HOST|password=|pwd=|user=\s/i.test(dbJson), dbJson.slice(0, 200));

  // The reducer itself.
  const shape = await phpRun(php, `
lab_login_admin();
$out = array();
foreach ( array(
	'SELECT * FROM wp_posts WHERE ID = 5',
	"UPDATE wp_options SET option_value = 'x' WHERE option_name = 'y'",
	'INSERT INTO wp_postmeta (post_id) VALUES (1)',
	'DROP TABLE wp_links',
	'not a query at all',
) as $sql ) {
	$out[] = ScanSite_BB_Error_Signals::describe_query( $sql );
}
lab_dump('shapes', $out );
lab_dump('stripped', ScanSite_BB_Error_Signals::strip_sql( "Failed running SELECT * FROM wp_users WHERE email='a@b.com' badly" ) );`);

  const shapes = shape.markers.shapes ?? [];
  note('signals', 'describe_query reads a SELECT', shapes[0]?.type === 'SELECT' && shapes[0]?.table === 'wp_posts', JSON.stringify(shapes[0]));
  note('signals', 'describe_query reads an UPDATE', shapes[1]?.type === 'UPDATE' && shapes[1]?.table === 'wp_options', JSON.stringify(shapes[1]));
  note('signals', 'describe_query reads an INSERT', shapes[2]?.type === 'INSERT' && shapes[2]?.table === 'wp_postmeta', JSON.stringify(shapes[2]));
  note('signals', 'describe_query reads a DROP', shapes[3]?.type === 'DROP' && shapes[3]?.table === 'wp_links', JSON.stringify(shapes[3]));
  note('signals', 'describe_query reports nothing for a non-query',
    shapes[4]?.type === null && shapes[4]?.table === null, JSON.stringify(shapes[4]));
  note('signals', 'strip_sql removes an embedded statement',
    typeof shape.markers.stripped === 'string' && !/SELECT/i.test(shape.markers.stripped) && !shape.markers.stripped.includes('a@b.com'),
    String(shape.markers.stripped));

  /* --------------------------------------------------------------- AJAX */
  console.log('\n--- an admin-ajax action ---');

  await reset(php);
  const ajax = await phpRun(php, `
${REQUIRE}
lab_login_admin();
$_SERVER['REQUEST_URI']    = '/wp-admin/admin-ajax.php';
$_SERVER['REQUEST_METHOD'] = 'POST';
$_REQUEST['action']        = 'scansite_probe_action';
$_POST['card_number']      = '4242424242424242';   // must never be sent

if ( ! defined( 'DOING_AJAX' ) ) { define( 'DOING_AJAX', true ); }
lab_dump('ajaxContext', wp_doing_ajax() );
lab_dump('statusVisible', http_response_code() );

// Which plugin WordPress says owns this action.
$ref = new ReflectionMethod( 'ScanSite_BB_Error_Signals', 'component_for_ajax_action' );
$ref->setAccessible( true );
lab_dump('owner', $ref->invoke( null, 'scansite_probe_action' ) );

// The gate itself: with a 200 status nothing may be recorded.
ScanSite_BB_Error_Signals::record_ajax_error();
lab_dump_queue();`);

  const ajaxEvents = of(ajax.markers.QUEUE ?? [], 'ajax_error');
  const owner = ajax.markers.owner ?? {};
  const ajaxJson = JSON.stringify(ajax.markers);

  note('signals', 'The AJAX context was entered', ajax.markers.ajaxContext === true, `wp_doing_ajax=${ajax.markers.ajaxContext}`);
  note('signals', 'The action is attributed to the plugin that registered it',
    owner.component === 'plugin' && owner.slug === PROBE_SLUG, `${owner.component}/${owner.slug}`);
  note('signals', 'The plugin display name is resolved for the action',
    owner.name === 'ScanSite Signal Probe', `name=${owner.name}`);
  // php-wasm ignores http_response_code(), so the status gate can only be
  // proved in the negative direction here: a request that did not fail must
  // record nothing.
  note('signals', 'An admin-ajax request that did not fail records nothing',
    ajaxEvents.length === 0, `statusVisible=${ajax.markers.statusVisible} queued=${ajaxEvents.length}`);
  note('signals', 'No posted form field is sent', !ajaxJson.includes('4242424242424242'), ajaxJson.slice(0, 160));

  const actionSan = await phpRun(php, `
lab_login_admin();
$_REQUEST['action'] = 'evil<script>alert(1)</script>action"; DROP TABLE x;--';
$ref = new ReflectionMethod( 'ScanSite_BB_Error_Signals', 'ajax_action' );
$ref->setAccessible( true );
lab_dump('action', $ref->invoke( null ) );`);
  note('signals', 'The action name is reduced to safe characters',
    typeof actionSan.markers.action === 'string' && !/[^a-zA-Z0-9_\-]/.test(actionSan.markers.action), String(actionSan.markers.action));

  // Drive the real capture path end to end. php-wasm cannot set
  // http_response_code(), so the status is supplied through the documented
  // filter seam — the code under test (gate, attribution, sanitising, queue)
  // is the shipped code, and only the status source is substituted.
  await reset(php);
  const ajaxFail = await phpRun(php, `
${REQUIRE}
lab_login_admin();
$_SERVER['REQUEST_URI']    = '/wp-admin/admin-ajax.php';
$_SERVER['REQUEST_METHOD'] = 'POST';
$_REQUEST['action']        = 'scansite_probe_action';
$_POST['card_number']      = '4242424242424242';   // must never be sent
if ( ! defined( 'DOING_AJAX' ) ) { define( 'DOING_AJAX', true ); }
add_filter( 'scansite_blackbox_response_status', function () { return 400; } );
lab_dump('status', ScanSite_BB_Error_Capture::response_status() );
ScanSite_BB_Error_Signals::record_ajax_error();
lab_dump_queue();`);

  const af = of(ajaxFail.markers.QUEUE ?? [], 'ajax_error');
  const am = af[0]?.metadata ?? {};

  note('signals', 'A failed admin-ajax request is captured', af.length === 1, `queued=${af.length} status=${ajaxFail.markers.status}`);
  note('signals', 'The action name is recorded', am.ajaxAction === 'scansite_probe_action', `action=${am.ajaxAction}`);
  note('signals', 'The status is recorded', am.status === 400, `status=${am.status}`);
  note('signals', 'The request path is recorded',
    typeof am.requestPath === 'string' && am.requestPath.length > 0, String(am.requestPath));
  note('signals', 'The owning plugin is resolved for the captured event',
    am.component === 'plugin' && am.componentSlug === PROBE_SLUG, `${am.component}/${am.componentSlug}`);
  note('signals', 'No posted form field reaches the captured event',
    !JSON.stringify(af).includes('4242424242424242'), JSON.stringify(af).slice(0, 160));

  matrix('ajax_error', {
    tested: 'Yes',
    detected: af.length === 1 ? 'Yes' : 'No',
    payloadCorrect: am.ajaxAction === 'scansite_probe_action' && am.status === 400 ? 'Yes' : 'No',
    notes: af.length ? `action ${am.ajaxAction} status ${am.status} via the status filter seam` : 'not captured',
  });

  /* --------------------------------------------------------------- cron */
  console.log('\n--- a scheduled task that fails ---');

  const cron = await phpRun(php, `
lab_login_admin();
wp_schedule_event( time() + 3600, 'twicedaily', 'scansite_probe_cleanup' );
ScanSite_BB_Error_Signals::on_cron_event( 'scansite_probe_cleanup', array( 'a' ) );
lab_dump('context', ScanSite_BB_Error_Signals::cron_context() );`);

  note('signals', 'The cron hook is captured while it runs',
    cron.markers.context?.hook === 'scansite_probe_cleanup', JSON.stringify(cron.markers.context));
  note('signals', 'The schedule is resolved from the real cron array',
    cron.markers.context?.schedule === 'twicedaily', `schedule=${cron.markers.context?.schedule}`);
  note('signals', 'The argument count is recorded, not the arguments',
    cron.markers.context?.args === 1, `args=${cron.markers.context?.args}`);

  const unknownCron = await phpRun(php, `
lab_login_admin();
ScanSite_BB_Error_Signals::on_cron_event( 'a_hook_that_is_not_scheduled' );
lab_dump('context', ScanSite_BB_Error_Signals::cron_context() );`);
  note('signals', 'An unscheduled hook reports no schedule rather than guessing',
    unknownCron.markers.context?.schedule === null, JSON.stringify(unknownCron.markers.context));

  // The listener is attached from the real cron array, during a cron request.
  const cronWatch = await phpRun(php, `
lab_login_admin();
wp_clear_scheduled_hook( 'scansite_probe_boom' );
wp_schedule_event( time() - 10, 'hourly', 'scansite_probe_boom' );
if ( ! defined( 'DOING_CRON' ) ) { define( 'DOING_CRON', true ); }
lab_dump('doingCron', wp_doing_cron() );
ScanSite_BB_Error_Signals::watch_cron_events();
lab_dump('listener', has_action( 'pre_scansite_probe_boom' ) ? 'yes' : 'no' );`);
  note('signals', 'The watcher attaches a listener to a scheduled hook',
    cronWatch.markers.doingCron === true && cronWatch.markers.listener === 'yes',
    `doingCron=${cronWatch.markers.doingCron} listener=${cronWatch.markers.listener}`);

  // A scheduled callback that fatals takes the cron request with it. The throw
  // is expected — the queue read afterwards is the real assertion.
  await reset(php);
  try {
    await phpRun(php, `
lab_login_admin();
wp_clear_scheduled_hook( 'scansite_probe_boom' );
wp_schedule_event( time() - 10, 'hourly', 'scansite_probe_boom' );
if ( ! defined( 'DOING_CRON' ) ) { define( 'DOING_CRON', true ); }
ScanSite_BB_Error_Signals::watch_cron_events();
// WordPress fires pre_{$hook} before running the callback.
do_action( 'pre_scansite_probe_boom' );
lab_dump('context', ScanSite_BB_Error_Signals::cron_context() );
${REQUIRE}
( new ScanSiteSignalProbe() )->undefined_method();`);
  } catch {
    /* the cron request is meant to die */
  }
  const cronEvents = of(await queue(php), 'cron_error');
  const cm = cronEvents[0]?.metadata ?? {};

  note('signals', 'A scheduled task that fatals is captured as cron_error',
    cronEvents.length === 1, `queued=${cronEvents.length}`);
  note('signals', 'The failing hook name is recorded', cm.cronHook === 'scansite_probe_boom', `hook=${cm.cronHook}`);
  note('signals', 'The schedule is recorded with the failure', cm.schedule === 'hourly', `schedule=${cm.schedule}`);
  note('signals', 'The fatal that stopped it is recorded',
    typeof cm.message === 'string' && cm.message.length > 0, String(cm.message));
  note('signals', 'A cron failure is grouped by hook, not by message',
    typeof cm.fingerprint === 'string' && cm.fingerprint.length > 0, `fp=${cm.fingerprint}`);
  matrix('cron_error', {
    tested: 'Yes',
    detected: cronEvents.length === 1 ? 'Yes' : 'No',
    payloadCorrect: cm.cronHook === 'scansite_probe_boom' && cm.schedule === 'hourly' ? 'Yes' : 'No',
    notes: cronEvents.length ? `hook ${cm.cronHook} schedule ${cm.schedule}` : 'not captured',
  });

  /* --------------------------------------------------------------- http */
  console.log('\n--- an HTTP error response ---');

  // Driven through the same status seam. The gate, route grouping, fingerprint
  // and queue are all the shipped code; only the status source is substituted,
  // because php-wasm cannot set a response status at all.
  await reset(php);
  const http = await phpRun(php, `
lab_login_admin();
$_SERVER['REQUEST_URI']         = '/wp-json/wc/v3/orders/1234';
$_SERVER['REQUEST_METHOD']      = 'POST';
$_SERVER['REQUEST_TIME_FLOAT']  = microtime( true ) - 0.25;
add_filter( 'scansite_blackbox_response_status', function () { return 503; } );
lab_dump('status', ScanSite_BB_Error_Capture::response_status() );
ScanSite_BB_Error_Capture::on_shutdown();
lab_dump_queue();`);

  const httpEvents = of(http.markers.QUEUE ?? [], 'http_error');
  const hm = httpEvents[0]?.metadata ?? {};

  note('signals', 'An HTTP 503 response is captured', httpEvents.length === 1, `queued=${httpEvents.length} status=${http.markers.status}`);
  note('signals', 'The status is recorded', hm.status === 503, `status=${hm.status}`);
  note('signals', 'The request path is recorded', typeof hm.requestPath === 'string' && hm.requestPath.length > 0, String(hm.requestPath));
  note('signals', 'The HTTP method is recorded', hm.requestMethod === 'POST', String(hm.requestMethod));
  note('signals', 'A response time is recorded when the server provides one',
    typeof hm.responseTimeMs === 'number' && hm.responseTimeMs > 0, `ms=${hm.responseTimeMs}`);
  note('signals', 'The fingerprint groups by status and route, not by id',
    typeof hm.fingerprint === 'string' && hm.fingerprint.length === 24, `fp=${hm.fingerprint}`);
  matrix('http_error', {
    tested: 'Yes',
    detected: httpEvents.length === 1 ? 'Yes' : 'No',
    payloadCorrect: hm.status === 503 && hm.requestMethod === 'POST' ? 'Yes' : 'No',
    notes: httpEvents.length ? `HTTP ${hm.status} ${hm.requestMethod} via the status filter seam` : 'not captured',
  });

  // Two ids on one route must collapse into one group.
  await reset(php);
  const httpRoutes = await phpRun(php, `
lab_login_admin();
add_filter( 'scansite_blackbox_response_status', function () { return 404; } );
$_SERVER['REQUEST_METHOD'] = 'GET';
foreach ( array( '/wp-json/wc/v3/orders/1234', '/wp-json/wc/v3/orders/5678' ) as $u ) {
	$_SERVER['REQUEST_URI'] = $u;
	update_option( ScanSite_BB_Error_Capture::OPT_STATE, array(), false );
	ScanSite_BB_Error_Capture::on_shutdown();
}
lab_dump_queue();`);
  const routeFps = of(httpRoutes.markers.QUEUE ?? [], 'http_error').map((e) => e.metadata.fingerprint);
  note('signals', 'Two ids on one route share a fingerprint',
    routeFps.length === 2 && routeFps[0] === routeFps[1], JSON.stringify(routeFps));

  // A success status must record nothing.
  await reset(php);
  const httpOk = await phpRun(php, `
lab_login_admin();
$_SERVER['REQUEST_URI'] = '/checkout/';
add_filter( 'scansite_blackbox_response_status', function () { return 200; } );
ScanSite_BB_Error_Capture::on_shutdown();
lab_dump_queue();`);
  note('signals', 'A 200 response records nothing',
    of(httpOk.markers.QUEUE ?? [], 'http_error').length === 0, `queued=${of(httpOk.markers.QUEUE ?? [], 'http_error').length}`);

  /* ------------------------------------------------------------- WP_Error */
  console.log('\n--- a WP_Error from an outbound request ---');

  // WordPress fires http_api_debug after every wp_remote_*() call. The request
  // has to really fail for the hook to fire — a pre_http_request stub returns
  // from WP_Http::request() before http_api_debug is reached.
  await reset(php);
  const wpErr = await phpRun(php, `
${REQUIRE}
lab_login_admin();
add_filter( 'http_request_args', function ( $args ) {
	$args['timeout']     = 1;
	$args['redirection'] = 0;
	return $args;
} );
$res = wp_remote_get( 'http://scansite-unreachable.invalid/charge?api_key=sk_live_99887766' );
lab_dump('isError', is_wp_error( $res ) );
lab_dump('code', is_wp_error( $res ) ? $res->get_error_code() : '-' );
lab_dump_queue();`);

  const wpEvents = of(wpErr.markers.QUEUE ?? [], 'wp_error');
  const wm = wpEvents[0]?.metadata ?? {};
  const wpJson = JSON.stringify(wpEvents);

  note('signals', 'A failed outbound request is captured as a WP_Error',
    wpEvents.length === 1, `queued=${wpEvents.length} isError=${wpErr.markers.isError} code=${wpErr.markers.code}`);
  note('signals', 'The WP_Error code is recorded',
    typeof wm.errorCode === 'string' && wm.errorCode.length > 0 && wm.errorCode === wpErr.markers.code,
    `code=${wm.errorCode}`);
  note('signals', 'The message is recorded',
    typeof wm.message === 'string' && wm.message.length > 0, String(wm.message).slice(0, 80));
  note('signals', 'Only the host is kept from the request URL, not its query string',
    wm.source === 'scansite-unreachable.invalid', `source=${wm.source}`);
  note('signals', 'No API key from the request URL is sent',
    !wpJson.includes('sk_live_99887766'), wpJson.slice(0, 160));
  note('signals', 'The context says what kind of call failed',
    wm.context === 'outbound HTTP request', `context=${wm.context}`);
  matrix('wp_error', {
    tested: 'Yes',
    detected: wpEvents.length === 1 ? 'Yes' : 'No',
    payloadCorrect: wm.source === 'scansite-unreachable.invalid' && wm.errorCode === wpErr.markers.code ? 'Yes' : 'No',
    notes: wpEvents.length ? `${wm.errorCode} from a real wp_remote_get() failure` : 'not captured',
  });

  // The collector's own delivery failing is not the site's error.
  await reset(php);
  const ownEndpoint = await phpRun(php, `
lab_login_admin();
ScanSite_BB_Error_Signals::on_http_api_debug(
	new WP_Error( 'http_request_failed', 'Could not resolve host' ),
	'response', 'WpOrg', array(), ScanSite_BB_Connection::endpoint() . '/api/blackbox/ingest'
);
lab_dump_queue();`);
  note('signals', "ScanSite's own failed delivery is not recorded as a site error",
    of(ownEndpoint.markers.QUEUE ?? [], 'wp_error').length === 0,
    `queued=${of(ownEndpoint.markers.QUEUE ?? [], 'wp_error').length}`);

  // A transport-context WP_Error is an internal retry and must not be recorded.
  await reset(php);
  const wpTransport = await phpRun(php, `
lab_login_admin();
ScanSite_BB_Error_Signals::on_http_api_debug( new WP_Error( 'http_request_failed', 'retrying' ), 'transport' );
lab_dump_queue();`);
  note('signals', 'A transport retry is not recorded as a failure',
    of(wpTransport.markers.QUEUE ?? [], 'wp_error').length === 0,
    `queued=${of(wpTransport.markers.QUEUE ?? [], 'wp_error').length}`);

  /* ----------------------------------------------------------- JS errors */
  console.log('\n--- a JavaScript error reported from the browser ---');

  await reset(php);
  const js = await phpRun(php, `
${REQUIRE}
lab_login_admin();
$req = new WP_REST_Request( 'POST', '/scansite-blackbox/v1/js-error' );
$req->set_param( 'message', 'Cannot read properties of undefined (reading "price")' );
$req->set_param( 'scriptUrl', 'https://example.com/wp-content/plugins/woocommerce/assets/js/cart.js?ver=123' );
$req->set_param( 'line', 128 );
$req->set_param( 'column', 7 );
$req->set_param( 'pageUrl', 'https://example.com/checkout/?order=99887766' );
$resp = ScanSite_BB_Error_Signals::on_js_report( $req );
lab_dump('ok', is_object( $resp ) );
lab_dump_queue();`);

  const jsEvents = of(js.markers.QUEUE ?? [], 'js_error');
  const jm = jsEvents[0]?.metadata ?? {};
  const jsJson = JSON.stringify(jsEvents);

  note('signals', 'A browser-reported JS error is captured', jsEvents.length === 1, `queued=${jsEvents.length}`);
  note('signals', 'The message is recorded',
    typeof jm.message === 'string' && jm.message.includes('Cannot read properties'), String(jm.message).slice(0, 70));
  note('signals', 'The script URL is recorded without its query string',
    jm.scriptUrl === '/wp-content/plugins/woocommerce/assets/js/cart.js', `script=${jm.scriptUrl}`);
  note('signals', 'The line and column are recorded',
    jm.line === 128 && jm.column === 7, `line=${jm.line} col=${jm.column}`);
  note('signals', 'The page URL is recorded without its query string',
    jm.pageUrl === '/checkout/', `page=${jm.pageUrl}`);
  note('signals', 'No query-string value from either URL is sent',
    !jsJson.includes('99887766'), jsJson.slice(0, 160));
  matrix('js_error', {
    tested: 'Yes',
    detected: jsEvents.length === 1 ? 'Yes' : 'No',
    payloadCorrect: jm.line === 128 && jm.pageUrl === '/checkout/' ? 'Yes' : 'No',
    notes: jsEvents.length ? 'intake route verified; the browser-side handler is not exercised (no browser in the lab)' : 'not captured',
  });

  // The reporter must only be printed when the collector is paired.
  const unpaired = await phpRun(php, `
lab_login_admin();
// Clearing the collector key makes the site unpaired: has_credentials() is
// false, so nothing should be printed into its pages. The key is restored in
// the same run — leaving it cleared would stop every later test queueing.
$saved = get_option( ScanSite_BB_Connection::OPT_KEY, '' );
update_option( ScanSite_BB_Connection::OPT_KEY, '', false );
lab_dump('paired', ScanSite_BB_Connection::has_credentials() );
$ref = new ReflectionProperty( 'ScanSite_BB_Error_Signals', 'reporter_printed' );
$ref->setAccessible( true );
$ref->setValue( null, false );
ob_start();
ScanSite_BB_Error_Signals::print_js_reporter();
lab_dump('out', trim( ob_get_clean() ) );
update_option( ScanSite_BB_Connection::OPT_KEY, $saved, false );
lab_dump('restored', ScanSite_BB_Connection::has_credentials() );`);
  note('signals', 'An unpaired site prints no reporter into its pages',
    unpaired.markers.paired === false && unpaired.markers.out === '',
    `paired=${unpaired.markers.paired} len=${String(unpaired.markers.out ?? '').length}`);
  note('signals', 'The collector key is restored for the tests that follow',
    unpaired.markers.restored === true, `restored=${unpaired.markers.restored}`);

  /* ------------------------------------------------- route normalisation */
  console.log('\n--- routes group by endpoint, not by id ---');

  const routes = await phpRun(php, `
lab_login_admin();
lab_dump('numA', ScanSite_BB_Error_Capture::normalise_route( '/wp-json/wc/v3/orders/1234' ) );
lab_dump('numB', ScanSite_BB_Error_Capture::normalise_route( '/wp-json/wc/v3/orders/5678' ) );
lab_dump('uuidA', ScanSite_BB_Error_Capture::normalise_route( '/wp-json/wc/v3/orders/550e8400-e29b-41d4-a716-446655440000' ) );
lab_dump('uuidB', ScanSite_BB_Error_Capture::normalise_route( '/wp-json/wc/v3/orders/111e2222-3333-4444-5555-666677778888' ) );
lab_dump('v4', ScanSite_BB_Error_Capture::normalise_route( '/wp-json/wc/v4/orders/9' ) );
lab_dump('plain', ScanSite_BB_Error_Capture::normalise_route( '/checkout/' ) );`);

  const r = routes.markers;
  note('signals', 'Two failing numeric ids are one route', r.numA === r.numB, `${r.numA} === ${r.numB}`);
  // Masking the digits first destroys the UUID shape, so the UUID branch never
  // matched and every distinct id became its own group. Order matters.
  note('signals', 'Two failing UUIDs are one route', r.uuidA === r.uuidB, `${r.uuidA} === ${r.uuidB}`);
  note('signals', 'A UUID route is not mistaken for a numeric one', r.uuidA !== r.numA, `${r.uuidA} vs ${r.numA}`);
  note('signals', 'An API version is kept distinct from another version', r.v4 !== r.numA, `${r.v4} vs ${r.numA}`);
  note('signals', 'A route with no id is left alone', r.plain === '/checkout/', String(r.plain));

  /* -------------------------------------------------------- sanitising */
  console.log('\n--- the sanitiser ---');

  const san = await phpRun(php, `
lab_login_admin();
lab_dump('email', ScanSite_BB_Error_Signals::sanitize_text( "Failed for buyer@shop.example while paying" ) );
lab_dump('digits', ScanSite_BB_Error_Signals::sanitize_text( 'Card 4242424242424242 declined' ) );
lab_dump('quoted', ScanSite_BB_Error_Signals::sanitize_text( "Undefined index 'customer_note'" ) );
lab_dump('markup', ScanSite_BB_Error_Signals::sanitize_text( '<strong>Bad</strong> thing &amp; more' ) );
lab_dump('sql', ScanSite_BB_Error_Signals::sanitize_text( "WordPress database error for query SELECT * FROM wp_users WHERE user_email='a@b.com'" ) );
lab_dump('cap', strlen( ScanSite_BB_Error_Signals::sanitize_text( str_repeat( 'x', 900 ) ) ) );`);

  note('signals', 'An email address is redacted',
    !String(san.markers.email).includes('buyer@shop.example'), String(san.markers.email));
  note('signals', 'A long digit run is redacted',
    !String(san.markers.digits).includes('4242424242424242'), String(san.markers.digits));
  note('signals', 'A quoted literal is redacted',
    !String(san.markers.quoted).includes('customer_note'), String(san.markers.quoted));
  note('signals', 'Markup is stripped and entities decoded',
    !String(san.markers.markup).includes('<strong>') && !String(san.markers.markup).includes('&amp;'), String(san.markers.markup));
  note('signals', 'An embedded SQL statement is removed',
    !/SELECT/i.test(String(san.markers.sql)) && !String(san.markers.sql).includes('a@b.com'), String(san.markers.sql));
  note('signals', 'A message is capped in length', san.markers.cap <= 300, `len=${san.markers.cap}`);

  /* --------------------------------------------------------- throttling */
  console.log('\n--- repeats are counted, not duplicated ---');

  await reset(php);
  const repeats = await phpRun(php, `
lab_login_admin();
for ( $i = 0; $i < 6; $i++ ) {
	ScanSite_BB_Error_Signals::on_mail_failed( new WP_Error( 'wp_mail_failed', 'Same failure' ) );
}
lab_dump_queue();`);
  const mailRepeats = of(repeats.markers.QUEUE ?? [], 'mail_error');
  note('signals', 'Six identical mail failures queue one event',
    mailRepeats.length === 1, `queued=${mailRepeats.length}`);

  /* ---------------------------------------------------------- delivery */
  console.log('\n--- delivery through the normal flush ---');

  const f = await flush(php);
  note('signals', 'The error leaves the queue on flush',
    of(f.markers.QUEUE ?? [], 'mail_error').length === 0, `still queued=${of(f.markers.QUEUE ?? [], 'mail_error').length}`);

  const received = await phpRun(php, `
lab_login_admin();
lab_dump('state', ScanSite_BB_Connection::state() );`);
  note('signals', 'The connection is healthy after delivering an error',
    received.markers.state === 'connected', String(received.markers.state));

  console.log('');
}
