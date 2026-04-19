<?php
defined( 'ABSPATH' ) || exit;

class FrameBuilder_API {

	private static function is_submission_generated_post( WP_Post $post ): bool {
		if ( 'post' !== $post->post_type ) {
			return false;
		}
		if ( get_post_meta( $post->ID, '_fb_created_from_submission', true ) ) {
			return true;
		}
		$title = get_the_title( $post );
		if ( is_string( $title ) && 0 === strpos( $title, 'Form Submission ' ) ) {
			return true;
		}
		$slug = isset( $post->post_name ) ? (string) $post->post_name : '';
		return '' !== $slug && 0 === strpos( $slug, 'form-submission-' );
	}

	private static function build_variable_source_excerpt( WP_Post $post ): string {
		$excerpt = isset( $post->post_excerpt ) ? trim( wp_strip_all_tags( (string) $post->post_excerpt ) ) : '';
		if ( '' !== $excerpt ) {
			return $excerpt;
		}

		$content = isset( $post->post_content ) ? (string) $post->post_content : '';
		$content = strip_shortcodes( $content );
		$content = wp_strip_all_tags( $content );
		$content = preg_replace( '/\s+/', ' ', $content ) ?? $content;
		$content = trim( $content );

		return '' !== $content ? wp_trim_words( $content, 28, '…' ) : '';
	}

	private static function map_variable_source_post( WP_Post $post, string $post_type ): array {
		$image_url = get_the_post_thumbnail_url( $post, 'full' );
		$taxonomy = 'product' === $post_type ? 'product_cat' : ( 'post' === $post_type ? 'category' : '' );
		$term_ids = [];
		if ( '' !== $taxonomy && taxonomy_exists( $taxonomy ) ) {
			$terms = get_the_terms( $post, $taxonomy );
			if ( is_array( $terms ) ) {
				foreach ( $terms as $term ) {
					if ( $term instanceof WP_Term ) {
						$term_ids[] = (int) $term->term_id;
					}
				}
			}
		}
		return [
			'id' => $post->ID,
			'title' => get_the_title( $post ),
			'url' => get_permalink( $post ),
			'postType' => $post_type,
			'image' => $image_url ? esc_url_raw( $image_url ) : '',
			'excerpt' => self::build_variable_source_excerpt( $post ),
			'date' => get_the_date( '', $post ),
			'termIds' => $term_ids,
		];
	}

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
		add_action( 'wp_ajax_framebuilder_submit_form', [ __CLASS__, 'ajax_submit_form' ] );
		add_action( 'wp_ajax_nopriv_framebuilder_submit_form', [ __CLASS__, 'ajax_submit_form' ] );
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

