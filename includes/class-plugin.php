<?php
defined( 'ABSPATH' ) || exit;

class FrameBuilder_Plugin {

	public static function init() {
		add_action( 'admin_menu',             [ __CLASS__, 'add_menu' ] );
		add_action( 'admin_enqueue_scripts',  [ __CLASS__, 'enqueue' ] );
		add_filter( 'script_loader_tag',      [ __CLASS__, 'filter_script_loader_tag' ], 10, 3 );
		add_action( 'admin_print_scripts',    [ __CLASS__, 'dequeue_builder_admin_scripts' ], PHP_INT_MAX );
		add_action( 'admin_print_footer_scripts', [ __CLASS__, 'dequeue_builder_admin_scripts' ], PHP_INT_MAX );
		add_action( 'admin_print_styles',     [ __CLASS__, 'dequeue_builder_admin_scripts' ], PHP_INT_MAX );
		add_action( 'admin_print_footer_styles', [ __CLASS__, 'dequeue_builder_admin_scripts' ], PHP_INT_MAX );
		add_filter( 'post_row_actions',       [ __CLASS__, 'row_action' ], 10, 2 );
		add_filter( 'page_row_actions',       [ __CLASS__, 'row_action' ], 10, 2 );
		add_action( 'wp_enqueue_scripts',     [ __CLASS__, 'enqueue_frontend' ] );
		// Dequeue WP admin-only scripts that cause JS errors on the canvas front-end page.
		add_action( 'wp_enqueue_scripts',       [ __CLASS__, 'dequeue_canvas_scripts' ], 999 );
		// Also run at print-time to catch scripts added late (e.g. admin bar footer scripts).
		add_action( 'wp_print_scripts',         [ __CLASS__, 'dequeue_canvas_scripts' ], PHP_INT_MAX );
		add_action( 'wp_print_footer_scripts',  [ __CLASS__, 'dequeue_canvas_scripts' ], PHP_INT_MAX );
		// Priority 999: run after wpautop and all other content filters so
		// they don't wrap our <style> block or absolute-positioned divs in <p> tags.
		add_filter( 'the_content',            [ __CLASS__, 'frontend_content' ], 999 );
		// Full-page canvas: bypass theme entirely on FrameBuilder pages.
		add_filter( 'template_include',       [ __CLASS__, 'canvas_template' ] );
	}

	// ── Admin menu ────────────────────────────────────────────

	// ── Admin menu ────────────────────────────────────────────

	public static function add_menu() {
		add_menu_page(
			__( 'FrameBuilder', 'framebuilder' ),
			__( 'FrameBuilder', 'framebuilder' ),
			'edit_posts',
			'framebuilder',
			[ __CLASS__, 'render_page' ],
			'dashicons-screenoptions',
			30
		);
		// Hidden submenu — no parent slug means it won't appear in any menu,
		// but WP registers it so the capability check passes when loaded in iframe.
		add_submenu_page(
			null,
			'FrameBuilder Media Picker',
			'FrameBuilder Media Picker',
			'upload_files',
			'fb-media-picker',
			[ __CLASS__, 'render_media_picker' ]
		);
	}

	public static function render_page() {
		$post_id = isset( $_GET['post_id'] ) ? absint( $_GET['post_id'] ) : 0;
		echo '<div id="framebuilder-root" data-post-id="' . esc_attr( $post_id ) . '" style="position:fixed;inset:0;z-index:99999;"></div>';
	}

