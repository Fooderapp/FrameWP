<?php
defined( 'ABSPATH' ) || exit;

class FrameBuilder_API {

	public static function init() {
		add_action( 'rest_api_init', [ __CLASS__, 'register_routes' ] );
		add_action( 'wp_ajax_framebuilder_get_layout', [ __CLASS__, 'ajax_get_layout' ] );
		add_action( 'wp_ajax_framebuilder_save_layout', [ __CLASS__, 'ajax_save_layout' ] );
		add_action( 'wp_ajax_framebuilder_get_document_lock', [ __CLASS__, 'ajax_get_document_lock' ] );
		add_action( 'wp_ajax_framebuilder_acquire_document_lock', [ __CLASS__, 'ajax_acquire_document_lock' ] );
		add_action( 'wp_ajax_framebuilder_release_document_lock', [ __CLASS__, 'ajax_release_document_lock' ] );
		add_action( 'wp_ajax_framebuilder_get_color_styles', [ __CLASS__, 'ajax_get_color_styles' ] );
		add_action( 'wp_ajax_framebuilder_save_color_styles', [ __CLASS__, 'ajax_save_color_styles' ] );
		add_action( 'wp_ajax_framebuilder_get_text_styles', [ __CLASS__, 'ajax_get_text_styles' ] );
		add_action( 'wp_ajax_framebuilder_save_text_styles', [ __CLASS__, 'ajax_save_text_styles' ] );
		add_action( 'wp_ajax_framebuilder_get_element_styles', [ __CLASS__, 'ajax_get_element_styles' ] );
		add_action( 'wp_ajax_framebuilder_save_element_styles', [ __CLASS__, 'ajax_save_element_styles' ] );
		add_action( 'wp_ajax_framebuilder_get_components', [ __CLASS__, 'ajax_get_components' ] );
		add_action( 'wp_ajax_framebuilder_save_components', [ __CLASS__, 'ajax_save_components' ] );
		add_action( 'wp_ajax_framebuilder_get_variables', [ __CLASS__, 'ajax_get_variables' ] );
		add_action( 'wp_ajax_framebuilder_save_variables', [ __CLASS__, 'ajax_save_variables' ] );
		add_action( 'wp_ajax_framebuilder_get_variable_sources', [ __CLASS__, 'ajax_get_variable_sources' ] );
		add_action( 'wp_ajax_framebuilder_publish_layout', [ __CLASS__, 'ajax_publish_layout' ] );
		add_action( 'wp_ajax_framebuilder_import_media_asset', [ __CLASS__, 'ajax_import_media_asset' ] );
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

		register_rest_route( $ns, '/document-lock/(?P<post_id>\\d+)', [
			'methods'             => 'GET',
			'callback'            => [ __CLASS__, 'get_document_lock' ],
			'permission_callback' => [ __CLASS__, 'can_edit' ],
			'args'                => [
				'post_id' => [
					'validate_callback' => [ __CLASS__, 'validate_numeric' ],
				],
			],
		] );

		register_rest_route( $ns, '/document-lock/acquire', [
			'methods'             => 'POST',
			'callback'            => [ __CLASS__, 'acquire_document_lock' ],
			'permission_callback' => [ __CLASS__, 'can_edit' ],
		] );

		register_rest_route( $ns, '/document-lock/release', [
			'methods'             => 'POST',
			'callback'            => [ __CLASS__, 'release_document_lock' ],
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

		register_rest_route( $ns, '/text-styles', [
			'methods'             => 'GET',
			'callback'            => [ __CLASS__, 'get_text_styles' ],
			'permission_callback' => [ __CLASS__, 'can_edit' ],
		] );

		register_rest_route( $ns, '/text-styles', [
			'methods'             => 'POST',
			'callback'            => [ __CLASS__, 'save_text_styles' ],
			'permission_callback' => [ __CLASS__, 'can_edit' ],
		] );

		register_rest_route( $ns, '/element-styles', [
			'methods'             => 'GET',
			'callback'            => [ __CLASS__, 'get_element_styles' ],
			'permission_callback' => [ __CLASS__, 'can_edit' ],
		] );

		register_rest_route( $ns, '/element-styles', [
			'methods'             => 'POST',
			'callback'            => [ __CLASS__, 'save_element_styles' ],
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
		$result = self::perform_get_layout( $post_id );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return rest_ensure_response( $result );
	}

	public static function get_document_lock( WP_REST_Request $request ) {
		$post_id = absint( $request['post_id'] );
		$result = self::perform_get_document_lock( $post_id );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return rest_ensure_response( $result );
	}

	private static function perform_get_layout( int $post_id ) {
		if ( ! $post_id ) {
			return new WP_Error( 'invalid_post_id', 'A valid post ID is required.', [ 'status' => 400 ] );
		}
		$post = get_post( $post_id );
		if ( ! $post || ! current_user_can( 'edit_post', $post_id ) ) {
			return new WP_Error( 'not_found', 'Post not found.', [ 'status' => 404 ] );
		}
		$raw    = get_post_meta( $post_id, '_fb_layout', true );
		$layout = $raw ? json_decode( $raw, true ) : null;
		return [
			'success' => true,
			'layout'  => $layout,
			'post'    => [
				'id'    => $post->ID,
				'title' => get_the_title( $post ),
				'slug'  => $post->post_name,
			],
		];
	}

	private static function get_document_lock_window(): int {
		return max( 30, (int) apply_filters( 'fb_document_lock_window', 150 ) );
	}

	private static function get_document_lock_meta_key(): string {
		return '_fb_document_lock';
	}

	private static function build_document_lock_payload( int $post_id, bool $owns_lock, ?array $lock_data ): array {
		return [
			'success' => true,
			'lock'    => [
				'postId'             => $post_id,
				'state'              => $lock_data ? ( $owns_lock ? 'owned' : 'locked' ) : 'available',
				'ownedByCurrentUser' => $owns_lock,
				'lockedByOther'      => $lock_data ? ! $owns_lock : false,
				'expiresAt'          => $lock_data['expiresAt'] ?? null,
				'holder'             => $lock_data ? [
					'id'          => $lock_data['userId'],
					'displayName' => $lock_data['displayName'],
					'avatarUrl'   => $lock_data['avatarUrl'],
				] : null,
			],
		];
	}

	private static function get_active_document_lock( int $post_id ): ?array {
		$raw = get_post_meta( $post_id, self::get_document_lock_meta_key(), true );
		if ( ! is_string( $raw ) || '' === $raw ) {
			return null;
		}

		$parts = explode( ':', $raw );
		if ( count( $parts ) < 2 ) {
			delete_post_meta( $post_id, self::get_document_lock_meta_key() );
			return null;
		}

		$timestamp = absint( $parts[0] );
		$user_id   = absint( $parts[1] );
		if ( ! $timestamp || ! $user_id ) {
			delete_post_meta( $post_id, self::get_document_lock_meta_key() );
			return null;
		}

		$user = get_userdata( $user_id );
		if ( ! $user ) {
			delete_post_meta( $post_id, self::get_document_lock_meta_key() );
			return null;
		}

		$window = self::get_document_lock_window();
		if ( $timestamp <= ( time() - $window ) ) {
			delete_post_meta( $post_id, self::get_document_lock_meta_key() );
			return null;
		}

		return [
			'userId'      => $user_id,
			'timestamp'   => $timestamp,
			'expiresAt'   => $timestamp + $window,
			'displayName' => $user->display_name,
			'avatarUrl'   => get_avatar_url( $user_id, [ 'size' => 96 ] ),
		];
	}

	private static function perform_get_document_lock( int $post_id ) {
		if ( ! $post_id ) {
			return new WP_Error( 'invalid_post_id', 'A valid post ID is required.', [ 'status' => 400 ] );
		}
		$post = get_post( $post_id );
		if ( ! $post || ! current_user_can( 'edit_post', $post_id ) ) {
			return new WP_Error( 'not_found', 'Post not found.', [ 'status' => 404 ] );
		}

		$lock = self::get_active_document_lock( $post_id );
		return self::build_document_lock_payload( $post_id, $lock && (int) $lock['userId'] === get_current_user_id(), $lock );
	}

	private static function ensure_document_lock_allows_write( int $post_id ) {
		$lock = self::get_active_document_lock( $post_id );
		if ( $lock && (int) $lock['userId'] !== get_current_user_id() ) {
			return new WP_Error( 'document_locked', 'This document is currently locked by another user.', [
				'status' => 409,
				'lock'   => self::build_document_lock_payload( $post_id, false, $lock )['lock'],
			] );
		}

		return true;
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

	public static function acquire_document_lock( WP_REST_Request $request ) {
		$post_id = absint( $request->get_param( 'post_id' ) );
		$result = self::perform_acquire_document_lock( $post_id );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return rest_ensure_response( $result );
	}

	public static function release_document_lock( WP_REST_Request $request ) {
		$post_id = absint( $request->get_param( 'post_id' ) );
		$result = self::perform_release_document_lock( $post_id );
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
		$lock_check = self::ensure_document_lock_allows_write( $post_id );
		if ( is_wp_error( $lock_check ) ) {
			return $lock_check;
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
		$lock_check = self::ensure_document_lock_allows_write( $post_id );
		if ( is_wp_error( $lock_check ) ) {
			return $lock_check;
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

	private static function perform_acquire_document_lock( int $post_id ) {
		if ( ! $post_id ) {
			return new WP_Error( 'invalid_post_id', 'A valid post ID is required.', [ 'status' => 400 ] );
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return new WP_Error( 'forbidden', 'Not allowed.', [ 'status' => 403 ] );
		}

		$current_user_id = get_current_user_id();
		if ( ! $current_user_id ) {
			return new WP_Error( 'forbidden', 'Not allowed.', [ 'status' => 403 ] );
		}

		$lock = self::get_active_document_lock( $post_id );
		if ( $lock && (int) $lock['userId'] !== $current_user_id ) {
			return self::build_document_lock_payload( $post_id, false, $lock );
		}

		$now = time();
		update_post_meta( $post_id, self::get_document_lock_meta_key(), $now . ':' . $current_user_id );
		$next_lock = self::get_active_document_lock( $post_id );
		return self::build_document_lock_payload( $post_id, true, $next_lock );
	}

	private static function perform_release_document_lock( int $post_id ) {
		if ( ! $post_id ) {
			return new WP_Error( 'invalid_post_id', 'A valid post ID is required.', [ 'status' => 400 ] );
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return new WP_Error( 'forbidden', 'Not allowed.', [ 'status' => 403 ] );
		}

		$lock = self::get_active_document_lock( $post_id );
		if ( $lock && (int) $lock['userId'] === get_current_user_id() ) {
			delete_post_meta( $post_id, self::get_document_lock_meta_key() );
		}

		return self::build_document_lock_payload( $post_id, false, null );
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

	public static function ajax_get_layout() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		$result = self::perform_get_layout( absint( $_POST['post_id'] ?? 0 ) );
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( [ 'message' => $result->get_error_message() ], (int) ( $result->get_error_data()['status'] ?? 400 ) );
		}
		wp_send_json( $result );
	}

	public static function ajax_get_document_lock() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		$result = self::perform_get_document_lock( absint( $_REQUEST['post_id'] ?? 0 ) );
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

	public static function ajax_acquire_document_lock() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		$result = self::perform_acquire_document_lock( absint( $_POST['post_id'] ?? 0 ) );
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( [ 'message' => $result->get_error_message() ], (int) ( $result->get_error_data()['status'] ?? 400 ) );
		}
		wp_send_json( $result );
	}

	public static function ajax_release_document_lock() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		$result = self::perform_release_document_lock( absint( $_REQUEST['post_id'] ?? 0 ) );
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
		return rest_ensure_response( self::perform_get_color_styles() );
	}

	private static function perform_get_color_styles() {
		$raw    = get_option( '_fb_color_styles', '[]' );
		$styles = json_decode( $raw, true );
		if ( ! is_array( $styles ) ) $styles = [];
		return [ 'success' => true, 'styles' => $styles ];
	}

	public static function save_color_styles( WP_REST_Request $request ) {
		$result = self::perform_save_color_styles( $request->get_param( 'styles' ) );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return rest_ensure_response( $result );
	}

	private static function perform_save_color_styles( $styles ) {
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
		return [ 'success' => true, 'styles' => $clean ];
	}

	private static function sanitize_style_value( $value ) {
		if ( is_array( $value ) ) {
			$clean = [];
			foreach ( $value as $key => $item ) {
				$clean_key = is_string( $key ) ? sanitize_text_field( $key ) : $key;
				$clean[ $clean_key ] = self::sanitize_style_value( $item );
			}
			return $clean;
		}
		if ( is_bool( $value ) || is_numeric( $value ) || null === $value ) {
			return $value;
		}
		return sanitize_text_field( is_scalar( $value ) ? (string) $value : '' );
	}

	private static function sanitize_import_asset_stem( string $asset_name, string $fallback = 'figma-import' ): string {
		$stem = sanitize_file_name( pathinfo( $asset_name, PATHINFO_FILENAME ) );
		$stem = trim( $stem, " \t\n\r\0\x0B-_." );
		return '' !== $stem ? $stem : $fallback;
	}

	private static function build_import_filename( string $asset_name, string $extension, string $fallback = 'figma-import' ): string {
		$stem = self::sanitize_import_asset_stem( $asset_name, $fallback );
		$extension = trim( sanitize_key( ltrim( $extension, '.' ) ) );
		return '' !== $extension ? $stem . '.' . $extension : $stem;
	}

	private static function get_import_attachment_by_source_hash( string $source_hash ): int {
		if ( '' === $source_hash ) {
			return 0;
		}

		$matches = get_posts( [
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'orderby'        => 'ID',
			'order'          => 'DESC',
			'meta_key'       => '_fb_import_source_hash',
			'meta_value'     => $source_hash,
		] );

		return ! empty( $matches ) ? absint( $matches[0] ) : 0;
	}

	private static function build_import_media_result( int $attachment_id, bool $already_exists = false, string $asset_name = '' ) {
		$url = wp_get_attachment_url( $attachment_id );
		if ( ! $url ) {
			return new WP_Error( 'upload_failed', 'Could not resolve uploaded media URL.', [ 'status' => 500 ] );
		}

		return [
			'success'       => true,
			'attachmentId'  => $attachment_id,
			'url'           => esc_url_raw( $url ),
			'alreadyExists' => $already_exists,
			'assetName'     => $asset_name,
		];
	}

	private static function persist_import_attachment_meta( int $attachment_id, string $source_hash, string $asset_name ): void {
		if ( '' !== $source_hash ) {
			update_post_meta( $attachment_id, '_fb_import_source_hash', $source_hash );
		}
		if ( '' !== $asset_name ) {
			update_post_meta( $attachment_id, '_fb_import_asset_name', $asset_name );
		}
	}

	private static function decode_data_url_to_file( string $source, string $asset_name = '' ): array {
		if ( ! preg_match( '/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i', $source, $matches ) ) {
			return [ '', '', '' ];
		}

		$mime_type = sanitize_mime_type( $matches[1] ?: 'application/octet-stream' );
		$binary = base64_decode( $matches[2], true );
		if ( false === $binary ) {
			return [ '', '', '' ];
		}

		$extension_map = [
			'image/jpeg' => 'jpg',
			'image/jpg' => 'jpg',
			'image/png' => 'png',
			'image/gif' => 'gif',
			'image/webp' => 'webp',
			'image/svg+xml' => 'svg',
		];
		$extension = $extension_map[ $mime_type ] ?? 'bin';
		$filename = self::build_import_filename( $asset_name, $extension );

		return [ $filename, $binary, $mime_type ];
	}

	private static function perform_import_media_asset( $source, int $post_id = 0, string $asset_name = '' ) {
		if ( ! current_user_can( 'upload_files' ) ) {
			return new WP_Error( 'forbidden', 'Not allowed.', [ 'status' => 403 ] );
		}

		$source = is_string( $source ) ? trim( $source ) : '';
		$asset_name = is_string( $asset_name ) ? trim( sanitize_text_field( $asset_name ) ) : '';
		if ( '' === $source ) {
			return new WP_Error( 'invalid_source', 'A valid media source is required.', [ 'status' => 400 ] );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$attachment_id = 0;
		if ( 0 === strpos( $source, 'data:' ) ) {
			[ $filename, $binary, $mime_type ] = self::decode_data_url_to_file( $source, $asset_name );
			if ( '' === $filename || '' === $binary ) {
				return new WP_Error( 'invalid_source', 'Could not decode media data.', [ 'status' => 400 ] );
			}

			$source_hash = sha1( $binary );
			$existing_attachment_id = self::get_import_attachment_by_source_hash( $source_hash );
			if ( $existing_attachment_id > 0 ) {
				return self::build_import_media_result( $existing_attachment_id, true, $asset_name );
			}

			$upload = wp_upload_bits( $filename, null, $binary );
			if ( ! empty( $upload['error'] ) ) {
				return new WP_Error( 'upload_failed', $upload['error'], [ 'status' => 500 ] );
			}

			$filetype = wp_check_filetype( $upload['file'], null );
			$attachment = [
				'post_mime_type' => $filetype['type'] ?: $mime_type,
				'post_title'     => self::sanitize_import_asset_stem( $asset_name ?: $filename ),
				'post_content'   => '',
				'post_status'    => 'inherit',
			];
			$attachment_id = wp_insert_attachment( $attachment, $upload['file'], $post_id > 0 ? $post_id : 0 );
			if ( is_wp_error( $attachment_id ) || ! $attachment_id ) {
				return is_wp_error( $attachment_id )
					? $attachment_id
					: new WP_Error( 'upload_failed', 'Could not create attachment.', [ 'status' => 500 ] );
			}

			$metadata = wp_generate_attachment_metadata( $attachment_id, $upload['file'] );
			if ( is_array( $metadata ) ) {
				wp_update_attachment_metadata( $attachment_id, $metadata );
			}
			self::persist_import_attachment_meta( (int) $attachment_id, $source_hash, $asset_name );
		} else {
			$temp_file = download_url( $source );
			if ( is_wp_error( $temp_file ) ) {
				return $temp_file;
			}

			$source_hash = is_readable( $temp_file ) ? hash_file( 'sha1', $temp_file ) : '';
			$existing_attachment_id = self::get_import_attachment_by_source_hash( $source_hash );
			if ( $existing_attachment_id > 0 ) {
				@unlink( $temp_file );
				return self::build_import_media_result( $existing_attachment_id, true, $asset_name );
			}

			$path = wp_parse_url( $source, PHP_URL_PATH );
			$remote_name = $path ? basename( $path ) : '';
			$remote_ext = pathinfo( $remote_name, PATHINFO_EXTENSION );
			$filename = self::build_import_filename( $asset_name ?: $remote_name, $remote_ext ?: 'bin' );
			$file_array = [
				'name' => $filename,
				'tmp_name' => $temp_file,
			];

			$attachment_id = media_handle_sideload( $file_array, $post_id > 0 ? $post_id : 0 );
			if ( is_wp_error( $attachment_id ) ) {
				@unlink( $temp_file );
				return $attachment_id;
			}
			self::persist_import_attachment_meta( (int) $attachment_id, $source_hash, $asset_name );
		}

		return self::build_import_media_result( (int) $attachment_id, false, $asset_name );
	}

	private static function sanitize_style_library( $styles ): array {
		if ( ! is_array( $styles ) ) return [];
		$clean = [];
		foreach ( $styles as $item ) {
			if ( ! is_array( $item ) || empty( $item['id'] ) ) continue;
			$clean[] = [
				'id'        => sanitize_text_field( $item['id'] ),
				'name'      => sanitize_text_field( $item['name'] ?? 'Style' ),
				'type'      => sanitize_text_field( $item['type'] ?? '' ),
				'source'    => sanitize_text_field( $item['source'] ?? '' ),
				'sourceId'  => sanitize_text_field( $item['sourceId'] ?? '' ),
				'styleProps' => self::sanitize_style_value( $item['styleProps'] ?? [] ),
			];
		}
		return $clean;
	}

	public static function get_text_styles( WP_REST_Request $request ) {
		return rest_ensure_response( self::perform_get_text_styles() );
	}

	private static function perform_get_text_styles() {
		$raw = get_option( '_fb_text_styles', '[]' );
		$styles = json_decode( $raw, true );
		if ( ! is_array( $styles ) ) $styles = [];
		return [ 'success' => true, 'styles' => $styles ];
	}

	public static function save_text_styles( WP_REST_Request $request ) {
		$result = self::perform_save_text_styles( $request->get_param( 'styles' ) );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return rest_ensure_response( $result );
	}

	private static function perform_save_text_styles( $styles ) {
		$clean = self::sanitize_style_library( $styles );
		update_option( '_fb_text_styles', wp_json_encode( $clean ) );
		return [ 'success' => true, 'styles' => $clean ];
	}

	public static function get_element_styles( WP_REST_Request $request ) {
		return rest_ensure_response( self::perform_get_element_styles() );
	}

	private static function perform_get_element_styles() {
		$raw = get_option( '_fb_element_styles', '[]' );
		$styles = json_decode( $raw, true );
		if ( ! is_array( $styles ) ) $styles = [];
		return [ 'success' => true, 'styles' => $styles ];
	}

	public static function save_element_styles( WP_REST_Request $request ) {
		$result = self::perform_save_element_styles( $request->get_param( 'styles' ) );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return rest_ensure_response( $result );
	}

	private static function perform_save_element_styles( $styles ) {
		$clean = self::sanitize_style_library( $styles );
		update_option( '_fb_element_styles', wp_json_encode( $clean ) );
		return [ 'success' => true, 'styles' => $clean ];
	}

	public static function get_components( WP_REST_Request $request ) {
		return rest_ensure_response( self::perform_get_components() );
	}

	private static function perform_get_components() {
		$raw        = get_option( '_fb_component_library', '[]' );
		$components = json_decode( $raw, true );
		if ( ! is_array( $components ) ) $components = [];
		return [ 'success' => true, 'components' => $components ];
	}

	public static function save_components( WP_REST_Request $request ) {
		$result = self::perform_save_components( $request->get_param( 'components' ) );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return rest_ensure_response( $result );
	}

	private static function perform_save_components( $components ) {
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
		return [ 'success' => true, 'components' => $clean ];
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
		return rest_ensure_response( self::perform_get_variables() );
	}

	private static function perform_get_variables() {
		$raw = get_option( '_fb_global_variables', '[]' );
		$variables = json_decode( $raw, true );
		if ( ! is_array( $variables ) ) $variables = [];
		return [ 'success' => true, 'variables' => $variables ];
	}

	public static function save_variables( WP_REST_Request $request ) {
		$result = self::perform_save_variables( $request->get_param( 'variables' ) );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return rest_ensure_response( $result );
	}

	private static function perform_save_variables( $variables ) {
		$variables = self::sanitize_variables_list( $variables, 'global' );
		update_option( '_fb_global_variables', wp_json_encode( $variables ) );
		return [ 'success' => true, 'variables' => $variables ];
	}

	public static function get_variable_sources( WP_REST_Request $request ) {
		return rest_ensure_response( self::perform_get_variable_sources() );
	}

	private static function perform_get_variable_sources() {
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

		return [
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
		];
	}

	public static function ajax_get_color_styles() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		wp_send_json( self::perform_get_color_styles() );
	}

	public static function ajax_save_color_styles() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		$result = self::perform_save_color_styles( self::decode_ajax_layout( $_POST['styles'] ?? null ) );
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( [ 'message' => $result->get_error_message() ], (int) ( $result->get_error_data()['status'] ?? 400 ) );
		}
		wp_send_json( $result );
	}

	public static function ajax_get_components() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		wp_send_json( self::perform_get_components() );
	}

	public static function ajax_save_components() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		$result = self::perform_save_components( self::decode_ajax_layout( $_POST['components'] ?? null ) );
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( [ 'message' => $result->get_error_message() ], (int) ( $result->get_error_data()['status'] ?? 400 ) );
		}
		wp_send_json( $result );
	}

	public static function ajax_get_text_styles() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		wp_send_json( self::perform_get_text_styles() );
	}

	public static function ajax_save_text_styles() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		$result = self::perform_save_text_styles( self::decode_ajax_layout( $_POST['styles'] ?? null ) );
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( [ 'message' => $result->get_error_message() ], (int) ( $result->get_error_data()['status'] ?? 400 ) );
		}
		wp_send_json( $result );
	}

	public static function ajax_get_element_styles() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		wp_send_json( self::perform_get_element_styles() );
	}

	public static function ajax_save_element_styles() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		$result = self::perform_save_element_styles( self::decode_ajax_layout( $_POST['styles'] ?? null ) );
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( [ 'message' => $result->get_error_message() ], (int) ( $result->get_error_data()['status'] ?? 400 ) );
		}
		wp_send_json( $result );
	}

	public static function ajax_get_variables() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		wp_send_json( self::perform_get_variables() );
	}

	public static function ajax_save_variables() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		$result = self::perform_save_variables( self::decode_ajax_layout( $_POST['variables'] ?? null ) );
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( [ 'message' => $result->get_error_message() ], (int) ( $result->get_error_data()['status'] ?? 400 ) );
		}
		wp_send_json( $result );
	}

	public static function ajax_get_variable_sources() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		wp_send_json( self::perform_get_variable_sources() );
	}

	public static function ajax_import_media_asset() {
		if ( ! check_ajax_referer( 'wp_rest', '_wpnonce', false ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}
		$result = self::perform_import_media_asset(
			wp_unslash( $_POST['source'] ?? '' ),
			absint( $_POST['post_id'] ?? 0 ),
			wp_unslash( $_POST['asset_name'] ?? '' )
		);
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( [ 'message' => $result->get_error_message() ], (int) ( $result->get_error_data()['status'] ?? 400 ) );
		}
		wp_send_json( $result );
	}
}
