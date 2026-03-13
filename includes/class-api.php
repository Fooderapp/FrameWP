<?php
defined( 'ABSPATH' ) || exit;

class FrameBuilder_API {

	public static function init() {
		add_action( 'rest_api_init', [ __CLASS__, 'register_routes' ] );
		add_action( 'wp_ajax_framebuilder_save_layout', [ __CLASS__, 'ajax_save_layout' ] );
		add_action( 'wp_ajax_framebuilder_publish_layout', [ __CLASS__, 'ajax_publish_layout' ] );
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

		register_rest_route( $ns, '/variables', [
			'methods'             => 'GET',
			'callback'            => [ __CLASS__, 'get_variables' ],
			'permission_callback' => [ __CLASS__, 'can_edit' ],
		] );

		register_rest_route( $ns, '/variables', [
			'methods'             => 'POST',
			'callback'            => [ __CLASS__, 'save_variables' ],
			'permission_callback' => [ __CLASS__, 'can_edit' ],
		] );

		register_rest_route( $ns, '/variable-sources', [
			'methods'             => 'GET',
			'callback'            => [ __CLASS__, 'get_variable_sources' ],
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
		$result = self::perform_save_layout( $post_id, $layout );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return rest_ensure_response( $result );
	}

	public static function publish_layout( WP_REST_Request $request ) {
		$post_id = absint( $request->get_param( 'post_id' ) );
		$layout  = $request->get_param( 'layout' );
		$result = self::perform_publish_layout( $post_id, $layout );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return rest_ensure_response( $result );
	}

	private static function perform_save_layout( int $post_id, $layout ) {
		if ( ! $post_id ) {
			return new WP_Error( 'invalid_post_id', 'A valid post ID is required.', [ 'status' => 400 ] );
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return new WP_Error( 'forbidden', 'Not allowed.', [ 'status' => 403 ] );
		}
		update_post_meta( $post_id, '_fb_layout', wp_slash( wp_json_encode( $layout ) ) );
		return [ 'success' => true ];
	}

	private static function perform_publish_layout( int $post_id, $layout ) {
		if ( ! $post_id ) {
			return new WP_Error( 'invalid_post_id', 'A valid post ID is required.', [ 'status' => 400 ] );
		}
		if ( ! current_user_can( 'edit_post', $post_id ) || ! current_user_can( 'publish_posts' ) ) {
			return new WP_Error( 'forbidden', 'Not allowed.', [ 'status' => 403 ] );
		}
		update_post_meta( $post_id, '_fb_layout', wp_slash( wp_json_encode( $layout ) ) );
		$exporter = new FrameBuilder_Exporter( $layout );
		$html     = $exporter->generate_html();
		$css      = $exporter->generate_css();
		update_post_meta( $post_id, '_fb_published_html', wp_slash( $html ) );
		update_post_meta( $post_id, '_fb_published_css',  wp_slash( $css ) );
		wp_update_post( [ 'ID' => $post_id, 'post_status' => 'publish' ] );
		return [
			'success'   => true,
			'permalink' => get_permalink( $post_id ),
		];
	}

	public static function ajax_save_layout() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		$result = self::perform_save_layout( absint( $_POST['post_id'] ?? 0 ), self::decode_ajax_layout( $_POST['layout'] ?? null ) );
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( [ 'message' => $result->get_error_message() ], (int) ( $result->get_error_data()['status'] ?? 400 ) );
		}
		wp_send_json( $result );
	}

