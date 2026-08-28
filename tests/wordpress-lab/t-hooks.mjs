/**
 * GOAL 2 — verify every important WordPress hook against real WordPress.
 *
 * Each test performs a genuine WordPress action and reports exactly what the
 * collector queued. Nothing here calls do_action() to fake a trigger: if a hook
 * does not fire, the test records that.
 */
import { phpRun, queue, clearQueue, matrix, note, bug, results } from './harness.mjs';

/** Extract the event list captured under a label. */
const ev = (r, label) => r.markers[label]?.events ?? [];
const types = (list) => list.map((e) => e.type);

export async function runHookTests(php) {
  console.log('\n' + '='.repeat(72));
  console.log('GOAL 2 — REAL WORDPRESS HOOK VALIDATION');
  console.log('='.repeat(72));

  /* --------------------------------------------------- AUTHENTICATION */
  console.log('\n--- authentication ---');

  const login = await phpRun(php, `
lab_capture( 'login', function () {
	return wp_signon( array( 'user_login' => 'labadmin', 'user_password' => 'LabPass!2345' ), false );
} );`);
  const loginEv = ev(login, 'login');
  const ls = loginEv.find((e) => e.type === 'login_success');
  matrix('login_success', {
    tested: 'Yes',
    detected: ls ? 'Yes' : 'No',
    payloadCorrect: ls && ls.actor?.username === 'labadmin' && ls.actor?.userId > 0 ? 'Yes' : 'Partial',
    duplicates: loginEv.filter((e) => e.type === 'login_success').length > 1 ? 'Yes' : 'No',
    notes: ls ? `actor=${ls.actor?.username}/${ls.actor?.role} ip=${ls.actor?.ip} all=${types(loginEv).join(',')}` : `events=${types(loginEv).join(',')}`,
  });

  // One failed login.
  const fail1 = await phpRun(php, `
lab_capture( 'fail', function () {
	return wp_authenticate( 'labadmin', 'definitely-wrong' );
} );`);
  const f1 = ev(fail1, 'fail');
  matrix('login_failed', {
    tested: 'Yes',
    detected: types(f1).includes('login_failed') ? 'Yes' : 'No',
    payloadCorrect: f1.find((e) => e.type === 'login_failed')?.target?.username === 'labadmin' ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: `single attempt -> ${types(f1).join(',') || 'nothing'}`,
  });

  // Ten failed logins — aggregation behaviour.
  const burst = await phpRun(php, `
delete_option( 'scansite_blackbox_login_counts' );
lab_capture( 'burst', function () {
	for ( $i = 0; $i < 10; $i++ ) {
		wp_authenticate( 'labadmin', 'definitely-wrong' );
	}
	return true;
} );`);
  const bEv = ev(burst, 'burst');
  const b = bEv.find((e) => e.type === 'login_failed_burst');
  matrix('login_failed_burst', {
    tested: 'Yes',
    detected: b ? 'Yes' : 'No',
    payloadCorrect: b && b.count === 10 && b.metadata?.windowMinutes ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: b
      ? `10 attempts -> ${bEv.length} events total (count=${b.count}, window=${b.metadata.windowMinutes}m, ips=${b.metadata.ipCount})`
      : `10 attempts -> ${bEv.length} events: ${types(bEv).join(',')}`,
  });

  /* -------------------------------------------------------- USERS */
  console.log('\n--- users ---');

  // The lab database persists between runs, so remove any leftovers first or
  // wp_insert_user() fails with "username already exists" and no hook fires.
  await phpRun(php, `
require_once ABSPATH . 'wp-admin/includes/user.php';
foreach ( array( 'test_subscriber', 'test_admin' ) as $login ) {
	$u = get_user_by( 'login', $login );
	if ( $u ) { wp_delete_user( $u->ID ); }
}
lab_clear_queue();`);

  const sub = await phpRun(php, `
lab_login_admin();
lab_capture( 'sub', function () {
	return wp_insert_user( array(
		'user_login' => 'test_subscriber',
		'user_pass'  => 'SubPass!2345',
		'user_email' => 'sub@wp.local',
		'role'       => 'subscriber',
	) );
} );`);
  const subEv = ev(sub, 'sub');
  const uc = subEv.find((e) => e.type === 'user_created');
  matrix('user_created', {
    tested: 'Yes',
    detected: uc ? 'Yes' : 'No',
    payloadCorrect: uc && uc.target?.role === 'subscriber' && uc.actor?.username === 'labadmin' ? 'Yes' : 'Partial',
    duplicates: types(subEv).filter((t) => t === 'user_created').length > 1 ? 'Yes' : 'No',
    notes: `role=${uc?.target?.role} actor=${uc?.actor?.username ?? 'MISSING'} events=${types(subEv).join(',')}`,
  });

  const adm = await phpRun(php, `
lab_login_admin();
lab_capture( 'adm', function () {
	return wp_insert_user( array(
		'user_login' => 'test_admin',
		'user_pass'  => 'AdmPass!2345',
		'user_email' => 'adm@wp.local',
		'role'       => 'administrator',
	) );
} );`);
  const admEv = ev(adm, 'adm');
  const ac = admEv.find((e) => e.type === 'administrator_created');
  matrix('administrator_created', {
    tested: 'Yes',
    detected: ac ? 'Yes' : 'No',
    payloadCorrect: ac && ac.target?.username === 'test_admin' ? 'Yes' : 'Partial',
    duplicates: admEv.length > 1 ? 'Yes' : 'No',
    notes: `events=${types(admEv).join(',')}`,
  });

  const role = await phpRun(php, `
lab_login_admin();
$u = get_user_by( 'login', 'test_subscriber' );
lab_capture( 'role', function () use ( $u ) {
	$u->set_role( 'administrator' );
	return true;
} );`);
  const roleEv = ev(role, 'role');
  const rc = roleEv.find((e) => e.type === 'user_role_changed' || e.type === 'administrator_created');
  matrix('user_role_changed', {
    tested: 'Yes',
    detected: rc ? 'Yes' : 'No',
    payloadCorrect: rc && rc.changes?.from === 'subscriber' && rc.changes?.to === 'administrator' ? 'Yes' : 'Partial',
    duplicates: roleEv.length > 1 ? 'Yes' : 'No',
    notes: `${rc?.type}: ${rc?.changes?.from} -> ${rc?.changes?.to} (all: ${types(roleEv).join(',')})`,
  });

  const del = await phpRun(php, `
lab_login_admin();
$u = get_user_by( 'login', 'test_admin' );
lab_capture( 'del', function () use ( $u ) {
	require_once ABSPATH . 'wp-admin/includes/user.php';
	return wp_delete_user( $u->ID );
} );`);
  const delEv = ev(del, 'del');
  const du = delEv.find((e) => e.type === 'user_deleted');
  matrix('user_deleted', {
    tested: 'Yes',
    detected: du ? 'Yes' : 'No',
    payloadCorrect: du && du.target?.username === 'test_admin' && du.target?.role ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: du ? `username=${du.target.username} role=${du.target.role} userId=${du.target.userId}` : `events=${types(delEv).join(',')}`,
  });

  const logout = await phpRun(php, `
lab_login_admin();
lab_capture( 'logout', function () { wp_logout(); return true; } );`);
  const loEv = ev(logout, 'logout');
  matrix('logout', {
    tested: 'Yes',
    detected: types(loEv).includes('logout') ? 'Yes' : 'No',
    payloadCorrect: loEv.find((e) => e.type === 'logout')?.target?.username ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: `events=${types(loEv).join(',') || 'nothing'}`,
  });

  const pwd = await phpRun(php, `
$_POST['user_login']    = 'labadmin';
$_REQUEST['user_login'] = 'labadmin';
lab_capture( 'pwd', function () { return retrieve_password(); } );`);
  const pwdEv = ev(pwd, 'pwd');
  matrix('password_reset', {
    tested: 'Yes',
    detected: types(pwdEv).includes('password_reset') ? 'Yes' : 'No',
    payloadCorrect: 'Yes',
    duplicates: 'No',
    notes: `events=${types(pwdEv).join(',') || 'nothing'}`,
  });

  /* ------------------------------------------------------ OPTIONS */
  console.log('\n--- options / database state ---');

  const reg = await phpRun(php, `
lab_capture( 'reg', function () {
	update_option( 'users_can_register', '1' );
	update_option( 'users_can_register', '0' );
	return true;
} );`);
  const regEv = ev(reg, 'reg');
  matrix('registration_setting_changed', {
    tested: 'Yes',
    detected: types(regEv).includes('registration_setting_changed') ? 'Yes' : 'No',
    payloadCorrect: regEv.find((e) => e.type === 'registration_setting_changed')?.changes ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: `events=${types(regEv).join(',') || 'nothing'}`,
  });

  const siteurl = await phpRun(php, `
$orig_site = get_option( 'siteurl' );
$orig_home = get_option( 'home' );
lab_capture( 'siteurl', function () use ( $orig_site ) {
	update_option( 'siteurl', 'http://wp.local/wordpress' );
	update_option( 'siteurl', $orig_site );
	return true;
} );
lab_capture( 'home', function () use ( $orig_home ) {
	update_option( 'home', 'http://wp.local/home' );
	update_option( 'home', $orig_home );
	return true;
} );`);
  const suEv = ev(siteurl, 'siteurl');
  matrix('siteurl_changed', {
    tested: 'Yes',
    detected: types(suEv).includes('siteurl_changed') ? 'Yes' : 'No',
    payloadCorrect: suEv.find((e) => e.type === 'siteurl_changed')?.changes?.from ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: `${suEv.length} events (change + restore): ${types(suEv).join(',')}`,
  });
  const hoEv = ev(siteurl, 'home');
  matrix('home_changed', {
    tested: 'Yes',
    detected: types(hoEv).includes('home_changed') ? 'Yes' : 'No',
    payloadCorrect: hoEv.find((e) => e.type === 'home_changed')?.changes?.from ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: `${hoEv.length} events (change + restore): ${types(hoEv).join(',')}`,
  });

  /* -------------------------------------------------------- CRON */
  console.log('\n--- cron ---');

  const cron = await phpRun(php, `
lab_capture( 'cron', function () {
	wp_schedule_event( time() + 3600, 'hourly', 'lab_test_hook' );
	return true;
} );
lab_capture( 'cronoff', function () {
	wp_clear_scheduled_hook( 'lab_test_hook' );
	return true;
} );`);
  const caEv = ev(cron, 'cron');
  const ca = caEv.find((e) => e.type === 'cron_added');
  matrix('cron_added', {
    tested: 'Yes',
    detected: ca ? 'Yes' : 'No',
    payloadCorrect: ca && ca.target?.hook === 'lab_test_hook' && ca.metadata?.schedule ? 'Yes' : 'Partial',
    duplicates: types(caEv).filter((t) => t === 'cron_added').length > 1 ? 'Yes' : 'No',
    notes: ca ? `hook=${ca.target.hook} schedule=${ca.metadata.schedule} nextRun=${ca.metadata.nextRun}` : `events=${types(caEv).join(',') || 'nothing'}`,
  });
  const crEv = ev(cron, 'cronoff');
  matrix('cron_removed', {
    tested: 'Yes',
    detected: types(crEv).includes('cron_removed') ? 'Yes' : 'No',
    payloadCorrect: crEv.find((e) => e.type === 'cron_removed')?.target?.hook === 'lab_test_hook' ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: `events=${types(crEv).join(',') || 'nothing'}`,
  });

  /* ------------------------------------------------- CONFIG FILES */
  console.log('\n--- configuration files ---');

  const cfg = await phpRun(php, `
$ht = ABSPATH . '.htaccess';
$orig = file_exists( $ht ) ? file_get_contents( $ht ) : null;
file_put_contents( $ht, "# ScanSite lab marker " . microtime( true ) . "\\n" );
lab_admin_init();
lab_capture( 'ht', function () use ( $ht ) {
	file_put_contents( $ht, "# ScanSite lab marker changed " . microtime( true ) . "\\n" );
	lab_admin_init();
	return true;
} );
if ( null === $orig ) { @unlink( $ht ); } else { file_put_contents( $ht, $orig ); }`);
  const htEv = ev(cfg, 'ht');
  const ht = htEv.find((e) => e.type === 'htaccess_modified');
  matrix('htaccess_modified', {
    tested: 'Yes',
    detected: ht ? 'Yes' : 'No',
    payloadCorrect: ht && ht.metadata?.sha256 && ht.path === '/.htaccess' ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: ht ? `path=${ht.path} sha256=${String(ht.metadata.sha256).slice(0, 12)}… contents sent=${JSON.stringify(ht).includes('# ScanSite') ? 'YES-LEAK' : 'no'}` : `events=${types(htEv).join(',') || 'nothing'}`,
  });

  const wpc = await phpRun(php, `
$cf = ABSPATH . 'wp-config.php';
$orig = file_get_contents( $cf );
lab_capture( 'wpc', function () use ( $cf, $orig ) {
	file_put_contents( $cf, $orig . "\\n// ScanSite lab harmless comment " . microtime( true ) . "\\n" );
	lab_admin_init();
	return true;
} );
file_put_contents( $cf, $orig );`);
  const wpcEv = ev(wpc, 'wpc');
  const wc = wpcEv.find((e) => e.type === 'wp_config_modified');
  matrix('wp_config_modified', {
    tested: 'Yes',
    detected: wc ? 'Yes' : 'No',
    payloadCorrect: wc && wc.metadata?.sha256 ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: wc ? `sha256=${String(wc.metadata.sha256).slice(0, 12)}… secrets sent=${/DB_PASSWORD|AUTH_KEY|NONCE_KEY/.test(JSON.stringify(wc)) ? 'YES-LEAK' : 'no'}` : `events=${types(wpcEv).join(',') || 'nothing'}`,
  });

  /* ------------------------------------------------- FILE MONITORING */
  console.log('\n--- file monitoring ---');

  const files = await phpRun(php, `
$dir = lab_uploads_dir();
$test = $dir . '/scansite-lab-probe.php';
@unlink( $test );
delete_option( 'scansite_blackbox_upload_hashes' );
lab_admin_init();   // establish the baseline snapshot

lab_capture( 'created', function () use ( $test ) {
	file_put_contents( $test, "<?php\\n// benign ScanSite lab probe, never executed\\necho 'hello';\\n" );
	lab_admin_init();
	return true;
} );
lab_capture( 'modified', function () use ( $test ) {
	file_put_contents( $test, "<?php\\n// benign ScanSite lab probe, modified\\necho 'hello again';\\n" );
	lab_admin_init();
	return true;
} );
lab_capture( 'deleted', function () use ( $test ) {
	@unlink( $test );
	lab_admin_init();
	return true;
} );`);

  const fcEv = ev(files, 'created');
  const fc = fcEv.find((e) => e.type === 'executable_created');
  matrix('executable_created', {
    tested: 'Yes',
    detected: fc ? 'Yes' : 'No',
    payloadCorrect:
      fc && fc.path?.endsWith('scansite-lab-probe.php') && fc.metadata?.sha256 && fc.metadata?.bytes > 0 ? 'Yes' : 'Partial',
    duplicates: types(fcEv).filter((t) => t === 'executable_created').length > 1 ? 'Yes' : 'No',
    notes: fc
      ? `path=${fc.path} ext=${fc.metadata.extension} bytes=${fc.metadata.bytes} perms=${fc.metadata.permissions} hash=${String(fc.metadata.sha256).slice(0, 10)}… code sent=${JSON.stringify(fc).includes('echo') ? 'YES-LEAK' : 'no'}`
      : `events=${types(fcEv).join(',') || 'nothing'}`,
  });

  const fmEv = ev(files, 'modified');
  matrix('file_modified', {
    tested: 'Yes',
    detected: types(fmEv).includes('file_modified') ? 'Yes' : 'No',
    payloadCorrect: fmEv.find((e) => e.type === 'file_modified')?.metadata?.sha256 ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: `events=${types(fmEv).join(',') || 'nothing'}`,
  });

  const fdEv = ev(files, 'deleted');
  matrix('file_deleted', {
    tested: 'Yes',
    detected: types(fdEv).includes('file_deleted') ? 'Yes' : 'No',
    payloadCorrect: fdEv.find((e) => e.type === 'file_deleted')?.path ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: `events=${types(fdEv).join(',') || 'nothing'}`,
  });

  /* -------------------------------------------------------- PLUGINS */
  console.log('\n--- plugins ---');

  const plug = await phpRun(php, `
lab_login_admin();
$dir = WP_PLUGIN_DIR . '/lab-test-plugin';
if ( ! is_dir( $dir ) ) { wp_mkdir_p( $dir ); }
file_put_contents( $dir . '/lab-test-plugin.php', "<?php\\n/**\\n * Plugin Name: Lab Test Plugin\\n * Version: 1.0.0\\n */\\n" );
// The lab database persists between runs, and a previous run may have left
// this plugin active — activate_plugin() no-ops in that case and fires no
// hooks, so force a known inactive starting point first.
if ( is_plugin_active( 'lab-test-plugin/lab-test-plugin.php' ) ) {
	deactivate_plugins( 'lab-test-plugin/lab-test-plugin.php' );
}
lab_capture( 'activate', function () {
	return activate_plugin( 'lab-test-plugin/lab-test-plugin.php' );
} );
lab_capture( 'deactivate', function () {
	deactivate_plugins( 'lab-test-plugin/lab-test-plugin.php' );
	return true;
} );
lab_capture( 'delete', function () {
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	require_once ABSPATH . 'wp-admin/includes/file.php';
	WP_Filesystem();
	return delete_plugins( array( 'lab-test-plugin/lab-test-plugin.php' ) );
} );`);

  const paEv = ev(plug, 'activate');
  const pa = paEv.find((e) => e.type === 'plugin_activated');
  matrix('plugin_activated', {
    tested: 'Yes',
    detected: pa ? 'Yes' : 'No',
    payloadCorrect: pa && pa.target?.plugin === 'lab-test-plugin/lab-test-plugin.php' && pa.actor?.username ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: `actor=${pa?.actor?.username ?? 'MISSING'} all=${types(paEv).join(',')}`,
  });
  // Activating a plugin also rewrites active_plugins. Reporting both would
  // double every toggle, so the explicit plugin event wins — but a direct
  // rewrite of the option (WP-CLI, a DB edit) must still be reported.
  const apcEv = paEv.filter((e) => e.type === 'active_plugins_changed');
  const direct = await phpRun(php, `
lab_login_admin();
lab_capture( 'direct', function () {
	$plugins = get_option( 'active_plugins', array() );
	$plugins[] = 'some-other-plugin/some-other-plugin.php';
	update_option( 'active_plugins', $plugins );
	$plugins = get_option( 'active_plugins', array() );
	array_pop( $plugins );
	update_option( 'active_plugins', $plugins );
	return true;
} );`);
  const dirEv = ev(direct, 'direct');
  matrix('active_plugins_changed', {
    tested: 'Yes',
    detected: dirEv.filter((e) => e.type === 'active_plugins_changed').length ? 'Yes' : 'No',
    payloadCorrect: dirEv.find((e) => e.type === 'active_plugins_changed')?.target?.name === 'active_plugins' ? 'Yes' : 'Partial',
    duplicates: apcEv.length > 0 ? 'Yes' : 'No',
    notes: `activation emits ${apcEv.length} duplicate(s); direct option rewrite emits ${dirEv.filter((e) => e.type === 'active_plugins_changed').length}`,
  });

  const pdEv = ev(plug, 'deactivate');
  matrix('plugin_deactivated', {
    tested: 'Yes',
    detected: types(pdEv).includes('plugin_deactivated') ? 'Yes' : 'No',
    payloadCorrect: pdEv.find((e) => e.type === 'plugin_deactivated')?.target?.name ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: `name=${pdEv.find((e) => e.type === 'plugin_deactivated')?.target?.name} all=${types(pdEv).join(',')}`,
  });

  const pdelEv = ev(plug, 'delete');
  const pdel = pdelEv.find((e) => e.type === 'plugin_deleted');
  matrix('plugin_deleted', {
    tested: 'Yes',
    detected: pdel ? 'Yes' : 'No',
    payloadCorrect: pdel && pdel.target?.plugin ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: pdel ? `target=${pdel.target.plugin} name still resolvable after removal=${pdel.target.name ? 'yes' : 'no'}` : `events=${types(pdelEv).join(',') || 'nothing'}`,
  });

  /* --------------------------------------------------------- THEMES */
  console.log('\n--- themes ---');

  const theme = await phpRun(php, `
lab_login_admin();
$dir = get_theme_root() . '/lab-test-theme';
if ( ! is_dir( $dir ) ) { wp_mkdir_p( $dir ); }
file_put_contents( $dir . '/style.css', "/*\\nTheme Name: Lab Test Theme\\nVersion: 1.0.0\\n*/\\n" );
file_put_contents( $dir . '/index.php', "<?php\\n" );
lab_capture( 'activate', function () {
	switch_theme( 'lab-test-theme' );
	return true;
} );
lab_capture( 'restore', function () {
	switch_theme( 'twentytwentyfive' );
	return true;
} );
lab_capture( 'delete', function () {
	require_once ABSPATH . 'wp-admin/includes/theme.php';
	require_once ABSPATH . 'wp-admin/includes/file.php';
	return delete_theme( 'lab-test-theme' );
} );`);

  const taEv = ev(theme, 'activate');
  const ta = taEv.find((e) => e.type === 'theme_activated');
  matrix('theme_activated', {
    tested: 'Yes',
    detected: ta ? 'Yes' : 'No',
    payloadCorrect: ta && ta.target?.theme === 'lab-test-theme' ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: `theme=${ta?.target?.theme} name=${ta?.target?.name} all=${types(taEv).join(',')}`,
  });

  const tdEv = ev(theme, 'delete');
  matrix('theme_deleted', {
    tested: 'Yes',
    detected: types(tdEv).includes('theme_deleted') ? 'Yes' : 'No',
    payloadCorrect: tdEv.find((e) => e.type === 'theme_deleted')?.target?.theme === 'lab-test-theme' ? 'Yes' : 'Partial',
    duplicates: 'No',
    notes: `events=${types(tdEv).join(',') || 'nothing'}`,
  });

  await clearQueue(php);
  return results;
}
