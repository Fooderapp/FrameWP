<?php
defined( 'ABSPATH' ) || exit;

class FrameBuilder_Plugin {
	/** @var array<int,array{html:string,css:string}> */
	private static array $frontend_render_cache = [];

	private static function force_important_in_css_block( string $block, array $properties ): string {
		foreach ( $properties as $property ) {
			$pattern = '/(' . preg_quote( $property, '/' ) . '\s*:\s*[^;{}]+?)(\s*!important)?;/i';
			$block = preg_replace_callback(
				$pattern,
				static function ( array $matches ): string {
					return rtrim( $matches[1] ) . ' !important;';
				},
				$block,
				1
			) ?? $block;
		}
		return $block;
	}

	private static function normalize_google_font_import_url( string $url ): string {
		$query = '';
		$query_start = strpos( $url, '?' );
		if ( false !== $query_start ) {
			$query = substr( $url, $query_start + 1 );
		}
		if ( '' === $query ) {
			return $url;
		}

		if ( ! preg_match_all( '/(?:^|&)family=([^&]+)/', $query, $family_matches ) ) {
			return $url;
		}

		$families = [];
		foreach ( $family_matches[1] as $encoded_family ) {
			$decoded_family = urldecode( (string) $encoded_family );
			$base_family = trim( preg_replace( '/:.*/', '', $decoded_family ) ?? '' );
			if ( '' === $base_family ) {
				continue;
			}
			$families[ $base_family ] = true;
		}
		if ( empty( $families ) ) {
			return $url;
		}

		$display = 'swap';
		if ( preg_match( '/(?:^|&)display=([^&]+)/', $query, $display_match ) ) {
			$display_candidate = trim( urldecode( (string) $display_match[1] ) );
			if ( '' !== $display_candidate ) {
				$display = $display_candidate;
			}
		}

		$family_query = [];
		foreach ( array_keys( $families ) as $family ) {
			$family_query[] = 'family=' . str_replace( '%20', '+', rawurlencode( $family ) );
		}

		$normalized_query = implode( '&', $family_query ) . '&display=' . rawurlencode( $display );
		$normalized_url = 'https://fonts.googleapis.com/css2?' . $normalized_query;
		return $normalized_url;
	}

	private static function normalize_frontend_google_font_imports( string $markup ): string {
		if ( '' === $markup || false === strpos( $markup, 'fonts.googleapis.com/css2' ) ) {
			return $markup;
		}

		return preg_replace_callback(
			'/https:\/\/fonts\.googleapis\.com\/css2\?[^\'"\)\s]+/i',
			static function ( array $matches ): string {
				return self::normalize_google_font_import_url( $matches[0] );
			},
			$markup
		) ?? $markup;
	}