	public static function ajax_publish_layout() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		$result = self::perform_publish_layout( absint( $_POST['post_id'] ?? 0 ), self::decode_ajax_layout( $_POST['layout'] ?? null ) );
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( [ 'message' => $result->get_error_message() ], (int) ( $result->get_error_data()['status'] ?? 400 ) );
		}
		wp_send_json( $result );
	}

	private static function decode_ajax_layout( $layout ) {
		if ( is_array( $layout ) ) {
			return $layout;
		}
		if ( is_string( $layout ) && $layout !== '' ) {
			$decoded = json_decode( wp_unslash( $layout ), true );
			if ( is_array( $decoded ) ) {
				return $decoded;
			}
		}
		return [];
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
					$mode = sanitize_text_field( $variant['mode'] ?? 'default' );
					if ( ! in_array( $mode, [ 'default', 'hover', 'pressed' ], true ) ) $mode = 'default';
					$parent_variant_id = $mode === 'default' ? '' : sanitize_text_field( $variant['parentVariantId'] ?? '' );
					$interaction = null;
					if ( 'default' === $mode && is_array( $variant['interaction'] ?? null ) && ! empty( $variant['interaction']['targetVariantId'] ) ) {
						$bezier = is_array( $variant['interaction']['transition']['bezier'] ?? null )
							? [
								'x1' => isset( $variant['interaction']['transition']['bezier']['x1'] ) ? max( 0, min( 1, (float) $variant['interaction']['transition']['bezier']['x1'] ) ) : 0.44,
								'y1' => isset( $variant['interaction']['transition']['bezier']['y1'] ) ? max( 0, min( 1, (float) $variant['interaction']['transition']['bezier']['y1'] ) ) : 0,
								'x2' => isset( $variant['interaction']['transition']['bezier']['x2'] ) ? max( 0, min( 1, (float) $variant['interaction']['transition']['bezier']['x2'] ) ) : 0.56,
								'y2' => isset( $variant['interaction']['transition']['bezier']['y2'] ) ? max( 0, min( 1, (float) $variant['interaction']['transition']['bezier']['y2'] ) ) : 1,
							]
							: null;
						$transition = is_array( $variant['interaction']['transition'] ?? null )
							? [
								'type'       => sanitize_text_field( $variant['interaction']['transition']['type'] ?? 'instant' ),
								'duration'   => isset( $variant['interaction']['transition']['duration'] ) ? max( 0, (float) $variant['interaction']['transition']['duration'] ) : 0.3,
								'easePreset' => sanitize_text_field( $variant['interaction']['transition']['easePreset'] ?? 'easeInOut' ),
								'springMode' => sanitize_text_field( $variant['interaction']['transition']['springMode'] ?? 'time' ),
								'bounce'     => isset( $variant['interaction']['transition']['bounce'] ) ? max( 0, min( 1, (float) $variant['interaction']['transition']['bounce'] ) ) : 0.2,
								'stiffness'  => isset( $variant['interaction']['transition']['stiffness'] ) ? max( 1, (float) $variant['interaction']['transition']['stiffness'] ) : 500,
								'damping'    => isset( $variant['interaction']['transition']['damping'] ) ? max( 1, (float) $variant['interaction']['transition']['damping'] ) : 24,
								'mass'       => isset( $variant['interaction']['transition']['mass'] ) ? max( 0.1, (float) $variant['interaction']['transition']['mass'] ) : 1,
								'bezier'     => $bezier,
							]
							: null;
						$interaction = [
							'targetVariantId' => sanitize_text_field( $variant['interaction']['targetVariantId'] ),
							'trigger'         => sanitize_text_field( $variant['interaction']['trigger'] ?? 'click' ),
							'delay'           => isset( $variant['interaction']['delay'] ) ? max( 0, (float) $variant['interaction']['delay'] ) : 0,
							'transition'      => $transition,
						];
					}
					$clean_variants[] = [
						'id'          => sanitize_text_field( $variant['id'] ),
						'name'        => sanitize_text_field( $variant['name'] ?? ( 'default' === $mode ? 'Variant' : ucfirst( $mode ) ) ),
						'mode'        => $mode,
						'parentVariantId' => $parent_variant_id,
						'snapshot'    => is_array( $variant['snapshot'] ?? null ) ? $variant['snapshot'] : [],
						'interaction' => $interaction,
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

	private static function sanitize_variable_value( string $type, $value ) {
		switch ( $type ) {
			case 'boolean':
				return (bool) $value;
			case 'color':
				return sanitize_text_field( is_string( $value ) ? $value : '#000000' );
			case 'image':
				return esc_url_raw( is_scalar( $value ) ? (string) $value : '' );
			case 'number':
				return is_numeric( $value ) ? (float) $value : 0;
			case 'post':
			case 'product':
				if ( ! is_array( $value ) ) return null;
				return [
					'id'       => isset( $value['id'] ) ? absint( $value['id'] ) : 0,
					'title'    => sanitize_text_field( $value['title'] ?? '' ),
					'url'      => esc_url_raw( $value['url'] ?? '' ),
					'postType' => sanitize_key( $value['postType'] ?? ( 'product' === $type ? 'product' : 'post' ) ),
				];
			case 'string':
			default:
				return sanitize_text_field( is_scalar( $value ) ? (string) $value : '' );
		}
	}

	private static function sanitize_variables_list( $variables, string $scope = 'global' ): array {
		if ( ! is_array( $variables ) ) return [];
		$clean = [];
		foreach ( $variables as $variable ) {
			if ( ! is_array( $variable ) ) continue;
			$type = sanitize_key( $variable['type'] ?? 'string' );
			if ( ! in_array( $type, [ 'string', 'boolean', 'color', 'number', 'image', 'post', 'product' ], true ) ) $type = 'string';
			$clean[] = [
				'id'         => sanitize_text_field( $variable['id'] ?? wp_generate_uuid4() ),
				'scope'      => 'page' === $scope ? 'page' : 'global',
				'name'       => sanitize_text_field( $variable['name'] ?? 'Variable' ),
				'category'   => sanitize_text_field( $variable['category'] ?? 'General' ),
				'type'       => $type,
				'persistent' => ! empty( $variable['persistent'] ),
				'value'      => self::sanitize_variable_value( $type, $variable['value'] ?? null ),
			];
		}
		return $clean;
	}

	public static function get_variables( WP_REST_Request $request ) {
		$raw = get_option( '_fb_global_variables', '[]' );
		$variables = json_decode( $raw, true );
		if ( ! is_array( $variables ) ) $variables = [];
		return rest_ensure_response( [ 'success' => true, 'variables' => $variables ] );
	}

	public static function save_variables( WP_REST_Request $request ) {
		$variables = self::sanitize_variables_list( $request->get_param( 'variables' ), 'global' );
		update_option( '_fb_global_variables', wp_json_encode( $variables ) );
		return rest_ensure_response( [ 'success' => true, 'variables' => $variables ] );
	}

	public static function get_variable_sources( WP_REST_Request $request ) {
		$pages = get_posts( [
			'post_type'      => 'page',
			'post_status'    => [ 'publish', 'draft', 'private' ],
			'posts_per_page' => 100,
			'orderby'        => 'menu_order title',
			'order'          => 'ASC',
		] );

		$posts = get_posts( [
			'post_type'      => 'post',
			'post_status'    => [ 'publish', 'draft', 'private' ],
			'posts_per_page' => 100,
			'orderby'        => 'date',
			'order'          => 'DESC',
		] );

		$products = [];
		if ( post_type_exists( 'product' ) ) {
			$product_posts = get_posts( [
				'post_type'      => 'product',
				'post_status'    => [ 'publish', 'draft', 'private' ],
				'posts_per_page' => 100,
				'orderby'        => 'date',
				'order'          => 'DESC',
			] );
			$products = array_map( static function( $post ) {
				return [
					'id'       => $post->ID,
					'title'    => get_the_title( $post ),
					'url'      => get_permalink( $post ),
					'postType' => 'product',
				];
			}, $product_posts );
		}

		return rest_ensure_response( [
			'success'  => true,
			'pages'    => array_map( static function( $post ) {
				return [
					'id'       => $post->ID,
					'title'    => get_the_title( $post ),
					'url'      => get_permalink( $post ),
					'postType' => 'page',
				];
			}, $pages ),
			'posts'    => array_map( static function( $post ) {
				return [
					'id'       => $post->ID,
					'title'    => get_the_title( $post ),
					'url'      => get_permalink( $post ),
					'postType' => 'post',
				];
			}, $posts ),
			'products' => $products,
		] );
	}
}
