<?php
/**
 * Plugin Name:  FrameBuilder
 * Plugin URI:   https://github.com/framebuilder
 * Description:  Framer-like visual page builder for WordPress. React-based, stores in JSON, publishes to PHP/HTML/CSS.
 * Version:      0.8.6
 * Author:       FrameBuilder
 * License:      GPL v2 or later
 * Text Domain:  framebuilder
 */

defined( 'ABSPATH' ) || exit;

define( 'FB_DIR',     plugin_dir_path( __FILE__ ) );
define( 'FB_URL',     plugin_dir_url( __FILE__ ) );
define( 'FB_VERSION', '0.8.6' );

require_once FB_DIR . 'includes/class-plugin.php';
require_once FB_DIR . 'includes/class-api.php';
require_once FB_DIR . 'includes/class-exporter.php';

FrameBuilder_Plugin::init();
FrameBuilder_API::init();
