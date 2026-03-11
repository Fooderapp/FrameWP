<?php
defined( 'ABSPATH' ) || exit;

class FrameBuilder_API {

	public static function init() {
		add_action( 'rest_api_init', [ __CLASS__, 'register_routes' ] );
	}

	public static function register_routes() {
		$ns = 'framebuilder/v1';

		register_rest_route( $ns, '/get-layout/(?P<post_id>\\d+)', [
			'methods'             => 'GET',
			'callback'            => [ __CLASS__, 'get_layout' ],
			'permission_callback' => [ __CLASS__, 'can_edit' ],
			'args'                => [
				'post_id' => [
					'validate_callback' => [ __CLASS__, 'validate_numeric' ],
				],
			],
		] );

		register_rest_route( $ns, '/save-layout', [
			'methods'             => 'POST',
			'callback'            => [ __CLASS__, 'save_layout' ],
			'permission_callback' => [ __CLASS__, 'can_edit' ],
		] );

		register_rest_route( $ns, '/publish', [
			'methods'             => 'POST',
			'callback'            => [ __CLASS__, 'publish_layout' ],
			'permission_callback' => [ __CLASS__, 'can_publish' ],
		] );

		register_rest_route( $ns, '/color-styles', [
			'methods'             => 'GET',
			'callback'            => [ __CLASS__, 'get_color_styles' ],
			'permission_callback' => [ __CLASS__, 'can_edit' ],
		] );

		register_rest_route( $ns, '/color-styles', [
			'methods'             => 'POST',
			'callback'            => [ __CLASS__, 'save_color_styles' ],
			'permission_callback' => [ __CLASS__, 'can_edit' ],
		] );

		register_rest_route( $ns, '/components', [
			'methods'             => 'GET',
			'callback'            => [ __CLASS__, 'get_components' ],
			'permission_callback' => [ __CLASS__, 'can_edit' ],
		] );

		register_rest_route( $ns, '/components', [
			'methods'             => 'POST',
			'callback'            => [ __CLASS__, 'save_components' ],
			'permission_callback' => [ __CLASS__, 'can_edit' ],
		] );
	}

	/**
	 * WP REST calls validate_callback( $value, $request, $param ).
	 * is_numeric() only accepts 1 argument and Fatal-errors when used directly.
	 */
	public static function validate_numeric( $value ) {
		return is_numeric( $value );
	}

	private static function verify_nonce( WP_REST_Request $request ) {
		$nonce = isset( $_REQUEST['_wpnonce'] ) ? sanitize_text_field( $_REQUEST['_wpnonce'] ) : null;
		if ( ! $nonce ) {
			$nonce = $request->get_header( 'X-WP-Nonce' );
		}
		if ( empty( $nonce ) ) {
			return false;
		}
		return (bool) wp_verify_nonce( $nonce, 'wp_rest' );
	}

	public static function can_edit( WP_REST_Request $request ) {
		if ( ! self::verify_nonce( $request ) ) {
			return new WP_Error( 'rest_forbidden', 'Nonce verification failed.', [ 'status' => 403 ] );
		}
		return current_user_can( 'edit_posts' );
	}

	public static function can_publish( WP_REST_Request $request ) {
		if ( ! self::verify_nonce( $request ) ) {
			return new WP_Error( 'rest_forbidden', 'Nonce verification failed.', [ 'status' => 403 ] );
		}
		return current_user_can( 'publish_posts' );
	}

	public static function get_layout( WP_REST_Request $request ) {
		$post_id = absint( $request['post_id'] );
		if ( ! $post_id ) {
			return new WP_Error( 'invalid_post_id', 'A valid post ID is required.', [ 'status' => 400 ] );
		}
		$post = get_post( $post_id );
		if ( ! $post || ! current_user_can( 'edit_post', $post_id ) ) {
			return new WP_Error( 'not_found', 'Post not found.', [ 'status' => 404 ] );
		}
		$raw    = get_post_meta( $post_id, '_fb_layout', true );
		$layout = $raw ? json_decode( $raw, true ) : null;
		return rest_ensure_response( [
			'success' => true,
			'layout'  => $layout,
			'post'    => [
				'id'    => $post->ID,
				'title' => get_the_title( $post ),
				'slug'  => $post->post_name,
			],
		] );
	}

	public static function save_layout( WP_REST_Request $request ) {
		$post_id = absint( $request->get_param( 'post_id' ) );
		$layout  = $request->get_param( 'layout' );
		if ( ! $post_id ) {
			return new WP_Error( 'invalid_post_id', 'A valid post ID is required.', [ 'status' => 400 ] );
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return new WP_Error( 'forbidden', 'Not allowed.', [ 'status' => 403 ] );
		}
		update_post_meta( $post_id, '_fb_layout', wp_json_encode( $layout ) );
		return rest_ensure_response( [ 'success' => true ] );
	}