	/**
	 * Render the isolated media picker page (loaded in an iframe from the builder).
	 * wp.media() runs here in its own WP admin context — no conflicts with builder scripts.
	 * On selection it posts the image URL back to the builder via postMessage.
	 */
	public static function render_media_picker() {
		?>
		<style>
		  html, body { margin: 0; padding: 0; height: 100vh; overflow: hidden; background: #f0f0f1; }
		  #wpadminbar, #adminmenuwrap, #adminmenuback, #wpbody,
		  #wpcontent, .notice, .update-nag { display: none !important; }
		  /* Backdrop is our outer modal — hide WP's own */
		  .media-modal-backdrop { display: none !important; }
		  /* Modal fills the entire iframe */
		  .media-modal {
		    position: fixed !important;
		    top: 0 !important; right: 0 !important;
		    bottom: 0 !important; left: 0 !important;
		    border-radius: 0 !important;
		    box-shadow: none !important;
		    z-index: 1 !important;
		  }
		  .media-frame { height: 100% !important; }
		</style>
		<script>
		jQuery( function() {
			var frame = wp.media( {
				title:    <?php echo wp_json_encode( __( 'Select Image', 'framebuilder' ) ); ?>,
				multiple: false,
				library:  { type: 'image' },
				button:   { text: <?php echo wp_json_encode( __( 'Insert', 'framebuilder' ) ); ?> }
			} );
			frame.on( 'select', function() {
				var att = frame.state().get( 'selection' ).first().toJSON();
				window.parent.postMessage( { fbMediaUrl: att.url }, '*' );
			} );
			frame.on( 'close escape', function() {
				window.parent.postMessage( { fbMediaClosed: true }, '*' );
			} );
			frame.open();
		} );
		</script>
		<?php
	}

	// ── Asset enqueueing ──────────────────────────────────────

	public static function enqueue( $hook ) {
		$page = isset( $_GET['page'] ) ? sanitize_key( $_GET['page'] ) : '';

		// Media picker iframe page — enqueue the full media stack here (before wp_head).
		if ( $page === 'fb-media-picker' ) {
			wp_enqueue_media( [ 'post' => 0 ] );
			return;
		}

		if ( ! self::is_builder_screen( $hook ) ) {
			return;
		}

		self::dequeue_builder_admin_scripts();

		wp_deregister_script( 'svg-painter' );
		wp_deregister_script( 'heartbeat' );
		wp_deregister_script( 'wp-auth-check' );
		wp_dequeue_script( 'svg-painter' );
		wp_dequeue_script( 'heartbeat' );
		wp_dequeue_script( 'wp-auth-check' );

		// Hide default WP admin chrome when builder is open
		echo '<style>#wpcontent,#wpbody{padding:0!important;margin:0!important;}
		      #adminmenuwrap,#adminmenuback,#wpadminbar{display:none!important;}
		      body{overflow:hidden!important;}</style>';

		$assets_dir = FB_DIR . 'assets/';
		$assets_url = FB_URL . 'assets/';

		if ( file_exists( $assets_dir . 'builder.css' ) ) {
			wp_enqueue_style( 'framebuilder', $assets_url . 'builder.css', [], FB_VERSION );
		}

		if ( file_exists( $assets_dir . 'builder.js' ) ) {
			wp_enqueue_script( 'framebuilder', $assets_url . 'builder.js', [], FB_VERSION, true );
			wp_script_add_data( 'framebuilder', 'type', 'module' );
		}

		// WordPress HMR dev mode: load Vite dev server instead
		if ( defined( 'FB_DEV' ) && FB_DEV ) {
			echo '<script type="module" src="http://localhost:3000/@vite/client"></script>';
			echo '<script type="module" src="http://localhost:3000/src/main.jsx"></script>';
		}

		wp_localize_script( 'framebuilder', 'fbData', [
			'nonce'    => wp_create_nonce( 'wp_rest' ),
			'restUrl'  => rest_url( 'framebuilder/v1/' ),
			'ajaxUrl'  => admin_url( 'admin-ajax.php' ),
			'siteUrl'  => site_url(),
			'adminUrl' => admin_url(),
			'postId'   => isset( $_GET['post_id'] ) ? absint( $_GET['post_id'] ) : 0,
		] );
	}

	public static function filter_script_loader_tag( $tag, $handle, $src ) {
		if ( $handle !== 'framebuilder' ) {
			return $tag;
		}

		return sprintf(
			'<script type="module" src="%s" id="%s-js"></script>',
			esc_url( $src ),
			esc_attr( $handle )
		);
	}

	private static function is_builder_screen( $hook = '' ): bool {
		$page = isset( $_GET['page'] ) ? sanitize_key( $_GET['page'] ) : '';
		if ( $page === 'framebuilder' ) {
			return true;
		}
		if ( $hook === 'toplevel_page_framebuilder' ) {
			return true;
		}
		if ( function_exists( 'get_current_screen' ) ) {
			$screen = get_current_screen();
			if ( $screen && $screen->id === 'toplevel_page_framebuilder' ) {
				return true;
			}
		}
		return false;
	}

	public static function dequeue_builder_admin_scripts() {
		if ( ! self::is_builder_screen() ) {
			return;
		}

		$allowed_script_handles = [
			'framebuilder',
		];
		$allowed_style_handles = [
			'framebuilder',
		];

		foreach ( [ 'svg-painter', 'heartbeat', 'wp-auth-check' ] as $handle ) {
			wp_deregister_script( $handle );
			wp_dequeue_script( $handle );
		}

		global $wp_scripts;
		if ( $wp_scripts instanceof WP_Scripts ) {
			foreach ( array_keys( $wp_scripts->registered ) as $handle ) {
				if ( in_array( $handle, $allowed_script_handles, true ) ) continue;
				wp_dequeue_script( $handle );
				wp_deregister_script( $handle );
			}
		}

		global $wp_styles;
		if ( $wp_styles instanceof WP_Styles ) {
			foreach ( array_keys( $wp_styles->registered ) as $handle ) {
				if ( in_array( $handle, $allowed_style_handles, true ) ) continue;
				wp_dequeue_style( $handle );
				wp_deregister_style( $handle );
			}
		}
	}

	// ── "Edit with FrameBuilder" row action ───────────────────

	public static function row_action( $actions, $post ) {
		if ( current_user_can( 'edit_post', $post->ID ) ) {
			$url = admin_url( 'admin.php?page=framebuilder&post_id=' . $post->ID );
			$actions['framebuilder'] = sprintf(
				'<a href="%s">%s</a>',
				esc_url( $url ),
				esc_html__( 'Edit with FrameBuilder', 'framebuilder' )
			);
		}
		return $actions;
	}

	// ── Frontend: inject published CSS + HTML ─────────────────

	public static function enqueue_frontend() {
		if ( ! is_singular() ) return;
		global $post;
		$css = get_post_meta( $post->ID, '_fb_published_css', true );
		if ( ! $css ) return;

		$assets_url = FB_URL . 'assets/';
		$assets_dir = FB_DIR . 'assets/';
		if ( file_exists( $assets_dir . 'gsap.min.js' ) ) {
			wp_enqueue_script( 'framebuilder-gsap', $assets_url . 'gsap.min.js', [], FB_VERSION, false );
		}
		if ( file_exists( $assets_dir . 'Flip.min.js' ) ) {
			wp_enqueue_script( 'framebuilder-gsap-flip', $assets_url . 'Flip.min.js', [ 'framebuilder-gsap' ], FB_VERSION, false );
		}

		// Register a dedicated handle so inline style is always output,
		// regardless of whether the theme enqueues wp-block-library.
		wp_register_style( 'framebuilder-frontend', false, [], FB_VERSION );
		wp_enqueue_style( 'framebuilder-frontend' );
		wp_add_inline_style( 'framebuilder-frontend', $css );
	}

	/**
	 * Remove WP admin-only scripts that shouldn't run on the FrameBuilder canvas page.
	 * heartbeat requires wp.hooks which is not loaded on the front end;
	 * svg-painter depends on a jQuery plugin that may not be present.
	 */
	public static function dequeue_canvas_scripts() {
		if ( ! is_singular() ) return;
		$post_id = get_the_ID();
		if ( ! $post_id || ! get_post_meta( $post_id, '_fb_published_html', true ) ) return;
		// Deregister completely so no downstream re-enqueueing can restore them.
		wp_deregister_script( 'heartbeat' );
		wp_deregister_script( 'svg-painter' );
		wp_deregister_script( 'wp-auth-check' );
		wp_dequeue_script( 'heartbeat' );
		wp_dequeue_script( 'svg-painter' );
		wp_dequeue_script( 'wp-auth-check' );

		global $wp_scripts;
		if ( $wp_scripts instanceof WP_Scripts ) {
			foreach ( array_keys( $wp_scripts->registered ) as $handle ) {
				if ( strpos( $handle, 'wc-' ) !== 0 ) continue;
				wp_dequeue_script( $handle );
				wp_deregister_script( $handle );
			}
		}
	}

	public static function frontend_content( $content ) {
		if ( ! is_singular() ) {
			return $content;
		}
		global $post;
		$built = get_post_meta( $post->ID, '_fb_published_html', true );
		if ( $built ) {
			return $built;
		}
		return $content;
	}

	/**
	 * Swap the theme template for a full-page blank canvas when the current
	 * singular page has FrameBuilder published content.
	 * Equivalent to Elementor Canvas — no header, footer, or theme constraints.
	 */
	public static function canvas_template( $template ) {
		if ( ! is_singular() ) {
			return $template;
		}
		global $post;
		$html = get_post_meta( $post->ID, '_fb_published_html', true );
		if ( ! $html ) {
			return $template;
		}
		$canvas = FB_DIR . 'templates/canvas.php';
		if ( file_exists( $canvas ) ) {
			return $canvas;
		}
		return $template;
	}
}
