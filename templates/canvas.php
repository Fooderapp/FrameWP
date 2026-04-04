<?php
/**
 * FrameBuilder Canvas Template
 *
 * Full-page blank canvas — no theme header, footer, or sidebar.
 * Loaded automatically for any page that has FrameBuilder published content.
 * Equivalent to Elementor's "Canvas" page template.
 */
defined( 'ABSPATH' ) || exit;

global $post;
$layout_raw = get_post_meta( $post->ID, '_fb_layout', true );
$html = '';
if ( is_string( $layout_raw ) && '' !== trim( $layout_raw ) ) {
	$layout = json_decode( $layout_raw, true );
	if ( ! is_array( $layout ) ) {
		$layout = json_decode( wp_unslash( $layout_raw ), true );
	}
	if ( is_array( $layout ) ) {
		$exporter = new FrameBuilder_Exporter( $layout, (int) $post->ID );
		$html = $exporter->generate_html();
	}
}
if ( ! is_string( $html ) || '' === trim( $html ) ) {
	$html = get_post_meta( $post->ID, '_fb_published_html', true );
}
$global_variables_raw = get_option( '_fb_global_variables', '[]' );
$global_variables = json_decode( $global_variables_raw, true );
if ( ! is_array( $global_variables ) ) $global_variables = [];
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<script>
	/* Stub missing WP admin globals so any admin scripts that still load don't crash. */
	window.wp = window.wp || {};
	window.wp.hooks = window.wp.hooks || {
		doAction: function() {}, addAction: function() {}, removeAction: function() {},
		applyFilters: function(h, v) { return v; }, addFilter: function() {}, removeFilter: function() {}
	};
	window.fbRuntimeData = window.fbRuntimeData || {
		postId: <?php echo (int) $post->ID; ?>,
		restUrl: <?php echo wp_json_encode( rest_url( 'framebuilder/v1/' ) ); ?>,
		globalVariables: <?php echo wp_json_encode( $global_variables ); ?>
	};
	</script>
	<?php wp_head(); ?>
	<style>
		*, *::before, *::after { box-sizing: border-box; }
		html, body {
			margin: 0;
			padding: 0;
			width: 100%;
			max-width: 100% !important;
			overflow-x: visible;
			overflow-y: visible;
		}
		@supports (overflow: clip) {
			html, body {
				overflow-x: clip;
			}
		}
		body.fb-canvas-page,
		body.fb-canvas-page > .fb-page {
			overflow: visible !important;
		}
		/* Kill every WP/theme container that could box-in the layout */
		body > *,
		.wp-site-blocks,
		.wp-block-group,
		.entry-content,
		.site,
		.site-content,
		#page,
		#content,
		#primary,
		#main,
		main {
			width: 100% !important;
			max-width: 100% !important;
			padding: 0 !important;
			margin: 0 !important;
		}
	</style>
</head>
<body <?php body_class( 'fb-canvas-page' ); ?>>
<?php
// Output the published HTML directly — it already contains its own <style> block.
echo $html; // phpcs:ignore WordPress.Security.EscapeOutput
wp_footer();
?>
</body>
</html>