	private static function normalize_font_family_name( string $value ): string {
		$decoded = html_entity_decode( $value, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		$entry = trim( explode( ',', $decoded )[0] ?? '' );
		$entry = trim( $entry, "\"'" );
		$entry = preg_replace( '/\s+/', ' ', $entry ) ?? '';
		if ( '' === $entry || preg_match( '/^&#?[a-z0-9]+$/i', $entry ) ) {
			return '';
		}
		$normalized = strtolower( trim( $entry ) );
		if ( '' === $normalized || in_array( $normalized, [ 'inherit', 'initial', 'unset', 'serif', 'sans-serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'arial' ], true ) ) {
			return '';
		}
		return trim( $entry );
	}

	private static function build_safe_google_font_imports( string ...$markup_blocks ): string {
		$families = [];
		foreach ( $markup_blocks as $markup ) {
			if ( '' === $markup || false === stripos( $markup, 'font-family' ) ) {
				continue;
			}
			if ( preg_match_all( '/font-family\s*:\s*([^;{}]+)/i', $markup, $matches ) ) {
				foreach ( $matches[1] as $raw_family ) {
					$family = self::normalize_font_family_name( (string) $raw_family );
					if ( '' === $family ) {
						continue;
					}
					$families[ $family ] = true;
				}
			}
		}

		if ( empty( $families ) ) {
			return '';
		}

		$family_query = [];
		foreach ( array_keys( $families ) as $family ) {
			$family_query[] = 'family=' . str_replace( '%20', '+', rawurlencode( $family ) );
		}

		return "@import url('https://fonts.googleapis.com/css2?" . implode( '&', $family_query ) . "&display=swap');";
	}

	private static function normalize_frontend_render_html( string $html ): string {
		$html = self::normalize_frontend_google_font_imports( $html );

		if ( '' === $html || false === strpos( $html, 'fb-form-choice__control' ) ) {
			return $html;
		}

		$html = preg_replace_callback(
			'/(:(?:focus|focus-visible)\s*\+\s*\.fb-form-choice__control\{)([^}]*)(\})/i',
			static function ( array $matches ): string {
				return $matches[1] . self::force_important_in_css_block( $matches[2], [ 'border-color', 'background', 'box-shadow' ] ) . $matches[3];
			},
			$html
		) ?? $html;

		$html = preg_replace_callback(
			'/(:checked\s*\+\s*\.fb-form-choice__control\{)([^}]*)(\})/i',
			static function ( array $matches ): string {
				return $matches[1] . self::force_important_in_css_block( $matches[2], [ 'border-color', 'background', 'box-shadow' ] ) . $matches[3];
			},
			$html
		) ?? $html;

		$html = preg_replace_callback(
			'/(:checked\s*\+\s*\.fb-form-choice__control\s+\.fb-form-choice__mark\{)([^}]*)(\})/i',
			static function ( array $matches ): string {
				return $matches[1] . self::force_important_in_css_block( $matches[2], [ 'opacity' ] ) . $matches[3];
			},
			$html
		) ?? $html;

		return $html;
	}

	private static function asset_version( string $absolute_path ): string {
		if ( file_exists( $absolute_path ) ) {
			$mtime = filemtime( $absolute_path );
			if ( false !== $mtime ) {
				return FB_VERSION . '.' . (string) $mtime;
			}
		}
		return FB_VERSION;
	}

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
		add_submenu_page(
			'framebuilder',
			__( 'Form Submissions', 'framebuilder' ),
			__( 'Form Submissions', 'framebuilder' ),
			'edit_posts',
			'framebuilder-submissions',
			[ __CLASS__, 'render_submissions_page' ]
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

	private static function format_submission_value( $value ): string {
		if ( is_bool( $value ) ) {
			return $value ? 'true' : 'false';
		}
		if ( is_array( $value ) ) {
			return wp_json_encode( $value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) ?: '';
		}
		if ( null === $value ) {
			return '';
		}
		return (string) $value;
	}

	private static function format_submission_admin_value( $value ): string {
		if ( is_bool( $value ) ) {
			return $value ? __( 'Yes', 'framebuilder' ) : __( 'No', 'framebuilder' );
		}

		return self::format_submission_value( $value );
	}

	private static function build_submissions_page_url( array $args = [] ): string {
		$base_args = [ 'page' => 'framebuilder-submissions' ];
		foreach ( $args as $key => $value ) {
			if ( '' === $value || null === $value ) {
				continue;
			}
			$base_args[ $key ] = $value;
		}
		return add_query_arg( $base_args, admin_url( 'admin.php' ) );
	}

	private static function send_submission_export( array $submission_record, string $format ): void {
		$submission = is_array( $submission_record['submission'] ?? null ) ? $submission_record['submission'] : [];
		$submission_id = sanitize_file_name( (string) ( $submission['id'] ?? 'submission' ) );
		$format = 'csv' === $format ? 'csv' : 'json';

		nocache_headers();
		if ( 'csv' === $format ) {
			header( 'Content-Type: text/csv; charset=utf-8' );
			header( 'Content-Disposition: attachment; filename="' . $submission_id . '.csv"' );
			$output = fopen( 'php://output', 'w' );
			if ( false === $output ) {
				exit;
			}
			fputcsv( $output, [ 'field', 'label', 'type', 'value' ] );
			foreach ( is_array( $submission['fields'] ?? null ) ? $submission['fields'] : [] as $field ) {
				fputcsv( $output, [
					(string) ( $field['name'] ?? '' ),
					(string) ( $field['label'] ?? '' ),
					(string) ( $field['type'] ?? '' ),
					self::format_submission_value( $field['value'] ?? '' ),
				] );
			}
			fclose( $output );
			exit;
		}

		header( 'Content-Type: application/json; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="' . $submission_id . '.json"' );
		echo wp_json_encode( $submission, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		exit;
	}

	private static function format_submission_datetime( string $submitted_at ): string {
		if ( '' === $submitted_at ) {
			return '—';
		}

		$formatted = get_date_from_gmt( $submitted_at, 'Y-m-d H:i:s' );
		return '' !== $formatted ? $formatted : $submitted_at;
	}

	private static function format_submission_preview_value( $value, int $limit = 120 ): string {
		$text = trim( self::format_submission_value( $value ) );
		if ( '' === $text ) {
			return '—';
		}

		if ( function_exists( 'mb_strlen' ) && function_exists( 'mb_substr' ) ) {
			if ( mb_strlen( $text ) <= $limit ) {
				return $text;
			}

			return rtrim( mb_substr( $text, 0, max( 1, $limit - 1 ) ) ) . '…';
		}

		if ( strlen( $text ) <= $limit ) {
			return $text;
		}

		return rtrim( substr( $text, 0, max( 1, $limit - 1 ) ) ) . '…';
	}

	public static function render_submissions_page() {
		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_die( esc_html__( 'You do not have permission to view form submissions.', 'framebuilder' ) );
		}

		$page = max( 1, absint( $_GET['paged'] ?? 1 ) );
		$submission_id = absint( $_GET['submission_id'] ?? 0 );
		$action = sanitize_key( (string) ( $_GET['action'] ?? '' ) );
		$post_id = absint( $_GET['post_id'] ?? 0 );
		$form_id = sanitize_key( (string) ( $_GET['form_id'] ?? '' ) );
		$search = sanitize_text_field( (string) ( $_GET['s'] ?? '' ) );
		$delete_failed = false;
		$deleted_submission = absint( $_GET['deleted'] ?? 0 );
		if ( $submission_id > 0 && 'delete' === $action ) {
			check_admin_referer( 'fb_delete_submission_' . $submission_id );
			if ( FrameBuilder_API::delete_form_submission_record_for_admin( $submission_id ) ) {
				wp_safe_redirect( self::build_submissions_page_url([
					'post_id' => $post_id ?: null,
					'form_id' => '' !== $form_id ? $form_id : null,
					's' => '' !== $search ? $search : null,
					'paged' => $page,
					'deleted' => $submission_id,
				]) );
				exit;
			}

			$delete_failed = true;
			$action = '';
		}
		$active_submission = $submission_id > 0 ? FrameBuilder_API::get_form_submission_record_for_admin( $submission_id ) : null;
		if ( $active_submission && in_array( $action, [ 'download_json', 'download_csv' ], true ) ) {
			self::send_submission_export( $active_submission, 'download_csv' === $action ? 'csv' : 'json' );
		}
		$result = FrameBuilder_API::get_form_submissions_for_admin([
			'page' => $page,
			'perPage' => 25,
			'postId' => $post_id,
			'formId' => $form_id,
			'search' => $search,
		]);
		$items = is_array( $result['items'] ?? null ) ? $result['items'] : [];
		$pagination = is_array( $result['pagination'] ?? null ) ? $result['pagination'] : [ 'page' => 1, 'total' => 0, 'totalPages' => 1 ];
		$total = (int) ( $pagination['total'] ?? count( $items ) );
		$total_pages = max( 1, (int) ( $pagination['totalPages'] ?? 1 ) );
		?>
		<div class="wrap">
			<?php if ( $deleted_submission > 0 ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Submission deleted.', 'framebuilder' ); ?></p></div>
			<?php elseif ( $delete_failed ) : ?>
				<div class="notice notice-error"><p><?php esc_html_e( 'Submission could not be deleted.', 'framebuilder' ); ?></p></div>
			<?php endif; ?>
			<style>
				.fb-submissions-page {
					--fb-border: #dcdcde;
					--fb-bg: #f6f7f7;
					--fb-panel: #ffffff;
					--fb-ink: #1d2327;
					--fb-muted: #646970;
					margin-top: 16px;
				}

				.fb-submissions-page *,
				.fb-submissions-page *::before,
				.fb-submissions-page *::after {
					box-sizing: border-box;
				}

				.fb-submissions-page__detail,
				.fb-submissions-page__empty {
					background: var(--fb-panel);
					border: 1px solid var(--fb-border);
					border-radius: 8px;
				}

				.fb-submissions-page__header {
					margin-bottom: 14px;
				}

				.fb-submissions-page__header h1 {
					margin: 0 0 6px;
					font-size: 23px;
					line-height: 1.3;
					color: var(--fb-ink);
				}

				.fb-submissions-page__header p {
					margin: 0;
					color: var(--fb-muted);
					font-size: 13px;
					line-height: 1.5;
				}

				.fb-submissions-page__content {
					display: grid;
					gap: 14px;
				}

				.fb-submissions-page__chip {
					display: inline-flex;
					align-items: center;
					gap: 6px;
					padding: 5px 10px;
					border-radius: 999px;
					background: var(--fb-bg);
					border: 1px solid var(--fb-border);
					color: var(--fb-ink);
					font-size: 12px;
				}

				.fb-submissions-page__table {
					width: 100%;
					border-collapse: collapse;
					background: var(--fb-panel);
					border: 1px solid var(--fb-border);
					border-radius: 8px;
					overflow: hidden;
				}

				.fb-submissions-page__table th,
				.fb-submissions-page__table td {
					padding: 12px;
					border-top: 1px solid var(--fb-border);
					vertical-align: top;
					text-align: left;
				}

				.fb-submissions-page__table thead th {
					padding-top: 12px;
					border-top: 0;
					font-size: 12px;
					font-weight: 600;
					color: var(--fb-muted);
					background: var(--fb-bg);
				}

				.fb-submissions-page__detail-title {
					margin: 0;
					font-size: 18px;
					color: var(--fb-ink);
				}

				.fb-submissions-page__detail-head,
				.fb-submissions-page__actions,
				.fb-submissions-page__detail-tags {
					display: flex;
					gap: 8px;
					flex-wrap: wrap;
				}

				.fb-submissions-page__detail-head {
					justify-content: space-between;
					align-items: flex-start;
					margin-bottom: 12px;
				}

				.fb-submissions-page__actions {
					justify-content: flex-end;
				}

				.fb-submissions-page__detail-meta,
				.fb-submissions-page__json,
				.fb-submissions-page__fields {
					padding: 12px;
					border-radius: 6px;
					background: var(--fb-bg);
					border: 1px solid var(--fb-border);
				}

				.fb-submissions-page__detail-meta strong {
					display: block;
					margin-bottom: 4px;
					color: var(--fb-ink);
				}

				.fb-submissions-page__field-key,
				.fb-submissions-page__muted {
					color: var(--fb-muted);
					font-size: 12px;
				}

				.fb-submissions-page__detail {
					padding: 16px;
				}

				.fb-submissions-page__detail-grid {
					display: grid;
					grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
					gap: 12px;
				}

				.fb-submissions-page__detail-fields {
					display: grid;
					gap: 12px;
				}

				.fb-submissions-page__meta-list {
					display: grid;
					grid-template-columns: 92px minmax(0, 1fr);
					gap: 8px 12px;
					margin: 0;
				}

				.fb-submissions-page__meta-list dt {
					margin: 0;
					color: var(--fb-muted);
					font-size: 12px;
					font-weight: 600;
				}

				.fb-submissions-page__meta-list dd {
					margin: 0;
					min-width: 0;
				}

				.fb-submissions-page__fields-table {
					width: 100%;
					border-collapse: collapse;
				}

				.fb-submissions-page__fields-table th,
				.fb-submissions-page__fields-table td {
					padding: 10px 0;
					border-top: 1px solid var(--fb-border);
					vertical-align: top;
					text-align: left;
				}

				.fb-submissions-page__fields-table thead th {
					padding-top: 0;
					border-top: 0;
					font-size: 12px;
					font-weight: 600;
					color: var(--fb-muted);
				}

				.fb-submissions-page__field-label {
					font-weight: 600;
				}

				.fb-submissions-page__field-subline {
					margin-top: 2px;
				}

				.fb-submissions-page__detail-sidebar {
					display: grid;
					gap: 12px;
				}

				.fb-submissions-page__json pre {
					margin: 10px 0 0;
					max-height: 320px;
					overflow: auto;
					white-space: pre-wrap;
					word-break: break-word;
					font-size: 12px;
					line-height: 1.55;
				}

				.fb-submissions-page__summary-link {
					font-weight: 600;
					color: var(--fb-ink);
					text-decoration: none;
				}

				.fb-submissions-page__summary-link:hover {
					text-decoration: underline;
				}

				.fb-submissions-page__table-actions {
					display: flex;
					gap: 6px;
					flex-wrap: wrap;
				}

				.fb-submissions-page__empty {
					padding: 28px 22px;
					text-align: center;
				}

				.fb-submissions-page__pagination {
					margin-top: 12px;
				}

				.fb-submissions-page__pagination .tablenav-pages {
					float: none;
					margin: 0;
				}

				@media (max-width: 1080px) {
					.fb-submissions-page__detail-grid {
						grid-template-columns: 1fr;
					}

					.fb-submissions-page__meta-list {
						grid-template-columns: 1fr;
						gap: 2px;
					}

					.fb-submissions-page__detail-head,
					.fb-submissions-page__header {
						flex-direction: column;
					}

					.fb-submissions-page__actions {
						justify-content: flex-start;
					}

					.fb-submissions-page__table,
					.fb-submissions-page__table tbody,
					.fb-submissions-page__table tr,
					.fb-submissions-page__table td {
						display: block;
						width: 100%;
					}

					.fb-submissions-page__table thead {
						display: none;
					}

					.fb-submissions-page__table td {
						padding: 10px 0;
					}

					.fb-submissions-page__table tr + tr td:first-child {
						border-top: 1px solid var(--fb-border);
						padding-top: 14px;
					}
				}
			</style>

			<div class="fb-submissions-page">
				<div class="fb-submissions-page__header">
					<h1><?php esc_html_e( 'Form Submissions', 'framebuilder' ); ?></h1>
					<p><?php echo esc_html( sprintf( _n( '%d submission', '%d submissions', $total, 'framebuilder' ), $total ) ); ?></p>
				</div>

				<div class="fb-submissions-page__content">

			<?php if ( $active_submission ) : ?>
				<?php
				$active_payload = is_array( $active_submission['submission'] ?? null ) ? $active_submission['submission'] : [];
				$active_fields = is_array( $active_payload['fields'] ?? null ) ? $active_payload['fields'] : [];
				$active_source = is_array( $active_payload['source'] ?? null ) ? $active_payload['source'] : [];
				$active_json = wp_json_encode( $active_payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
				$active_submitted_at = is_string( $active_payload['submittedAt'] ?? null ) ? $active_payload['submittedAt'] : (string) ( $active_submission['submittedAt'] ?? '' );
				$delete_submission_url = wp_nonce_url( self::build_submissions_page_url([
					'submission_id' => $submission_id,
					'action' => 'delete',
					'post_id' => $post_id ?: null,
					'form_id' => '' !== $form_id ? $form_id : null,
					's' => '' !== $search ? $search : null,
					'paged' => $page,
				]), 'fb_delete_submission_' . $submission_id );
				?>
				<section class="fb-submissions-page__detail">
					<div class="fb-submissions-page__detail-head">
						<div>
							<h2 class="fb-submissions-page__detail-title"><?php esc_html_e( 'Submission Detail', 'framebuilder' ); ?></h2>
							<div class="fb-submissions-page__detail-tags">
								<span class="fb-submissions-page__chip"><strong><?php esc_html_e( 'Submission', 'framebuilder' ); ?></strong> <code><?php echo esc_html( (string) ( $active_payload['id'] ?? '' ) ); ?></code></span>
								<span class="fb-submissions-page__chip"><strong><?php esc_html_e( 'Page', 'framebuilder' ); ?></strong> <?php echo esc_html( (string) ( $active_submission['postTitle'] ?? __( 'Untitled', 'framebuilder' ) ) ); ?></span>
							</div>
						</div>
						<div class="fb-submissions-page__actions">
						<a class="button button-primary" href="<?php echo esc_url( self::build_submissions_page_url([
							'submission_id' => $submission_id,
							'action' => 'download_json',
							'post_id' => $post_id ?: null,
							'form_id' => '' !== $form_id ? $form_id : null,
							's' => '' !== $search ? $search : null,
							'paged' => $page,
						]) ); ?>"><?php esc_html_e( 'Download JSON', 'framebuilder' ); ?></a>
						<a class="button button-secondary" href="<?php echo esc_url( self::build_submissions_page_url([
							'submission_id' => $submission_id,
							'action' => 'download_csv',
							'post_id' => $post_id ?: null,
							'form_id' => '' !== $form_id ? $form_id : null,
							's' => '' !== $search ? $search : null,
							'paged' => $page,
						]) ); ?>"><?php esc_html_e( 'Download CSV', 'framebuilder' ); ?></a>
						<a class="button button-secondary" href="<?php echo esc_url( $delete_submission_url ); ?>" onclick="return window.confirm('<?php echo esc_js( __( 'Delete this submission permanently?', 'framebuilder' ) ); ?>');"><?php esc_html_e( 'Delete Submission', 'framebuilder' ); ?></a>
						<a class="button" href="<?php echo esc_url( self::build_submissions_page_url([
							'post_id' => $post_id ?: null,
							'form_id' => '' !== $form_id ? $form_id : null,
							's' => '' !== $search ? $search : null,
							'paged' => $page,
						]) ); ?>"><?php esc_html_e( 'Close Detail', 'framebuilder' ); ?></a>
					</div>
					</div>

					<div class="fb-submissions-page__detail-grid">
						<div class="fb-submissions-page__detail-fields">
							<div class="fb-submissions-page__fields">
								<strong><?php esc_html_e( 'Fields', 'framebuilder' ); ?></strong>
								<?php if ( empty( $active_fields ) ) : ?>
									<p class="fb-submissions-page__muted"><?php esc_html_e( 'This submission payload does not contain structured form fields.', 'framebuilder' ); ?></p>
								<?php else : ?>
									<table class="fb-submissions-page__fields-table">
										<thead>
											<tr>
												<th><?php esc_html_e( 'Field Name', 'framebuilder' ); ?></th>
												<th><?php esc_html_e( 'Type', 'framebuilder' ); ?></th>
												<th><?php esc_html_e( 'Value', 'framebuilder' ); ?></th>
											</tr>
										</thead>
										<tbody>
											<?php foreach ( $active_fields as $field ) : ?>
												<tr>
													<td><?php echo esc_html( (string) ( $field['name'] ?? $field['label'] ?? 'field' ) ); ?></td>
													<td><?php echo esc_html( (string) ( $field['type'] ?? '—' ) ); ?></td>
													<td><?php echo esc_html( self::format_submission_admin_value( $field['value'] ?? '' ) ); ?></td>
												</tr>
											<?php endforeach; ?>
										</tbody>
									</table>
								<?php endif; ?>
							</div>
						</div>

						<div class="fb-submissions-page__detail-sidebar">
							<div class="fb-submissions-page__detail-meta">
								<strong><?php esc_html_e( 'Submission Meta', 'framebuilder' ); ?></strong>
								<dl class="fb-submissions-page__meta-list">
									<dt><?php esc_html_e( 'Submission', 'framebuilder' ); ?></dt>
									<dd><code><?php echo esc_html( (string) ( $active_payload['id'] ?? '' ) ); ?></code></dd>
									<dt><?php esc_html_e( 'Date', 'framebuilder' ); ?></dt>
									<dd><?php echo esc_html( self::format_submission_datetime( $active_submitted_at ) ); ?></dd>
									<dt><?php esc_html_e( 'Page', 'framebuilder' ); ?></dt>
									<dd><?php echo esc_html( (string) ( $active_submission['postTitle'] ?? __( 'Untitled', 'framebuilder' ) ) ); ?> <code>#<?php echo esc_html( (string) absint( $active_submission['postId'] ?? 0 ) ); ?></code></dd>
									<dt><?php esc_html_e( 'Form', 'framebuilder' ); ?></dt>
									<dd><code><?php echo esc_html( (string) ( $active_submission['formId'] ?? '' ) ); ?></code></dd>
									<dt><?php esc_html_e( 'Builder', 'framebuilder' ); ?></dt>
									<dd><a href="<?php echo esc_url( admin_url( 'admin.php?page=framebuilder&post_id=' . absint( $active_submission['postId'] ?? 0 ) ) ); ?>"><?php esc_html_e( 'Open Builder', 'framebuilder' ); ?></a></dd>
									<?php if ( ! empty( $active_source['url'] ) ) : ?>
										<dt><?php esc_html_e( 'Source URL', 'framebuilder' ); ?></dt>
										<dd><a href="<?php echo esc_url( (string) $active_source['url'] ); ?>" target="_blank" rel="noreferrer"><?php echo esc_html( (string) $active_source['url'] ); ?></a></dd>
									<?php endif; ?>
								</dl>
							</div>

							<div class="fb-submissions-page__json">
								<strong><?php esc_html_e( 'Raw JSON Payload', 'framebuilder' ); ?></strong>
								<pre><?php echo esc_html( is_string( $active_json ) ? $active_json : '{}' ); ?></pre>
							</div>
						</div>
					</div>
				</section>
			<?php endif; ?>

			<?php if ( ! $active_submission ) : ?>
				<?php if ( empty( $items ) ) : ?>
					<div class="fb-submissions-page__empty">
						<h3><?php esc_html_e( 'No submissions matched the current filters.', 'framebuilder' ); ?></h3>
						<p class="fb-submissions-page__muted"><?php esc_html_e( 'No submissions have been stored yet.', 'framebuilder' ); ?></p>
					</div>
				<?php else : ?>
					<table class="fb-submissions-page__table">
						<thead>
							<tr>
								<th><?php esc_html_e( 'Submission', 'framebuilder' ); ?></th>
								<th><?php esc_html_e( 'Page / Form', 'framebuilder' ); ?></th>
								<th><?php esc_html_e( 'Date', 'framebuilder' ); ?></th>
								<th><?php esc_html_e( 'Actions', 'framebuilder' ); ?></th>
							</tr>
						</thead>
						<tbody>
							<?php foreach ( $items as $item ) : ?>
								<?php
								$submission = is_array( $item['submission'] ?? null ) ? $item['submission'] : [];
								$submitted_at = is_string( $submission['submittedAt'] ?? null ) ? $submission['submittedAt'] : (string) ( $item['submittedAt'] ?? '' );
								$submitted_at_label = self::format_submission_datetime( $submitted_at );
								$post_title = (string) ( $item['postTitle'] ?? '' );
								$form_id_value = (string) ( $item['formId'] ?? '' );
								$delete_item_url = wp_nonce_url( self::build_submissions_page_url([
									'submission_id' => absint( $item['metaId'] ?? 0 ),
									'action' => 'delete',
									'post_id' => $post_id ?: null,
									'form_id' => '' !== $form_id ? $form_id : null,
									's' => '' !== $search ? $search : null,
									'paged' => $page,
								]), 'fb_delete_submission_' . absint( $item['metaId'] ?? 0 ) );
								?>
								<tr>
									<td>
										<a class="fb-submissions-page__summary-link" href="<?php echo esc_url( self::build_submissions_page_url([
											'submission_id' => absint( $item['metaId'] ?? 0 ),
											'paged' => $page,
										]) ); ?>"><?php echo esc_html( (string) ( $submission['id'] ?? __( 'View submission', 'framebuilder' ) ) ); ?></a>
									</td>
									<td>
										<strong><?php echo esc_html( '' !== $post_title ? $post_title : __( 'Untitled', 'framebuilder' ) ); ?></strong>
										<span class="fb-submissions-page__muted"> · <?php esc_html_e( 'Form', 'framebuilder' ); ?> <code><?php echo esc_html( $form_id_value ); ?></code></span>
									</td>
									<td>
										<?php echo esc_html( $submitted_at_label ); ?>
									</td>
									<td>
										<div class="fb-submissions-page__table-actions">
											<a class="button button-small" href="<?php echo esc_url( self::build_submissions_page_url([
												'submission_id' => absint( $item['metaId'] ?? 0 ),
												'paged' => $page,
											]) ); ?>"><?php esc_html_e( 'View', 'framebuilder' ); ?></a>
											<a class="button button-small" href="<?php echo esc_url( $delete_item_url ); ?>" onclick="return window.confirm('<?php echo esc_js( __( 'Delete this submission permanently?', 'framebuilder' ) ); ?>');"><?php esc_html_e( 'Delete', 'framebuilder' ); ?></a>
										</div>
									</td>
								</tr>
							<?php endforeach; ?>
						</tbody>
					</table>

					<?php if ( $total_pages > 1 ) : ?>
						<div class="tablenav fb-submissions-page__pagination"><div class="tablenav-pages">
							<?php
							echo wp_kses_post(
								paginate_links([
									'base' => esc_url_raw( self::build_submissions_page_url([
										'paged' => '%#%',
									]) ),
									'format' => '',
									'current' => $page,
									'total' => $total_pages,
									'prev_text' => '&laquo;',
									'next_text' => '&raquo;',
								])
							);
							?>
						</div></div>
					<?php endif; ?>
				<?php endif; ?>
			<?php endif; ?>
				</div>
			</div>
		</div>
		<?php
	}

	/**
	 * Render the isolated media picker page (loaded in an iframe from the builder).
	 * wp.media() runs here in its own WP admin context — no conflicts with builder scripts.
	 * On selection it posts the image URL back to the builder via postMessage.
	 */
	public static function render_media_picker() {
		$media_type = isset( $_GET['type'] ) && 'video' === sanitize_key( $_GET['type'] ) ? 'video' : 'image';
		$title = 'video' === $media_type ? __( 'Select Video', 'framebuilder' ) : __( 'Select Image', 'framebuilder' );
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
				title:    <?php echo wp_json_encode( $title ); ?>,
				multiple: false,
				library:  { type: <?php echo wp_json_encode( $media_type ); ?> },
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

		self::cleanup_builder_admin_screen();
		self::dequeue_builder_admin_scripts();

		wp_deregister_script( 'svg-painter' );
		wp_deregister_script( 'heartbeat' );
		wp_deregister_script( 'wp-auth-check' );
		wp_dequeue_script( 'svg-painter' );
		wp_dequeue_script( 'heartbeat' );
		wp_dequeue_script( 'wp-auth-check' );

		// Hide default WP admin chrome when builder is open
		echo '<style>#wpcontent,#wpbody{padding:0!important;margin:0!important;}
		      #adminmenuwrap,#adminmenuback,#wpadminbar,#screen-meta-links,#screen-meta,.notice,.update-nag,#wp-auth-check-wrap,.screen-reader-shortcut{display:none!important;}
		      body.wp-admin .hidden{display:none!important;}
		      body{overflow:hidden!important;}</style>';

		$assets_dir = FB_DIR . 'assets/';
		$assets_url = FB_URL . 'assets/';
		$builder_css_version = self::asset_version( $assets_dir . 'builder.css' );
		$builder_js_version = self::asset_version( $assets_dir . 'builder.js' );

		if ( file_exists( $assets_dir . 'builder.css' ) ) {
			wp_enqueue_style( 'framebuilder', $assets_url . 'builder.css', [], $builder_css_version );
		}

		if ( file_exists( $assets_dir . 'builder.js' ) ) {
			wp_enqueue_script( 'framebuilder', $assets_url . 'builder.js', [], $builder_js_version, true );
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
			'currentUser' => [
				'displayName' => wp_get_current_user()->display_name,
				'avatarUrl'   => get_avatar_url( get_current_user_id(), [ 'size' => 96 ] ),
			],
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

	private static function cleanup_builder_admin_screen(): void {
		if ( ! self::is_builder_screen() ) {
			return;
		}

		remove_action( 'admin_print_footer_scripts', 'wp_auth_check_html', 5 );
		remove_action( 'admin_footer', 'wp_auth_check_html', 5 );
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

	private static function get_frontend_render_assets( int $post_id ): ?array {
		if ( $post_id <= 0 ) {
			return null;
		}

		if ( isset( self::$frontend_render_cache[ $post_id ] ) ) {
			return self::$frontend_render_cache[ $post_id ];
		}

		$layout_raw = get_post_meta( $post_id, '_fb_layout', true );
		if ( is_string( $layout_raw ) && '' !== trim( $layout_raw ) ) {
			$layout = json_decode( $layout_raw, true );
			if ( ! is_array( $layout ) ) {
				$layout = json_decode( wp_unslash( $layout_raw ), true );
			}
			if ( is_array( $layout ) ) {
				$exporter = new FrameBuilder_Exporter( $layout, $post_id );
				self::$frontend_render_cache[ $post_id ] = [
					'html' => self::normalize_frontend_render_html( $exporter->generate_html() ),
					'css'  => self::normalize_frontend_google_font_imports( $exporter->generate_css() ),
				];
				return self::$frontend_render_cache[ $post_id ];
			}
		}

		$html = get_post_meta( $post_id, '_fb_published_html', true );
		$css  = get_post_meta( $post_id, '_fb_published_css', true );
		if ( ! is_string( $html ) || '' === trim( $html ) ) {
			return null;
		}

		self::$frontend_render_cache[ $post_id ] = [
			'html' => self::normalize_frontend_render_html( $html ),
			'css'  => is_string( $css ) ? self::normalize_frontend_google_font_imports( $css ) : '',
		];
		return self::$frontend_render_cache[ $post_id ];
	}

	public static function enqueue_frontend() {
		if ( ! is_singular() ) return;
		global $post;
		$assets = self::get_frontend_render_assets( (int) $post->ID );
		$css = is_array( $assets ) ? ( $assets['css'] ?? '' ) : '';
		$html = is_array( $assets ) ? ( $assets['html'] ?? '' ) : '';
		if ( ! is_string( $css ) || '' === trim( $css ) ) return;
		$css = self::build_safe_google_font_imports( (string) $html, $css ) . $css;
		$css .= '.fb-form-choice__input:focus + .fb-form-choice__control,.fb-form-choice__input:focus-visible + .fb-form-choice__control{border-color:#2563eb !important;background:#ffffff !important;box-shadow:0 1px 2px rgba(15,23,42,0.06),0 0 0 3px rgba(37,99,235,0.2) !important;}';
		$css .= '.fb-form-choice__input:checked + .fb-form-choice__control{border-color:#2563eb !important;background:#eff6ff !important;box-shadow:0 1px 2px rgba(15,23,42,0.06) !important;}';
		$css .= '.fb-form-choice__input:checked + .fb-form-choice__control .fb-form-choice__mark{opacity:1 !important;}';

		$assets_url = FB_URL . 'assets/';
		$assets_dir = FB_DIR . 'assets/';
		$gsap_version = self::asset_version( $assets_dir . 'gsap.min.js' );
		$flip_version = self::asset_version( $assets_dir . 'Flip.min.js' );
		$scroll_trigger_version = self::asset_version( $assets_dir . 'ScrollTrigger.min.js' );
		if ( file_exists( $assets_dir . 'gsap.min.js' ) ) {
			wp_enqueue_script( 'framebuilder-gsap', $assets_url . 'gsap.min.js', [], $gsap_version, false );
		}
		if ( file_exists( $assets_dir . 'Flip.min.js' ) ) {
			wp_enqueue_script( 'framebuilder-gsap-flip', $assets_url . 'Flip.min.js', [ 'framebuilder-gsap' ], $flip_version, false );
		}
		if ( file_exists( $assets_dir . 'ScrollTrigger.min.js' ) ) {
			wp_enqueue_script( 'framebuilder-gsap-scrolltrigger', $assets_url . 'ScrollTrigger.min.js', [ 'framebuilder-gsap' ], $scroll_trigger_version, false );
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
		if ( ! $post_id || ! self::get_frontend_render_assets( (int) $post_id ) ) return;
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
		$assets = self::get_frontend_render_assets( (int) $post->ID );
		if ( is_array( $assets ) && ! empty( $assets['html'] ) ) {
			return $assets['html'];
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
		$assets = self::get_frontend_render_assets( (int) $post->ID );
		if ( ! is_array( $assets ) || empty( $assets['html'] ) ) {
			return $template;
		}
		$canvas = FB_DIR . 'templates/canvas.php';
		if ( file_exists( $canvas ) ) {
			return $canvas;
		}
		return $template;
	}
}