		register_rest_route( $ns, '/forms/submit', [
			'methods'             => 'POST',
			'callback'            => [ __CLASS__, 'submit_form' ],
			'permission_callback' => '__return_true',
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

	private static function get_saved_layout_for_post( int $post_id ) {
		$raw = get_post_meta( $post_id, '_fb_layout', true );
		if ( ! is_string( $raw ) || '' === $raw ) {
			return null;
		}

		$layout = json_decode( $raw, true );
		return is_array( $layout ) ? $layout : null;
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
		$layout  = self::decode_compressed_layout( $request->get_param( 'layout_gz' ), $request->get_param( 'layout' ) );
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

	private static function perform_publish_layout( int $post_id, $layout = null ) {
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

		if ( null === $layout ) {
			$layout = self::get_saved_layout_for_post( $post_id );
		}
		if ( ! is_array( $layout ) ) {
			return new WP_Error( 'invalid_layout', 'A saved layout is required before publishing.', [ 'status' => 400 ] );
		}

		update_post_meta( $post_id, '_fb_layout', wp_slash( wp_json_encode( $layout ) ) );
		update_post_meta( $post_id, '_fb_published_layout', wp_slash( wp_json_encode( $layout ) ) );
		$exporter = new FrameBuilder_Exporter( $layout, $post_id );
		$html     = $exporter->generate_html();
		$css      = $exporter->generate_css();
		update_post_meta( $post_id, '_fb_published_html', wp_slash( $html ) );
		update_post_meta( $post_id, '_fb_published_css',  wp_slash( $css ) );

		// Phase 4: persist detail-page template marking as indexable meta
		$template_type   = isset( $layout['templateType'] ) ? sanitize_key( $layout['templateType'] ) : 'regular';
		$template_target = isset( $layout['templateTarget'] ) ? sanitize_text_field( $layout['templateTarget'] ) : '';
		update_post_meta( $post_id, '_fb_template_type', $template_type );
		update_post_meta( $post_id, '_fb_template_target', $template_target );

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
		$layout = self::decode_uploaded_compressed_layout( $_FILES['layout_gz_file'] ?? null );
		if ( ! is_array( $layout ) ) {
			$layout = self::decode_compressed_layout( $_POST['layout_gz'] ?? null, $_POST['layout'] ?? null );
		}
		$result = self::perform_save_layout( absint( $_POST['post_id'] ?? 0 ), $layout );
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
		$layout = array_key_exists( 'layout', $_POST ) ? self::decode_ajax_layout( $_POST['layout'] ?? null ) : null;
		$result = self::perform_publish_layout( absint( $_POST['post_id'] ?? 0 ), $layout );
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

	private static function decode_compressed_layout( $layout_gz, $layout_fallback ) {
		if ( is_string( $layout_gz ) && '' !== $layout_gz ) {
			$raw = base64_decode( $layout_gz, true );
			if ( false !== $raw && function_exists( 'gzdecode' ) ) {
				$json = gzdecode( $raw );
				if ( false !== $json ) {
					$decoded = json_decode( $json, true );
					if ( is_array( $decoded ) ) {
						return $decoded;
					}
				}
			}
		}
		return self::decode_ajax_layout( $layout_fallback );
	}

	private static function decode_uploaded_compressed_layout( $layout_file ) {
		if ( ! is_array( $layout_file ) ) {
			return null;
		}
		$tmp_name = isset( $layout_file['tmp_name'] ) ? (string) $layout_file['tmp_name'] : '';
		$error    = isset( $layout_file['error'] ) ? (int) $layout_file['error'] : UPLOAD_ERR_NO_FILE;
		if ( '' === $tmp_name || UPLOAD_ERR_OK !== $error || ! is_uploaded_file( $tmp_name ) ) {
			return null;
		}
		$raw = @file_get_contents( $tmp_name );
		if ( false === $raw || ! function_exists( 'gzdecode' ) ) {
			return null;
		}
		$json = gzdecode( $raw );
		if ( false === $json ) {
			return null;
		}
		$decoded = json_decode( $json, true );
		return is_array( $decoded ) ? $decoded : null;
	}

	private static function is_form_container_type( string $type ): bool {
		return 'form' === $type;
	}

	private static function is_form_field_type( string $type ): bool {
		return in_array( $type, [ 'text-field', 'textarea-field', 'rich-text-editor', 'radio-group', 'dropdown', 'checkbox', 'file-upload', 'captcha' ], true );
	}

	private static function normalize_form_field_name( array $element ): string {
		$base = is_array( $element['base'] ?? null ) ? $element['base'] : [];
		$field_name = isset( $base['fieldName'] ) && is_string( $base['fieldName'] ) ? trim( $base['fieldName'] ) : '';
		if ( '' === $field_name && isset( $element['name'] ) && is_string( $element['name'] ) ) {
			$field_name = trim( $element['name'] );
		}
		$field_name = strtolower( preg_replace( '/[^a-zA-Z0-9_-]+/', '_', $field_name ) ?? '' );
		$field_name = trim( $field_name, '_' );
		if ( '' === $field_name ) {
			$field_name = 'field_' . strtolower( sanitize_key( (string) ( $element['id'] ?? 'form_field' ) ) );
		}
		return $field_name;
	}

	private static function normalize_form_config( $value ): array {
		$config = is_array( $value ) ? $value : [];
		$actions = is_array( $config['actions'] ?? null ) ? $config['actions'] : [];
		$email = is_array( $actions['email'] ?? null ) ? $actions['email'] : [];
		$webhook = is_array( $actions['webhook'] ?? null ) ? $actions['webhook'] : [];
		$store = is_array( $actions['store'] ?? null ) ? $actions['store'] : [];
		return [
			'submitLabel' => isset( $config['submitLabel'] ) && is_string( $config['submitLabel'] ) && trim( $config['submitLabel'] ) !== ''
				? sanitize_text_field( $config['submitLabel'] )
				: 'Submit',
			'successMessage' => isset( $config['successMessage'] ) && is_string( $config['successMessage'] ) && trim( $config['successMessage'] ) !== ''
				? sanitize_text_field( $config['successMessage'] )
				: 'Thanks. Your submission was received.',
			'errorMessage' => isset( $config['errorMessage'] ) && is_string( $config['errorMessage'] ) && trim( $config['errorMessage'] ) !== ''
				? sanitize_text_field( $config['errorMessage'] )
				: 'Something went wrong. Please try again.',
			'actions' => [
				'store' => [ 'enabled' => ! isset( $store['enabled'] ) || ! empty( $store['enabled'] ) ],
				'email' => [
					'enabled' => ! empty( $email['enabled'] ),
					'to' => isset( $email['to'] ) && is_string( $email['to'] ) ? sanitize_email( $email['to'] ) : '',
					'subject' => isset( $email['subject'] ) && is_string( $email['subject'] ) && trim( $email['subject'] ) !== ''
						? sanitize_text_field( $email['subject'] )
						: 'New form submission',
				],
				'webhook' => [
					'enabled' => ! empty( $webhook['enabled'] ),
					'url' => isset( $webhook['url'] ) && is_string( $webhook['url'] ) ? esc_url_raw( trim( $webhook['url'] ) ) : '',
				],
			],
		];
	}

	private static function get_submission_status_options(): array {
		return [
			[ 'value' => 'draft', 'label' => 'Draft' ],
			[ 'value' => 'publish', 'label' => 'Publish' ],
			[ 'value' => 'pending', 'label' => 'Pending Review' ],
			[ 'value' => 'private', 'label' => 'Private' ],
		];
	}

	private static function get_form_target_field_definitions(): array {
		return [
			'post' => [
				[ 'key' => 'post_title', 'label' => 'Title' ],
				[ 'key' => 'post_name', 'label' => 'Slug' ],
				[ 'key' => 'post_content', 'label' => 'Content' ],
				[ 'key' => 'post_excerpt', 'label' => 'Excerpt' ],
				[ 'key' => 'featured_image', 'label' => 'Featured Image' ],
			],
			'category' => [
				[ 'key' => 'name', 'label' => 'Name' ],
				[ 'key' => 'slug', 'label' => 'Slug' ],
				[ 'key' => 'description', 'label' => 'Description' ],
				[ 'key' => 'parent', 'label' => 'Parent Term ID' ],
				[ 'key' => 'image', 'label' => 'Category Image' ],
			],
			'productCategory' => [
				[ 'key' => 'name', 'label' => 'Name' ],
				[ 'key' => 'slug', 'label' => 'Slug' ],
				[ 'key' => 'description', 'label' => 'Description' ],
				[ 'key' => 'parent', 'label' => 'Parent Term ID' ],
				[ 'key' => 'image', 'label' => 'Category Image' ],
			],
			'product' => [
				[ 'key' => 'post_title', 'label' => 'Title' ],
				[ 'key' => 'post_name', 'label' => 'Slug' ],
				[ 'key' => 'post_content', 'label' => 'Description' ],
				[ 'key' => 'post_excerpt', 'label' => 'Short Description' ],
				[ 'key' => 'featured_image', 'label' => 'Product Image' ],
				[ 'key' => 'gallery_images', 'label' => 'Product Gallery' ],
				[ 'key' => 'regular_price', 'label' => 'Regular Price' ],
				[ 'key' => 'sale_price', 'label' => 'Sale Price' ],
				[ 'key' => 'sku', 'label' => 'SKU' ],
				[ 'key' => 'stock_quantity', 'label' => 'Stock Quantity' ],
			],
		];
	}

	private static function flatten_acf_fields( array $fields, array &$flattened ): void {
		foreach ( $fields as $field ) {
			if ( ! is_array( $field ) ) {
				continue;
			}
			$key = isset( $field['key'] ) && is_string( $field['key'] ) ? $field['key'] : '';
			$name = isset( $field['name'] ) && is_string( $field['name'] ) ? $field['name'] : '';
			if ( '' !== $key && '' !== $name ) {
				$flattened[] = [
					'key' => sanitize_text_field( $key ),
					'name' => sanitize_key( $name ),
					'label' => isset( $field['label'] ) && is_string( $field['label'] ) ? sanitize_text_field( $field['label'] ) : sanitize_text_field( $name ),
					'type' => isset( $field['type'] ) && is_string( $field['type'] ) ? sanitize_key( $field['type'] ) : 'text',
				];
			}
			if ( ! empty( $field['sub_fields'] ) && is_array( $field['sub_fields'] ) ) {
				self::flatten_acf_fields( $field['sub_fields'], $flattened );
			}
		}
	}

	private static function get_acf_fields_for_filter( array $filter ): array {
		if ( ! function_exists( 'acf_get_field_groups' ) || ! function_exists( 'acf_get_fields' ) ) {
			return [];
		}

		$field_groups = acf_get_field_groups( $filter );
		if ( ! is_array( $field_groups ) ) {
			return [];
		}

		$flattened = [];
		foreach ( $field_groups as $group ) {
			$fields = acf_get_fields( $group );
			if ( is_array( $fields ) ) {
				self::flatten_acf_fields( $fields, $flattened );
			}
		}

		$unique = [];
		foreach ( $flattened as $field ) {
			if ( empty( $field['key'] ) ) {
				continue;
			}
			$unique[ $field['key'] ] = $field;
		}

		return array_values( $unique );
	}

	private static function get_form_action_targets(): array {
		$target_fields = self::get_form_target_field_definitions();
		$product_enabled = post_type_exists( 'product' );
		$product_category_enabled = taxonomy_exists( 'product_cat' );

		return [
			'post' => [
				'enabled' => true,
				'fields' => $target_fields['post'],
				'statuses' => self::get_submission_status_options(),
				'acfFields' => self::get_acf_fields_for_filter( [ 'post_type' => 'post' ] ),
			],
			'category' => [
				'enabled' => taxonomy_exists( 'category' ),
				'fields' => $target_fields['category'],
				'acfFields' => self::get_acf_fields_for_filter( [ 'taxonomy' => 'category' ] ),
			],
			'productCategory' => [
				'enabled' => $product_category_enabled,
				'fields' => $target_fields['productCategory'],
				'acfFields' => $product_category_enabled ? self::get_acf_fields_for_filter( [ 'taxonomy' => 'product_cat' ] ) : [],
			],
			'product' => [
				'enabled' => $product_enabled,
				'fields' => $target_fields['product'],
				'statuses' => self::get_submission_status_options(),
				'acfFields' => $product_enabled ? self::get_acf_fields_for_filter( [ 'post_type' => 'product' ] ) : [],
			],
		];
	}

	private static function normalize_submission_mapping_entries( $value, string $key_name ): array {
		if ( ! is_array( $value ) ) {
			return [];
		}

		$normalized = [];
		foreach ( $value as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}
			$key = sanitize_key( (string) ( $entry[ $key_name ] ?? '' ) );
			$field_name = sanitize_key( (string) ( $entry['fieldName'] ?? '' ) );
			if ( '' === $key || '' === $field_name ) {
				continue;
			}
			$normalized[] = [
				'id' => isset( $entry['id'] ) && is_string( $entry['id'] ) ? sanitize_text_field( $entry['id'] ) : uniqid( 'fbmap_', true ),
				$key_name => $key,
				'fieldName' => $field_name,
			];
		}

		return $normalized;
	}

	private static function normalize_submission_action_config( $value, array $legacy_actions = [] ): array {
		$actions = is_array( $value ) ? $value : [];
		$legacy = is_array( $legacy_actions ) ? $legacy_actions : [];
		$has_store_enabled = isset( $actions['store'] ) && is_array( $actions['store'] ) && array_key_exists( 'enabled', $actions['store'] );

		return [
			'store' => [
				'enabled' => $has_store_enabled ? ! empty( $actions['store']['enabled'] ) : ! empty( $legacy['store']['enabled'] ),
			],
			'email' => [
				'enabled' => isset( $actions['email']['enabled'] ) ? ! empty( $actions['email']['enabled'] ) : ! empty( $legacy['email']['enabled'] ),
				'to' => isset( $actions['email']['to'] ) && is_string( $actions['email']['to'] ) ? sanitize_email( $actions['email']['to'] ) : sanitize_email( (string) ( $legacy['email']['to'] ?? '' ) ),
				'subject' => isset( $actions['email']['subject'] ) && is_string( $actions['email']['subject'] ) && trim( $actions['email']['subject'] ) !== ''
					? sanitize_text_field( $actions['email']['subject'] )
					: sanitize_text_field( (string) ( $legacy['email']['subject'] ?? 'New form submission' ) ),
			],
			'webhook' => [
				'enabled' => isset( $actions['webhook']['enabled'] ) ? ! empty( $actions['webhook']['enabled'] ) : ! empty( $legacy['webhook']['enabled'] ),
				'url' => isset( $actions['webhook']['url'] ) && is_string( $actions['webhook']['url'] ) ? esc_url_raw( trim( $actions['webhook']['url'] ) ) : esc_url_raw( (string) ( $legacy['webhook']['url'] ?? '' ) ),
			],
			'createPost' => [
				'enabled' => ! empty( $actions['createPost']['enabled'] ),
				'status' => isset( $actions['createPost']['status'] ) && is_string( $actions['createPost']['status'] ) ? sanitize_key( $actions['createPost']['status'] ) : 'draft',
				'fieldMappings' => self::normalize_submission_mapping_entries( $actions['createPost']['fieldMappings'] ?? [], 'targetKey' ),
				'acfMappings' => self::normalize_submission_mapping_entries( $actions['createPost']['acfMappings'] ?? [], 'fieldKey' ),
			],
			'createCategory' => [
				'enabled' => ! empty( $actions['createCategory']['enabled'] ),
				'fieldMappings' => self::normalize_submission_mapping_entries( $actions['createCategory']['fieldMappings'] ?? [], 'targetKey' ),
				'acfMappings' => self::normalize_submission_mapping_entries( $actions['createCategory']['acfMappings'] ?? [], 'fieldKey' ),
			],
			'createProductCategory' => [
				'enabled' => ! empty( $actions['createProductCategory']['enabled'] ),
				'fieldMappings' => self::normalize_submission_mapping_entries( $actions['createProductCategory']['fieldMappings'] ?? [], 'targetKey' ),
				'acfMappings' => self::normalize_submission_mapping_entries( $actions['createProductCategory']['acfMappings'] ?? [], 'fieldKey' ),
			],
			'createProduct' => [
				'enabled' => ! empty( $actions['createProduct']['enabled'] ),
				'status' => isset( $actions['createProduct']['status'] ) && is_string( $actions['createProduct']['status'] ) ? sanitize_key( $actions['createProduct']['status'] ) : 'draft',
				'fieldMappings' => self::normalize_submission_mapping_entries( $actions['createProduct']['fieldMappings'] ?? [], 'targetKey' ),
				'acfMappings' => self::normalize_submission_mapping_entries( $actions['createProduct']['acfMappings'] ?? [], 'fieldKey' ),
			],
		];
	}

	private static function get_form_submission_node( array $layout, string $form_id ): ?array {
		$flows = is_array( $layout['flows'] ?? null ) ? $layout['flows'] : [];
		$related_ids = self::get_form_related_element_ids( $layout, $form_id );
		foreach ( self::get_matching_form_submission_flows( $flows, $form_id, $related_ids ) as $flow ) {
			if ( ! is_array( $flow ) ) {
				continue;
			}
			$nodes = is_array( $flow['nodes'] ?? null ) ? $flow['nodes'] : [];
			foreach ( $nodes as $node ) {
				if ( is_array( $node ) && 'submission-form' === (string) ( $node['type'] ?? '' ) ) {
					return $node;
				}
			}
		}

		return null;
	}

	private static function get_submission_value_by_field_name( array $submission_values, string $field_name ) {
		return array_key_exists( $field_name, $submission_values ) ? $submission_values[ $field_name ] : null;
	}

	private static function scalarize_submission_value( $value ): string {
		if ( is_array( $value ) ) {
			if ( isset( $value['url'] ) && is_string( $value['url'] ) ) {
				return $value['url'];
			}
			return wp_json_encode( $value ) ?: '';
		}
		if ( is_bool( $value ) ) {
			return $value ? '1' : '0';
		}
		if ( null === $value ) {
			return '';
		}
		return (string) $value;
	}

	private static function resolve_attachment_id_from_submission_value( $value ): int {
		if ( is_array( $value ) ) {
			if ( isset( $value['attachmentId'] ) ) {
				$attachment_id = absint( $value['attachmentId'] );
				if ( $attachment_id > 0 ) {
					return $attachment_id;
				}
			}
			if ( isset( $value['url'] ) && is_string( $value['url'] ) && function_exists( 'attachment_url_to_postid' ) ) {
				$attachment_id = absint( attachment_url_to_postid( $value['url'] ) );
				if ( $attachment_id > 0 ) {
					return $attachment_id;
				}
			}
			foreach ( $value as $entry ) {
				$attachment_id = self::resolve_attachment_id_from_submission_value( $entry );
				if ( $attachment_id > 0 ) {
					return $attachment_id;
				}
			}
			return 0;
		}

		if ( is_numeric( $value ) ) {
			return absint( $value );
		}

		if ( is_string( $value ) ) {
			$trimmed = trim( $value );
			if ( '' === $trimmed ) {
				return 0;
			}
			if ( is_numeric( $trimmed ) ) {
				return absint( $trimmed );
			}
			if ( function_exists( 'attachment_url_to_postid' ) ) {
				return absint( attachment_url_to_postid( $trimmed ) );
			}
		}

		return 0;
	}

	private static function resolve_attachment_ids_from_submission_value( $value ): array {
		if ( ! is_array( $value ) ) {
			$attachment_id = self::resolve_attachment_id_from_submission_value( $value );
			return $attachment_id > 0 ? [ $attachment_id ] : [];
		}

		if ( isset( $value['attachmentId'] ) || isset( $value['url'] ) ) {
			$attachment_id = self::resolve_attachment_id_from_submission_value( $value );
			return $attachment_id > 0 ? [ $attachment_id ] : [];
		}

		$attachment_ids = [];
		foreach ( $value as $entry ) {
			$attachment_ids = array_merge( $attachment_ids, self::resolve_attachment_ids_from_submission_value( $entry ) );
		}

		$attachment_ids = array_values( array_filter( array_map( 'absint', array_unique( $attachment_ids ) ) ) );
		return $attachment_ids;
	}

	private static function maybe_apply_post_featured_image( int $post_id, $value ): int {
		if ( $post_id <= 0 || ! function_exists( 'set_post_thumbnail' ) ) {
			return 0;
		}
		$attachment_id = self::resolve_attachment_id_from_submission_value( $value );
		if ( $attachment_id <= 0 ) {
			return 0;
		}
		set_post_thumbnail( $post_id, $attachment_id );
		return $attachment_id;
	}

	private static function maybe_apply_term_image( int $term_id, $value ): int {
		if ( $term_id <= 0 ) {
			return 0;
		}
		$attachment_id = self::resolve_attachment_id_from_submission_value( $value );
		if ( $attachment_id <= 0 ) {
			return 0;
		}
		update_term_meta( $term_id, 'thumbnail_id', $attachment_id );
		return $attachment_id;
	}

	private static function maybe_apply_product_gallery_images( int $product_id, $value, int $featured_image_id = 0 ): array {
		if ( $product_id <= 0 ) {
			return [];
		}
		$attachment_ids = self::resolve_attachment_ids_from_submission_value( $value );
		if ( $featured_image_id > 0 ) {
			$attachment_ids = array_values( array_filter( $attachment_ids, static fn( $attachment_id ) => $attachment_id !== $featured_image_id ) );
		}
		update_post_meta( $product_id, '_product_image_gallery', implode( ',', $attachment_ids ) );
		return $attachment_ids;
	}

	private static function normalize_product_price_value( $value ): string {
		$scalar = self::scalarize_submission_value( $value );
		if ( '' === $scalar ) {
			return '';
		}
		if ( function_exists( 'wc_format_decimal' ) ) {
			return (string) wc_format_decimal( $scalar );
		}
		$normalized = preg_replace( '/[^0-9,.-]/', '', $scalar );
		if ( ! is_string( $normalized ) || '' === $normalized ) {
			return '';
		}
		$normalized = str_replace( ',', '.', $normalized );
		return $normalized;
	}

	private static function map_submission_pairs( array $mappings, array $submission_values ): array {
		$mapped = [];
		foreach ( $mappings as $mapping ) {
			if ( ! is_array( $mapping ) ) {
				continue;
			}
			$key = sanitize_key( (string) ( $mapping['targetKey'] ?? $mapping['fieldKey'] ?? '' ) );
			$field_name = sanitize_key( (string) ( $mapping['fieldName'] ?? '' ) );
			if ( '' === $key || '' === $field_name ) {
				continue;
			}
			$mapped[ $key ] = self::get_submission_value_by_field_name( $submission_values, $field_name );
		}
		return $mapped;
	}

	private static function apply_post_acf_mappings( int $post_id, array $mappings, array $submission_values ): void {
		if ( $post_id <= 0 || ! function_exists( 'update_field' ) ) {
			return;
		}
		foreach ( $mappings as $mapping ) {
			$field_key = sanitize_text_field( (string) ( $mapping['fieldKey'] ?? '' ) );
			$field_name = sanitize_key( (string) ( $mapping['fieldName'] ?? '' ) );
			if ( '' === $field_key || '' === $field_name ) {
				continue;
			}
			update_field( $field_key, self::get_submission_value_by_field_name( $submission_values, $field_name ), $post_id );
		}
	}

	private static function apply_term_acf_mappings( string $taxonomy, int $term_id, array $mappings, array $submission_values ): void {
		if ( '' === $taxonomy || $term_id <= 0 || ! function_exists( 'update_field' ) ) {
			return;
		}
		$object_id = $taxonomy . '_' . $term_id;
		foreach ( $mappings as $mapping ) {
			$field_key = sanitize_text_field( (string) ( $mapping['fieldKey'] ?? '' ) );
			$field_name = sanitize_key( (string) ( $mapping['fieldName'] ?? '' ) );
			if ( '' === $field_key || '' === $field_name ) {
				continue;
			}
			update_field( $field_key, self::get_submission_value_by_field_name( $submission_values, $field_name ), $object_id );
		}
	}

	private static function create_post_from_submission( array $action_config, array $submission_payload ) {
		$mapped = self::map_submission_pairs( $action_config['fieldMappings'] ?? [], $submission_payload['values'] ?? [] );
		$postarr = [
			'post_type' => 'post',
			'post_status' => sanitize_key( (string) ( $action_config['status'] ?? 'draft' ) ) ?: 'draft',
			'post_title' => sanitize_text_field( self::scalarize_submission_value( $mapped['post_title'] ?? ( 'Form Submission ' . ( $submission_payload['id'] ?? '' ) ) ) ),
		];
		if ( array_key_exists( 'post_name', $mapped ) ) {
			$postarr['post_name'] = sanitize_title( self::scalarize_submission_value( $mapped['post_name'] ) );
		}
		if ( array_key_exists( 'post_content', $mapped ) ) {
			$postarr['post_content'] = wp_kses_post( self::scalarize_submission_value( $mapped['post_content'] ) );
		}
		if ( array_key_exists( 'post_excerpt', $mapped ) ) {
			$postarr['post_excerpt'] = sanitize_textarea_field( self::scalarize_submission_value( $mapped['post_excerpt'] ) );
		}

		$post_id = wp_insert_post( wp_slash( $postarr ), true );
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		$featured_image_id = array_key_exists( 'featured_image', $mapped )
			? self::maybe_apply_post_featured_image( (int) $post_id, $mapped['featured_image'] )
			: 0;

		self::apply_post_acf_mappings( (int) $post_id, $action_config['acfMappings'] ?? [], $submission_payload['values'] ?? [] );
		update_post_meta( (int) $post_id, '_fb_created_from_submission', [
			'submissionId' => (string) ( $submission_payload['id'] ?? '' ),
			'createdAt' => current_time( 'mysql', true ),
		] );
		return [
			'id' => (int) $post_id,
			'title' => get_the_title( $post_id ),
			'url' => get_permalink( $post_id ),
			'status' => get_post_status( $post_id ),
			'featuredImageId' => $featured_image_id,
		];
	}

	private static function create_term_from_submission( string $taxonomy, array $action_config, array $submission_payload ) {
		if ( ! taxonomy_exists( $taxonomy ) ) {
			return new WP_Error( 'missing_taxonomy', 'Target taxonomy is not available.' );
		}

		$mapped = self::map_submission_pairs( $action_config['fieldMappings'] ?? [], $submission_payload['values'] ?? [] );
		$name = sanitize_text_field( self::scalarize_submission_value( $mapped['name'] ?? '' ) );
		if ( '' === $name ) {
			return new WP_Error( 'missing_term_name', 'A term name mapping is required.' );
		}

		$args = [];
		if ( array_key_exists( 'slug', $mapped ) ) {
			$args['slug'] = sanitize_title( self::scalarize_submission_value( $mapped['slug'] ) );
		}
		if ( array_key_exists( 'description', $mapped ) ) {
			$args['description'] = sanitize_textarea_field( self::scalarize_submission_value( $mapped['description'] ) );
		}
		if ( array_key_exists( 'parent', $mapped ) ) {
			$args['parent'] = absint( self::scalarize_submission_value( $mapped['parent'] ) );
		}

		$result = wp_insert_term( $name, $taxonomy, $args );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$term_id = absint( $result['term_id'] ?? 0 );
		$image_id = array_key_exists( 'image', $mapped )
			? self::maybe_apply_term_image( $term_id, $mapped['image'] )
			: 0;
		self::apply_term_acf_mappings( $taxonomy, $term_id, $action_config['acfMappings'] ?? [], $submission_payload['values'] ?? [] );
		$link = get_term_link( $term_id, $taxonomy );
		return [
			'id' => $term_id,
			'name' => $name,
			'url' => is_wp_error( $link ) ? '' : $link,
			'taxonomy' => $taxonomy,
			'imageId' => $image_id,
		];
	}

	private static function create_product_from_submission( array $action_config, array $submission_payload ) {
		if ( ! post_type_exists( 'product' ) ) {
			return new WP_Error( 'missing_product_type', 'WooCommerce products are not available.' );
		}

		$mapped = self::map_submission_pairs( $action_config['fieldMappings'] ?? [], $submission_payload['values'] ?? [] );
		$postarr = [
			'post_type' => 'product',
			'post_status' => sanitize_key( (string) ( $action_config['status'] ?? 'draft' ) ) ?: 'draft',
			'post_title' => sanitize_text_field( self::scalarize_submission_value( $mapped['post_title'] ?? ( 'Product ' . ( $submission_payload['id'] ?? '' ) ) ) ),
		];
		if ( array_key_exists( 'post_name', $mapped ) ) {
			$postarr['post_name'] = sanitize_title( self::scalarize_submission_value( $mapped['post_name'] ) );
		}
		if ( array_key_exists( 'post_content', $mapped ) ) {
			$postarr['post_content'] = wp_kses_post( self::scalarize_submission_value( $mapped['post_content'] ) );
		}
		if ( array_key_exists( 'post_excerpt', $mapped ) ) {
			$postarr['post_excerpt'] = sanitize_textarea_field( self::scalarize_submission_value( $mapped['post_excerpt'] ) );
		}

		$product_id = wp_insert_post( wp_slash( $postarr ), true );
		if ( is_wp_error( $product_id ) ) {
			return $product_id;
		}

		$regular_price = array_key_exists( 'regular_price', $mapped ) ? self::scalarize_submission_value( $mapped['regular_price'] ) : '';
		$sale_price = array_key_exists( 'sale_price', $mapped ) ? self::scalarize_submission_value( $mapped['sale_price'] ) : '';
		$sku = array_key_exists( 'sku', $mapped ) ? sanitize_text_field( self::scalarize_submission_value( $mapped['sku'] ) ) : '';
		$stock_quantity = array_key_exists( 'stock_quantity', $mapped ) ? self::scalarize_submission_value( $mapped['stock_quantity'] ) : '';

		if ( '' !== $regular_price ) {
			update_post_meta( $product_id, '_regular_price', self::normalize_product_price_value( $regular_price ) );
		}
		if ( '' !== $sale_price ) {
			update_post_meta( $product_id, '_sale_price', self::normalize_product_price_value( $sale_price ) );
		}
		if ( '' !== $regular_price || '' !== $sale_price ) {
			$price = '' !== $sale_price ? $sale_price : $regular_price;
			update_post_meta( $product_id, '_price', self::normalize_product_price_value( $price ) );
		}
		if ( '' !== $sku ) {
			update_post_meta( $product_id, '_sku', $sku );
		}
		if ( '' !== $stock_quantity ) {
			$stock_value = intval( $stock_quantity );
			update_post_meta( $product_id, '_manage_stock', 'yes' );
			update_post_meta( $product_id, '_stock', $stock_value );
			update_post_meta( $product_id, '_stock_status', $stock_value > 0 ? 'instock' : 'outofstock' );
		}

		$featured_image_id = array_key_exists( 'featured_image', $mapped )
			? self::maybe_apply_post_featured_image( (int) $product_id, $mapped['featured_image'] )
			: 0;
		$gallery_image_ids = array_key_exists( 'gallery_images', $mapped )
			? self::maybe_apply_product_gallery_images( (int) $product_id, $mapped['gallery_images'], $featured_image_id )
			: [];

		self::apply_post_acf_mappings( (int) $product_id, $action_config['acfMappings'] ?? [], $submission_payload['values'] ?? [] );
		return [
			'id' => (int) $product_id,
			'title' => get_the_title( $product_id ),
			'url' => get_permalink( $product_id ),
			'status' => get_post_status( $product_id ),
			'featuredImageId' => $featured_image_id,
			'galleryImageIds' => $gallery_image_ids,
		];
	}

	private static function get_form_submission_meta_prefix(): string {
		return '_fb_form_submission_';
	}

	private static function decode_layout_meta_value( $layout_raw ): ?array {
		if ( ! is_string( $layout_raw ) || '' === trim( $layout_raw ) ) {
			return null;
		}

		$layout = json_decode( $layout_raw, true );
		if ( is_array( $layout ) ) {
			return $layout;
		}

		$layout = json_decode( wp_unslash( $layout_raw ), true );
		return is_array( $layout ) ? $layout : null;
	}

	private static function get_submission_layout( int $post_id ): ?array {
		$layout_keys = [ '_fb_layout', '_fb_published_layout' ];
		foreach ( $layout_keys as $meta_key ) {
			$layout_raw = get_post_meta( $post_id, $meta_key, true );
			$layout = self::decode_layout_meta_value( $layout_raw );
			if ( is_array( $layout ) ) {
				return $layout;
			}
		}
		return null;
	}

	private static function get_form_related_element_ids( array $layout, string $form_id ): array {
		$elements = is_array( $layout['elements'] ?? null ) ? $layout['elements'] : [];
		$child_ids_by_parent = [];
		$form_exists = false;

		foreach ( $elements as $element ) {
			if ( ! is_array( $element ) || empty( $element['id'] ) ) {
				continue;
			}

			$element_id = (string) $element['id'];
			if ( $element_id === $form_id && self::is_form_container_type( (string) ( $element['type'] ?? '' ) ) ) {
				$form_exists = true;
			}

			$parent_id = (string) ( $element['parentId'] ?? '' );
			if ( '' === $parent_id ) {
				continue;
			}

			if ( ! isset( $child_ids_by_parent[ $parent_id ] ) ) {
				$child_ids_by_parent[ $parent_id ] = [];
			}

			$child_ids_by_parent[ $parent_id ][] = $element_id;
		}

		if ( ! $form_exists ) {
			return [ $form_id ];
		}

		$related_ids = [ $form_id ];
		$queue = [ $form_id ];

		while ( ! empty( $queue ) ) {
			$current_id = array_shift( $queue );
			foreach ( $child_ids_by_parent[ $current_id ] ?? [] as $child_id ) {
				if ( in_array( $child_id, $related_ids, true ) ) {
					continue;
				}

				$related_ids[] = $child_id;
				$queue[] = $child_id;
			}
		}

		return $related_ids;
	}

	private static function get_form_submission_trigger_priority( array $trigger, string $form_id, array $related_ids ): int {
		$trigger_type = (string) ( $trigger['type'] ?? '' );
		if ( 'form-submit' === $trigger_type && $form_id === (string) ( $trigger['formId'] ?? '' ) ) {
			return 2;
		}

		if ( 'element-click' === $trigger_type ) {
			$trigger_element_id = (string) ( $trigger['elementId'] ?? '' );
			if ( '' !== $trigger_element_id && in_array( $trigger_element_id, $related_ids, true ) ) {
				return 1;
			}
		}

		return 0;
	}

	private static function get_matching_form_submission_flows( array $flows, string $form_id, array $related_ids ): array {
		$exact_matches = [];
		$legacy_matches = [];

		foreach ( $flows as $flow ) {
			if ( ! is_array( $flow ) ) {
				continue;
			}

			$trigger = is_array( $flow['trigger'] ?? null ) ? $flow['trigger'] : [];
			$priority = self::get_form_submission_trigger_priority( $trigger, $form_id, $related_ids );
			if ( 2 === $priority ) {
				$exact_matches[] = $flow;
			} elseif ( 1 === $priority ) {
				$legacy_matches[] = $flow;
			}
		}

		return array_merge( $exact_matches, $legacy_matches );
	}

	private static function flow_matches_form_submission_trigger( array $trigger, string $form_id, array $related_ids ): bool {
		return self::get_form_submission_trigger_priority( $trigger, $form_id, $related_ids ) > 0;
	}

	private static function find_form_elements( array $layout, string $form_id ): array {
		$elements = is_array( $layout['elements'] ?? null ) ? $layout['elements'] : [];
		$form = null;
		$element_map = [];
		foreach ( $elements as $element ) {
			if ( ! is_array( $element ) || empty( $element['id'] ) ) continue;
			$element_map[ (string) $element['id'] ] = $element;
			if ( (string) $element['id'] === $form_id && self::is_form_container_type( (string) ( $element['type'] ?? '' ) ) ) {
				$form = $element;
			}
		}
		if ( ! $form ) {
			return [ null, [] ];
		}
		$field_ids = is_array( $form['children'] ?? null ) ? $form['children'] : [];
		$fields = [];
		foreach ( $field_ids as $field_id ) {
			$field = $element_map[ (string) $field_id ] ?? null;
			if ( $field && self::is_form_field_type( (string) ( $field['type'] ?? '' ) ) ) {
				$fields[] = $field;
			}
		}
		if ( empty( $fields ) ) {
			foreach ( $elements as $element ) {
				if ( ! is_array( $element ) ) continue;
				if ( (string) ( $element['parentId'] ?? '' ) !== $form_id ) continue;
				if ( ! self::is_form_field_type( (string) ( $element['type'] ?? '' ) ) ) continue;
				$fields[] = $element;
			}
		}
		return [ $form, $fields ];
	}

	private static function get_ordered_submission_fields( array $layout, string $form_id, array $fields ): array {
		$flows = is_array( $layout['flows'] ?? null ) ? $layout['flows'] : [];
		$related_ids = self::get_form_related_element_ids( $layout, $form_id );
		$field_map = [];
		foreach ( $fields as $field ) {
			if ( ! is_array( $field ) ) continue;
			$field_map[ self::normalize_form_field_name( $field ) ] = $field;
		}

		$field_order = [];
		foreach ( self::get_matching_form_submission_flows( $flows, $form_id, $related_ids ) as $flow ) {
			if ( ! is_array( $flow ) ) continue;
			$nodes = is_array( $flow['nodes'] ?? null ) ? $flow['nodes'] : [];
			foreach ( $nodes as $node ) {
				if ( ! is_array( $node ) || 'submission-form' !== (string) ( $node['type'] ?? '' ) ) continue;
				$config_fields = is_array( $node['config']['fields'] ?? null ) ? $node['config']['fields'] : [];
				foreach ( $config_fields as $entry ) {
					$field_name = '';
					if ( is_string( $entry ) ) {
						$field_name = $entry;
					} elseif ( is_array( $entry ) ) {
						$field_name = is_string( $entry['fieldName'] ?? null ) ? $entry['fieldName'] : ( is_string( $entry['name'] ?? null ) ? $entry['name'] : '' );
					}
					$field_name = strtolower( preg_replace( '/[^a-zA-Z0-9_-]+/', '_', (string) $field_name ) ?? '' );
					$field_name = trim( $field_name, '_' );
					if ( '' !== $field_name && ! in_array( $field_name, $field_order, true ) ) {
						$field_order[] = $field_name;
					}
				}
				break 2;
			}
		}

		if ( empty( $field_order ) ) {
			return $fields;
		}

		$ordered_fields = [];
		foreach ( $field_order as $field_name ) {
			if ( isset( $field_map[ $field_name ] ) ) {
				$ordered_fields[] = $field_map[ $field_name ];
			}
		}

		return ! empty( $ordered_fields ) ? $ordered_fields : $fields;
	}

	private static function decode_form_submission_record( array $row ): ?array {
		$payload = json_decode( wp_unslash( (string) ( $row['meta_value'] ?? '' ) ), true );
		if ( ! is_array( $payload ) ) {
			return null;
		}

		$prefix = self::get_form_submission_meta_prefix();
		$meta_key = (string) ( $row['meta_key'] ?? '' );
		$form_id = isset( $payload['formId'] ) && is_string( $payload['formId'] ) && '' !== $payload['formId']
			? $payload['formId']
			: ( 0 === strpos( $meta_key, $prefix ) ? substr( $meta_key, strlen( $prefix ) ) : '' );

		return [
			'metaId' => absint( $row['meta_id'] ?? 0 ),
			'postId' => absint( $row['post_id'] ?? 0 ),
			'postTitle' => sanitize_text_field( (string) ( $row['post_title'] ?? '' ) ),
			'postType' => sanitize_key( (string) ( $row['post_type'] ?? '' ) ),
			'postStatus' => sanitize_key( (string) ( $row['post_status'] ?? '' ) ),
			'formId' => sanitize_text_field( $form_id ),
			'submittedAt' => sanitize_text_field( (string) ( $payload['submittedAt'] ?? '' ) ),
			'submission' => $payload,
		];
	}

	public static function get_form_submissions_for_admin( array $args = [] ): array {
		global $wpdb;

		$page = max( 1, absint( $args['page'] ?? 1 ) );
		$per_page = max( 1, min( 200, absint( $args['perPage'] ?? 25 ) ) );
		$post_id = absint( $args['postId'] ?? 0 );
		$form_id = sanitize_key( (string) ( $args['formId'] ?? '' ) );
		$search = sanitize_text_field( (string) ( $args['search'] ?? '' ) );
		$offset = ( $page - 1 ) * $per_page;

		$prefix = self::get_form_submission_meta_prefix();
		$where = [ 'pm.meta_key LIKE %s' ];
		$params = [ $wpdb->esc_like( $prefix ) . '%' ];

		if ( $post_id > 0 ) {
			$where[] = 'pm.post_id = %d';
			$params[] = $post_id;
		}

		if ( '' !== $form_id ) {
			$where[] = 'pm.meta_key = %s';
			$params[] = $prefix . $form_id;
		}

		if ( '' !== $search ) {
			$like = '%' . $wpdb->esc_like( $search ) . '%';
			$where[] = '(pm.meta_value LIKE %s OR p.post_title LIKE %s OR pm.meta_key LIKE %s)';
			$params[] = $like;
			$params[] = $like;
			$params[] = $like;
		}

		$where_sql = 'WHERE ' . implode( ' AND ', $where );
		$from_sql = "FROM {$wpdb->postmeta} pm INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id {$where_sql}";

		$count_sql = "SELECT COUNT(*) {$from_sql}";
		$total = (int) $wpdb->get_var( $wpdb->prepare( $count_sql, $params ) );

		$query_params = $params;
		$query_params[] = $per_page;
		$query_params[] = $offset;
		$rows_sql = "SELECT pm.meta_id, pm.post_id, pm.meta_key, pm.meta_value, p.post_title, p.post_type, p.post_status {$from_sql} ORDER BY pm.meta_id DESC LIMIT %d OFFSET %d";
		$rows = $wpdb->get_results( $wpdb->prepare( $rows_sql, $query_params ), ARRAY_A );

		$items = [];
		foreach ( is_array( $rows ) ? $rows : [] as $row ) {
			$record = self::decode_form_submission_record( $row );
			if ( null !== $record ) {
				$items[] = $record;
			}
		}

		return [
			'items' => $items,
			'pagination' => [
				'page' => $page,
				'perPage' => $per_page,
				'total' => $total,
				'totalPages' => max( 1, (int) ceil( $total / $per_page ) ),
			],
			'filters' => [
				'postId' => $post_id,
				'formId' => $form_id,
				'search' => $search,
			],
		];
	}

	public static function get_form_submission_record_for_admin( int $meta_id ): ?array {
		global $wpdb;

		if ( $meta_id <= 0 ) {
			return null;
		}

		$sql = "SELECT pm.meta_id, pm.post_id, pm.meta_key, pm.meta_value, p.post_title, p.post_type, p.post_status FROM {$wpdb->postmeta} pm INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id WHERE pm.meta_id = %d LIMIT 1";
		$row = $wpdb->get_row( $wpdb->prepare( $sql, $meta_id ), ARRAY_A );
		if ( ! is_array( $row ) ) {
			return null;
		}

		$prefix = self::get_form_submission_meta_prefix();
		$meta_key = (string) ( $row['meta_key'] ?? '' );
		if ( 0 !== strpos( $meta_key, $prefix ) ) {
			return null;
		}

		return self::decode_form_submission_record( $row );
	}

	public static function delete_form_submission_record_for_admin( int $meta_id ): bool {
		if ( $meta_id <= 0 ) {
			return false;
		}

		$record = self::get_form_submission_record_for_admin( $meta_id );
		if ( null === $record ) {
			return false;
		}

		return (bool) delete_metadata_by_mid( 'post', $meta_id );
	}

	private static function upload_form_file( array $file ) {
		if ( empty( $file['tmp_name'] ) || ! empty( $file['error'] ) ) {
			return new WP_Error( 'invalid_upload', 'File upload failed.', [ 'status' => 400 ] );
		}
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		$uploaded = wp_handle_upload( $file, [ 'test_form' => false ] );
		if ( ! is_array( $uploaded ) || ! empty( $uploaded['error'] ) ) {
			return new WP_Error( 'upload_failed', is_array( $uploaded ) ? ( $uploaded['error'] ?? 'Upload failed.' ) : 'Upload failed.', [ 'status' => 400 ] );
		}

		$attachment_id = 0;
		$uploaded_file_path = isset( $uploaded['file'] ) ? (string) $uploaded['file'] : '';
		if ( '' !== $uploaded_file_path ) {
			$attachment = [
				'post_mime_type' => sanitize_mime_type( (string) ( $uploaded['type'] ?? '' ) ),
				'post_title' => self::sanitize_import_asset_stem( (string) ( $file['name'] ?? '' ), 'form-upload' ),
				'post_content' => '',
				'post_status' => 'inherit',
			];
			$inserted_attachment_id = wp_insert_attachment( $attachment, $uploaded_file_path, 0, true );
			if ( ! is_wp_error( $inserted_attachment_id ) && $inserted_attachment_id ) {
				$attachment_id = absint( $inserted_attachment_id );
				$metadata = wp_generate_attachment_metadata( $attachment_id, $uploaded_file_path );
				if ( is_array( $metadata ) ) {
					wp_update_attachment_metadata( $attachment_id, $metadata );
				}
			}
		}

		return [
			'url' => esc_url_raw( $uploaded['url'] ?? '' ),
			'file' => sanitize_text_field( basename( (string) ( $uploaded['file'] ?? '' ) ) ),
			'type' => sanitize_mime_type( (string) ( $uploaded['type'] ?? '' ) ),
			'name' => sanitize_text_field( (string) ( $file['name'] ?? '' ) ),
			'size' => isset( $file['size'] ) ? absint( $file['size'] ) : 0,
			'attachmentId' => $attachment_id,
		];
	}

	private static function normalize_uploaded_files( $file_value ): array {
		if ( ! is_array( $file_value ) || empty( $file_value ) ) {
			return [];
		}

		if ( isset( $file_value['tmp_name'] ) && ! is_array( $file_value['tmp_name'] ) ) {
			return [ $file_value ];
		}

		$names = isset( $file_value['name'] ) && is_array( $file_value['name'] ) ? $file_value['name'] : [];
		$tmp_names = isset( $file_value['tmp_name'] ) && is_array( $file_value['tmp_name'] ) ? $file_value['tmp_name'] : [];
		$types = isset( $file_value['type'] ) && is_array( $file_value['type'] ) ? $file_value['type'] : [];
		$errors = isset( $file_value['error'] ) && is_array( $file_value['error'] ) ? $file_value['error'] : [];
		$sizes = isset( $file_value['size'] ) && is_array( $file_value['size'] ) ? $file_value['size'] : [];
		$normalized = [];

		foreach ( $tmp_names as $index => $tmp_name ) {
			$normalized[] = [
				'name' => $names[ $index ] ?? '',
				'tmp_name' => $tmp_name,
				'type' => $types[ $index ] ?? '',
				'error' => $errors[ $index ] ?? 0,
				'size' => $sizes[ $index ] ?? 0,
			];
		}

		return $normalized;
	}

	private static function collect_form_submission_fields( array $fields, array $params, array $files ) {
		$values = [];
		$flat_values = [];
		foreach ( $fields as $field ) {
			$type = (string) ( $field['type'] ?? '' );
			$base = is_array( $field['base'] ?? null ) ? $field['base'] : [];
			$field_name = self::normalize_form_field_name( $field );
			$allows_multiple_files = ! empty( $base['allowMultipleFiles'] );
			$label = isset( $base['label'] ) && is_string( $base['label'] ) && trim( $base['label'] ) !== ''
				? sanitize_text_field( $base['label'] )
				: sanitize_text_field( (string) ( $field['name'] ?? 'Field' ) );
			$required = ! empty( $base['required'] );
			$value = null;

			if ( 'file-upload' === $type ) {
				$file_value = $files[ $field_name ] ?? null;
				$normalized_files = self::normalize_uploaded_files( $file_value );
				if ( ! empty( $normalized_files ) ) {
					$uploaded_files = [];
					foreach ( $normalized_files as $normalized_file ) {
						$uploaded = self::upload_form_file( $normalized_file );
						if ( is_wp_error( $uploaded ) ) {
							return $uploaded;
						}
						$uploaded_files[] = $uploaded;
					}
					$value = $allows_multiple_files ? $uploaded_files : ( $uploaded_files[0] ?? null );
				}
			} elseif ( 'checkbox' === $type ) {
				$value = ! empty( $params[ $field_name ] );
			} elseif ( 'rich-text-editor' === $type ) {
				$value = isset( $params[ $field_name ] ) ? wp_kses_post( wp_unslash( (string) $params[ $field_name ] ) ) : '';
			} elseif ( 'captcha' === $type ) {
				$value = isset( $params[ $field_name ] ) ? sanitize_text_field( (string) $params[ $field_name ] ) : 'captcha-placeholder';
			} else {
				$value = isset( $params[ $field_name ] ) ? sanitize_textarea_field( wp_unslash( (string) $params[ $field_name ] ) ) : '';
			}

			if ( 'checkbox' === $type ) {
				$has_value = ( true === $value );
			} elseif ( 'file-upload' === $type ) {
				$has_value = is_array( $value )
					? ( isset( $value['url'] ) ? ! empty( $value['url'] ) : ! empty( $value ) )
					: false;
			} elseif ( 'rich-text-editor' === $type ) {
				$has_value = '' !== trim( wp_strip_all_tags( (string) $value ) );
			} else {
				$has_value = '' !== trim( (string) ( is_array( $value ) ? wp_json_encode( $value ) : $value ) );
			}
			if ( $required && ! $has_value ) {
				return new WP_Error( 'missing_required_field', sprintf( '%s is required.', $label ), [ 'status' => 422 ] );
			}

			$values[] = [
				'id' => sanitize_text_field( (string) ( $field['id'] ?? '' ) ),
				'name' => $field_name,
				'label' => $label,
				'type' => $type,
				'value' => $value,
			];
			$flat_values[ $field_name ] = $value;
		}

		return [
			'fields' => $values,
			'values' => $flat_values,
		];
	}

	private static function collect_fallback_submission_fields( array $params, array $files ): array {
		$ignored_param_keys = [ 'post_id', 'form_id', '_wpnonce', '_wp_http_referer', 'action' ];
		$values = [];
		$flat_values = [];

		foreach ( $params as $key => $raw_value ) {
			$field_name = sanitize_key( (string) $key );
			if ( '' === $field_name || in_array( $field_name, $ignored_param_keys, true ) ) {
				continue;
			}
			if ( isset( $files[ $field_name ] ) ) {
				continue;
			}

			$value = is_array( $raw_value )
				? array_map(
					static fn( $entry ) => sanitize_textarea_field( wp_unslash( (string) $entry ) ),
					$raw_value
				)
				: sanitize_textarea_field( wp_unslash( (string) $raw_value ) );

			$values[] = [
				'id' => $field_name,
				'name' => $field_name,
				'label' => sanitize_text_field( ucwords( str_replace( [ '-', '_' ], ' ', $field_name ) ) ),
				'type' => is_array( $value ) ? 'group' : 'text-field',
				'value' => $value,
			];
			$flat_values[ $field_name ] = $value;
		}

		foreach ( $files as $key => $file_value ) {
			$field_name = sanitize_key( (string) $key );
			if ( '' === $field_name ) {
				continue;
			}
			$normalized_files = self::normalize_uploaded_files( $file_value );
			if ( empty( $normalized_files ) ) {
				continue;
			}
			$uploaded_files = [];
			foreach ( $normalized_files as $normalized_file ) {
				$uploaded = self::upload_form_file( $normalized_file );
				if ( is_wp_error( $uploaded ) ) {
					continue 2;
				}
				$uploaded_files[] = $uploaded;
			}
			$values[] = [
				'id' => $field_name,
				'name' => $field_name,
				'label' => sanitize_text_field( ucwords( str_replace( [ '-', '_' ], ' ', $field_name ) ) ),
				'type' => 'file-upload',
				'value' => 1 === count( $uploaded_files ) ? $uploaded_files[0] : $uploaded_files,
			];
			$flat_values[ $field_name ] = 1 === count( $uploaded_files ) ? $uploaded_files[0] : $uploaded_files;
		}

		return [
			'fields' => $values,
			'values' => $flat_values,
		];
	}

	private static function store_form_submission( int $post_id, string $form_id, array $submission ): bool {
		return false !== add_post_meta( $post_id, self::get_form_submission_meta_prefix() . sanitize_key( $form_id ), wp_slash( wp_json_encode( $submission ) ) );
	}

	private static function send_form_submission_email( int $post_id, string $form_id, array $config, array $submission ): bool {
		$to = sanitize_email( (string) ( $config['actions']['email']['to'] ?? '' ) );
		if ( '' === $to || ! is_email( $to ) ) return false;
		$subject = sanitize_text_field( (string) ( $config['actions']['email']['subject'] ?? 'New form submission' ) );
		$post_title = get_the_title( $post_id );
		$lines = [
			sprintf( 'Post: %s (#%d)', $post_title ?: 'Untitled', $post_id ),
			sprintf( 'Form: %s', $form_id ),
			'',
		];
		foreach ( $submission['fields'] as $field ) {
			$value = $field['value'];
			if ( is_array( $value ) ) {
				$value = wp_json_encode( $value );
			} elseif ( is_bool( $value ) ) {
				$value = $value ? 'true' : 'false';
			}
			$lines[] = sprintf( '%s: %s', $field['label'], (string) $value );
		}
		return wp_mail( $to, $subject, implode( "\n", $lines ) );
	}

	private static function send_form_submission_webhook( array $config, array $payload ) {
		$url = esc_url_raw( (string) ( $config['actions']['webhook']['url'] ?? '' ) );
		if ( '' === $url ) return false;
		$response = wp_remote_post( $url, [
			'timeout' => 12,
			'headers' => [ 'Content-Type' => 'application/json' ],
			'body' => wp_json_encode( $payload ),
		] );
		if ( is_wp_error( $response ) ) return $response;
		$status = wp_remote_retrieve_response_code( $response );
		return $status >= 200 && $status < 300;
	}

	public static function submit_form( WP_REST_Request $request ) {
		$post_id = absint( $request->get_param( 'post_id' ) );
		$form_id = sanitize_text_field( (string) $request->get_param( 'form_id' ) );
		$result = self::perform_submit_form( $post_id, $form_id, $request->get_params(), $request->get_file_params() );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return rest_ensure_response( $result );
	}

	public static function ajax_submit_form() {
		$result = self::perform_submit_form(
			absint( $_REQUEST['post_id'] ?? 0 ),
			sanitize_text_field( (string) ( $_REQUEST['form_id'] ?? '' ) ),
			wp_unslash( $_POST ),
			$_FILES
		);
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( [ 'message' => $result->get_error_message() ], (int) ( $result->get_error_data()['status'] ?? 400 ) );
		}
		wp_send_json( $result );
	}

	private static function perform_submit_form( int $post_id, string $form_id, array $params, array $files ) {
		if ( ! $post_id ) {
			return new WP_Error( 'invalid_post_id', 'A valid post ID is required.', [ 'status' => 400 ] );
		}
		if ( '' === $form_id ) {
			return new WP_Error( 'invalid_form_id', 'A valid form ID is required.', [ 'status' => 400 ] );
		}
		$post = get_post( $post_id );
		if ( ! $post ) {
			return new WP_Error( 'not_found', 'Post not found.', [ 'status' => 404 ] );
		}
		$layout = self::get_submission_layout( $post_id );
		$form = null;
		$fields = [];
		if ( is_array( $layout ) ) {
			[ $form, $fields ] = self::find_form_elements( $layout, $form_id );
			if ( $form ) {
				$fields = self::get_ordered_submission_fields( $layout, $form_id, $fields );
			}
		}

		$config = self::normalize_form_config( is_array( $form['base']['formConfig'] ?? null ) ? $form['base']['formConfig'] : [] );
		$submission_node = is_array( $layout ) ? self::get_form_submission_node( $layout, $form_id ) : null;
		$action_config = self::normalize_submission_action_config(
			is_array( $submission_node['config']['actions'] ?? null ) ? $submission_node['config']['actions'] : [],
			$submission_node ? [] : ( $config['actions'] ?? [] )
		);
		$submission = $form
			? self::collect_form_submission_fields( $fields, $params, $files )
			: self::collect_fallback_submission_fields( $params, $files );
		if ( is_wp_error( $submission ) ) {
			return $submission;
		}

		$submission_payload = [
			'id' => uniqid( 'fbsub_', true ),
			'postId' => $post_id,
			'formId' => $form_id,
			'submittedAt' => current_time( 'mysql', true ),
			'fields' => $submission['fields'],
			'values' => $submission['values'],
			'source' => [
				'url' => esc_url_raw( wp_get_referer() ?: get_permalink( $post_id ) ?: '' ),
				'userAgent' => isset( $_SERVER['HTTP_USER_AGENT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) : '',
			],
		];

		$errors = [];
		$created = [];
		if ( ! empty( $action_config['store']['enabled'] ) ) {
			if ( ! self::store_form_submission( $post_id, $form_id, $submission_payload ) ) {
				$errors[] = 'store';
			}
		}
		if ( ! empty( $action_config['email']['enabled'] ) ) {
			if ( ! self::send_form_submission_email( $post_id, $form_id, [ 'actions' => [ 'email' => $action_config['email'] ] ], $submission_payload ) ) {
				$errors[] = 'email';
			}
		}
		if ( ! empty( $action_config['webhook']['enabled'] ) ) {
			$webhook_result = self::send_form_submission_webhook( [ 'actions' => [ 'webhook' => $action_config['webhook'] ] ], $submission_payload );
			if ( is_wp_error( $webhook_result ) || true !== $webhook_result ) {
				$errors[] = 'webhook';
			}
		}
		if ( ! empty( $action_config['createPost']['enabled'] ) ) {
			$post_result = self::create_post_from_submission( $action_config['createPost'], $submission_payload );
			if ( is_wp_error( $post_result ) ) {
				$errors[] = 'createPost';
			} else {
				$created['post'] = $post_result;
			}
		}
		if ( ! empty( $action_config['createCategory']['enabled'] ) ) {
			$category_result = self::create_term_from_submission( 'category', $action_config['createCategory'], $submission_payload );
			if ( is_wp_error( $category_result ) ) {
				$errors[] = 'createCategory';
			} else {
				$created['category'] = $category_result;
			}
		}
		if ( ! empty( $action_config['createProductCategory']['enabled'] ) ) {
			$product_category_result = self::create_term_from_submission( 'product_cat', $action_config['createProductCategory'], $submission_payload );
			if ( is_wp_error( $product_category_result ) ) {
				$errors[] = 'createProductCategory';
			} else {
				$created['productCategory'] = $product_category_result;
			}
		}
		if ( ! empty( $action_config['createProduct']['enabled'] ) ) {
			$product_result = self::create_product_from_submission( $action_config['createProduct'], $submission_payload );
			if ( is_wp_error( $product_result ) ) {
				$errors[] = 'createProduct';
			} else {
				$created['product'] = $product_result;
			}
		}

		if ( ! empty( $errors ) ) {
			return new WP_Error( 'submit_failed', $config['errorMessage'], [ 'status' => 500, 'actions' => $errors ] );
		}

		return [
			'success' => true,
			'message' => $config['successMessage'],
			'submission' => $submission_payload,
			'created' => $created,
			'values' => $submission_payload['values'],
		];
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

		if ( is_ssl() ) {
			$url = set_url_scheme( $url, 'https' );
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

	private static function perform_import_media_asset( $source, int $post_id = 0, string $asset_name = '', ?array $uploaded_file = null ) {
		if ( ! current_user_can( 'upload_files' ) ) {
			return new WP_Error( 'forbidden', 'Not allowed.', [ 'status' => 403 ] );
		}

		$source = is_string( $source ) ? trim( $source ) : '';
		$asset_name = is_string( $asset_name ) ? trim( sanitize_text_field( $asset_name ) ) : '';
		if ( '' === $source && empty( $uploaded_file['tmp_name'] ) ) {
			return new WP_Error( 'invalid_source', 'A valid media source is required.', [ 'status' => 400 ] );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$attachment_id = 0;
		if ( ! empty( $uploaded_file['tmp_name'] ) ) {
			if ( ! empty( $uploaded_file['error'] ) ) {
				return new WP_Error( 'upload_failed', 'Uploaded media file is invalid.', [ 'status' => 400 ] );
			}

			$tmp_name = (string) $uploaded_file['tmp_name'];
			if ( '' === $tmp_name || ! is_readable( $tmp_name ) ) {
				return new WP_Error( 'upload_failed', 'Uploaded media file is missing.', [ 'status' => 400 ] );
			}

			$source_hash = hash_file( 'sha1', $tmp_name ) ?: '';
			$existing_attachment_id = self::get_import_attachment_by_source_hash( $source_hash );
			if ( $existing_attachment_id > 0 ) {
				@unlink( $tmp_name );
				return self::build_import_media_result( $existing_attachment_id, true, $asset_name );
			}

			$original_name = isset( $uploaded_file['name'] ) && is_string( $uploaded_file['name'] ) ? $uploaded_file['name'] : '';
			$extension = pathinfo( $original_name, PATHINFO_EXTENSION );
			$filename = self::build_import_filename( $asset_name ?: $original_name, $extension ?: 'bin' );
			$file_array = [
				'name'     => $filename,
				'tmp_name' => $tmp_name,
			];

			$attachment_id = media_handle_sideload( $file_array, $post_id > 0 ? $post_id : 0 );
			if ( is_wp_error( $attachment_id ) ) {
				@unlink( $tmp_name );
				return $attachment_id;
			}

			self::persist_import_attachment_meta( (int) $attachment_id, $source_hash, $asset_name );
		} elseif ( 0 === strpos( $source, 'data:' ) ) {
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
		$post_categories = taxonomy_exists( 'category' )
			? get_terms( [
				'taxonomy' => 'category',
				'hide_empty' => false,
			] )
			: [];
		$product_categories = taxonomy_exists( 'product_cat' )
			? get_terms( [
				'taxonomy' => 'product_cat',
				'hide_empty' => false,
			] )
			: [];
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
		$posts = array_values( array_filter( $posts, static function( $post ) {
			return ! ( $post instanceof WP_Post ) || ! self::is_submission_generated_post( $post ) ? true : false;
		} ) );

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
				$item = self::map_variable_source_post( $post, 'product' );
				if ( function_exists( 'wc_get_product' ) ) {
					$product = wc_get_product( $post->ID );
					if ( $product ) {
						$item['price'] = wp_strip_all_tags( html_entity_decode( $product->get_price_html(), ENT_QUOTES, 'UTF-8' ) );
					}
				}
				return $item;
			}, $product_posts );
		}

		return [
			'success'  => true,
			'pages'    => array_map( static function( $post ) {
				return self::map_variable_source_post( $post, 'page' );
			}, $pages ),
			'posts'    => array_map( static function( $post ) {
				return self::map_variable_source_post( $post, 'post' );
			}, $posts ),
			'products' => $products,
			'postCategories' => is_array( $post_categories ) ? array_map( static function( $term ) {
				return [
					'id' => (int) $term->term_id,
					'name' => $term->name,
					'slug' => $term->slug,
				];
			}, $post_categories ) : [],
			'productCategories' => is_array( $product_categories ) ? array_map( static function( $term ) {
				return [
					'id' => (int) $term->term_id,
					'name' => $term->name,
					'slug' => $term->slug,
				];
			}, $product_categories ) : [],
			'formTargets' => self::get_form_action_targets(),
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
			wp_unslash( $_POST['asset_name'] ?? '' ),
			isset( $_FILES['file'] ) && is_array( $_FILES['file'] ) ? $_FILES['file'] : null
		);
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( [ 'message' => $result->get_error_message() ], (int) ( $result->get_error_data()['status'] ?? 400 ) );
		}
		wp_send_json( $result );
	}
}