	public static function publish_layout( WP_REST_Request $request ) {
		$post_id = absint( $request->get_param( 'post_id' ) );
		$layout  = $request->get_param( 'layout' );
		if ( ! $post_id ) {
			return new WP_Error( 'invalid_post_id', 'A valid post ID is required.', [ 'status' => 400 ] );
		}
		if ( ! current_user_can( 'publish_posts', $post_id ) ) {
			return new WP_Error( 'forbidden', 'Not allowed.', [ 'status' => 403 ] );
		}
		update_post_meta( $post_id, '_fb_layout', wp_json_encode( $layout ) );
		$exporter = new FrameBuilder_Exporter( $layout );
		$html     = $exporter->generate_html();
		$css      = $exporter->generate_css();
		update_post_meta( $post_id, '_fb_published_html', $html );
		update_post_meta( $post_id, '_fb_published_css',  $css );
		wp_update_post( [ 'ID' => $post_id, 'post_status' => 'publish' ] );
		return rest_ensure_response( [
			'success'   => true,
			'permalink' => get_permalink( $post_id ),
		] );
	}

	// Site-wide colour styles stored as a WP option (not per-post).
	public static function get_color_styles( WP_REST_Request $request ) {
		$raw    = get_option( '_fb_color_styles', '[]' );
		$styles = json_decode( $raw, true );
		if ( ! is_array( $styles ) ) $styles = [];
		return rest_ensure_response( [ 'success' => true, 'styles' => $styles ] );
	}

	public static function save_color_styles( WP_REST_Request $request ) {
		$styles = $request->get_param( 'styles' );
		if ( ! is_array( $styles ) ) {
			return new WP_Error( 'invalid_styles', 'styles must be an array.', [ 'status' => 400 ] );
		}
		// Sanitize: each item must have id, name (text), value (text)
		$clean = [];
		foreach ( $styles as $item ) {
			if ( ! isset( $item['id'], $item['name'], $item['value'] ) ) continue;
			$clean[] = [
				'id'    => sanitize_text_field( $item['id'] ),
				'name'  => sanitize_text_field( $item['name'] ),
				'value' => sanitize_text_field( $item['value'] ),
			];
		}
		update_option( '_fb_color_styles', wp_json_encode( $clean ) );
		return rest_ensure_response( [ 'success' => true ] );
	}

	public static function get_components( WP_REST_Request $request ) {
		$raw        = get_option( '_fb_component_library', '[]' );
		$components = json_decode( $raw, true );
		if ( ! is_array( $components ) ) $components = [];
		return rest_ensure_response( [ 'success' => true, 'components' => $components ] );
	}

	public static function save_components( WP_REST_Request $request ) {
		$components = $request->get_param( 'components' );
		if ( ! is_array( $components ) ) {
			return new WP_Error( 'invalid_components', 'components must be an array.', [ 'status' => 400 ] );
		}

		$clean = [];
		foreach ( $components as $component ) {
			if ( ! is_array( $component ) || empty( $component['id'] ) ) continue;
			$clean_variants = [];
			if ( is_array( $component['variants'] ?? null ) ) {
				foreach ( $component['variants'] as $variant ) {
					if ( ! is_array( $variant ) || empty( $variant['id'] ) ) continue;
					$clean_variants[] = [
						'id'       => sanitize_text_field( $variant['id'] ),
						'name'     => sanitize_text_field( $variant['name'] ?? 'Variant' ),
						'snapshot' => is_array( $variant['snapshot'] ?? null ) ? $variant['snapshot'] : [],
					];
				}
			}
			$clean[] = [
				'id'             => sanitize_text_field( $component['id'] ),
				'name'           => sanitize_text_field( $component['name'] ?? 'Component' ),
				'createdAt'      => isset( $component['createdAt'] ) ? intval( $component['createdAt'] ) : 0,
				'updatedAt'      => isset( $component['updatedAt'] ) ? intval( $component['updatedAt'] ) : 0,
				'defaultVariantId' => sanitize_text_field( $component['defaultVariantId'] ?? '' ),
				'variants'       => $clean_variants,
				'snapshot'       => is_array( $component['snapshot'] ?? null )
					? $component['snapshot']
					: ( isset( $clean_variants[0]['snapshot'] ) ? $clean_variants[0]['snapshot'] : [] ),
			];
		}

		update_option( '_fb_component_library', wp_json_encode( $clean ) );
		return rest_ensure_response( [ 'success' => true ] );
	}
}
