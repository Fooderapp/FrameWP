<?php
defined( 'ABSPATH' ) || exit;

/**
 * Converts FrameBuilder JSON layout into static HTML + CSS.
 *
 * Data model (new flat model):
 *   page.elements[]  — flat array, each element has:
 *     - base: { x, y, width, height, rotation, locked, hidden, name, styles{} }
 *     - overrides: { tablet: {styles?:{},x?,y?,...}, mobile: {...} }
 *     - parentId: null | string
 *     - children: string[]
 *   page.background: { desktop, tablet, mobile }
 *
 * Three breakpoint containers are rendered; CSS media queries show the right one.
 *
 * RESPONSIVENESS MODEL:
 *   - Each bp container is width:100%, min-height set from design height (px).
 *   - Elements use % for left/top/width/height relative to their containing context.
 *   - Elements use absolute px positioning — no transform:scale, no % scaling.
 */
class FrameBuilder_Exporter {

	private array  $layout;
	private array  $css      = [];
	private string $build_id;
	private int    $post_id  = 0;
	/** @var array<string, array> id → element map */
	private array  $el_index = [];

	/** @var array<string,array> Cascaded page padding per breakpoint */
	private array  $page_padding = [];

	/** @var array<string,array|null> Cascaded page layout (flex) per breakpoint; null = off */
	private array  $page_layout = [];
	/** @var array<string,array> Component library indexed by component ID */
	private array $component_library = [];
	/** @var array<int,array> Page-scoped variable definitions */
	private array $page_variables = [];
	/** @var array<int,array> Global variable definitions */
	private array $global_variables = [];
	/** @var array<int,array> Page-scoped interaction flows */
	private array $page_flows = [];
	/** @var array<string,array<string,bool>> Google Fonts requested by family and variant */
	private array $google_fonts = [];
	/** @var array<string,bool> Cascaded smooth-scroll setting per breakpoint */
	private array $page_smooth_scroll = [ 'desktop' => false, 'tablet' => false, 'mobile' => false ];

	/** @var array<string,float|null> Per-breakpoint viewport fold height (null = auto-compute) */
	private array $viewport_fold_h = [ 'desktop' => null, 'tablet' => null, 'mobile' => null ];

	private function is_submission_generated_post( WP_Post $post ): bool {
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

	private function normalize_media_url( $value ): string {
		if ( is_array( $value ) ) {
			if ( isset( $value['url'] ) && is_string( $value['url'] ) ) {
				return trim( $value['url'] );
			}
			return '';
		}
		if ( is_string( $value ) ) {
			return trim( $value );
		}
		return '';
	}

	private function normalize_link_url_value( $value ): string {
		if ( is_array( $value ) ) {
			if ( isset( $value['url'] ) && is_string( $value['url'] ) ) {
				return trim( $value['url'] );
			}
			return '';
		}
		if ( is_string( $value ) ) {
			return trim( $value );
		}
		if ( is_scalar( $value ) ) {
			return trim( (string) $value );
		}
		return '';
	}

	private function sanitize_navigation_url( string $value ): string {
		$value = trim( $value );
		if ( '' === $value ) return '';
		if ( 0 === strpos( $value, '//' ) ) return '';
		return wp_kses_bad_protocol( $value, [ 'http', 'https', 'mailto', 'tel' ] );
	}

	private function normalize_video_provider( $value ): string {
		return in_array( $value, [ 'youtube', 'vimeo', 'upload' ], true ) ? $value : 'upload';
	}

	private function normalize_embed_mode( $value ): string {
		return in_array( $value, [ 'html', 'shortcode', 'php', 'react' ], true ) ? $value : 'html';
	}

	private function normalize_scroll_sequence_type( $value ): string {
		return in_array( $value, [ 'video', 'image-sequence', 'gif' ], true ) ? $value : 'video';
	}

	private function normalize_scroll_sequence_source_mode( $value ): string {
		return 'url' === $value ? 'url' : 'library';
	}

	private function normalize_scroll_sequence_frames( $value ): array {
		if ( ! is_array( $value ) ) return [];
		$frames = [];
		foreach ( $value as $entry ) {
			$url = $this->normalize_media_url( $entry );
			if ( '' !== $url ) $frames[] = $url;
		}
		return $frames;
	}

	private function build_loop_item_excerpt( WP_Post $post ): string {
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

	private function get_constraint_axis_mode( array $constraints, string $axis ): string {
		if ( 'horizontal' === $axis ) {
			if ( isset( $constraints['horizontal'] ) && is_string( $constraints['horizontal'] ) ) {
				return $constraints['horizontal'];
			}
			$left = ! empty( $constraints['left'] );
			$right = ! empty( $constraints['right'] );
			if ( $left && $right ) return 'stretch';
			if ( $right && ! $left ) return 'right';
			return 'left';
		}

		if ( isset( $constraints['vertical'] ) && is_string( $constraints['vertical'] ) ) {
			return $constraints['vertical'];
		}
		$top = ! empty( $constraints['top'] );
		$bottom = ! empty( $constraints['bottom'] );
		if ( $top && $bottom ) return 'stretch';
		if ( $bottom && ! $top ) return 'bottom';
		return 'top';
	}

	private function get_scroll_sequence_config( array $resolved, array $styles ): ?array {
		$type = $this->normalize_scroll_sequence_type( $resolved['scrollSequenceType'] ?? 'video' );
		$source_mode = $this->normalize_scroll_sequence_source_mode( $resolved['scrollSequenceSourceMode'] ?? 'library' );
		$src = $this->normalize_media_url( $resolved['scrollSequenceSrc'] ?? '' );
		$frames = $this->normalize_scroll_sequence_frames( $resolved['scrollSequenceFrames'] ?? [] );
		if ( 'image-sequence' === $type && empty( $frames ) ) return null;
		if ( 'image-sequence' !== $type && '' === $src ) return null;
		return [
			'type' => $type,
			'sourceMode' => $source_mode,
			'src' => $src,
			'frames' => $frames,
			'objectFit' => 'contain' === ( $styles['objectFit'] ?? 'cover' ) ? 'contain' : 'cover',
			'start' => isset( $resolved['scrollSequenceStart'] ) ? max( 0, min( 1, (float) $resolved['scrollSequenceStart'] ) ) : 0.2,
			'end' => isset( $resolved['scrollSequenceEnd'] ) ? max( 0, min( 1, (float) $resolved['scrollSequenceEnd'] ) ) : 0.68,
			'startOffsetPx' => isset( $resolved['scrollSequenceStartOffsetPx'] ) && is_numeric( $resolved['scrollSequenceStartOffsetPx'] ) ? (float) $resolved['scrollSequenceStartOffsetPx'] : null,
			'endOffsetPx' => isset( $resolved['scrollSequenceEndOffsetPx'] ) && is_numeric( $resolved['scrollSequenceEndOffsetPx'] ) ? (float) $resolved['scrollSequenceEndOffsetPx'] : null,
		];
	}

	private function extract_youtube_video_id( string $value ): string {
		$value = trim( $value );
		if ( preg_match( '/^[A-Za-z0-9_-]{11}$/', $value ) ) return $value;
		if ( ! preg_match( '/^[a-z]+:/i', $value ) && preg_match( '/^(www\.|[\w-]+\.[a-z]{2,})/i', $value ) ) {
			$value = 'https://' . $value;
		}
		$parts = wp_parse_url( $value );
		if ( ! is_array( $parts ) ) return '';
		$host = strtolower( preg_replace( '/^www\./i', '', (string) ( $parts['host'] ?? '' ) ) );
		$path = trim( (string) ( $parts['path'] ?? '' ), '/' );
		if ( 'youtu.be' === $host ) {
			$id = explode( '/', $path )[0] ?? '';
			return preg_match( '/^[A-Za-z0-9_-]{11}$/', $id ) ? $id : '';
		}
		if ( false === strpos( $host, 'youtube.com' ) && false === strpos( $host, 'youtube-nocookie.com' ) ) return '';
		parse_str( (string) ( $parts['query'] ?? '' ), $query_args );
		if ( '/watch' === ( '/' . $path ) ) {
			$id = $query_args['v'] ?? '';
			return preg_match( '/^[A-Za-z0-9_-]{11}$/', $id ) ? $id : '';
		}
		$segments = array_values( array_filter( explode( '/', $path ) ) );
		foreach ( [ 'embed', 'shorts', 'live', 'v' ] as $marker ) {
			$index = array_search( $marker, $segments, true );
			if ( false !== $index && isset( $segments[ $index + 1 ] ) && preg_match( '/^[A-Za-z0-9_-]{11}$/', $segments[ $index + 1 ] ) ) {
				return $segments[ $index + 1 ];
			}
		}
		return '';
	}

	private function extract_vimeo_video_id( string $value ): string {
		$value = trim( $value );
		if ( preg_match( '/^\d+$/', $value ) ) return $value;
		if ( ! preg_match( '/^[a-z]+:/i', $value ) && preg_match( '/^(www\.|[\w-]+\.[a-z]{2,})/i', $value ) ) {
			$value = 'https://' . $value;
		}
		$parts = wp_parse_url( $value );
		if ( ! is_array( $parts ) ) return '';
		$host = strtolower( preg_replace( '/^www\./i', '', (string) ( $parts['host'] ?? '' ) ) );
		if ( false === strpos( $host, 'vimeo.com' ) ) return '';
		$segments = array_reverse( array_values( array_filter( explode( '/', trim( (string) ( $parts['path'] ?? '' ), '/' ) ) ) ) );
		foreach ( $segments as $segment ) {
			if ( preg_match( '/^\d+$/', $segment ) ) return $segment;
		}
		return '';
	}

	private function build_video_embed_url( string $provider, string $src, bool $controls, bool $loop, bool $muted, bool $autoplay ): string {
		$provider = $this->normalize_video_provider( $provider );
		if ( 'youtube' === $provider ) {
			$video_id = $this->extract_youtube_video_id( $src );
			if ( '' === $video_id ) return '';
			$query = [
				'controls' => $controls ? '1' : '0',
				'rel' => '0',
				'modestbranding' => '1',
				'playsinline' => '1',
			];
			if ( $loop ) {
				$query['loop'] = '1';
				$query['playlist'] = $video_id;
			}
			if ( $muted ) $query['mute'] = '1';
			if ( $autoplay ) $query['autoplay'] = '1';
			return 'https://www.youtube.com/embed/' . rawurlencode( $video_id ) . '?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 );
		}
		if ( 'vimeo' === $provider ) {
			$video_id = $this->extract_vimeo_video_id( $src );
			if ( '' === $video_id ) return '';
			$query = [
				'controls' => $controls ? '1' : '0',
				'title' => '0',
				'byline' => '0',
				'portrait' => '0',
				'dnt' => '1',
			];
			if ( $loop ) $query['loop'] = '1';
			if ( $muted ) $query['muted'] = '1';
			if ( $autoplay ) $query['autoplay'] = '1';
			return 'https://player.vimeo.com/video/' . rawurlencode( $video_id ) . '?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 );
		}
		return '';
	}

	private function build_video_embed_layout_styles( float $width, float $height, string $mode = 'cover' ): array {
		$safe_width = max( 1, $width );
		$safe_height = max( 1, $height );
		$aspect_ratio = 16 / 9;
		$container_ratio = $safe_width / $safe_height;
		$normalized_mode = 'contain' === $mode ? 'contain' : 'cover';
		$size_by_height = 'contain' === $normalized_mode
			? $container_ratio > $aspect_ratio
			: $container_ratio < $aspect_ratio;

		$render_width = $size_by_height ? ( $safe_height * $aspect_ratio ) : $safe_width;
		$render_height = $size_by_height ? $safe_height : ( $safe_width / $aspect_ratio );

		return [
			'wrapper' => 'position:absolute;inset:0;overflow:hidden;border-radius:inherit;background:#000;',
			'frame' => 'position:absolute;left:50%;top:50%;width:' . round( $render_width, 3 ) . 'px;height:' . round( $render_height, 3 ) . 'px;transform:translate(-50%, -50%);border:0;background:#000;',
		];
	}

	private function sanitize_svg_markup( $markup ): string {
		if ( ! is_string( $markup ) || trim( $markup ) === '' ) return '';

		$allowed = [
			'svg' => [
				'viewbox' => true,
				'fill' => true,
				'stroke' => true,
				'stroke-width' => true,
				'paint-order' => true,
				'stroke-linecap' => true,
				'stroke-linejoin' => true,
				'stroke-miterlimit' => true,
				'width' => true,
				'height' => true,
				'xmlns' => true,
				'xmlns:xlink' => true,
				'preserveaspectratio' => true,
				'role' => true,
				'aria-hidden' => true,
				'focusable' => true,
				'opacity' => true,
				'fill-opacity' => true,
				'stroke-opacity' => true,
				'transform' => true,
			],
			'g' => [
				'fill' => true, 'stroke' => true, 'stroke-width' => true, 'paint-order' => true, 'stroke-linecap' => true, 'stroke-linejoin' => true,
				'opacity' => true, 'fill-opacity' => true, 'stroke-opacity' => true, 'transform' => true, 'clip-path' => true, 'mask' => true,
			],
			'path' => [
				'd' => true, 'fill' => true, 'stroke' => true, 'stroke-width' => true, 'paint-order' => true, 'stroke-linecap' => true, 'stroke-linejoin' => true,
				'stroke-miterlimit' => true, 'opacity' => true, 'fill-opacity' => true, 'stroke-opacity' => true, 'transform' => true, 'clip-rule' => true,
			],
			'circle' => [ 'cx' => true, 'cy' => true, 'r' => true, 'fill' => true, 'stroke' => true, 'stroke-width' => true, 'paint-order' => true, 'opacity' => true, 'fill-opacity' => true, 'stroke-opacity' => true, 'transform' => true ],
			'rect' => [ 'x' => true, 'y' => true, 'width' => true, 'height' => true, 'rx' => true, 'ry' => true, 'fill' => true, 'stroke' => true, 'stroke-width' => true, 'paint-order' => true, 'opacity' => true, 'fill-opacity' => true, 'stroke-opacity' => true, 'transform' => true ],
			'line' => [ 'x1' => true, 'y1' => true, 'x2' => true, 'y2' => true, 'stroke' => true, 'stroke-width' => true, 'paint-order' => true, 'stroke-linecap' => true, 'opacity' => true, 'stroke-opacity' => true, 'transform' => true ],
			'polyline' => [ 'points' => true, 'fill' => true, 'stroke' => true, 'stroke-width' => true, 'paint-order' => true, 'stroke-linecap' => true, 'stroke-linejoin' => true, 'opacity' => true, 'fill-opacity' => true, 'stroke-opacity' => true, 'transform' => true ],
			'polygon' => [ 'points' => true, 'fill' => true, 'stroke' => true, 'stroke-width' => true, 'paint-order' => true, 'stroke-linecap' => true, 'stroke-linejoin' => true, 'opacity' => true, 'fill-opacity' => true, 'stroke-opacity' => true, 'transform' => true ],
			'ellipse' => [ 'cx' => true, 'cy' => true, 'rx' => true, 'ry' => true, 'fill' => true, 'stroke' => true, 'stroke-width' => true, 'paint-order' => true, 'opacity' => true, 'fill-opacity' => true, 'stroke-opacity' => true, 'transform' => true ],
			'defs' => [],
			'lineargradient' => [ 'id' => true, 'x1' => true, 'y1' => true, 'x2' => true, 'y2' => true, 'gradientunits' => true, 'gradienttransform' => true ],
			'radialgradient' => [ 'id' => true, 'cx' => true, 'cy' => true, 'r' => true, 'fx' => true, 'fy' => true, 'gradientunits' => true, 'gradienttransform' => true ],
			'stop' => [ 'offset' => true, 'stop-color' => true, 'stop-opacity' => true ],
			'clippath' => [ 'id' => true ],
			'mask' => [ 'id' => true, 'maskunits' => true, 'maskcontentunits' => true ],
			'symbol' => [ 'id' => true, 'viewbox' => true, 'preserveaspectratio' => true ],
			'use' => [ 'href' => true, 'xlink:href' => true, 'x' => true, 'y' => true, 'width' => true, 'height' => true ],
			'title' => [],
			'desc' => [],
		];

		$clean = wp_kses( $markup, $allowed );
		$clean = preg_replace( '/\son[a-z-]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $clean );
		$clean = preg_replace( '/\s(?:href|xlink:href)\s*=\s*("|\')\s*javascript:[^\1]*\1/i', '', $clean );
		if ( ! is_string( $clean ) || trim( $clean ) === '' ) return '';
		return preg_replace( '/<svg\b/i', '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet"', $clean, 1 ) ?? '';
	}

	private function sanitize_embed_html( $markup ): string {
		if ( ! is_string( $markup ) || trim( $markup ) === '' ) return '';

		$allowed = [
			'a' => [ 'href' => true, 'target' => true, 'rel' => true, 'class' => true, 'id' => true, 'title' => true, 'style' => true ],
			'article' => [ 'class' => true, 'id' => true, 'title' => true, 'style' => true ],
			'aside' => [ 'class' => true, 'id' => true, 'title' => true, 'style' => true ],
			'audio' => [ 'src' => true, 'controls' => true, 'autoplay' => true, 'loop' => true, 'muted' => true, 'preload' => true, 'class' => true, 'style' => true ],
			'b' => [ 'class' => true, 'style' => true ],
			'blockquote' => [ 'class' => true, 'style' => true ],
			'br' => [],
			'button' => [ 'type' => true, 'name' => true, 'value' => true, 'class' => true, 'style' => true ],
			'canvas' => [ 'width' => true, 'height' => true, 'class' => true, 'style' => true ],
			'caption' => [ 'class' => true, 'style' => true ],
			'code' => [ 'class' => true, 'style' => true ],
			'col' => [ 'span' => true, 'width' => true, 'style' => true ],
			'colgroup' => [ 'span' => true, 'style' => true ],
			'dd' => [ 'class' => true, 'style' => true ],
			'details' => [ 'open' => true, 'class' => true, 'style' => true ],
			'div' => [ 'class' => true, 'id' => true, 'title' => true, 'style' => true ],
			'dl' => [ 'class' => true, 'style' => true ],
			'dt' => [ 'class' => true, 'style' => true ],
			'em' => [ 'class' => true, 'style' => true ],
			'figcaption' => [ 'class' => true, 'style' => true ],
			'figure' => [ 'class' => true, 'style' => true ],
			'footer' => [ 'class' => true, 'style' => true ],
			'form' => [ 'action' => true, 'method' => true, 'target' => true, 'class' => true, 'style' => true ],
			'h1' => [ 'class' => true, 'style' => true ],
			'h2' => [ 'class' => true, 'style' => true ],
			'h3' => [ 'class' => true, 'style' => true ],
			'h4' => [ 'class' => true, 'style' => true ],
			'h5' => [ 'class' => true, 'style' => true ],
			'h6' => [ 'class' => true, 'style' => true ],
			'header' => [ 'class' => true, 'style' => true ],
			'hr' => [ 'class' => true, 'style' => true ],
			'i' => [ 'class' => true, 'style' => true ],
			'iframe' => [ 'src' => true, 'loading' => true, 'allow' => true, 'allowfullscreen' => true, 'referrerpolicy' => true, 'sandbox' => true, 'frameborder' => true, 'width' => true, 'height' => true, 'class' => true, 'style' => true ],
			'img' => [ 'src' => true, 'alt' => true, 'loading' => true, 'decoding' => true, 'srcset' => true, 'sizes' => true, 'width' => true, 'height' => true, 'class' => true, 'style' => true ],
			'input' => [ 'type' => true, 'name' => true, 'value' => true, 'placeholder' => true, 'checked' => true, 'disabled' => true, 'readonly' => true, 'min' => true, 'max' => true, 'step' => true, 'class' => true, 'style' => true ],
			'label' => [ 'for' => true, 'class' => true, 'style' => true ],
			'li' => [ 'class' => true, 'style' => true ],
			'main' => [ 'class' => true, 'style' => true ],
			'nav' => [ 'class' => true, 'style' => true ],
			'ol' => [ 'class' => true, 'style' => true ],
			'option' => [ 'value' => true, 'selected' => true, 'class' => true, 'style' => true ],
			'p' => [ 'class' => true, 'style' => true ],
			'picture' => [ 'class' => true, 'style' => true ],
			'pre' => [ 'class' => true, 'style' => true ],
			'section' => [ 'class' => true, 'style' => true ],
			'select' => [ 'name' => true, 'multiple' => true, 'disabled' => true, 'class' => true, 'style' => true ],
			'small' => [ 'class' => true, 'style' => true ],
			'source' => [ 'src' => true, 'srcset' => true, 'type' => true, 'media' => true ],
			'span' => [ 'class' => true, 'id' => true, 'title' => true, 'style' => true ],
			'strong' => [ 'class' => true, 'style' => true ],
			'style' => [ 'type' => true ],
			'sub' => [ 'class' => true, 'style' => true ],
			'summary' => [ 'class' => true, 'style' => true ],
			'sup' => [ 'class' => true, 'style' => true ],
			'table' => [ 'class' => true, 'style' => true ],
			'tbody' => [ 'class' => true, 'style' => true ],
			'td' => [ 'colspan' => true, 'rowspan' => true, 'class' => true, 'style' => true ],
			'textarea' => [ 'name' => true, 'placeholder' => true, 'rows' => true, 'cols' => true, 'readonly' => true, 'disabled' => true, 'class' => true, 'style' => true ],
			'tfoot' => [ 'class' => true, 'style' => true ],
			'th' => [ 'colspan' => true, 'rowspan' => true, 'scope' => true, 'class' => true, 'style' => true ],
			'thead' => [ 'class' => true, 'style' => true ],
			'tr' => [ 'class' => true, 'style' => true ],
			'u' => [ 'class' => true, 'style' => true ],
			'ul' => [ 'class' => true, 'style' => true ],
			'video' => [ 'src' => true, 'controls' => true, 'autoplay' => true, 'loop' => true, 'muted' => true, 'playsinline' => true, 'poster' => true, 'preload' => true, 'class' => true, 'style' => true ],
		];

		$clean = wp_kses( $markup, $allowed );
		$clean = preg_replace( '/\son[a-z-]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $clean );
		$clean = preg_replace( '/\s(?:href|src|action)\s*=\s*("|\')\s*javascript:[^\1]*\1/i', '', $clean );
		$clean = preg_replace( '/style\s*=\s*("|\')(?:[^\1]*?(?:expression\s*\(|javascript:|behavior:)[^\1]*)\1/i', '', $clean );
		return is_string( $clean ) ? trim( $clean ) : '';
	}

	private function build_embed_srcdoc( string $markup ): string {
		$clean = $this->sanitize_embed_html( $markup );
		if ( '' === $clean ) return '';
		return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank"><style>html,body{margin:0;padding:0;min-height:100%;}*,*::before,*::after{box-sizing:border-box;}body{font-family:Arial,sans-serif;}</style></head><body>' . $clean . '</body></html>';
	}

	private function plain_text_to_rich_text_html( string $text ): string {
		return nl2br( esc_html( $text ) );
	}

	private function normalize_font_family_name( string $value ): string {
		$entry = trim( explode( ',', $value )[0] ?? '' );
		$entry = trim( $entry, "\"'" );
		$entry = preg_replace( '/\s+/', ' ', $entry ) ?? '';
		return trim( $entry );
	}

	private function register_google_font_variant( string $family, $weight = 400, string $style = 'normal' ): void {
		$normalized_family = $this->normalize_font_family_name( $family );
		if ( '' === $normalized_family ) return;
		$normalized_weight = is_numeric( $weight ) ? (int) round( (float) $weight ) : 400;
		$normalized_weight = max( 100, min( 900, (int) ( round( $normalized_weight / 100 ) * 100 ) ) );
		$normalized_style = 'italic' === strtolower( trim( $style ) ) ? 'italic' : 'normal';
		$variant_key = ( 'italic' === $normalized_style ? '1' : '0' ) . ',' . $normalized_weight;
		if ( ! isset( $this->google_fonts[ $normalized_family ] ) ) {
			$this->google_fonts[ $normalized_family ] = [];
		}
		$this->google_fonts[ $normalized_family ][ $variant_key ] = true;
	}

	private function collect_google_fonts_from_rich_text_html( string $markup, string $fallback_family = 'Inter', int $fallback_weight = 400, string $fallback_style = 'normal' ): void {
		$clean_markup = $this->sanitize_rich_text_html( $markup );
		if ( '' === $clean_markup ) return;
		if ( ! class_exists( 'DOMDocument' ) ) {
			$this->register_google_font_variant( $fallback_family, $fallback_weight, $fallback_style );
			return;
		}

		libxml_use_internal_errors( true );
		$document = new DOMDocument( '1.0', 'UTF-8' );
		$loaded = $document->loadHTML(
			'<?xml encoding="utf-8" ?><div>' . $clean_markup . '</div>',
			LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
		);
		if ( ! $loaded ) {
			libxml_clear_errors();
			$this->register_google_font_variant( $fallback_family, $fallback_weight, $fallback_style );
			return;
		}

		$nodes = $document->getElementsByTagName( '*' );
		$registered = false;
		foreach ( $nodes as $node ) {
			if ( ! $node instanceof DOMElement || ! $node->hasAttribute( 'style' ) ) continue;
			$style_attribute = $node->getAttribute( 'style' );
			$entries = preg_split( '/;/', $style_attribute ) ?: [];
			$font_family = $fallback_family;
			$font_weight = $fallback_weight;
			$font_style = $fallback_style;
			foreach ( $entries as $entry ) {
				$parts = explode( ':', $entry, 2 );
				if ( 2 !== count( $parts ) ) continue;
				$key = strtolower( trim( $parts[0] ) );
				$value = trim( $parts[1] );
				if ( 'font-family' === $key && '' !== $value ) $font_family = $this->normalize_font_family_name( $value ) ?: $fallback_family;
				if ( 'font-weight' === $key && is_numeric( $value ) ) $font_weight = (int) $value;
				if ( 'font-style' === $key ) $font_style = strtolower( $value );
			}
			$this->register_google_font_variant( $font_family, $font_weight, $font_style );
			$registered = true;
		}
		if ( ! $registered ) {
			$this->register_google_font_variant( $fallback_family, $fallback_weight, $fallback_style );
		}
		libxml_clear_errors();
	}

	private function collect_google_fonts_from_elements( array $elements, string $bp_id ): void {
		foreach ( $elements as $element ) {
			if ( ! is_array( $element ) ) continue;
			$resolved = $this->resolve_element_with_variables( $element, $bp_id );
			$styles = is_array( $resolved['styles'] ?? null ) ? $resolved['styles'] : [];
			if ( ( $element['type'] ?? '' ) === 'text' ) {
				$font_family = trim( (string) ( $styles['fontFamily'] ?? 'Inter' ) );
				$font_weight = $styles['fontWeight'] ?? 400;
				$font_style = (string) ( $styles['fontStyle'] ?? 'normal' );
				$this->register_google_font_variant( $font_family, $font_weight, $font_style );
				$this->collect_google_fonts_from_rich_text_html( (string) ( $resolved['richTextHtml'] ?? '' ), $font_family, (int) $font_weight, $font_style );
			}
			if ( $this->is_form_field_type( (string) ( $element['type'] ?? '' ) ) || $this->is_form_submit_button_type( (string) ( $element['type'] ?? '' ) ) ) {
				$font_family = trim( (string) ( $styles['fontFamily'] ?? 'Inter' ) );
				$font_weight = $styles['fontWeight'] ?? ( $this->is_form_submit_button_type( (string) ( $element['type'] ?? '' ) ) ? 600 : 500 );
				$font_style = (string) ( $styles['fontStyle'] ?? 'normal' );
				$this->register_google_font_variant( $font_family, $font_weight, $font_style );
			}
		}
	}

	private function collect_used_google_fonts(): void {
		$this->google_fonts = [];
		$elements = is_array( $this->layout['elements'] ?? null ) ? $this->layout['elements'] : [];
		foreach ( [ 'desktop', 'tablet', 'mobile' ] as $bp_id ) {
			$this->collect_google_fonts_from_elements( $elements, $bp_id );
		}
		foreach ( $this->component_library as $component ) {
			if ( ! is_array( $component ) ) continue;
			foreach ( $component['variants'] ?? [] as $variant ) {
				$variant_elements = is_array( $variant['snapshot'] ?? null ) ? $variant['snapshot'] : [];
				foreach ( [ 'desktop', 'tablet', 'mobile' ] as $bp_id ) {
					$this->collect_google_fonts_from_elements( $variant_elements, $bp_id );
				}
			}
		}
	}

	private function build_google_font_imports_css(): string {
		if ( empty( $this->google_fonts ) ) return '';
		$family_requests = [];
		foreach ( array_keys( $this->google_fonts ) as $family ) {
			$family_requests[] = str_replace( '%20', '+', rawurlencode( $family ) );
		}
		if ( empty( $family_requests ) ) return '';

		$imports = [];
		foreach ( array_chunk( $family_requests, 12 ) as $chunk ) {
			$imports[] = "@import url('https://fonts.googleapis.com/css2?family=" . implode( '&family=', $chunk ) . "&display=swap');";
		}
		return implode( '', $imports );
	}

	private function build_gradient_frame_stroke_overlay_style( array $styles ): string {
		$border_width = isset( $styles['borderWidth'] ) ? max( 0, (float) $styles['borderWidth'] ) : 0;
		$border_color = $styles['borderColor'] ?? '';
		if ( $border_width <= 0 || ! $this->is_gradient_css_value( $border_color ) ) {
			return '';
		}

		return 'position:absolute;inset:0;border-radius:inherit;padding:' . $border_width . 'px;box-sizing:border-box;background:' . $this->sanitize_css_value( $border_color ) . ';-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;user-select:none;';
	}

	private function normalize_filter_percent( $value, float $fallback = 100 ): float {
		if ( ! is_numeric( $value ) ) return $fallback;
		return max( 0, min( 200, (float) $value ) );
	}

	private function build_filter_css_value( array $styles ): string {
		$filters = [];
		$brightness = array_key_exists( 'brightness', $styles ) ? $this->normalize_filter_percent( $styles['brightness'], 100 ) : 100;
		$contrast = array_key_exists( 'contrast', $styles ) ? $this->normalize_filter_percent( $styles['contrast'], 100 ) : 100;
		$saturation = array_key_exists( 'saturation', $styles ) ? $this->normalize_filter_percent( $styles['saturation'], 100 ) : 100;
		$blur = isset( $styles['blur'] ) && is_numeric( $styles['blur'] ) ? max( 0, (float) $styles['blur'] ) : 0;

		if ( abs( $brightness - 100 ) > 0.01 ) $filters[] = 'brightness(' . round( $brightness, 3 ) . '%)';
		if ( abs( $contrast - 100 ) > 0.01 ) $filters[] = 'contrast(' . round( $contrast, 3 ) . '%)';
		if ( abs( $saturation - 100 ) > 0.01 ) $filters[] = 'saturate(' . round( $saturation, 3 ) . '%)';
		if ( $blur > 0.01 ) $filters[] = 'blur(' . round( $blur, 3 ) . 'px)';

		return ! empty( $filters ) ? implode( ' ', $filters ) : 'none';
	}

	private function sanitize_rich_text_style_value( string $style_key, string $style_value ): string {
		$normalized_value = trim( $style_value );
		if ( $normalized_value === '' ) return '';

		if ( 'font-weight' === $style_key ) {
			return preg_match( '/^(normal|bold|bolder|lighter|[1-9]00)$/i', $normalized_value ) ? $normalized_value : '';
		}

		if ( 'font-style' === $style_key ) {
			return preg_match( '/^(normal|italic|oblique)$/i', $normalized_value ) ? $normalized_value : '';
		}

		if ( 'text-decoration' === $style_key ) {
			$decorations = array_values(
				array_filter(
					preg_split( '/\s+/', strtolower( $normalized_value ) ) ?: [],
					static fn( $token ) => in_array( $token, [ 'underline', 'line-through', 'none' ], true )
				)
			);
			return ! empty( $decorations ) ? implode( ' ', $decorations ) : '';
		}

		if ( 'font-size' === $style_key ) {
			if ( ! preg_match( '/^([0-9]+(?:\.[0-9]+)?)\s*(px)?$/i', $normalized_value, $matches ) ) return '';
			$clamped = max( 8, min( 144, (float) $matches[1] ) );
			$rounded = round( $clamped, 1 );
			if ( floor( $rounded ) === $rounded ) {
				return sprintf( '%dpx', (int) $rounded );
			}
			return rtrim( rtrim( sprintf( '%.1f', $rounded ), '0' ), '.' ) . 'px';
		}

		if ( 'color' === $style_key ) {
			if ( preg_match( '/^#[0-9a-f]{3}([0-9a-f]{3})?$/i', $normalized_value ) ) return $normalized_value;
			if ( preg_match( '/^rgba?\(([^)]+)\)$/i', $normalized_value ) ) return $normalized_value;
			if ( preg_match( '/^hsla?\(([^)]+)\)$/i', $normalized_value ) ) return $normalized_value;
			if ( preg_match( '/^[a-z]+$/i', $normalized_value ) ) return $normalized_value;
			return '';
		}

		if ( 'font-family' === $style_key ) {
			$families = array_values(
				array_filter(
					array_map(
						static function( $entry ) {
							$clean = trim( trim( $entry ), "\"'" );
							if ( $clean === '' ) return '';
							if ( ! preg_match( '/^[a-z0-9\s-]+$/i', $clean ) ) return '';
							return preg_match( '/^[a-z-]+$/i', $clean ) ? $clean : sprintf( "'%s'", $clean );
						},
						explode( ',', $normalized_value )
					)
				)
			);
			return ! empty( $families ) ? implode( ', ', $families ) : '';
		}

		return '';
	}

	private function sanitize_rich_text_style_attribute( string $style_value ): string {
		$allowed_style_keys = [ 'font-weight', 'font-style', 'text-decoration', 'font-size', 'color', 'font-family' ];
		$entries = preg_split( '/;/', $style_value ) ?: [];
		$sanitized = [];
		foreach ( $entries as $entry ) {
			$parts = explode( ':', $entry, 2 );
			if ( count( $parts ) !== 2 ) continue;
			$style_key = strtolower( trim( $parts[0] ) );
			if ( ! in_array( $style_key, $allowed_style_keys, true ) ) continue;
			$next_value = $this->sanitize_rich_text_style_value( $style_key, $parts[1] );
			if ( '' === $next_value ) continue;
			$sanitized[] = sprintf( '%s:%s', $style_key, $next_value );
		}
		return implode( '; ', $sanitized );
	}

	private function get_rich_text_inner_html( DOMNode $node ): string {
		$html = '';
		foreach ( $node->childNodes as $child ) {
			$html .= $node->ownerDocument->saveHTML( $child );
		}
		return $html;
	}

	private function sanitize_rich_text_dom_node( DOMNode $node, DOMDocument $document ): void {
		for ( $index = $node->childNodes->length - 1; $index >= 0; $index-- ) {
			$child = $node->childNodes->item( $index );
			if ( ! $child ) continue;
			if ( XML_TEXT_NODE === $child->nodeType ) continue;
			if ( XML_ELEMENT_NODE !== $child->nodeType ) {
				$node->removeChild( $child );
				continue;
			}

			$tag_name = strtolower( $child->nodeName );
			if ( in_array( $tag_name, [ 'div', 'p' ], true ) ) {
				$this->sanitize_rich_text_dom_node( $child, $document );
				$fragment = $document->createDocumentFragment();
				while ( $child->firstChild ) {
					$fragment->appendChild( $child->firstChild );
				}
				$last_child = $fragment->lastChild;
				if ( ! $last_child || strtolower( $last_child->nodeName ) !== 'br' ) {
					$fragment->appendChild( $document->createElement( 'br' ) );
				}
				$node->replaceChild( $fragment, $child );
				continue;
			}

			if ( ! in_array( $tag_name, [ 'br', 'strong', 'b', 'em', 'i', 'u', 'span' ], true ) ) {
				$this->sanitize_rich_text_dom_node( $child, $document );
				$fragment = $document->createDocumentFragment();
				while ( $child->firstChild ) {
					$fragment->appendChild( $child->firstChild );
				}
				$node->replaceChild( $fragment, $child );
				continue;
			}

			if ( $child->hasAttributes() ) {
				$attributes_to_remove = [];
				foreach ( $child->attributes as $attribute ) {
					if ( strtolower( $attribute->nodeName ) !== 'style' ) {
						$attributes_to_remove[] = $attribute->nodeName;
						continue;
					}
					$sanitized_style = $this->sanitize_rich_text_style_attribute( html_entity_decode( $attribute->nodeValue, ENT_QUOTES, 'UTF-8' ) );
					if ( '' === $sanitized_style ) {
						$attributes_to_remove[] = $attribute->nodeName;
						continue;
					}
					$child->setAttribute( 'style', $sanitized_style );
				}
				foreach ( $attributes_to_remove as $attribute_name ) {
					$child->removeAttribute( $attribute_name );
				}
			}

			$this->sanitize_rich_text_dom_node( $child, $document );
		}
	}

	private function sanitize_rich_text_html( $markup ): string {
		if ( ! is_string( $markup ) || trim( $markup ) === '' ) return '';
		if ( ! class_exists( 'DOMDocument' ) ) {
			return trim( wp_kses( $markup, [
				'br' => [],
				'strong' => [ 'style' => true ],
				'b' => [ 'style' => true ],
				'em' => [ 'style' => true ],
				'i' => [ 'style' => true ],
				'u' => [ 'style' => true ],
				'span' => [ 'style' => true ],
			] ) );
		}

		libxml_use_internal_errors( true );
		$document = new DOMDocument( '1.0', 'UTF-8' );
		$loaded = $document->loadHTML(
			'<?xml encoding="utf-8" ?><div>' . $markup . '</div>',
			LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
		);
		if ( ! $loaded ) {
			libxml_clear_errors();
			return '';
		}
		$root = $document->getElementsByTagName( 'div' )->item( 0 );
		if ( ! $root ) {
			libxml_clear_errors();
			return '';
		}

		$this->sanitize_rich_text_dom_node( $root, $document );
		$clean = trim( preg_replace( '/(?:<br>\s*)+$/i', '', $this->get_rich_text_inner_html( $root ) ) ?? '' );
		libxml_clear_errors();
		$clean = preg_replace( '/<(strong|em|u|span|b|i)\b[^>]*>\s*<\/\1>/i', '', $clean );
		return is_string( $clean ) ? trim( $clean ) : '';
	}

	private function get_resolved_rich_text_html( array $resolved ): string {
		$rich_text = $this->sanitize_rich_text_html( $resolved['richTextHtml'] ?? '' );
		if ( $rich_text !== '' ) return $rich_text;
		return $this->plain_text_to_rich_text_html( (string) ( $resolved['text'] ?? 'Text' ) );
	}

	public function __construct( array $layout, int $post_id = 0 ) {
		$this->layout   = $layout;
		$this->build_id = 'fb' . substr( md5( wp_json_encode( $layout ) ), 0, 6 );
		$this->post_id = max( 0, $post_id );
		$this->component_library = $this->load_component_library();
		$this->page_variables = $this->normalize_variable_list( $layout['variables'] ?? [], 'page' );
		$this->page_flows = $this->normalize_flow_list( $layout['flows'] ?? [] );
		$this->global_variables = $this->normalize_variable_list(
			json_decode( get_option( '_fb_global_variables', '[]' ), true ),
			'global'
		);

		// Override default bp_cfg with saved artboard dimensions if present
		$defs = $layout['_breakpointDefs'] ?? null;
		if ( is_array( $defs ) ) {
			foreach ( [ 'desktop', 'tablet', 'mobile' ] as $bpId ) {
				if ( isset( $defs[ $bpId ] ) ) {
					$this->bp_cfg[ $bpId ] = [
						'max_w'     => (float) ( $defs[ $bpId ]['width']  ?? $this->bp_cfg[ $bpId ]['max_w'] ),
						'default_h' => (float) ( $defs[ $bpId ]['height'] ?? $this->bp_cfg[ $bpId ]['default_h'] ),
					];
					// Store viewport fold height for correct fixed-element bottom positioning
					if ( isset( $defs[ $bpId ]['viewportFoldH'] ) && $defs[ $bpId ]['viewportFoldH'] !== null ) {
						$this->viewport_fold_h[ $bpId ] = (float) $defs[ $bpId ]['viewportFoldH'];
					}
				}
			}
		}

		// Build index for O(1) child lookups
		foreach ( $layout['elements'] ?? [] as $el ) {
			if ( isset( $el['id'] ) ) {
				$this->el_index[ $el['id'] ] = $el;
			}
		}

		// Cascade page padding: null = inherit from parent breakpoint
		$zero_pad   = [ 'top' => 0, 'right' => 0, 'bottom' => 0, 'left' => 0 ];
		$raw_pad    = $layout['padding'] ?? [];
		$pad_desk   = is_array( $raw_pad['desktop'] ?? null ) ? $raw_pad['desktop'] : $zero_pad;
		$pad_tablet = is_array( $raw_pad['tablet']  ?? null ) ? $raw_pad['tablet']  : null;
		$pad_mobile = is_array( $raw_pad['mobile']  ?? null ) ? $raw_pad['mobile']  : null;
		$this->page_padding = [
			'desktop' => $pad_desk,
			'tablet'  => $pad_tablet ?? $pad_desk,
			'mobile'  => $pad_mobile ?? $pad_tablet ?? $pad_desk,
		];

		$raw_smooth_scroll = is_array( $layout['smoothScroll'] ?? null ) ? $layout['smoothScroll'] : [];
		$smooth_scroll_desktop = ! empty( $raw_smooth_scroll['desktop'] );
		$smooth_scroll_tablet = array_key_exists( 'tablet', $raw_smooth_scroll ) ? $raw_smooth_scroll['tablet'] : null;
		$smooth_scroll_mobile = array_key_exists( 'mobile', $raw_smooth_scroll ) ? $raw_smooth_scroll['mobile'] : null;
		$this->page_smooth_scroll = [
			'desktop' => $smooth_scroll_desktop,
			'tablet'  => is_bool( $smooth_scroll_tablet ) ? $smooth_scroll_tablet : $smooth_scroll_desktop,
			'mobile'  => is_bool( $smooth_scroll_mobile ) ? $smooth_scroll_mobile : ( is_bool( $smooth_scroll_tablet ) ? $smooth_scroll_tablet : $smooth_scroll_desktop ),
		];

		// Cascade page layout: null = inherit / disabled
		$raw_layout  = $layout['layout'] ?? [];
		$lay_desk    = is_array( $raw_layout['desktop'] ?? null ) ? $raw_layout['desktop'] : null;
		$lay_tablet  = is_array( $raw_layout['tablet']  ?? null ) ? $raw_layout['tablet']  : null;
		$lay_mobile  = is_array( $raw_layout['mobile']  ?? null ) ? $raw_layout['mobile']  : null;
		$this->page_layout = [
			'desktop' => $lay_desk,
			'tablet'  => $lay_tablet ?? $lay_desk,
			'mobile'  => $lay_mobile ?? $lay_tablet ?? $lay_desk,
		];
	}

	// ── Public API ────────────────────────────────────────────

	/**
	 * Returns the full output: an embedded <style> block followed by the HTML.
	 * Embedding CSS directly means it always renders regardless of theme/enqueue.
	 */
	public function generate_html(): string {
		$this->collect_used_google_fonts();
		$font_imports = $this->build_google_font_imports_css();
		$css  = $this->generate_css();
		$html = '<style>' . $font_imports . $css . '</style>';

		$bg       = $this->layout['background'] ?? [];
		// Cascade: null = not overridden, inherit from parent breakpoint
		$bg_desktop = $bg['desktop'] ?? '#ffffff';
		$bg_tablet  = $bg['tablet']  ?? null;  // null → inherit desktop
		$bg_mobile  = $bg['mobile']  ?? null;  // null → inherit tablet → desktop
		$cascade_bg = [
			'desktop' => $bg_desktop ?: '#ffffff',
			'tablet'  => $bg_tablet  ?? $bg_desktop ?? '#ffffff',
			'mobile'  => $bg_mobile  ?? $bg_tablet  ?? $bg_desktop ?? '#ffffff',
		];
		$bp_order = [ 'desktop', 'tablet', 'mobile' ];
		$root_els = array_filter(
			$this->layout['elements'] ?? [],
			fn( $e ) => empty( $e['parentId'] )
		);

		$html .= '<div class="fb-page ' . esc_attr( $this->build_id ) . '">';

		foreach ( $bp_order as $bpId ) {
			$cfg      = $this->bp_cfg[ $bpId ] ?? [ 'max_w' => 1440, 'default_h' => 900 ];
			$aw       = (float) $cfg['max_w'];
			$ah       = (float) $this->compute_content_height( $bpId, $cfg['default_h'] );
			$bg_color = esc_attr( $cascade_bg[ $bpId ] ?? '#ffffff' );
			$pad      = $this->page_padding[ $bpId ];
			$cw       = max( 1.0, $aw - $pad['left'] - $pad['right'] );
			$ch       = max( 1.0, $ah - $pad['top']  - $pad['bottom'] );
			$html    .= '<div class="fb-bp fb-bp-' . esc_attr( $bpId ) . '" style="background:' . $bg_color . ';">';
			$html    .= '<div class="fb-bp-inner">';
			$artboard_layout_on = is_array( $this->page_layout[ $bpId ] ?? null );
			$artboard_flex_dir  = $artboard_layout_on ? ( $this->page_layout[ $bpId ]['flexDirection'] ?? 'column' ) : 'none';
			$artboard_align_items = $artboard_layout_on ? ( $this->page_layout[ $bpId ]['alignItems'] ?? 'flex-start' ) : 'stretch';
			foreach ( $root_els as $el ) {
				$html .= $this->render_element( $el, $bpId, $cw, $ch, $artboard_layout_on, $artboard_flex_dir, $artboard_align_items );
			}
			$html .= '</div>';
			$html .= '</div>';
		}

		$html .= '</div>';
		$html .= $this->get_component_runtime_assets();
		return $html;
	}

	/** Artboard design dimensions per breakpoint */
	private array $bp_cfg = [
		'desktop' => [ 'max_w' => 1440, 'default_h' => 900  ],
		'tablet'  => [ 'max_w' => 768,  'default_h' => 1024 ],
		'mobile'  => [ 'max_w' => 390,  'default_h' => 844  ],
	];

	public function generate_css(): string {
		$this->css = [];
		$bid       = $this->build_id;

		$this->css[] = ".fb-page.{$bid} { width: 100%; overflow: visible; }";
		$this->css[] = ".fb-page.{$bid} .fb-bp, .fb-page.{$bid} .fb-bp-inner { overflow: visible; }";
		$this->css[] = ".fb-page.{$bid} .fb-el--sticky { position: -webkit-sticky !important; position: sticky !important; top: var(--fb-sticky-top, 0px) !important; }";
		$this->css[] = $this->responsive_scroll_behavior_css();

		$root_els = array_values( array_filter(
			$this->layout['elements'] ?? [],
			fn( $e ) => empty( $e['parentId'] )
		) );

		foreach ( $this->bp_cfg as $bpId => $cfg ) {
			$aw  = (float) $cfg['max_w'];
			$ah  = (float) $this->compute_content_height( $bpId, $cfg['default_h'] );
			$pad = $this->page_padding[ $bpId ];
			/*
			 * Container fills 100% of the viewport — the artboard IS the page.
			 * Elements keep their designer-pixel positions (px, not %).
			 * Responsiveness = 3 separate layouts switched by media query.
			 */
			$this->css[] = ".{$bid} .fb-bp-{$bpId} { "
				. "width: 100%; "
				. "position: relative; "
				. "min-height: {$ah}px; "
				. "box-sizing: border-box; "
				. "}";
			$cw_css = max( 1.0, $aw - $pad['left'] - $pad['right'] );
			$ch_css = max( 1.0, $ah - $pad['top']  - $pad['bottom'] );
			$layout = $this->page_layout[ $bpId ] ?? null;
			if ( $layout ) {
				$fd  = esc_attr( $layout['flexDirection']  ?? 'column' );
				$ai  = esc_attr( $layout['alignItems']     ?? 'flex-start' );
				$jc  = esc_attr( $layout['justifyContent'] ?? 'flex-start' );
				$fw  = esc_attr( $layout['flexWrap']       ?? 'nowrap' );
				$gap = (float) ( $layout['gap']            ?? 0 );
				$this->css[] = ".{$bid} .fb-bp-{$bpId} .fb-bp-inner { "
					. "position: relative; min-height: {$ah}px; box-sizing: border-box; display: flex; "
					. "flex-direction: {$fd}; align-items: {$ai}; justify-content: {$jc}; flex-wrap: {$fw}; gap: {$gap}px; "
					. "padding: {$pad['top']}px {$pad['right']}px {$pad['bottom']}px {$pad['left']}px; "
					. "}";
			} else {
				$this->css[] = ".{$bid} .fb-bp-{$bpId} .fb-bp-inner { "
					. "position: relative; min-height: {$ah}px; box-sizing: border-box; "
					. "padding: {$pad['top']}px {$pad['right']}px {$pad['bottom']}px {$pad['left']}px; "
					. "}";
			}
			$artboard_flex_dir_css = $layout !== null ? ( $layout['flexDirection'] ?? 'column' ) : 'none';
			foreach ( $root_els as $el ) {
				$this->collect_element_css( $el, $bpId, $cw_css, $ch_css, $layout !== null, $artboard_flex_dir_css );
			}
		}

		$this->css[] = ".{$bid} .fb-text-content, .{$bid} .fb-text-content :is(span, strong, em, u, b, i, a, mark, small, sub, sup) { white-space: inherit; -webkit-text-stroke-width: var(--fb-text-stroke-width, 0px); -webkit-text-stroke-color: var(--fb-text-stroke-color, currentColor); -webkit-text-fill-color: currentColor; paint-order: stroke fill; }";
		$this->css[] = ".{$bid} .fb-icon-content svg { width:100%; height:100%; }";
		$this->css[] = ".{$bid} .fb-icon-content--stroked svg :is(path, circle, rect, line, polyline, polygon, ellipse) { stroke: var(--fb-icon-stroke-color); stroke-width: var(--fb-icon-stroke-width); paint-order: stroke fill; }";
		$this->css[] = ".{$bid} input.fb-form-control:not([type=checkbox]):not([type=radio]), .{$bid} select.fb-form-control, .{$bid} textarea.fb-form-control { margin:0 !important; min-width:0 !important; max-width:none !important; width:100% !important; height:auto !important; text-transform:none !important; border:0 !important; outline:none !important; background:transparent !important; box-shadow:none !important; border-radius:0 !important; appearance:none; -webkit-appearance:none; display:block !important; vertical-align:middle; }";
		$this->css[] = ".{$bid} input.fb-form-control[type=checkbox]:not(.fb-form-choice__input), .{$bid} input.fb-form-control[type=radio]:not(.fb-form-choice__input), .{$bid} input[type=checkbox]:not(.fb-form-choice__input), .{$bid} input[type=radio]:not(.fb-form-choice__input) { appearance:auto; -webkit-appearance:auto; width:auto !important; min-width:auto !important; max-width:none !important; height:auto !important; background:initial !important; border-radius:initial !important; display:inline-block !important; vertical-align:middle; }";
		$this->css[] = ".{$bid} select.fb-form-control { background-image:none !important; }";
		$this->css[] = ".{$bid} .fb-form-control::placeholder { opacity:1; }";
		$this->css[] = ".{$bid} .fb-form-field, .{$bid} .fb-form-field * { box-sizing:border-box; }";
		$this->css[] = ".{$bid} .fb-form-control--richtext { position:absolute !important; width:1px !important; min-width:1px !important; max-width:1px !important; height:1px !important; min-height:1px !important; margin:0 !important; padding:0 !important; border:0 !important; opacity:0 !important; overflow:hidden !important; pointer-events:none !important; clip:rect(0,0,0,0) !important; clip-path:inset(50%) !important; white-space:nowrap !important; display:block !important; }";
		$this->css[] = ".{$bid} .fb-form-richtext { display:grid; grid-template-rows:auto minmax(0,1fr); }";
		$this->css[] = ".{$bid} .fb-form-richtext__toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; min-height:36px; background:rgba(15,23,42,0.04); }";
		$this->css[] = ".{$bid} .fb-form-richtext__toolbar-group { display:inline-flex; align-items:center; gap:6px; }";
		$this->css[] = ".{$bid} .fb-form-richtext__toolbar-btn { display:inline-flex; align-items:center; justify-content:center; min-width:30px; height:28px; padding:0 8px; border:0; border-radius:8px; background:transparent; color:inherit; cursor:pointer; font:inherit; font-weight:600; line-height:1; opacity:.78; }";
		$this->css[] = ".{$bid} .fb-form-richtext__toolbar-btn:hover, .{$bid} .fb-form-richtext__toolbar-btn:focus-visible { background:rgba(15,23,42,0.08); outline:none; }";
		$this->css[] = ".{$bid} .fb-form-richtext__editor { width:100%; min-height:96px; outline:none; overflow:auto; }";
		$this->css[] = ".{$bid} .fb-form-richtext__editor.is-empty::before { content:attr(data-placeholder); color:inherit; opacity:.7; pointer-events:none; }";
		$this->css[] = ".{$bid} .fb-form-richtext__editor > :first-child { margin-top:0; }";
		$this->css[] = ".{$bid} .fb-form-richtext__editor > :last-child { margin-bottom:0; }";
		$this->css[] = ".{$bid} .fb-form-richtext__editor :is(p, ul, ol, blockquote) { margin:0 0 .8em; }";
		$this->css[] = ".{$bid} .fb-form-richtext__editor h1, .{$bid} .fb-form-richtext__editor h2, .{$bid} .fb-form-richtext__editor h3 { margin:0 0 .65em; line-height:1.2; }";
		$this->css[] = ".{$bid} .fb-form-richtext__editor ul, .{$bid} .fb-form-richtext__editor ol { padding-left:1.25em; }";
		$this->css[] = ".{$bid} .fb-form-richtext__editor blockquote { padding-left:1em; border-left:2px solid currentColor; opacity:.82; }";
		$this->css[] = ".{$bid} .fb-form-choice { position:relative; display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; width:16px; height:16px; min-width:16px; min-height:16px; }";
		$this->css[] = ".{$bid} .fb-form-choice__input { position:absolute !important; inset:0; opacity:0; margin:0 !important; width:100% !important; min-width:100% !important; max-width:100% !important; height:100% !important; cursor:pointer; z-index:2; appearance:none !important; -webkit-appearance:none !important; border:0 !important; background:transparent !important; border-radius:0 !important; }";
		$this->css[] = ".{$bid} .fb-form-choice__control { position:relative; width:100%; height:100%; display:inline-flex; align-items:center; justify-content:center; pointer-events:none; }";
		$this->css[] = ".{$bid} .fb-form-choice__label { min-width:0; }";
		$this->css[] = ".{$bid} .fb-form-file-upload { position:relative; display:grid; place-items:center; gap:8px; text-align:center; cursor:pointer; transition:border-color 160ms ease,background-color 160ms ease,box-shadow 160ms ease; }";
		$this->css[] = ".{$bid} .fb-form-file-upload.is-dragover { border-color:rgba(37,99,235,0.68) !important; background:rgba(37,99,235,0.08) !important; box-shadow:0 0 0 3px rgba(37,99,235,0.12) !important; }";
		$this->css[] = ".{$bid} .fb-form-file-upload__meta { opacity:.82; }";
		$this->css[] = ".{$bid} .fb-form-file-upload__input { position:absolute !important; inset:0; opacity:0; width:100% !important; height:100% !important; cursor:pointer; }";

		// Loop runtime styles (slideshow / ticker / carousel)
		$this->css[] = ".{$bid} .fb-loop-interactive { position:relative; width:100%; min-width:0; flex:1 1 0%; overflow:hidden; }";
		$this->css[] = ".{$bid} .fb-loop-track { width:100%; }";
		$this->css[] = ".{$bid} .fb-loop-runtime-item[data-fb-loop-item-url] { cursor:pointer; }";
		$this->css[] = ".{$bid} .fb-loop-arrow { position:absolute; top:50%; transform:translateY(-50%); z-index:5; display:flex; align-items:center; justify-content:center; width:36px; height:36px; border:0; border-radius:50%; background:rgba(0,0,0,.45); color:#fff; cursor:pointer; transition:background .2s; }";
		$this->css[] = ".{$bid} .fb-loop-arrow:hover { background:rgba(0,0,0,.7); }";
		$this->css[] = ".{$bid} .fb-loop-arrow--prev { left:8px; }";
		$this->css[] = ".{$bid} .fb-loop-arrow--next { right:8px; }";
		$this->css[] = ".{$bid} .fb-loop-dots { display:flex; justify-content:center; gap:6px; padding:10px 0; }";
		$this->css[] = ".{$bid} .fb-loop-dot { width:8px; height:8px; border:0; border-radius:50%; background:rgba(0,0,0,.25); cursor:pointer; padding:0; transition:background .2s; }";
		$this->css[] = ".{$bid} .fb-loop-dot--active, .{$bid} .fb-loop-dot:hover { background:rgba(0,0,0,.7); }";

		$this->css[] = $this->responsive_visibility_css();

		return implode( "\n", $this->css );
	}

	// ── HTML rendering ────────────────────────────────────────

	/**
	 * Render one element to HTML.
	 * Position values use % matching the CSS class — so inline doesn't override responsive CSS.
	 *
	 * @param float $cw  Design width  of the containing context in px.
	 * @param float $ch  Design height of the containing context in px.
	 */
	private function render_element( array $el, string $bpId, float $cw, float $ch, bool $artboard_layout_on = false, string $parent_flex_dir = 'none', string $parent_align_items = 'stretch', array $loop_item_variables = [] ): string {
		$resolved = $this->resolve_element_with_variables( $el, $bpId, $loop_item_variables );
		if ( ! empty( $resolved['hidden'] ) ) return '';
		$element_type = isset( $el['type'] ) ? (string) $el['type'] : '';

		$id     = preg_replace( '/[^a-zA-Z0-9_-]/', '', $el['id'] ?? '' );
		$class  = 'fb-el fb-el-' . $id;
		$class  = 'fb-el fb-el-' . $id;
		$styles = $resolved['styles'] ?? [];
		$explicit_align_self = isset( $styles['alignSelf'] ) && in_array( $styles['alignSelf'], [ 'auto', 'flex-start', 'center', 'flex-end', 'stretch' ], true )
			? $styles['alignSelf']
			: null;

		$x = floatval( $resolved['x']      ?? 0 );
		$y = floatval( $resolved['y']      ?? 0 );
		$sticky_top = max( 0.0, $y );
		$w = floatval( $resolved['width']  ?? 100 );
		$h = floatval( $resolved['height'] ?? 100 );

		$cx       = $resolved['constraints'] ?? [];
		$pos_type = $resolved['positionType'] ?? 'absolute';
		// Auto-layout: root elements flow unless explicitly pinned
		if ( $artboard_layout_on && empty( $resolved['absoluteInLayout'] ) ) {
			$pos_type = 'sticky' === $pos_type ? 'sticky' : 'relative';
		}
		if ( 'sticky' === $pos_type ) {
			$class .= ' fb-el--sticky';
		}
		if ( $pos_type !== 'relative' && $pos_type !== 'sticky' && $pos_type !== 'fixed' && ( $x + $w <= 0 || $x >= $cw || $y + $h <= 0 || $y >= $ch ) ) {
			return '';
		}
		$width_mode  = $resolved['widthMode']  ?? 'fixed';
		$height_mode = $resolved['heightMode'] ?? 'fixed';
		$w_fr  = floatval( $resolved['widthFr']   ?? 1 );
		$h_fr  = floatval( $resolved['heightFr']  ?? 1 );
		$w_pct = floatval( $resolved['widthPct']  ?? $w );
		$h_pct = floatval( $resolved['heightPct'] ?? $h );
		$min_w = isset( $resolved['minW'] ) && $resolved['minW'] !== null ? floatval( $resolved['minW'] ) : null;
		$max_w = isset( $resolved['maxW'] ) && $resolved['maxW'] !== null ? floatval( $resolved['maxW'] ) : null;
		$min_h = isset( $resolved['minH'] ) && $resolved['minH'] !== null ? floatval( $resolved['minH'] ) : null;
		$max_h = isset( $resolved['maxH'] ) && $resolved['maxH'] !== null ? floatval( $resolved['maxH'] ) : null;
		$w_str = $width_mode  === 'fill'     ? '100%'
		       : ( $width_mode  === 'hug'      ? 'fit-content'
		       : ( $width_mode  === 'relative' ? "{$w_pct}%"
		       : "{$w}px" ) );
		$h_str = $height_mode === 'fill'     ? '100%'
		       : ( $height_mode === 'hug'      ? 'fit-content'
		       : ( $height_mode === 'relative' ? "{$h_pct}%"
		       : "{$h}px" ) );
		$constraint_horizontal = $this->get_constraint_axis_mode( $cx, 'horizontal' );
		$constraint_vertical = $this->get_constraint_axis_mode( $cx, 'vertical' );
		$display_width = 'relative' === $width_mode ? ( $cw * ( $w_pct / 100 ) ) : ( 'fill' === $width_mode ? $cw : $w );
		$display_height = 'relative' === $height_mode ? ( $ch * ( $h_pct / 100 ) ) : ( 'fill' === $height_mode ? $ch : $h );
		$right_val  = $cw - $x - $w;
		$bottom_val = $ch - $y - $h;
		$center_offset_x = $x - ( ( $cw - $display_width ) / 2 );
		$center_offset_y = $y - ( ( $ch - $display_height ) / 2 );
		$sticky_cross_axis_extra = '';
		if ( 'sticky' === $pos_type ) {
			if ( 'column' === $parent_flex_dir ) {
				if ( 'center' === $parent_align_items ) $sticky_cross_axis_extra = 'margin-left:auto;margin-right:auto;';
				elseif ( 'flex-end' === $parent_align_items ) $sticky_cross_axis_extra = 'margin-left:auto;margin-right:0;';
				elseif ( 'flex-start' === $parent_align_items ) $sticky_cross_axis_extra = 'margin-left:0;margin-right:auto;';
			} elseif ( 'row' === $parent_flex_dir ) {
				if ( 'center' === $parent_align_items ) $sticky_cross_axis_extra = 'margin-top:auto;margin-bottom:auto;';
				elseif ( 'flex-end' === $parent_align_items ) $sticky_cross_axis_extra = 'margin-top:auto;margin-bottom:0;';
				elseif ( 'flex-start' === $parent_align_items ) $sticky_cross_axis_extra = 'margin-top:0;margin-bottom:auto;';
			}
		}

		if ( $pos_type === 'relative' || $pos_type === 'sticky' ) {
			// Direction-aware fill sizing (matches CanvasElement.jsx logic)
			$extra = '';
			$flow_align_self = $explicit_align_self;
			if ( null === $flow_align_self && ( ( 'row' === $parent_flex_dir && 'fill' === $height_mode ) || ( 'column' === $parent_flex_dir && 'fill' === $width_mode ) ) ) {
				$flow_align_self = 'stretch';
			}
			if ( $flow_align_self ) {
				$extra .= "align-self:{$flow_align_self};";
			}
			if ( $parent_flex_dir === 'row' && $width_mode === 'fill' ) {
				// Main axis (width) grows via flex
				$extra  = "flex:{$w_fr} 1 0%;min-width:0;";
				$extra .= ( $height_mode === 'fill' ) ? 'height:100%;' : "height:{$h_str};";
			} elseif ( $parent_flex_dir === 'column' && $height_mode === 'fill' ) {
				// Main axis (height) grows via flex
				$extra  = "flex:{$h_fr} 1 0%;min-height:0;";
				$extra .= ( $width_mode === 'fill' ) ? 'width:100%;' : "width:{$w_str};";
			} else {
				// Cross-axis fill or no flex parent
				$w_part = ( $width_mode  === 'fill' ) ? 'width:100%;'  : "width:{$w_str};";
				$h_part = ( $height_mode === 'fill' ) ? 'height:100%;' : "height:{$h_str};";
				$extra .= $w_part . $h_part;
			}
			$sticky_offsets = '';
			if ( $pos_type === 'sticky' ) {
				$sticky_align_self = $explicit_align_self ?: $parent_align_items;
				$sticky_offsets .= "--fb-sticky-top:{$sticky_top}px;top:{$sticky_top}px;align-self:{$sticky_align_self};{$sticky_cross_axis_extra}";
			}
			$inline = 'position:' . ( $pos_type === 'sticky' ? 'sticky' : 'relative' ) . ";box-sizing:border-box;{$sticky_offsets}{$extra}";
		} elseif ( $pos_type === 'fixed' || $pos_type === 'absolute' ) {
			$position_css = $pos_type === 'fixed' ? 'fixed' : 'absolute';
			$inline = "position:{$position_css};box-sizing:border-box;";
			$constraint_transforms = [];

			if ( $width_mode === 'fill' ) {
				$inline .= 'left:0;right:0;width:auto;';
			} elseif ( $width_mode === 'hug' ) {
				$inline .= "left:{$x}px;width:fit-content;";
			} elseif ( $width_mode === 'relative' ) {
				$inline .= "left:{$x}px;width:{$w_pct}%;";
			} elseif ( 'stretch' === $constraint_horizontal ) {
				$inline .= "left:{$x}px;right:{$right_val}px;";
			} elseif ( 'right' === $constraint_horizontal ) {
				$inline .= "right:{$right_val}px;width:{$w}px;";
			} elseif ( 'center' === $constraint_horizontal ) {
				$inline .= 'left:calc(50% + ' . $center_offset_x . 'px);width:' . $w . 'px;';
				$constraint_transforms[] = 'translateX(-50%)';
			} else {
				$inline .= "left:{$x}px;width:{$w}px;";
			}

			$eff_bottom_val = ( $pos_type === 'fixed' )
				? ( $this->get_viewport_fold_h( $bpId ) - $y - $h )
				: $bottom_val;

			if ( $height_mode === 'fill' ) {
				$inline .= 'top:0;bottom:0;height:auto;';
			} elseif ( $height_mode === 'hug' ) {
				$inline .= "top:{$y}px;height:fit-content;";
			} elseif ( $height_mode === 'relative' ) {
				$inline .= "top:{$y}px;height:{$h_pct}%;";
			} elseif ( 'stretch' === $constraint_vertical ) {
				$inline .= "top:{$y}px;bottom:{$eff_bottom_val}px;";
			} elseif ( 'bottom' === $constraint_vertical ) {
				$inline .= "bottom:{$eff_bottom_val}px;height:{$h}px;";
			} elseif ( 'center' === $constraint_vertical ) {
				$inline .= 'top:calc(50% + ' . $center_offset_y . 'px);height:' . $h . 'px;';
				$constraint_transforms[] = 'translateY(-50%)';
			} else {
				$inline .= "top:{$y}px;height:{$h}px;";
			}
			if ( ! empty( $constraint_transforms ) ) {
				$inline .= 'transform:' . implode( ' ', $constraint_transforms ) . ';';
			}
		}
		if ( $min_w !== null && $min_w > 0 ) $inline .= "min-width:{$min_w}px;";
		if ( $max_w !== null && $max_w > 0 ) $inline .= "max-width:{$max_w}px;";
		if ( $min_h !== null && $min_h > 0 ) $inline .= "min-height:{$min_h}px;";
		if ( $max_h !== null && $max_h > 0 ) $inline .= "max-height:{$max_h}px;";

		$rotation_parts = [];
		$rotation_x = isset( $resolved['rotationX'] ) ? floatval( $resolved['rotationX'] ) : 0.0;
		$rotation_y = isset( $resolved['rotationY'] ) ? floatval( $resolved['rotationY'] ) : 0.0;
		$rotation_z = isset( $resolved['rotation'] ) ? floatval( $resolved['rotation'] ) : 0.0;
		if ( 0.0 !== $rotation_x || 0.0 !== $rotation_y ) {
			$rotation_parts[] = 'perspective(1000px)';
		}
		if ( 0.0 !== $rotation_x ) $rotation_parts[] = 'rotateX(' . $rotation_x . 'deg)';
		if ( 0.0 !== $rotation_y ) $rotation_parts[] = 'rotateY(' . $rotation_y . 'deg)';
		if ( 0.0 !== $rotation_z ) $rotation_parts[] = 'rotate(' . $rotation_z . 'deg)';
		if ( ! empty( $rotation_parts ) ) {
			$rotation_transform = implode( ' ', $rotation_parts );
			if ( preg_match( '/transform:([^;]+);/', $inline, $transform_match ) ) {
				$inline = preg_replace( '/transform:[^;]+;/', 'transform:' . trim( $transform_match[1] ) . ' ' . $rotation_transform . ';', $inline, 1 );
			} else {
				$inline .= 'transform:' . $rotation_transform . ';';
			}
			if ( 0.0 !== $rotation_x || 0.0 !== $rotation_y ) {
				$inline .= 'transform-style:preserve-3d;';
			}
		}
		$inline .= 'transform-origin:center center;';

		$layout_inline = $inline;

		$visual_props = [
			'backgroundColor' => 'background-color',
			'borderRadius'    => 'border-radius',
			'opacity'         => 'opacity',
			'mixBlendMode'    => 'mix-blend-mode',
			'overflow'        => 'overflow',
			'boxShadow'       => 'box-shadow',
			'zIndex'          => 'z-index',
		];
		foreach ( $visual_props as $camel => $kebab ) {
			if ( ! isset( $styles[ $camel ] ) || $styles[ $camel ] === '' ) continue;
			$val = $styles[ $camel ];
			// CSS gradient strings go to background-image, not background-color
			if ( $camel === 'backgroundColor' && preg_match( '/gradient\(/', $val ) ) {
				$inline .= 'background-image:' . $this->sanitize_css_value( $val ) . ';';
				continue;
			}
			if ( is_numeric( $val ) && $kebab === 'border-radius' ) $val .= 'px';
			$inline .= $kebab . ':' . $this->sanitize_css_value( $val ) . ';';
		}
		// Independent corner radius overrides the shorthand set above
		if ( ( $styles['borderRadiusMode'] ?? '' ) === 'independent' ) {
			$br = (float) ( $styles['borderRadius'] ?? 0 );
			$tl = (float) ( $styles['borderRadiusTL'] ?? $br );
			$tr = (float) ( $styles['borderRadiusTR'] ?? $br );
			$brc = (float) ( $styles['borderRadiusBR'] ?? $br );
			$bl = (float) ( $styles['borderRadiusBL'] ?? $br );
			$inline .= "border-radius:{$tl}px {$tr}px {$brc}px {$bl}px;";
		}
		if ( array_key_exists( 'blur', $styles ) || array_key_exists( 'brightness', $styles ) || array_key_exists( 'contrast', $styles ) || array_key_exists( 'saturation', $styles ) ) {
			$inline .= 'filter:' . $this->build_filter_css_value( $styles ) . ';';
		}
		if ( isset( $styles['backdropBlur'] ) && $styles['backdropBlur'] !== '' ) {
			$backdrop_blur = max( 0, (float) $styles['backdropBlur'] );
			$backdrop_value = $backdrop_blur > 0 ? 'blur(' . $backdrop_blur . 'px)' : 'none';
			$inline .= '-webkit-backdrop-filter:' . $backdrop_value . ';backdrop-filter:' . $backdrop_value . ';';
		}

		// Background image fill on frames / divs
		$bg_img = $this->normalize_media_url( $styles['backgroundImage'] ?? '' );
		if ( $bg_img !== '' ) {
			$bg_size = $styles['backgroundSize'] ?? 'cover';
			$bg_pos  = esc_attr( $this->sanitize_css_value( $styles['backgroundPosition'] ?? 'center center' ) );
			if ( $bg_size === 'repeat' ) {
				$inline .= 'background-image:url(' . esc_attr( $bg_img ) . ');background-size:auto;background-repeat:repeat;background-position:' . $bg_pos . ';';
			} else {
				$inline .= 'background-image:url(' . esc_attr( $bg_img ) . ');background-size:' . esc_attr( $this->sanitize_css_value( $bg_size ) ) . ';background-repeat:no-repeat;background-position:' . $bg_pos . ';';
			}
		}

		$component_instance = is_array( $el['componentInstance'] ?? null ) ? $el['componentInstance'] : null;
		$component_id = sanitize_text_field( $component_instance['componentId'] ?? '' );
		$bindings_json = ! empty( $el['bindings'] ) ? esc_attr( wp_json_encode( $this->normalize_bindings( $el['bindings'] ) ) ) : '';
		$flow_json = '';
		$element_flow = $this->get_element_flow( $id );
		if ( ! $element_flow && $this->is_form_container_type( $element_type ) ) {
			$element_flow = $this->get_form_flow( $id );
		}
		if ( $element_flow ) {
			$flow_json = esc_attr( wp_json_encode( $element_flow ) );
		}
		$scroll_sequence_json = '';
		$scroll_sequence = $this->get_scroll_sequence_config( $resolved, $styles );
		if ( $scroll_sequence ) {
			$scroll_sequence_json = esc_attr( wp_json_encode( $scroll_sequence ) );
		}
		$interactions_json = ! empty( $el['interactions'] ) ? esc_attr( wp_json_encode( $el['interactions'] ) ) : '';
		$animations_json = ! empty( $el['animations'] ) ? esc_attr( wp_json_encode( $el['animations'] ) ) : '';
		$link_url = $this->sanitize_navigation_url( $this->normalize_link_url_value( $resolved['linkUrl'] ?? '' ) );
		$runtime_attrs = '';
		if ( $bindings_json !== '' ) {
			$runtime_attrs .= ' data-fb-bindings="' . $bindings_json . '"';
		}
		if ( '' !== $link_url ) {
			$runtime_attrs .= ' data-fb-link-url="' . esc_attr( $link_url ) . '"';
		}
		if ( $flow_json !== '' ) {
			$runtime_attrs .= ' data-fb-flow="' . $flow_json . '"';
		}
		if ( $interactions_json !== '' && $flow_json === '' ) {
			$runtime_attrs .= ' data-fb-interactions="' . $interactions_json . '"';
		}
		if ( $animations_json !== '' ) {
			$runtime_attrs .= ' data-fb-animations="' . $animations_json . '"';
		}
		$runtime_attrs .= ' data-fb-base-x="' . esc_attr( (string) $x ) . '"';
		$runtime_attrs .= ' data-fb-base-y="' . esc_attr( (string) $y ) . '"';
		$runtime_attrs .= ' data-fb-base-rotation="' . esc_attr( (string) (float) ( $resolved['rotation'] ?? 0 ) ) . '"';
		$runtime_attrs .= ' data-fb-base-rotation-x="' . esc_attr( (string) (float) ( $resolved['rotationX'] ?? 0 ) ) . '"';
		$runtime_attrs .= ' data-fb-base-rotation-y="' . esc_attr( (string) (float) ( $resolved['rotationY'] ?? 0 ) ) . '"';
		if ( $scroll_sequence_json !== '' ) {
			$runtime_attrs .= ' data-fb-scroll-sequence="' . $scroll_sequence_json . '"';
		}
		if ( $component_id && $this->get_component_definition( $component_id ) ) {
			$html = '<div class="' . esc_attr( $class . ' fb-component-instance' ) . '" style="' . esc_attr( $layout_inline ) . '" data-fb-node-id="' . esc_attr( $id ) . '" data-flip-id="' . esc_attr( $id ) . '" data-fb-component-id="' . esc_attr( $component_id ) . '" data-fb-active-variant="' . esc_attr( sanitize_text_field( $component_instance['variantId'] ?? '' ) ) . '"' . $runtime_attrs . '>';
			$html .= $this->render_component_instance_variants( $el, $resolved, $bpId );
			$html .= '</div>';
			return $html;
		}
		// Emit the root node with all accumulated inline styles
		$is_submit_button = $this->is_form_submit_button_type( $element_type );
		$root_tag = $this->is_form_container_type( $element_type ) ? 'form' : ( $is_submit_button ? 'button' : 'div' );
		$root_class = $class;
		$root_extra_attrs = '';
		$form_config = null;
		if ( 'form' === $root_tag ) {
			$form_config = $this->normalize_form_config( $resolved['formConfig'] ?? [] );
			$root_extra_attrs .= ' novalidate enctype="multipart/form-data" data-fb-form-id="' . esc_attr( $id ) . '"';
			$root_extra_attrs .= ' data-fb-post-id="' . esc_attr( (string) $this->post_id ) . '"';
			$root_extra_attrs .= ' data-fb-form-state="' . esc_attr( $form_config['state'] ) . '"';
			$root_extra_attrs .= ' data-fb-form-config="' . esc_attr( wp_json_encode( $form_config ) ) . '"';
		}
		if ( $this->is_form_field_type( $element_type ) ) {
			$inline .= 'background:transparent;background-image:none;border:none;border-radius:0;box-shadow:none;overflow:visible;padding:0;gap:0;display:block;';
		}
		$button_state_css = '';
		if ( $is_submit_button ) {
			$button_label = isset( $resolved['label'] ) && is_string( $resolved['label'] ) && trim( $resolved['label'] ) !== ''
				? trim( $resolved['label'] )
				: 'Submit';
			$button_padding_top = isset( $styles['paddingTop'] ) && is_numeric( $styles['paddingTop'] ) ? max( 0, (float) $styles['paddingTop'] ) : 14;
			$button_padding_right = isset( $styles['paddingRight'] ) && is_numeric( $styles['paddingRight'] ) ? max( 0, (float) $styles['paddingRight'] ) : 22;
			$button_padding_bottom = isset( $styles['paddingBottom'] ) && is_numeric( $styles['paddingBottom'] ) ? max( 0, (float) $styles['paddingBottom'] ) : 14;
			$button_padding_left = isset( $styles['paddingLeft'] ) && is_numeric( $styles['paddingLeft'] ) ? max( 0, (float) $styles['paddingLeft'] ) : 22;
			$button_font_family = isset( $styles['fontFamily'] ) && is_string( $styles['fontFamily'] ) && trim( $styles['fontFamily'] ) !== ''
				? $this->sanitize_css_value( "'" . trim( $styles['fontFamily'] ) . "', sans-serif" )
				: 'inherit';
			$button_font_size = isset( $styles['fontSize'] ) && is_numeric( $styles['fontSize'] ) ? max( 10, (float) $styles['fontSize'] ) : 14;
			$button_font_weight = isset( $styles['fontWeight'] ) && is_numeric( $styles['fontWeight'] ) ? (int) $styles['fontWeight'] : 600;
			$button_font_style = $this->sanitize_css_value( $styles['fontStyle'] ?? 'normal' );
			$button_line_height = isset( $styles['lineHeight'] ) && is_numeric( $styles['lineHeight'] ) ? max( 0.8, (float) $styles['lineHeight'] ) : 1.2;
			$button_letter_spacing = isset( $styles['letterSpacing'] ) && is_numeric( $styles['letterSpacing'] ) ? (float) $styles['letterSpacing'] : 0;
			$button_text_align = $this->sanitize_css_value( $styles['textAlign'] ?? 'center' );
			$button_text_decoration = $this->sanitize_css_value( $styles['textDecoration'] ?? 'none' );
			$button_text_color = $this->sanitize_css_value( $this->get_gradient_fallback_color( $styles['color'] ?? '', '#ffffff' ) );
			$button_background_color = $this->sanitize_css_value( $styles['backgroundColor'] ?? '#0f172a' );
			$button_border_color = $this->sanitize_css_value( $styles['borderColor'] ?? 'rgba(15,23,42,0.14)' );
			$button_box_shadow = $this->sanitize_css_value( $styles['boxShadow'] ?? '0 8px 18px rgba(15,23,42,0.16)' );
			$button_hover_background = $this->sanitize_css_value( $styles['hoverBackgroundColor'] ?? '#1f2937' );
			$button_hover_border = $this->sanitize_css_value( $styles['hoverBorderColor'] ?? 'rgba(15,23,42,0.22)' );
			$button_hover_text = $this->sanitize_css_value( $styles['hoverTextColor'] ?? $button_text_color );
			$button_pressed_background = $this->sanitize_css_value( $styles['pressedBackgroundColor'] ?? '#111827' );
			$button_pressed_border = $this->sanitize_css_value( $styles['pressedBorderColor'] ?? 'rgba(15,23,42,0.22)' );
			$button_pressed_text = $this->sanitize_css_value( $styles['pressedTextColor'] ?? $button_text_color );
			$button_processing_background = $this->sanitize_css_value( $styles['processingBackgroundColor'] ?? 'rgba(15,23,42,0.72)' );
			$button_processing_border = $this->sanitize_css_value( $styles['processingBorderColor'] ?? $button_border_color );
			$button_processing_text = $this->sanitize_css_value( $styles['processingTextColor'] ?? $button_text_color );
			$button_success_background = $this->sanitize_css_value( $styles['successBackgroundColor'] ?? '#047857' );
			$button_success_border = $this->sanitize_css_value( $styles['successBorderColor'] ?? 'rgba(4,120,87,0.32)' );
			$button_success_text = $this->sanitize_css_value( $styles['successTextColor'] ?? '#ffffff' );
			$button_error_background = $this->sanitize_css_value( $styles['errorBackgroundColor'] ?? '#b91c1c' );
			$button_error_border = $this->sanitize_css_value( $styles['errorBorderColor'] ?? 'rgba(185,28,28,0.32)' );
			$button_error_text = $this->sanitize_css_value( $styles['errorTextColor'] ?? '#ffffff' );
			$button_focus_ring_color = $this->sanitize_css_value( $styles['focusRingColor'] ?? 'rgba(37,99,235,0.2)' );
			$button_focus_ring_width = isset( $styles['focusRingWidth'] ) && is_numeric( $styles['focusRingWidth'] ) ? max( 0, (float) $styles['focusRingWidth'] ) : 3;
			$button_focus_box_shadow = 'none' !== $button_box_shadow ? $button_box_shadow : '';
			if ( $button_focus_ring_width > 0 ) {
				$button_focus_ring_shadow = '0 0 0 ' . round( $button_focus_ring_width, 3 ) . 'px ' . $button_focus_ring_color;
				$button_focus_box_shadow = '' !== $button_focus_box_shadow ? $button_focus_box_shadow . ',' . $button_focus_ring_shadow : $button_focus_ring_shadow;
			}
			$inline .= 'appearance:none;-webkit-appearance:none;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:' . esc_attr( round( $button_padding_top, 3 ) . 'px ' . round( $button_padding_right, 3 ) . 'px ' . round( $button_padding_bottom, 3 ) . 'px ' . round( $button_padding_left, 3 ) . 'px' ) . ';';
			$inline .= 'font-family:' . $button_font_family . ';font-size:' . esc_attr( $button_font_size ) . 'px;font-weight:' . esc_attr( (string) $button_font_weight ) . ';';
			$inline .= 'font-style:' . $button_font_style . ';line-height:' . esc_attr( $button_line_height ) . ';letter-spacing:' . esc_attr( $button_letter_spacing ) . 'em;';
			$inline .= 'text-align:' . $button_text_align . ';text-decoration:' . $button_text_decoration . ';white-space:nowrap;';
			$inline .= 'color:' . $button_text_color . ';background:' . $button_background_color . ';border-color:' . $button_border_color . ';box-shadow:' . $button_box_shadow . ';';
			$root_class .= ' fb-form-submit';
			$root_extra_attrs .= ' type="submit" data-fb-form-submit-button="true" data-fb-submit-label="' . esc_attr( $button_label ) . '"';
			$button_selector = '[data-fb-node-id="' . $id . '"]';
			$button_state_css = '<style>'
				. $button_selector . '{transition:border-color 160ms ease,background-color 160ms ease,box-shadow 160ms ease,color 160ms ease,transform 160ms ease;}'
				. $button_selector . ':hover{background:' . $button_hover_background . ' !important;border-color:' . $button_hover_border . ' !important;color:' . $button_hover_text . ' !important;}'
				. $button_selector . ':active{background:' . $button_pressed_background . ' !important;border-color:' . $button_pressed_border . ' !important;color:' . $button_pressed_text . ' !important;transform:scale(0.985) !important;}'
				. $button_selector . ':focus-visible{box-shadow:' . $button_focus_box_shadow . ' !important;}'
				. 'form[data-fb-form-state="submitting"] ' . $button_selector . '{background:' . $button_processing_background . ' !important;border-color:' . $button_processing_border . ' !important;color:' . $button_processing_text . ' !important;cursor:progress !important;transform:none !important;}'
				. 'form[data-fb-form-state="success"] ' . $button_selector . '{background:' . $button_success_background . ' !important;border-color:' . $button_success_border . ' !important;color:' . $button_success_text . ' !important;transform:none !important;}'
				. 'form[data-fb-form-state="error"] ' . $button_selector . '{background:' . $button_error_background . ' !important;border-color:' . $button_error_border . ' !important;color:' . $button_error_text . ' !important;transform:none !important;}'
				. '</style>';
		}
		$html = '<' . $root_tag . ' class="' . esc_attr( $root_class ) . '" style="' . esc_attr( $inline ) . '" data-fb-node-id="' . esc_attr( $id ) . '" data-flip-id="' . esc_attr( $id ) . '"' . $runtime_attrs . $root_extra_attrs . '>';
		if ( '' !== $button_state_css ) {
			$html .= $button_state_css;
		}
		$frame_stroke_overlay_style = $this->build_gradient_frame_stroke_overlay_style( $styles );
		if ( '' !== $frame_stroke_overlay_style ) {
			$html .= '<div class="fb-frame-stroke-overlay" aria-hidden="true" style="' . esc_attr( $frame_stroke_overlay_style ) . '"></div>';
		}

		// Image element: render <img> tag filling the div (added after div opening)
		if ( 'image' === $element_type ) {
			$src     = esc_url( $this->normalize_media_url( $resolved['src'] ?? '' ) );
			$obj_fit = $this->sanitize_css_value( $styles['objectFit'] ?? 'cover' );
			if ( $src ) {
				$img_style = "position:absolute;inset:0;width:100%;height:100%;object-fit:{$obj_fit};border-radius:inherit;";
				$html .= '<img src="' . $src . '" alt="" style="' . esc_attr( $img_style ) . '" loading="lazy">';
			}
		}

		if ( 'video' === $element_type ) {
			$provider = $this->normalize_video_provider( $resolved['videoProvider'] ?? 'upload' );
			$src = 'upload' === $provider
				? $this->normalize_media_url( $resolved['src'] ?? '' )
				: trim( (string) ( $resolved['src'] ?? '' ) );
			$controls = ! isset( $resolved['videoControls'] ) || ! empty( $resolved['videoControls'] );
			$loop = ! empty( $resolved['videoLoop'] );
			$muted = ! empty( $resolved['videoMuted'] );
			$autoplay = ! empty( $resolved['videoAutoplay'] );
			if ( 'upload' === $provider ) {
				$video_url = esc_url( $src );
				if ( $video_url ) {
					$video_style = 'position:absolute;inset:0;width:100%;height:100%;object-fit:' . esc_attr( $this->sanitize_css_value( $styles['objectFit'] ?? 'cover' ) ) . ';border-radius:inherit;';
					$html .= '<video src="' . $video_url . '" style="' . esc_attr( $video_style ) . '"' . ( $controls ? ' controls' : '' ) . ( $loop ? ' loop' : '' ) . ( $muted ? ' muted' : '' ) . ( $autoplay ? ' autoplay' : '' ) . ' playsinline preload="metadata"></video>';
				}
			} else {
				$embed_url = esc_url( $this->build_video_embed_url( $provider, $src, $controls, $loop, $muted, $autoplay ) );
				if ( $embed_url ) {
					$embed_layout = $this->build_video_embed_layout_styles( $w, $h, $styles['objectFit'] ?? 'cover' );
					$html .= '<div class="fb-video-embed" style="' . esc_attr( $embed_layout['wrapper'] ) . '">';
					$html .= '<iframe src="' . $embed_url . '" title="' . esc_attr( $el['name'] ?? 'Video' ) . '" style="' . esc_attr( $embed_layout['frame'] ) . '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>';
					$html .= '</div>';
				}
			}
		}

		if ( 'scroll-sequence' === $element_type && $scroll_sequence ) {
			$object_fit = $this->sanitize_css_value( $scroll_sequence['objectFit'] ?? 'cover' );
			if ( 'video' === $scroll_sequence['type'] ) {
				$video_url = esc_url( $scroll_sequence['src'] ?? '' );
				if ( $video_url ) {
					$video_style = 'position:absolute;inset:0;width:100%;height:100%;object-fit:' . $object_fit . ';border-radius:inherit;background:#040712;';
					$html .= '<video data-fb-scroll-sequence-media="video" src="' . $video_url . '" style="' . esc_attr( $video_style ) . '" muted playsinline preload="auto"></video>';
				}
			} elseif ( 'image-sequence' === $scroll_sequence['type'] ) {
				$frames = $scroll_sequence['frames'] ?? [];
				$first_frame = ! empty( $frames ) ? esc_url( $frames[0] ) : '';
				if ( $first_frame ) {
					$img_style = 'position:absolute;inset:0;width:100%;height:100%;object-fit:' . $object_fit . ';border-radius:inherit;';
					$html .= '<img data-fb-scroll-sequence-media="image-sequence" src="' . $first_frame . '" alt="" style="' . esc_attr( $img_style ) . '" loading="eager">';
				}
			} else {
				$gif_url = esc_url( $scroll_sequence['src'] ?? '' );
				if ( $gif_url ) {
					$img_style = 'position:absolute;inset:0;width:100%;height:100%;object-fit:' . $object_fit . ';border-radius:inherit;';
					$html .= '<img data-fb-scroll-sequence-media="gif" src="' . $gif_url . '" alt="" style="' . esc_attr( $img_style ) . '" loading="eager">';
				}
			}
		}

		if ( 'embed' === $element_type ) {
			$embed_mode = $this->normalize_embed_mode( $resolved['embedMode'] ?? 'html' );
			$embed_code = isset( $resolved['embedCode'] ) && is_string( $resolved['embedCode'] ) ? $resolved['embedCode'] : '';
			if ( 'html' === $embed_mode ) {
				$srcdoc = $this->build_embed_srcdoc( $embed_code );
				if ( '' !== $srcdoc ) {
					$html .= '<iframe srcdoc="' . esc_attr( $srcdoc ) . '" title="' . esc_attr( $el['name'] ?? 'Embed' ) . '" sandbox="" style="position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;"></iframe>';
				}
			} elseif ( 'shortcode' === $embed_mode ) {
				$shortcode_output = do_shortcode( shortcode_unautop( $embed_code ) );
				if ( is_string( $shortcode_output ) && '' !== trim( $shortcode_output ) ) {
					$html .= '<div class="fb-embed-shortcode" style="position:absolute;inset:0;width:100%;height:100%;overflow:auto;">' . $shortcode_output . '</div>';
				}
			} else {
				$html .= '<div class="fb-embed-placeholder" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:18px;border:1.5px dashed rgba(120,120,160,0.32);border-radius:inherit;background:linear-gradient(180deg, rgba(248,250,252,0.92), rgba(241,245,249,0.88));color:#0f172a;">';
				$html .= '<div style="display:grid;gap:8px;width:100%;max-width:240px;">';
				$html .= '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;"><span style="font-size:12px;font-weight:700;">' . esc_html( strtoupper( $embed_mode ) . ' is stored but not executed' ) . '</span><span style="padding:4px 8px;border-radius:999px;background:rgba(15,23,42,0.08);font-size:10px;font-weight:800;letter-spacing:0.08em;">' . esc_html( strtoupper( $embed_mode ) ) . '</span></div>';
				$html .= '<pre style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;line-height:1.5;color:rgba(15,23,42,0.72);white-space:pre-wrap;word-break:break-word;max-height:110px;overflow:hidden;">' . esc_html( $embed_code ) . '</pre>';
				$html .= '</div></div>';
			}
		}

		if ( 'text' === $element_type ) {
			$font_family = trim( (string) ( $styles['fontFamily'] ?? 'Inter' ) );
			$font_stack  = $font_family !== '' ? "'{$font_family}', sans-serif" : 'Inter, sans-serif';
			$font_style  = $this->sanitize_css_value( $styles['fontStyle'] ?? 'normal' );
			$font_weight = intval( $styles['fontWeight'] ?? 400 );
			$font_size   = floatval( $styles['fontSize'] ?? 42 ) . ( $styles['fontSizeUnit'] ?? 'px' );
			$line_height = floatval( $styles['lineHeight'] ?? 1.2 ) . ( $styles['lineHeightUnit'] ?? 'em' );
			$letter_space = floatval( $styles['letterSpacing'] ?? 0 ) . ( $styles['letterSpacingUnit'] ?? 'em' );
			$text_align  = $this->sanitize_css_value( $styles['textAlign'] ?? 'left' );
			$text_decoration = $this->sanitize_css_value( $styles['textDecoration'] ?? 'none' );
			$text_color  = $this->sanitize_css_value( $styles['color'] ?? '#000000' );
			$text_color_gradient = is_string( $styles['color'] ?? null ) && false !== strpos( $styles['color'], 'gradient(' )
				? $this->sanitize_css_value( $styles['color'] )
				: '';
			$text_gradient = $text_color_gradient !== '' ? $text_color_gradient
				: ( is_string( $styles['backgroundColor'] ?? null ) && false !== strpos( $styles['backgroundColor'], 'gradient(' )
					? $this->sanitize_css_value( $styles['backgroundColor'] )
					: '' );
			$white_space = ( $width_mode === 'hug' && $height_mode === 'hug' ) ? 'pre' : 'pre-wrap';
			$text_style  = 'width:100%;display:block;overflow:visible;';
			$text_style .= 'font-family:' . $this->sanitize_css_value( $font_stack ) . ';';
			$text_style .= 'font-style:' . $font_style . ';';
			$text_style .= 'font-weight:' . $font_weight . ';';
			$text_style .= 'font-size:' . $this->sanitize_css_value( $font_size ) . ';';
			$text_style .= 'line-height:' . $this->sanitize_css_value( $line_height ) . ';';
			$text_style .= 'letter-spacing:' . $this->sanitize_css_value( $letter_space ) . ';';
			$text_style .= 'text-align:' . $text_align . ';';
			$text_style .= 'text-decoration:' . $text_decoration . ';';
			$text_style .= 'color:' . ( $text_gradient !== '' ? 'transparent' : $text_color ) . ';';
			$text_style .= 'white-space:' . $white_space . ';';
			$text_style .= 'word-break:break-word;';
			if ( $text_gradient !== '' ) {
				$text_style .= 'background-image:' . $text_gradient . ';';
				$text_style .= 'background-clip:text;-webkit-background-clip:text;-webkit-text-fill-color:transparent;';
			}
			$text_stroke_width = isset( $styles['strokeWidth'] ) ? max( 0, (float) $styles['strokeWidth'] ) : 0;
			if ( $text_stroke_width > 0 ) {
				$text_stroke_color = $this->sanitize_css_value( $this->get_gradient_fallback_color( $styles['strokeColor'] ?? '', $styles['color'] ?? '#000000' ) );
				$text_style .= '--fb-text-stroke-width:' . $text_stroke_width . 'px;';
				$text_style .= '--fb-text-stroke-color:' . $text_stroke_color . ';';
			}
			$text_value = $this->get_resolved_rich_text_html( $resolved );
			$html .= '<div class="fb-text-content" data-flip-id="' . esc_attr( $id . '__content' ) . '" style="' . esc_attr( $text_style ) . '">' . $text_value . '</div>';
		}

		if ( 'icon' === $element_type ) {
			$icon_markup = $this->sanitize_svg_markup( $resolved['svgMarkup'] ?? '' );
			$icon_color = $this->sanitize_css_value( $styles['color'] ?? '#111827' );
			$icon_stroke_width = isset( $styles['strokeWidth'] ) ? max( 0, (float) $styles['strokeWidth'] ) : 0;
			$icon_stroke_color = $this->sanitize_css_value( $this->get_gradient_fallback_color( $styles['strokeColor'] ?? '', $styles['color'] ?? '#111827' ) );
			if ( $icon_markup !== '' ) {
				$icon_class = 'fb-icon-content' . ( $icon_stroke_width > 0 ? ' fb-icon-content--stroked' : '' );
				$icon_style = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:' . esc_attr( $icon_color ) . ';pointer-events:none;user-select:none;';
				if ( $icon_stroke_width > 0 ) {
					$icon_style .= '--fb-icon-stroke-width:' . esc_attr( $icon_stroke_width . 'px' ) . ';--fb-icon-stroke-color:' . esc_attr( $icon_stroke_color ) . ';';
				}
				$html .= '<div class="' . esc_attr( $icon_class ) . '" data-flip-id="' . esc_attr( $id . '__content' ) . '" style="' . $icon_style . '">' . $icon_markup . '</div>';
			}
		}

		if ( $this->is_form_field_type( $element_type ) ) {
			$html .= $this->render_form_field_content( $el, $resolved, $styles, $id );
		}

		if ( $is_submit_button ) {
			$html .= esc_html( isset( $resolved['label'] ) && is_string( $resolved['label'] ) && trim( $resolved['label'] ) !== '' ? trim( $resolved['label'] ) : 'Submit' );
		}

		// Compute flex direction this element provides to its own children
		$child_flex_dir = 'none';
		if ( ( $styles['display'] ?? '' ) === 'flex' ) {
			$child_flex_dir = $styles['flexDirection'] ?? 'column';
		}
		$child_layout_on = $child_flex_dir !== 'none';
		$child_align_items = $child_layout_on ? ( $styles['alignItems'] ?? 'stretch' ) : 'stretch';
		list( $child_cw, $child_ch ) = $this->compute_child_context_size( $resolved, $cw, $ch, $artboard_layout_on, $parent_flex_dir );
		if ( 'loop' === $element_type ) {
			$html .= $this->render_loop_children( $el, $bpId, $child_cw, $child_ch, $child_layout_on, $child_flex_dir, $child_align_items );
		} else {
			foreach ( $el['children'] ?? [] as $child_id ) {
				$child = $this->el_index[ $child_id ] ?? null;
				if ( $child ) {
					$html .= $this->render_element( $child, $bpId, $child_cw, $child_ch, $child_layout_on, $child_flex_dir, $child_align_items, $loop_item_variables );
				}
			}
		}

		if ( $this->is_form_container_type( $element_type ) ) {
			$form_config = is_array( $form_config ) ? $form_config : $this->normalize_form_config( $resolved['formConfig'] ?? [] );
			$submit_state = $form_config['state'];
			$status_message = 'success' === $submit_state
				? $form_config['successMessage']
				: ( 'error' === $submit_state ? $form_config['errorMessage'] : '' );
			$html .= '<div class="fb-form-status" data-fb-form-status style="display:' . ( '' !== $status_message ? 'block' : 'none' ) . ';margin-top:8px;font-size:12px;line-height:1.45;color:' . esc_attr( 'error' === $submit_state ? '#b91c1c' : ( 'success' === $submit_state ? '#047857' : 'rgba(15,23,42,0.68)' ) ) . ';">' . esc_html( $status_message ) . '</div>';
		}

		$html .= '</' . $root_tag . '>';
		return $html;
	}

	// ── CSS generation ────────────────────────────────────────

	/**
	 * Emit CSS for one element (% positioning), recurse into children.
	 *
	 * @param float $cw  Design width  of containing context (artboard or parent) in px.
	 * @param float $ch  Design height of containing context in px.
	 */
	private function collect_element_css( array $el, string $bpId, float $cw, float $ch, bool $artboard_layout_on = false, string $parent_flex_dir = 'none' ): void {
		$resolved = $this->resolve_element_with_variables( $el, $bpId );
		if ( ! empty( $resolved['hidden'] ) ) return;

		$id       = preg_replace( '/[^a-zA-Z0-9_-]/', '', $el['id'] ?? '' );
		$selector = ".{$this->build_id} .fb-bp-{$bpId} .fb-bp-inner .fb-el-{$id}";
		$styles   = $resolved['styles'] ?? [];
		$element_type = isset( $el['type'] ) ? (string) $el['type'] : '';
		$is_form_field = $this->is_form_field_type( $element_type );

		$x = floatval( $resolved['x']      ?? 0 );
		$y = floatval( $resolved['y']      ?? 0 );
		$sticky_top = max( 0.0, $y );
		$w = floatval( $resolved['width']  ?? 100 );
		$h = floatval( $resolved['height'] ?? 100 );

		$cx          = $resolved['constraints'] ?? [];
		$pos_type    = $resolved['positionType'] ?? 'absolute';
		// Auto-layout: root elements flow unless explicitly pinned
		if ( $artboard_layout_on && empty( $resolved['absoluteInLayout'] ) ) {
			$pos_type = 'sticky' === $pos_type ? 'sticky' : 'relative';
		}
		$width_mode  = $resolved['widthMode']    ?? 'fixed';
		$height_mode = $resolved['heightMode']   ?? 'fixed';
		$w_fr  = floatval( $resolved['widthFr']   ?? 1 );
		$h_fr  = floatval( $resolved['heightFr']  ?? 1 );
		$w_pct = floatval( $resolved['widthPct']  ?? $w );
		$h_pct = floatval( $resolved['heightPct'] ?? $h );
		$min_w = isset( $resolved['minW'] ) && $resolved['minW'] !== null ? floatval( $resolved['minW'] ) : null;
		$max_w = isset( $resolved['maxW'] ) && $resolved['maxW'] !== null ? floatval( $resolved['maxW'] ) : null;
		$min_h = isset( $resolved['minH'] ) && $resolved['minH'] !== null ? floatval( $resolved['minH'] ) : null;
		$max_h = isset( $resolved['maxH'] ) && $resolved['maxH'] !== null ? floatval( $resolved['maxH'] ) : null;
		$constraint_horizontal = $this->get_constraint_axis_mode( $cx, 'horizontal' );
		$constraint_vertical = $this->get_constraint_axis_mode( $cx, 'vertical' );
		$display_width = 'relative' === $width_mode ? ( $cw * ( $w_pct / 100 ) ) : ( 'fill' === $width_mode ? $cw : $w );
		$display_height = 'relative' === $height_mode ? ( $ch * ( $h_pct / 100 ) ) : ( 'fill' === $height_mode ? $ch : $h );
		// Compute right/bottom from design positions
		$right_val  = $cw - $x - $w;
		$bottom_val = $ch - $y - $h;
		$center_offset_x = $x - ( ( $cw - $display_width ) / 2 );
		$center_offset_y = $y - ( ( $ch - $display_height ) / 2 );

		// Off-canvas: skip absolute elements outside artboard; relative/fixed are exempt
		if ( $pos_type !== 'relative' && $pos_type !== 'sticky' && $pos_type !== 'fixed' && ( $x + $w <= 0 || $x >= $cw || $y + $h <= 0 || $y >= $ch ) ) {
			return;
		}

		if ( $pos_type === 'relative' || $pos_type === 'sticky' ) {
			$rules = [ 'position: ' . ( $pos_type === 'sticky' ? 'sticky' : 'relative' ), 'box-sizing: border-box' ];
			if ( $pos_type === 'sticky' ) {
				$rules[] = "top: {$sticky_top}px";
			}
			if ( $parent_flex_dir === 'row' && $width_mode === 'fill' ) {
				// Main axis: width grows via flex
				$rules[] = "flex: {$w_fr} 1 0%";
				$rules[] = 'min-width: 0';
				if ( $height_mode === 'fill' ) {
					$rules[] = 'height: 100%';
				} elseif ( $height_mode === 'hug' ) {
					$rules[] = 'height: fit-content';
				} elseif ( $height_mode === 'relative' ) {
					$rules[] = "height: {$h_pct}%";
				} else {
					$rules[] = "height: {$h}px";
				}
			} elseif ( $parent_flex_dir === 'column' && $height_mode === 'fill' ) {
				// Main axis: height grows via flex
				$rules[] = "flex: {$h_fr} 1 0%";
				$rules[] = 'min-height: 0';
				if ( $width_mode === 'fill' ) {
					$rules[] = 'width: 100%';
				} elseif ( $width_mode === 'hug' ) {
					$rules[] = 'width: fit-content';
				} elseif ( $width_mode === 'relative' ) {
					$rules[] = "width: {$w_pct}%";
				} else {
					$rules[] = "width: {$w}px";
				}
			} else {
				// Cross-axis fill or no flex parent
				if ( $width_mode === 'fill' ) {
					$rules[] = 'width: 100%';
				} elseif ( $width_mode === 'hug' ) {
					$rules[] = 'width: fit-content';
				} elseif ( $width_mode === 'relative' ) {
					$rules[] = "width: {$w_pct}%";
				} else {
					$rules[] = "width: {$w}px";
				}
				if ( $height_mode === 'fill' ) {
					$rules[] = 'height: 100%';
				} elseif ( $height_mode === 'hug' ) {
					$rules[] = 'height: fit-content';
				} elseif ( $height_mode === 'relative' ) {
					$rules[] = "height: {$h_pct}%";
				} else {
					$rules[] = "height: {$h}px";
				}
			}
		} elseif ( $pos_type === 'fixed' || $pos_type === 'absolute' ) {
			$rules = [
				'position: ' . $pos_type,
				'box-sizing: border-box',
			];
			$constraint_transforms = [];
			// Horizontal: fill/hug/relative override pinning
			if ( $width_mode === 'fill' ) {
				$rules[] = 'left: 0';
				$rules[] = 'right: 0';
				$rules[] = 'width: auto';
			} elseif ( $width_mode === 'hug' ) {
				$rules[] = "left: {$x}px";
				$rules[] = 'width: fit-content';
			} elseif ( $width_mode === 'relative' ) {
				$rules[] = "left: {$x}px";
				$rules[] = "width: {$w_pct}%";
			} elseif ( 'stretch' === $constraint_horizontal ) {
				$rules[] = "left: {$x}px";
				$rules[] = "right: {$right_val}px";
			} elseif ( 'right' === $constraint_horizontal ) {
				$rules[] = "right: {$right_val}px";
				$rules[] = "width: {$w}px";
			} elseif ( 'center' === $constraint_horizontal ) {
				$rules[] = 'left: calc(50% + ' . $center_offset_x . 'px)';
				$rules[] = "width: {$w}px";
				$constraint_transforms[] = 'translateX(-50%)';
			} else {
				$rules[] = "left: {$x}px";
				$rules[] = "width: {$w}px";
			}
			// For fixed elements bottom is measured from the viewport fold, not the parent height
			$eff_bottom_val = ( $pos_type === 'fixed' )
				? ( $this->get_viewport_fold_h( $bpId ) - $y - $h )
				: $bottom_val;
			// Vertical: fill/hug/relative override pinning
			if ( $height_mode === 'fill' ) {
				$rules[] = 'top: 0';
				$rules[] = 'bottom: 0';
				$rules[] = 'height: auto';
			} elseif ( $height_mode === 'hug' ) {
				$rules[] = "top: {$y}px";
				$rules[] = 'height: fit-content';
			} elseif ( $height_mode === 'relative' ) {
				$rules[] = "top: {$y}px";
				$rules[] = "height: {$h_pct}%";
			} elseif ( 'stretch' === $constraint_vertical ) {
				$rules[] = "top: {$y}px";
				$rules[] = "bottom: {$eff_bottom_val}px";
			} elseif ( 'bottom' === $constraint_vertical ) {
				$rules[] = "bottom: {$eff_bottom_val}px";
				$rules[] = "height: {$h}px";
			} elseif ( 'center' === $constraint_vertical ) {
				$rules[] = 'top: calc(50% + ' . $center_offset_y . 'px)';
				$rules[] = "height: {$h}px";
				$constraint_transforms[] = 'translateY(-50%)';
			} else {
				$rules[] = "top: {$y}px";
				$rules[] = "height: {$h}px";
			}
			if ( ! empty( $constraint_transforms ) ) {
				$rules[] = 'transform: ' . implode( ' ', $constraint_transforms );
			}
		}

		if ( $min_w !== null && $min_w > 0 ) $rules[] = "min-width: {$min_w}px";
		if ( $max_w !== null && $max_w > 0 ) $rules[] = "max-width: {$max_w}px";
		if ( $min_h !== null && $min_h > 0 ) $rules[] = "min-height: {$min_h}px";
		if ( $max_h !== null && $max_h > 0 ) $rules[] = "max-height: {$max_h}px";

		$rotation_parts = [];
		$rotation_x = isset( $resolved['rotationX'] ) ? floatval( $resolved['rotationX'] ) : 0.0;
		$rotation_y = isset( $resolved['rotationY'] ) ? floatval( $resolved['rotationY'] ) : 0.0;
		$rotation_z = isset( $resolved['rotation'] ) ? floatval( $resolved['rotation'] ) : 0.0;
		if ( 0.0 !== $rotation_x || 0.0 !== $rotation_y ) {
			$rotation_parts[] = 'perspective(1000px)';
		}
		if ( 0.0 !== $rotation_x ) $rotation_parts[] = 'rotateX(' . $rotation_x . 'deg)';
		if ( 0.0 !== $rotation_y ) $rotation_parts[] = 'rotateY(' . $rotation_y . 'deg)';
		if ( 0.0 !== $rotation_z ) $rotation_parts[] = 'rotate(' . $rotation_z . 'deg)';
		if ( ! empty( $rotation_parts ) ) {
			$rotation_transform = implode( ' ', $rotation_parts );
			$transform_index = null;
			foreach ( $rules as $index => $rule ) {
				if ( 0 === strpos( $rule, 'transform:' ) ) {
					$transform_index = $index;
					break;
				}
			}
			if ( null !== $transform_index ) {
				$existing_transform = trim( substr( $rules[ $transform_index ], strlen( 'transform:' ) ) );
				$rules[ $transform_index ] = 'transform: ' . trim( $existing_transform . ' ' . $rotation_transform );
			} else {
				$rules[] = 'transform: ' . $rotation_transform;
			}
			if ( 0.0 !== $rotation_x || 0.0 !== $rotation_y ) {
				$rules[] = 'transform-style: preserve-3d';
			}
		}
		$rules[] = 'transform-origin: center center';

		$allowed_props = $is_form_field
			? [ 'opacity', 'mixBlendMode', 'zIndex' ]
			: [
				'backgroundColor', 'borderRadius', 'borderWidth', 'borderColor', 'borderStyle',
				'opacity', 'mixBlendMode', 'overflow', 'display', 'flexDirection', 'flexWrap', 'gap',
				'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
				'alignItems', 'justifyContent', 'boxShadow', 'zIndex',
			];
		$px_props = [
			'border-radius', 'border-width', 'gap',
			'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
		];

		foreach ( $allowed_props as $prop ) {
			if ( ! isset( $styles[ $prop ] ) || $styles[ $prop ] === '' ) continue;
			if ( 'borderColor' === $prop && $this->is_gradient_css_value( $styles['borderColor'] ?? '' ) ) continue;
			$val     = $styles[ $prop ];
			$css_key = $this->camel_to_kebab( $prop );
			if ( is_numeric( $val ) && in_array( $css_key, $px_props, true ) ) {
				$val .= 'px';
			}
			$rules[] = $css_key . ': ' . $this->sanitize_css_value( $val );
		}
		if ( ! $is_form_field && ! empty( $styles['borderWidth'] ) && $this->is_gradient_css_value( $styles['borderColor'] ?? '' ) ) {
			$rules = array_filter( $rules, fn( $rule ) => strpos( $rule, 'border-color:' ) === false );
			$rules[] = 'border-color: transparent';
		}
		// Background image fill
		$bg_img = $this->normalize_media_url( $styles['backgroundImage'] ?? '' );
		if ( ! $is_form_field && $bg_img !== '' ) {
			$bg_size = $styles['backgroundSize'] ?? 'cover';
			$bg_pos  = $styles['backgroundPosition'] ?? 'center center';
			$rules[] = 'background-image: url(' . $this->sanitize_css_value( $bg_img ) . ')';
			if ( $bg_size === 'repeat' ) {
				$rules[] = 'background-size: auto';
				$rules[] = 'background-repeat: repeat';
			} else {
				$rules[] = 'background-size: ' . $this->sanitize_css_value( $bg_size );
				$rules[] = 'background-repeat: no-repeat';
			}
			$rules[] = 'background-position: ' . $this->sanitize_css_value( $bg_pos );
		}
		// Independent corner radius
		if ( ! $is_form_field && ( $styles['borderRadiusMode'] ?? '' ) === 'independent' ) {
			$br = (float) ( $styles['borderRadius'] ?? 0 );
			$tl = (float) ( $styles['borderRadiusTL'] ?? $br );
			$tr = (float) ( $styles['borderRadiusTR'] ?? $br );
			$brc = (float) ( $styles['borderRadiusBR'] ?? $br );
			$bl = (float) ( $styles['borderRadiusBL'] ?? $br );
			$rules = array_filter( $rules, fn( $r ) => strpos( $r, 'border-radius' ) === false );
			$rules[] = "border-radius: {$tl}px {$tr}px {$brc}px {$bl}px";
		}
		if ( array_key_exists( 'blur', $styles ) || array_key_exists( 'brightness', $styles ) || array_key_exists( 'contrast', $styles ) || array_key_exists( 'saturation', $styles ) ) {
			$rules[] = 'filter: ' . $this->build_filter_css_value( $styles );
		}
		if ( isset( $styles['backdropBlur'] ) && $styles['backdropBlur'] !== '' ) {
			$backdrop_blur = max( 0, (float) $styles['backdropBlur'] );
			$backdrop_value = $backdrop_blur > 0 ? 'blur(' . $backdrop_blur . 'px)' : 'none';
			$rules[] = '-webkit-backdrop-filter: ' . $backdrop_value;
			$rules[] = 'backdrop-filter: ' . $backdrop_value;
		}

		$this->css[] = $selector . ' { ' . implode( '; ', $rules ) . ' }';

		// Recurse: pass this element's flex direction to children for fill-mode awareness.
		$child_flex_dir = 'none';
		if ( ( $styles['display'] ?? '' ) === 'flex' ) {
			$child_flex_dir = $styles['flexDirection'] ?? 'column';
		}
		$child_layout_on = $child_flex_dir !== 'none';
		list( $child_cw, $child_ch ) = $this->compute_child_context_size( $resolved, $cw, $ch, $artboard_layout_on, $parent_flex_dir );
		foreach ( $el['children'] ?? [] as $child_id ) {
			$child = $this->el_index[ $child_id ] ?? null;
			if ( $child ) {
				$this->collect_element_css( $child, $bpId, $child_cw, $child_ch, $child_layout_on, $child_flex_dir );
			}
		}
	}

	private function compute_child_context_size( array $resolved, float $cw, float $ch, bool $artboard_layout_on = false, string $parent_flex_dir = 'none' ): array {
		$pos_type = $resolved['positionType'] ?? 'absolute';
		if ( $artboard_layout_on && empty( $resolved['absoluteInLayout'] ) ) {
			$pos_type = 'sticky' === $pos_type ? 'sticky' : 'relative';
		}

		$width_mode = $resolved['widthMode'] ?? 'fixed';
		$height_mode = $resolved['heightMode'] ?? 'fixed';
		$width = max( 1.0, (float) ( $resolved['width'] ?? 1 ) );
		$height = max( 1.0, (float) ( $resolved['height'] ?? 1 ) );
		$width_pct = (float) ( $resolved['widthPct'] ?? $width );
		$height_pct = (float) ( $resolved['heightPct'] ?? $height );

		$effective_width = $width;
		$effective_height = $height;

		if ( 'fill' === $width_mode ) {
			$effective_width = max( 1.0, $cw );
		} elseif ( 'relative' === $width_mode ) {
			$effective_width = max( 1.0, $cw * ( $width_pct / 100 ) );
		}

		if ( 'fill' === $height_mode ) {
			$effective_height = max( 1.0, $ch );
		} elseif ( 'relative' === $height_mode ) {
			$effective_height = max( 1.0, $ch * ( $height_pct / 100 ) );
		}

		if ( 'relative' === $pos_type || 'sticky' === $pos_type ) {
			if ( 'row' === $parent_flex_dir && 'fill' === $width_mode && $width > 0 ) {
				$effective_width = $width;
			}
			if ( 'column' === $parent_flex_dir && 'fill' === $height_mode && $height > 0 ) {
				$effective_height = $height;
			}
		}

		return [ $effective_width, $effective_height ];
	}

	/**
	 * Show desktop by default; switch to tablet at ≤768px, mobile at ≤375px.
	 * Scoped to this build's ID so multiple published pages don't interfere.
	 */
	private function responsive_visibility_css(): string {
		$bid = $this->build_id;
		$tablet_max = max( 768, (int) round( (float) ( $this->bp_cfg['tablet']['max_w'] ?? 768 ) ) );
		$mobile_max = max( 480, (int) round( (float) ( $this->bp_cfg['mobile']['max_w'] ?? 390 ) ) );
		return implode( "\n", [
			".{$bid} .fb-bp-tablet, .{$bid} .fb-bp-mobile { display: none; }",
			"@media (max-width: {$tablet_max}px) { .{$bid} .fb-bp-desktop { display: none !important; } .{$bid} .fb-bp-tablet { display: block !important; } }",
			"@media (max-width: {$mobile_max}px) { .{$bid} .fb-bp-tablet  { display: none !important; } .{$bid} .fb-bp-mobile  { display: block !important; } }",
		] );
	}

	private function responsive_scroll_behavior_css(): string {
		$tablet_max = max( 768, (int) round( (float) ( $this->bp_cfg['tablet']['max_w'] ?? 768 ) ) );
		$mobile_max = max( 480, (int) round( (float) ( $this->bp_cfg['mobile']['max_w'] ?? 390 ) ) );
		$desktop_behavior = ! empty( $this->page_smooth_scroll['desktop'] ) ? 'smooth' : 'auto';
		$tablet_behavior = ! empty( $this->page_smooth_scroll['tablet'] ) ? 'smooth' : 'auto';
		$mobile_behavior = ! empty( $this->page_smooth_scroll['mobile'] ) ? 'smooth' : 'auto';
		return implode( "\n", [
			"html { scroll-behavior: {$desktop_behavior}; }",
			"@media (max-width: {$tablet_max}px) { html { scroll-behavior: {$tablet_behavior}; } }",
			"@media (max-width: {$mobile_max}px) { html { scroll-behavior: {$mobile_behavior}; } }",
		] );
	}

	// ── Helpers ───────────────────────────────────────────────

	private function normalize_variable_value( string $type, $value ) {
		switch ( $type ) {
			case 'boolean':
				if ( is_bool( $value ) ) return $value;
				if ( is_string( $value ) ) {
					$normalized = strtolower( trim( $value ) );
					if ( in_array( $normalized, [ 'true', '1', 'yes', 'on' ], true ) ) return true;
					if ( in_array( $normalized, [ 'false', '0', 'no', 'off', '' ], true ) ) return false;
				}
				if ( is_numeric( $value ) ) return (float) $value !== 0.0;
				return (bool) $value;
			case 'color':
				return is_string( $value ) && $value !== '' ? $value : '#000000';
			case 'image':
				return $this->normalize_media_url( $value );
			case 'number':
				return is_numeric( $value ) ? (float) $value : 0;
			case 'post':
			case 'product':
				if ( ! is_array( $value ) ) return null;
				return [
					'id'       => isset( $value['id'] ) ? (int) $value['id'] : 0,
					'title'    => isset( $value['title'] ) ? sanitize_text_field( $value['title'] ) : '',
					'url'      => isset( $value['url'] ) ? esc_url_raw( $value['url'] ) : '',
					'postType' => isset( $value['postType'] ) ? sanitize_key( $value['postType'] ) : ( $type === 'product' ? 'product' : 'post' ),
				];
			case 'string':
			default:
				return is_string( $value ) ? $value : (string) ( $value ?? '' );
		}
	}

	private function normalize_variable_list( $variables, string $scope ): array {
		if ( ! is_array( $variables ) ) return [];

		$normalized = [];
		foreach ( $variables as $variable ) {
			if ( ! is_array( $variable ) ) continue;
			$id = isset( $variable['id'] ) ? sanitize_text_field( (string) $variable['id'] ) : '';
			if ( $id === '' ) continue;
			$type = isset( $variable['type'] ) ? sanitize_key( (string) $variable['type'] ) : 'string';
			$normalized[] = [
				'id'         => $id,
				'scope'      => $scope,
				'type'       => $type,
				'name'       => isset( $variable['name'] ) ? sanitize_text_field( $variable['name'] ) : 'Variable',
				'category'   => isset( $variable['category'] ) ? sanitize_text_field( $variable['category'] ) : 'General',
				'persistent' => ! empty( $variable['persistent'] ),
				'value'      => $this->normalize_variable_value( $type, $variable['value'] ?? null ),
			];
		}

		return $normalized;
	}

	private function get_variable_map(): array {
		return $this->get_variable_map_for_loop_item();
	}

	private function get_variable_map_for_loop_item( array $loop_item_variables = [] ): array {
		$page_map = [];
		foreach ( $this->page_variables as $variable ) {
			$page_map[ $variable['id'] ] = $variable;
		}
		$global_map = [];
		foreach ( $this->global_variables as $variable ) {
			$global_map[ $variable['id'] ] = $variable;
		}
		$loop_item_map = [];
		foreach ( $this->normalize_variable_list( $loop_item_variables, 'loop-item' ) as $variable ) {
			$loop_item_map[ $variable['id'] ] = $variable;
		}

		return [
			'page'   => $page_map,
			'global' => $global_map,
			'loop-item' => $loop_item_map,
		];
	}

	private function normalize_flow_config_value( $value ) {
		if ( is_array( $value ) ) {
			$normalized = [];
			foreach ( $value as $key => $entry ) {
				$normalized[ is_string( $key ) ? $key : (string) $key ] = $this->normalize_flow_config_value( $entry );
			}
			return $normalized;
		}
		if ( is_bool( $value ) || is_null( $value ) || is_int( $value ) || is_float( $value ) || is_string( $value ) ) {
			return $value;
		}
		if ( is_numeric( $value ) ) return 0 + $value;
		return null;
	}

	private function normalize_flow_trigger( $trigger ): array {
		$type = isset( $trigger['type'] ) ? sanitize_key( (string) $trigger['type'] ) : 'custom';
		if ( ! in_array( $type, [ 'element-click', 'page-load', 'form-submit', 'custom' ], true ) ) {
			$type = 'custom';
		}
		return [
			'type' => $type,
			'elementId' => isset( $trigger['elementId'] ) ? sanitize_text_field( (string) $trigger['elementId'] ) : '',
			'event' => isset( $trigger['event'] ) ? sanitize_key( (string) $trigger['event'] ) : ( 'element-click' === $type ? 'click' : '' ),
			'formId' => isset( $trigger['formId'] ) ? sanitize_text_field( (string) $trigger['formId'] ) : '',
		];
	}

	private function normalize_flow_node( $node ): ?array {
		if ( ! is_array( $node ) ) return null;
		$id = isset( $node['id'] ) ? sanitize_text_field( (string) $node['id'] ) : '';
		$type = isset( $node['type'] ) ? sanitize_key( (string) $node['type'] ) : '';
		if ( '' === $id || ! in_array( $type, [ 'trigger', 'submission-form', 'condition', 'navigate', 'set-variable', 'delay', 'end' ], true ) ) {
			return null;
		}
		$position = is_array( $node['position'] ?? null ) ? $node['position'] : [];
		return [
			'id' => $id,
			'type' => $type,
			'label' => isset( $node['label'] ) && is_string( $node['label'] ) && trim( $node['label'] ) !== '' ? sanitize_text_field( $node['label'] ) : $type,
			'position' => [
				'x' => isset( $position['x'] ) && is_numeric( $position['x'] ) ? (float) $position['x'] : 0,
				'y' => isset( $position['y'] ) && is_numeric( $position['y'] ) ? (float) $position['y'] : 0,
			],
			'config' => $this->normalize_flow_config_value( is_array( $node['config'] ?? null ) ? $node['config'] : [] ),
		];
	}

	private function normalize_flow_edge( $edge, array $node_ids ): ?array {
		if ( ! is_array( $edge ) ) return null;
		$source = isset( $edge['source'] ) ? sanitize_text_field( (string) $edge['source'] ) : '';
		$target = isset( $edge['target'] ) ? sanitize_text_field( (string) $edge['target'] ) : '';
		if ( '' === $source || '' === $target || ! isset( $node_ids[ $source ] ) || ! isset( $node_ids[ $target ] ) ) {
			return null;
		}
		$source_port = isset( $edge['sourcePort'] ) ? sanitize_key( (string) $edge['sourcePort'] ) : 'next';
		$target_port = isset( $edge['targetPort'] ) ? sanitize_key( (string) $edge['targetPort'] ) : 'in';
		return [
			'id' => isset( $edge['id'] ) ? sanitize_text_field( (string) $edge['id'] ) : uniqid( 'flow-edge-', true ),
			'source' => $source,
			'target' => $target,
			'sourcePort' => in_array( $source_port, [ 'next', 'true', 'false', 'submitted', 'error' ], true ) ? $source_port : 'next',
			'targetPort' => '' !== $target_port ? $target_port : 'in',
		];
	}

	private function normalize_flow( $flow ): ?array {
		if ( ! is_array( $flow ) ) return null;
		$nodes = [];
		$node_ids = [];
		foreach ( $flow['nodes'] ?? [] as $node ) {
			$normalized_node = $this->normalize_flow_node( $node );
			if ( ! $normalized_node ) continue;
			$nodes[] = $normalized_node;
			$node_ids[ $normalized_node['id'] ] = true;
		}
		if ( empty( $nodes ) ) return null;
		$edges = [];
		foreach ( $flow['edges'] ?? [] as $edge ) {
			$normalized_edge = $this->normalize_flow_edge( $edge, $node_ids );
			if ( $normalized_edge ) $edges[] = $normalized_edge;
		}
		return [
			'id' => isset( $flow['id'] ) ? sanitize_text_field( (string) $flow['id'] ) : uniqid( 'flow-', true ),
			'name' => isset( $flow['name'] ) && is_string( $flow['name'] ) && trim( $flow['name'] ) !== '' ? sanitize_text_field( $flow['name'] ) : 'Untitled Flow',
			'trigger' => $this->normalize_flow_trigger( is_array( $flow['trigger'] ?? null ) ? $flow['trigger'] : [] ),
			'nodes' => $nodes,
			'edges' => $edges,
			'legacySourceElementId' => isset( $flow['legacySourceElementId'] ) ? sanitize_text_field( (string) $flow['legacySourceElementId'] ) : '',
			'isLegacyProxy' => ! empty( $flow['isLegacyProxy'] ),
		];
	}

	private function normalize_flow_list( $flows ): array {
		if ( ! is_array( $flows ) ) return [];
		$normalized = [];
		foreach ( $flows as $flow ) {
			$normalized_flow = $this->normalize_flow( $flow );
			if ( $normalized_flow ) $normalized[] = $normalized_flow;
		}
		return $normalized;
	}

	private function get_element_flow( string $element_id ): ?array {
		if ( '' === $element_id ) return null;
		foreach ( $this->page_flows as $flow ) {
			$trigger = is_array( $flow['trigger'] ?? null ) ? $flow['trigger'] : [];
			if ( ( $trigger['type'] ?? '' ) === 'element-click' && ( $trigger['elementId'] ?? '' ) === $element_id ) {
				return $flow;
			}
		}
		return null;
	}

	private function get_form_flow( string $form_id ): ?array {
		if ( '' === $form_id ) return null;
		foreach ( $this->page_flows as $flow ) {
			$trigger = is_array( $flow['trigger'] ?? null ) ? $flow['trigger'] : [];
			if ( ( $trigger['type'] ?? '' ) === 'form-submit' && ( $trigger['formId'] ?? '' ) === $form_id ) {
				return $flow;
			}
		}
		return null;
	}

	private function is_form_container_type( string $type ): bool {
		return 'form' === $type;
	}

	private function is_form_field_type( string $type ): bool {
		return in_array( $type, [ 'text-field', 'textarea-field', 'rich-text-editor', 'radio-group', 'dropdown', 'checkbox', 'file-upload', 'captcha' ], true );
	}

	private function is_form_submit_button_type( string $type ): bool {
		return 'submit-button' === $type;
	}

	private function normalize_form_field_name( array $resolved, array $el, string $fallback_id ): string {
		$field_name = isset( $resolved['fieldName'] ) && is_string( $resolved['fieldName'] ) ? trim( $resolved['fieldName'] ) : '';
		if ( '' === $field_name ) {
			$field_name = isset( $el['name'] ) && is_string( $el['name'] ) ? trim( $el['name'] ) : '';
		}
		$field_name = strtolower( preg_replace( '/[^a-zA-Z0-9_-]+/', '_', $field_name ) ?? '' );
		$field_name = trim( $field_name, '_' );
		if ( '' === $field_name ) {
			$field_name = 'field_' . strtolower( $fallback_id );
		}
		return $field_name;
	}

	private function normalize_form_field_options( $value ): array {
		if ( ! is_array( $value ) ) return [];
		$options = [];
		foreach ( $value as $index => $option ) {
			if ( ! is_array( $option ) ) continue;
			$label = isset( $option['label'] ) && is_string( $option['label'] ) && trim( $option['label'] ) !== ''
				? trim( $option['label'] )
				: 'Option ' . ( $index + 1 );
			$option_value = isset( $option['value'] ) && is_string( $option['value'] ) && trim( $option['value'] ) !== ''
				? trim( $option['value'] )
				: sanitize_title( $label );
			$options[] = [
				'id' => isset( $option['id'] ) && is_string( $option['id'] ) ? sanitize_text_field( $option['id'] ) : 'option-' . ( $index + 1 ),
				'label' => sanitize_text_field( $label ),
				'value' => sanitize_text_field( $option_value ),
				'enabled' => ! isset( $option['enabled'] ) || false !== $option['enabled'],
			];
		}
		return $options;
	}

	private function normalize_form_config( $value ): array {
		$config = is_array( $value ) ? $value : [];
		$actions = is_array( $config['actions'] ?? null ) ? $config['actions'] : [];
		$email = is_array( $actions['email'] ?? null ) ? $actions['email'] : [];
		$webhook = is_array( $actions['webhook'] ?? null ) ? $actions['webhook'] : [];
		$store = is_array( $actions['store'] ?? null ) ? $actions['store'] : [];

		return [
			'state' => isset( $config['state'] ) && is_string( $config['state'] ) ? sanitize_key( $config['state'] ) : 'idle',
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
				'store' => [
					'enabled' => ! isset( $store['enabled'] ) || ! empty( $store['enabled'] ),
				],
				'email' => [
					'enabled' => ! empty( $email['enabled'] ),
					'to' => isset( $email['to'] ) && is_string( $email['to'] ) ? sanitize_text_field( $email['to'] ) : '',
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

	private function render_form_field_content( array $el, array $resolved, array $styles, string $id ): string {
		$type = isset( $el['type'] ) ? (string) $el['type'] : '';
		if ( ! $this->is_form_field_type( $type ) ) return '';

		$field_name = $this->normalize_form_field_name( $resolved, $el, $id );
		$field_label = isset( $resolved['label'] ) && is_string( $resolved['label'] ) && trim( $resolved['label'] ) !== ''
			? trim( $resolved['label'] )
			: ( isset( $el['name'] ) && is_string( $el['name'] ) ? trim( $el['name'] ) : 'Field' );
		$placeholder = isset( $resolved['placeholder'] ) && is_string( $resolved['placeholder'] ) ? trim( $resolved['placeholder'] ) : '';
		$helper_text = isset( $resolved['helperText'] ) && is_string( $resolved['helperText'] ) ? trim( $resolved['helperText'] ) : '';
		$required_attr = ! empty( $resolved['required'] ) ? ' required' : '';
		$options = $this->normalize_form_field_options( $resolved['fieldOptions'] ?? [] );
		$base_text_color = $this->sanitize_css_value( $this->get_gradient_fallback_color( $styles['color'] ?? '', '#0f172a' ) );
		$helper_color = $this->sanitize_css_value( $styles['helperColor'] ?? 'rgba(15,23,42,0.58)' );
		$placeholder_color = $this->sanitize_css_value( $styles['placeholderColor'] ?? 'rgba(15,23,42,0.58)' );
		$icon_color = $this->sanitize_css_value( $styles['iconColor'] ?? $placeholder_color );
		$select_icon = isset( $styles['selectIcon'] ) && is_string( $styles['selectIcon'] ) ? sanitize_key( $styles['selectIcon'] ) : 'caret';
		$hover_border_color = $this->sanitize_css_value( $styles['hoverBorderColor'] ?? ( $styles['borderColor'] ?? 'rgba(37,99,235,0.32)' ) );
		$hover_background_color = $this->sanitize_css_value( $styles['hoverBackgroundColor'] ?? ( $styles['backgroundColor'] ?? '#ffffff' ) );
		$focus_border_color = $this->sanitize_css_value( $styles['focusBorderColor'] ?? '#2563eb' );
		$focus_background_color = $this->sanitize_css_value( $styles['focusBackgroundColor'] ?? ( $styles['backgroundColor'] ?? '#ffffff' ) );
		$focus_ring_color = $this->sanitize_css_value( $styles['focusRingColor'] ?? 'rgba(37,99,235,0.2)' );
		$focus_ring_width = isset( $styles['focusRingWidth'] ) && is_numeric( $styles['focusRingWidth'] ) ? max( 0, (float) $styles['focusRingWidth'] ) : 3;
		$font_family = isset( $styles['fontFamily'] ) && is_string( $styles['fontFamily'] ) && trim( $styles['fontFamily'] ) !== ''
			? $this->sanitize_css_value( "'" . trim( $styles['fontFamily'] ) . "', sans-serif" )
			: 'inherit';
		$font_size = isset( $styles['fontSize'] ) && is_numeric( $styles['fontSize'] ) ? max( 10, (float) $styles['fontSize'] ) : 14;
		$font_weight = isset( $styles['fontWeight'] ) && is_numeric( $styles['fontWeight'] ) ? (int) $styles['fontWeight'] : 500;
		$font_style = $this->sanitize_css_value( $styles['fontStyle'] ?? 'normal' );
		$line_height = isset( $styles['lineHeight'] ) && is_numeric( $styles['lineHeight'] ) ? max( 0.8, (float) $styles['lineHeight'] ) : 1.4;
		$letter_spacing = isset( $styles['letterSpacing'] ) && is_numeric( $styles['letterSpacing'] ) ? (float) $styles['letterSpacing'] : 0;
		$field_gap = isset( $styles['gap'] ) && is_numeric( $styles['gap'] ) ? max( 0, (float) $styles['gap'] ) : 8;
		$padding_top = isset( $styles['paddingTop'] ) && is_numeric( $styles['paddingTop'] ) ? max( 0, (float) $styles['paddingTop'] ) : 14;
		$padding_right = isset( $styles['paddingRight'] ) && is_numeric( $styles['paddingRight'] ) ? max( 0, (float) $styles['paddingRight'] ) : 18;
		$padding_bottom = isset( $styles['paddingBottom'] ) && is_numeric( $styles['paddingBottom'] ) ? max( 0, (float) $styles['paddingBottom'] ) : 14;
		$padding_left = isset( $styles['paddingLeft'] ) && is_numeric( $styles['paddingLeft'] ) ? max( 0, (float) $styles['paddingLeft'] ) : 18;
		if ( ( $styles['borderRadiusMode'] ?? '' ) === 'independent' ) {
			$base_border_radius = isset( $styles['borderRadius'] ) && is_numeric( $styles['borderRadius'] ) ? (float) $styles['borderRadius'] : 0;
			$radius_tl = isset( $styles['borderRadiusTL'] ) && is_numeric( $styles['borderRadiusTL'] ) ? (float) $styles['borderRadiusTL'] : $base_border_radius;
			$radius_tr = isset( $styles['borderRadiusTR'] ) && is_numeric( $styles['borderRadiusTR'] ) ? (float) $styles['borderRadiusTR'] : $base_border_radius;
			$radius_br = isset( $styles['borderRadiusBR'] ) && is_numeric( $styles['borderRadiusBR'] ) ? (float) $styles['borderRadiusBR'] : $base_border_radius;
			$radius_bl = isset( $styles['borderRadiusBL'] ) && is_numeric( $styles['borderRadiusBL'] ) ? (float) $styles['borderRadiusBL'] : $base_border_radius;
			$control_border_radius = esc_attr( round( $radius_tl, 3 ) . 'px ' . round( $radius_tr, 3 ) . 'px ' . round( $radius_br, 3 ) . 'px ' . round( $radius_bl, 3 ) . 'px' );
		} else {
			$control_border_radius = isset( $styles['borderRadius'] ) && is_numeric( $styles['borderRadius'] )
				? esc_attr( round( (float) $styles['borderRadius'], 3 ) . 'px' )
				: esc_attr( $this->sanitize_css_value( $styles['borderRadius'] ?? '0px' ) );
		}
		$border_width = isset( $styles['borderWidth'] ) && is_numeric( $styles['borderWidth'] ) ? max( 0, (float) $styles['borderWidth'] ) : 1;
		$border_style = $this->sanitize_css_value( $styles['borderStyle'] ?? 'solid' );
		$border_color = $this->sanitize_css_value( $styles['borderColor'] ?? 'rgba(15,23,42,0.12)' );
		$background_color = $this->sanitize_css_value( $styles['backgroundColor'] ?? '#ffffff' );
		$box_shadow = $this->sanitize_css_value( $styles['boxShadow'] ?? '0 1px 2px rgba(15,23,42,0.06)' );
		$focus_state_shadow = $this->sanitize_css_value( $styles['focusBoxShadow'] ?? '' );
		$focus_box_shadow = 'none' !== $box_shadow ? $box_shadow : '';
		if ( '' !== $focus_state_shadow && 'none' !== $focus_state_shadow ) {
			$focus_box_shadow = '' !== $focus_box_shadow ? $focus_box_shadow . ',' . $focus_state_shadow : $focus_state_shadow;
		}
		if ( $focus_ring_width > 0 ) {
			$focus_ring_shadow = '0 0 0 ' . round( $focus_ring_width, 3 ) . 'px ' . $focus_ring_color;
			$focus_box_shadow = '' !== $focus_box_shadow ? $focus_box_shadow . ',' . $focus_ring_shadow : $focus_ring_shadow;
		}
		$checked_border_color = $this->sanitize_css_value( $styles['checkedBorderColor'] ?? $focus_border_color );
		$checked_background_color = $this->sanitize_css_value( $styles['checkedBackgroundColor'] ?? '#eff6ff' );
		$checked_state_shadow = $this->sanitize_css_value( $styles['checkedBoxShadow'] ?? '' );
		$checked_box_shadow = 'none' !== $box_shadow ? $box_shadow : '';
		if ( '' !== $checked_state_shadow && 'none' !== $checked_state_shadow ) {
			$checked_box_shadow = '' !== $checked_box_shadow ? $checked_box_shadow . ',' . $checked_state_shadow : $checked_state_shadow;
		}
		$state_transition_duration = isset( $styles['stateTransitionDuration'] ) && is_numeric( $styles['stateTransitionDuration'] ) ? max( 0, (float) $styles['stateTransitionDuration'] ) : 0.16;
		$state_transition_easing = $this->sanitize_css_value( $styles['stateTransitionEasing'] ?? 'ease' );
		if ( ! in_array( $state_transition_easing, [ 'ease', 'linear', 'ease-in-out' ], true ) ) {
			$state_transition_easing = 'ease';
		}
		$state_transition = round( $state_transition_duration, 3 ) . 's ' . $state_transition_easing;
		$text_align = $this->sanitize_css_value( $styles['textAlign'] ?? 'left' );
		$text_decoration = $this->sanitize_css_value( $styles['textDecoration'] ?? 'none' );
		$field_text_style = 'font-family:' . $font_family . ';font-size:' . esc_attr( $font_size ) . 'px;font-weight:' . esc_attr( (string) $font_weight ) . ';font-style:' . $font_style . ';line-height:' . esc_attr( $line_height ) . ';letter-spacing:' . esc_attr( $letter_spacing ) . 'em;text-align:' . $text_align . ';text-decoration:' . $text_decoration . ';';
		$label_text_style = 'font-family:' . $font_family . ';font-size:' . esc_attr( (string) max( 10, round( $font_size * 0.86 ) ) ) . 'px;font-weight:' . esc_attr( (string) max( 600, $font_weight ) ) . ';line-height:' . esc_attr( $line_height ) . ';letter-spacing:' . esc_attr( $letter_spacing ) . 'em;text-align:' . $text_align . ';';
		$field_stack_style = 'display:grid;height:100%;align-content:start;gap:' . esc_attr( (string) round( $field_gap, 3 ) ) . 'px;';
		$label_markup = ( 'checkbox' !== $type && '' !== $field_label )
			? '<label class="fb-form-field__label" for="' . esc_attr( $id . '__input' ) . '" style="display:block;color:' . esc_attr( $base_text_color ) . ';' . $label_text_style . '">' . esc_html( $field_label ) . '</label>'
			: '';
		$helper_markup = '' !== $helper_text
			? '<div class="fb-form-field__helper" style="color:' . esc_attr( $helper_color ) . ';' . $field_text_style . 'font-size:' . esc_attr( (string) max( 11, $font_size - 1 ) ) . 'px;">' . esc_html( $helper_text ) . '</div>'
			: '';
		$control_min_height = max( 36, round( $font_size * $line_height + $padding_top + $padding_bottom, 3 ) );
		$control_shell_id = $id . '__control';
		$control_input_id = $id . '__input';
		$control_state_css = '<style>#' . esc_attr( $control_shell_id ) . '{transition:border-color ' . esc_attr( $state_transition ) . ',background-color ' . esc_attr( $state_transition ) . ',box-shadow ' . esc_attr( $state_transition ) . ';}#' . esc_attr( $control_input_id ) . '::placeholder{color:' . esc_attr( $placeholder_color ) . ';opacity:1;}#' . esc_attr( $control_shell_id ) . ':hover{border-color:' . esc_attr( $hover_border_color ) . ' !important;background:' . esc_attr( $hover_background_color ) . ' !important;}#' . esc_attr( $control_shell_id ) . ':focus-within{border-color:' . esc_attr( $focus_border_color ) . ' !important;background:' . esc_attr( $focus_background_color ) . ' !important;box-shadow:' . esc_attr( $focus_box_shadow ) . ' !important;}#' . esc_attr( $control_shell_id ) . ' .fb-form-field__indicator{transition:color ' . esc_attr( $state_transition ) . ';}</style>';
		$control_shell_style = 'position:relative;width:100%;min-height:' . esc_attr( (string) $control_min_height ) . 'px;display:flex;align-items:center;box-sizing:border-box;border:' . esc_attr( round( $border_width, 3 ) ) . 'px ' . $border_style . ' ' . $border_color . ';border-radius:' . $control_border_radius . ';background:' . $background_color . ';box-shadow:' . $box_shadow . ';overflow:hidden;';
		$control_style = 'width:100%;min-height:' . esc_attr( (string) $control_min_height ) . 'px;display:block;box-sizing:border-box;border:0;outline:none;background:transparent;color:' . esc_attr( $base_text_color ) . ';box-shadow:none;' . $field_text_style;
		$control_padding_style = 'padding:' . esc_attr( round( $padding_top, 3 ) . 'px ' . round( $padding_right, 3 ) . 'px ' . round( $padding_bottom, 3 ) . 'px ' . round( $padding_left, 3 ) . 'px' ) . ';';
		$select_padding_style = 'padding:' . esc_attr( round( $padding_top, 3 ) . 'px ' . round( max( 40, $padding_right + 26 ), 3 ) . 'px ' . round( $padding_bottom, 3 ) . 'px ' . round( $padding_left, 3 ) . 'px' ) . ';';
		$checkbox_accent_color = $this->sanitize_css_value( $styles['checkboxAccentColor'] ?? '#2563eb' );

		if ( 'textarea-field' === $type ) {
			$textarea_value = isset( $resolved['defaultValue'] ) && is_string( $resolved['defaultValue'] )
				? $resolved['defaultValue']
				: '';
			return '<div class="fb-form-field" style="' . esc_attr( $field_stack_style ) . '">'
				. $label_markup
				. $control_state_css
				. '<div id="' . esc_attr( $control_shell_id ) . '" data-fb-form-surface="true" style="' . esc_attr( $control_shell_style . 'min-height:' . max( 96, $control_min_height ) . 'px;align-items:stretch;' ) . '"><textarea id="' . esc_attr( $control_input_id ) . '" class="fb-form-control fb-form-control--textarea" name="' . esc_attr( $field_name ) . '" placeholder="' . esc_attr( $placeholder ) . '" rows="4" style="' . esc_attr( $control_style . $control_padding_style . 'min-height:' . max( 96, $control_min_height ) . 'px;resize:vertical;' ) . '"' . $required_attr . '>' . esc_textarea( $textarea_value ) . '</textarea></div>'
				. $helper_markup
				. '</div>';
		}

		if ( 'text-field' === $type ) {
			$input_type = 'text';
			if ( false !== stripos( $field_name, 'email' ) ) {
				$input_type = 'email';
			} elseif ( false !== stripos( $field_name, 'phone' ) || false !== stripos( $field_name, 'tel' ) ) {
				$input_type = 'tel';
			} elseif ( false !== stripos( $field_name, 'password' ) ) {
				$input_type = 'password';
			}
			return '<div class="fb-form-field" style="' . esc_attr( $field_stack_style ) . '">'
				. $label_markup
				. $control_state_css
				. '<div id="' . esc_attr( $control_shell_id ) . '" data-fb-form-surface="true" style="' . esc_attr( $control_shell_style ) . '"><input id="' . esc_attr( $control_input_id ) . '" class="fb-form-control fb-form-control--text" type="' . esc_attr( $input_type ) . '" name="' . esc_attr( $field_name ) . '" placeholder="' . esc_attr( $placeholder ) . '" style="' . esc_attr( $control_style . $control_padding_style ) . '"' . $required_attr . '></div>'
				. $helper_markup
				. '</div>';
		}

		if ( 'dropdown' === $type ) {
			$markup = '<div class="fb-form-field" style="' . esc_attr( $field_stack_style ) . '">' . $label_markup . $control_state_css;
			$markup .= '<div id="' . esc_attr( $control_shell_id ) . '" data-fb-form-surface="true" style="' . esc_attr( $control_shell_style ) . '">';
			$markup .= '<select id="' . esc_attr( $control_input_id ) . '" class="fb-form-control fb-form-control--select" name="' . esc_attr( $field_name ) . '" style="' . esc_attr( $control_style . 'appearance:none;-webkit-appearance:none;' . $select_padding_style ) . '"' . $required_attr . '>';
			$markup .= '<option value="">' . esc_html( $placeholder !== '' ? $placeholder : 'Select an option' ) . '</option>';
			foreach ( $options as $option ) {
				if ( isset( $option['enabled'] ) && false === $option['enabled'] ) {
					continue;
				}
				$markup .= '<option value="' . esc_attr( $option['value'] ) . '"' . ( isset( $resolved['defaultValue'] ) && $resolved['defaultValue'] === $option['value'] ? ' selected' : '' ) . '>' . esc_html( $option['label'] ) . '</option>';
			}
			$markup .= '</select>';
			if ( 'none' !== $select_icon ) {
				$markup .= '<span class="fb-form-field__indicator" aria-hidden="true" style="position:absolute;right:' . esc_attr( round( max( 12, $padding_right ), 3 ) ) . 'px;top:50%;transform:translateY(-50%);font-size:12px;color:' . esc_attr( $icon_color ) . ';pointer-events:none;">' . esc_html( 'chevron' === $select_icon ? '⌄' : '▼' ) . '</span>';
			}
			$markup .= '</div>' . $helper_markup . '</div>';
			return $markup;
		}

		if ( 'rich-text-editor' === $type ) {
			$editor_initial_value = isset( $resolved['defaultValue'] ) && is_string( $resolved['defaultValue'] )
				? wp_kses_post( $resolved['defaultValue'] )
				: '';
			$editor_is_empty = '' === trim( wp_strip_all_tags( $editor_initial_value ) );
			$richtext_toolbar_style = $field_text_style . 'font-size:' . esc_attr( (string) max( 11, round( $font_size * 0.92 ) ) ) . 'px;color:' . esc_attr( $base_text_color ) . ';padding:8px ' . esc_attr( round( $padding_right, 3 ) ) . 'px 8px ' . esc_attr( round( $padding_left, 3 ) ) . 'px;border-bottom:' . esc_attr( round( $border_width, 3 ) ) . 'px ' . $border_style . ' ' . $border_color . ';';
			$markup = '<div class="fb-form-field" style="' . esc_attr( $field_stack_style ) . '">' . $label_markup . $control_state_css;
			$markup .= '<div id="' . esc_attr( $control_shell_id ) . '" class="fb-form-richtext" data-fb-form-surface="true" data-fb-richtext-field="true" style="' . esc_attr( $control_shell_style . 'display:grid;grid-template-rows:auto minmax(0,1fr);align-items:stretch;min-height:' . max( 120, $control_min_height ) . 'px;' ) . '">';
			$markup .= '<div class="fb-form-richtext__toolbar" style="' . esc_attr( $richtext_toolbar_style ) . '">';
			$markup .= '<span class="fb-form-richtext__toolbar-group">';
			$markup .= '<button type="button" class="fb-form-richtext__toolbar-btn" data-fb-richtext-command="formatBlock" data-fb-richtext-value="p" aria-label="Paragraph">P</button>';
			$markup .= '<button type="button" class="fb-form-richtext__toolbar-btn" data-fb-richtext-command="formatBlock" data-fb-richtext-value="h2" aria-label="Heading">H2</button>';
			$markup .= '<button type="button" class="fb-form-richtext__toolbar-btn" data-fb-richtext-command="formatBlock" data-fb-richtext-value="blockquote" aria-label="Quote">Q</button>';
			$markup .= '</span>';
			$markup .= '<span class="fb-form-richtext__toolbar-group">';
			$markup .= '<button type="button" class="fb-form-richtext__toolbar-btn" data-fb-richtext-command="bold" aria-label="Bold"><strong>B</strong></button>';
			$markup .= '<button type="button" class="fb-form-richtext__toolbar-btn" data-fb-richtext-command="italic" aria-label="Italic"><em>I</em></button>';
			$markup .= '<button type="button" class="fb-form-richtext__toolbar-btn" data-fb-richtext-command="underline" aria-label="Underline"><span style="text-decoration:underline;">U</span></button>';
			$markup .= '<button type="button" class="fb-form-richtext__toolbar-btn" data-fb-richtext-command="removeFormat" aria-label="Clear formatting">Tx</button>';
			$markup .= '</span>';
			$markup .= '<span class="fb-form-richtext__toolbar-group">';
			$markup .= '<button type="button" class="fb-form-richtext__toolbar-btn" data-fb-richtext-command="insertUnorderedList" aria-label="Bullet list">•</button>';
			$markup .= '<button type="button" class="fb-form-richtext__toolbar-btn" data-fb-richtext-command="insertOrderedList" aria-label="Numbered list">1.</button>';
			$markup .= '<button type="button" class="fb-form-richtext__toolbar-btn" data-fb-richtext-command="createLink" aria-label="Insert link">Link</button>';
			$markup .= '<button type="button" class="fb-form-richtext__toolbar-btn" data-fb-richtext-command="undo" aria-label="Undo">↺</button>';
			$markup .= '<button type="button" class="fb-form-richtext__toolbar-btn" data-fb-richtext-command="redo" aria-label="Redo">↻</button>';
			$markup .= '</span>';
			$markup .= '</div>';
			$markup .= '<div class="fb-form-richtext__editor' . ( $editor_is_empty ? ' is-empty' : '' ) . '" id="' . esc_attr( $id . '__editor' ) . '" data-fb-richtext-editor="true" data-placeholder="' . esc_attr( $placeholder !== '' ? $placeholder : 'Write formatted content...' ) . '" contenteditable="true" role="textbox" aria-multiline="true" style="' . esc_attr( $field_text_style . $control_padding_style . 'min-height:96px;color:' . $base_text_color . ';' ) . '">' . $editor_initial_value . '</div>';
			$markup .= '<textarea id="' . esc_attr( $control_input_id ) . '" class="fb-form-control fb-form-control--richtext" name="' . esc_attr( $field_name ) . '" style="display:none;" data-fb-richtext-input="true">' . esc_textarea( $editor_initial_value ) . '</textarea>';
			$markup .= '</div>' . $helper_markup . '</div>';
			return $markup;
		}

		if ( 'checkbox' === $type ) {
			$choice_control_style = 'position:relative;width:16px;height:16px;min-width:16px;min-height:16px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;border:' . esc_attr( round( $border_width, 3 ) ) . 'px ' . $border_style . ' ' . $border_color . ';border-radius:' . $control_border_radius . ';background:' . esc_attr( $background_color ) . ';box-shadow:' . esc_attr( $box_shadow ) . ';color:' . esc_attr( $checkbox_accent_color ) . ';transition:border-color ' . esc_attr( $state_transition ) . ',background-color ' . esc_attr( $state_transition ) . ',box-shadow ' . esc_attr( $state_transition ) . ',color ' . esc_attr( $state_transition ) . ';flex:0 0 auto;';
			$choice_state_css = '<style>#' . esc_attr( $control_input_id ) . ':focus + .fb-form-choice__control,#' . esc_attr( $control_input_id ) . ':focus-visible + .fb-form-choice__control{border-color:' . esc_attr( $focus_border_color ) . ' !important;background:' . esc_attr( $focus_background_color ) . ' !important;box-shadow:' . esc_attr( $focus_box_shadow ) . ' !important;}#' . esc_attr( $control_input_id ) . ':checked + .fb-form-choice__control{border-color:' . esc_attr( $checked_border_color ) . ' !important;background:' . esc_attr( $checked_background_color ) . ' !important;box-shadow:' . esc_attr( $checked_box_shadow ) . ' !important;}#' . esc_attr( $control_input_id ) . ':checked + .fb-form-choice__control .fb-form-choice__mark{opacity:1 !important;}</style>';
			return '<div class="fb-form-field" style="display:grid;height:100%;align-content:center;gap:' . esc_attr( round( $field_gap, 3 ) ) . 'px;">'
				. $choice_state_css
				. '<label class="fb-form-field fb-form-field--checkbox" style="position:relative;display:flex;align-items:center;gap:' . esc_attr( round( $field_gap, 3 ) ) . 'px;width:100%;height:100%;color:' . esc_attr( $base_text_color ) . ';' . $field_text_style . '">'
				. '<span class="fb-form-choice">'
				. '<input id="' . esc_attr( $id . '__input' ) . '" class="fb-form-control fb-form-control--checkbox fb-form-choice__input" type="checkbox" name="' . esc_attr( $field_name ) . '" value="1"' . ( ! empty( $resolved['defaultValue'] ) ? ' checked' : '' ) . $required_attr . '>'
				. '<span class="fb-form-choice__control" style="' . esc_attr( $choice_control_style ) . '"><span class="fb-form-choice__mark" style="width:8px;height:5px;border-left:1.8px solid ' . esc_attr( $checkbox_accent_color ) . ';border-bottom:1.8px solid ' . esc_attr( $checkbox_accent_color ) . ';transform:rotate(-45deg) translateY(-1px);opacity:0;transition:opacity ' . esc_attr( $state_transition ) . ';"></span></span>'
				. '</span>'
				. '<span class="fb-form-choice__label" style="color:' . esc_attr( $base_text_color ) . ';' . $field_text_style . '">' . esc_html( $field_label ) . '</span>'
				. '</label>'
				. $helper_markup
				. '</div>';
		}

		if ( 'radio-group' === $type ) {
			$choice_control_style = 'position:relative;width:16px;height:16px;min-width:16px;min-height:16px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;border:' . esc_attr( round( $border_width, 3 ) ) . 'px ' . $border_style . ' ' . $border_color . ';border-radius:999px;background:' . esc_attr( $background_color ) . ';box-shadow:' . esc_attr( $box_shadow ) . ';color:' . esc_attr( $checkbox_accent_color ) . ';transition:border-color ' . esc_attr( $state_transition ) . ',background-color ' . esc_attr( $state_transition ) . ',box-shadow ' . esc_attr( $state_transition ) . ',color ' . esc_attr( $state_transition ) . ';flex:0 0 auto;';
			$markup = '<div class="fb-form-field" style="' . esc_attr( $field_stack_style ) . '">';
			$markup .= '<fieldset class="fb-form-field fb-form-field--radio" style="margin:0;padding:0;border:0;min-inline-size:0;display:grid;gap:' . esc_attr( round( $field_gap, 3 ) ) . 'px;font-family:' . $font_family . ';font-size:' . esc_attr( $font_size ) . 'px;font-weight:' . esc_attr( (string) $font_weight ) . ';font-style:' . $font_style . ';line-height:' . esc_attr( $line_height ) . ';letter-spacing:' . esc_attr( $letter_spacing ) . 'em;">';
			if ( '' !== $field_label ) {
				$markup .= '<legend style="padding:0;margin:0;color:' . esc_attr( $base_text_color ) . ';' . $label_text_style . '">' . esc_html( $field_label ) . '</legend>';
			}
			foreach ( $options as $index => $option ) {
				if ( isset( $option['enabled'] ) && false === $option['enabled'] ) {
					continue;
				}
				$option_input_id = $id . '__input_' . $index;
				$is_checked = ( ! empty( $resolved['defaultValue'] ) && $resolved['defaultValue'] === $option['value'] ) || ( 0 === $index && ! empty( $resolved['defaultValue'] ) && true === $resolved['defaultValue'] );
				$markup .= '<style>#' . esc_attr( $option_input_id ) . ':focus + .fb-form-choice__control,#' . esc_attr( $option_input_id ) . ':focus-visible + .fb-form-choice__control{border-color:' . esc_attr( $focus_border_color ) . ' !important;background:' . esc_attr( $focus_background_color ) . ' !important;box-shadow:' . esc_attr( $focus_box_shadow ) . ' !important;}#' . esc_attr( $option_input_id ) . ':checked + .fb-form-choice__control{border-color:' . esc_attr( $checked_border_color ) . ' !important;background:' . esc_attr( $checked_background_color ) . ' !important;box-shadow:' . esc_attr( $checked_box_shadow ) . ' !important;}#' . esc_attr( $option_input_id ) . ':checked + .fb-form-choice__control .fb-form-choice__mark{opacity:1 !important;}</style>';
				$markup .= '<label style="position:relative;display:flex;align-items:center;gap:' . esc_attr( round( $field_gap, 3 ) ) . 'px;color:' . esc_attr( $base_text_color ) . ';' . $field_text_style . '">';
				$markup .= '<span class="fb-form-choice">';
				$markup .= '<input id="' . esc_attr( $option_input_id ) . '" class="fb-form-control fb-form-choice__input" type="radio" name="' . esc_attr( $field_name ) . '" value="' . esc_attr( $option['value'] ) . '"' . ( $is_checked ? ' checked' : '' ) . $required_attr . '>';
				$markup .= '<span class="fb-form-choice__control" style="' . esc_attr( $choice_control_style ) . '"><span class="fb-form-choice__mark" style="width:6px;height:6px;border-radius:999px;background:' . esc_attr( $checkbox_accent_color ) . ';opacity:0;transition:opacity ' . esc_attr( $state_transition ) . ';"></span></span>';
				$markup .= '</span>';
				$markup .= '<span class="fb-form-choice__label" style="color:' . esc_attr( $base_text_color ) . ';' . $field_text_style . '">' . esc_html( $option['label'] ) . '</span>';
				$markup .= '</label>';
			}
			$markup .= '</fieldset>' . $helper_markup . '</div>';
			return $markup;
		}

		if ( 'file-upload' === $type ) {
			$allows_multiple_files = ! empty( $resolved['allowMultipleFiles'] );
			$file_input_name = $allows_multiple_files ? $field_name . '[]' : $field_name;
			$markup = '<div class="fb-form-field" style="' . esc_attr( $field_stack_style ) . '">' . $label_markup;
			$markup .= $control_state_css;
			$markup .= '<label id="' . esc_attr( $control_shell_id ) . '" class="fb-form-file-upload" data-fb-form-surface="true" data-fb-file-upload="true" data-fb-file-upload-multiple="' . ( $allows_multiple_files ? 'true' : 'false' ) . '" data-fb-file-upload-placeholder="' . esc_attr( $placeholder !== '' ? $placeholder : 'Drop files here or browse' ) . '" for="' . esc_attr( $control_input_id ) . '" style="height:100%;padding:' . esc_attr( round( $padding_top, 3 ) . 'px ' . round( $padding_right, 3 ) . 'px ' . round( $padding_bottom, 3 ) . 'px ' . round( $padding_left, 3 ) . 'px' ) . ';border:1.5px dashed ' . esc_attr( $border_color ) . ';border-radius:' . $control_border_radius . ';background:' . esc_attr( $background_color ) . ';box-shadow:' . esc_attr( $box_shadow ) . ';">';
			$markup .= '<span style="color:' . esc_attr( $base_text_color ) . ';' . $label_text_style . 'text-align:center;">' . esc_html( $allows_multiple_files ? 'Multi-file dropzone' : 'File dropzone' ) . '</span>';
			$markup .= '<span data-fb-file-upload-label="true" style="color:' . esc_attr( $placeholder_color ) . ';' . $field_text_style . 'font-size:' . esc_attr( max( 11, round( $font_size - 1, 2 ) ) ) . 'px;text-align:center;">' . esc_html( $placeholder !== '' ? $placeholder : 'Drop files here or browse' ) . '</span>';
			$markup .= '<span class="fb-form-file-upload__meta" data-fb-file-upload-meta="true" style="color:' . esc_attr( $placeholder_color ) . ';' . $field_text_style . 'font-size:' . esc_attr( max( 10, round( $font_size - 2, 2 ) ) ) . 'px;text-align:center;">' . esc_html( $allows_multiple_files ? 'Accepts multiple files' : 'Accepts one file' ) . '</span>';
			$markup .= '<input id="' . esc_attr( $control_input_id ) . '" class="fb-form-control fb-form-control--file fb-form-file-upload__input" type="file" name="' . esc_attr( $file_input_name ) . '"' . ( $allows_multiple_files ? ' multiple' : '' ) . $required_attr . '>';
			$markup .= '</label>' . $helper_markup . '</div>';
			return $markup;
		}

		if ( 'captcha' === $type ) {
			return '<div class="fb-form-field fb-form-field--captcha" style="display:grid;place-items:center;gap:' . esc_attr( round( $field_gap, 3 ) ) . 'px;height:100%;padding:' . esc_attr( round( $padding_top, 3 ) . 'px ' . round( $padding_right, 3 ) . 'px ' . round( $padding_bottom, 3 ) . 'px ' . round( $padding_left, 3 ) . 'px' ) . ';text-align:center;">'
				. '<span style="color:#065f46;' . $label_text_style . 'text-align:center;">Captcha</span>'
				. '<span style="color:rgba(6,95,70,0.72);' . $field_text_style . 'font-size:' . esc_attr( max( 10, round( $font_size - 2, 2 ) ) ) . 'px;text-align:center;">' . esc_html( $placeholder !== '' ? $placeholder : 'Provider-backed verification' ) . '</span>'
				. '<input type="hidden" name="' . esc_attr( $field_name ) . '" value="captcha-placeholder">'
				. '</div>';
		}

		return '';
	}

	private function normalize_bindings( $bindings ): array {
		$normalized = [ 'desktop' => [], 'tablet' => [], 'mobile' => [] ];
		if ( ! is_array( $bindings ) ) return $normalized;

		foreach ( [ 'desktop', 'tablet', 'mobile' ] as $bp_id ) {
			$bp_bindings = $bindings[ $bp_id ] ?? null;
			if ( ! is_array( $bp_bindings ) ) continue;
			foreach ( $bp_bindings as $property_key => $binding ) {
				if ( ! is_array( $binding ) ) continue;
				$scope = isset( $binding['scope'] ) ? sanitize_key( (string) $binding['scope'] ) : 'page';
				$variable_id = isset( $binding['variableId'] ) ? sanitize_text_field( (string) $binding['variableId'] ) : '';
				if ( $variable_id === '' ) continue;
				$normalized[ $bp_id ][ $property_key ] = [
					'scope'      => in_array( $scope, [ 'global', 'loop-item' ], true ) ? $scope : 'page',
					'variableId' => $variable_id,
				];
			}
		}

		return $normalized;
	}

	private function resolve_binding( array $bindings, string $bp_id, string $property_key ): ?array {
		if ( $bp_id === 'mobile' ) {
			return $bindings['mobile'][ $property_key ] ?? $bindings['tablet'][ $property_key ] ?? $bindings['desktop'][ $property_key ] ?? null;
		}
		if ( $bp_id === 'tablet' ) {
			return $bindings['tablet'][ $property_key ] ?? $bindings['desktop'][ $property_key ] ?? null;
		}
		return $bindings['desktop'][ $property_key ] ?? null;
	}

	private function normalize_loop_config( $value ): array {
		$source = is_array( $value ) ? $value : [];
		$query = is_array( $source['query'] ?? null ) ? $source['query'] : [];

		// Top-level mode & source
		$mode = isset( $source['mode'] ) && in_array( $source['mode'], [ 'loop', 'slideshow', 'ticker', 'carousel' ], true ) ? $source['mode'] : 'loop';
		$child_source = isset( $source['source'] ) && in_array( $source['source'], [ 'query', 'manual', 'component' ], true ) ? $source['source'] : 'query';
		$component_id = isset( $source['componentId'] ) && is_string( $source['componentId'] ) && '' !== $source['componentId'] ? sanitize_text_field( $source['componentId'] ) : '';

		$layout = isset( $source['layout'] ) && in_array( $source['layout'], [ 'vertical', 'horizontal', 'grid' ], true ) ? $source['layout'] : 'vertical';
		$source_type = isset( $query['source'] ) && in_array( $query['source'], [ 'collection', 'selected', 'variable' ], true ) ? $query['source'] : 'collection';
		$collection = isset( $query['collection'] ) && in_array( $query['collection'], [ 'posts', 'pages', 'products' ], true ) ? $query['collection'] : 'posts';
		$limit = isset( $query['limit'] ) && is_numeric( $query['limit'] ) ? max( 1, (int) $query['limit'] ) : 6;
		$order = isset( $query['order'] ) && 'asc' === strtolower( (string) $query['order'] ) ? 'ASC' : 'DESC';
		$category_ids = [];
		if ( is_array( $query['categoryIds'] ?? null ) ) {
			foreach ( $query['categoryIds'] as $category_id ) {
				$category_id = (int) $category_id;
				if ( $category_id > 0 && ! in_array( $category_id, $category_ids, true ) ) {
					$category_ids[] = $category_id;
				}
			}
		}
		$selected_ids = [];
		if ( is_array( $query['selectedIds'] ?? null ) ) {
			foreach ( $query['selectedIds'] as $selected_id ) {
				$selected_id = (int) $selected_id;
				if ( $selected_id > 0 && ! in_array( $selected_id, $selected_ids, true ) ) {
					$selected_ids[] = $selected_id;
				}
			}
		}
		$variable = null;
		if ( is_array( $query['variable'] ?? null ) ) {
			$scope = isset( $query['variable']['scope'] ) && 'global' === $query['variable']['scope'] ? 'global' : 'page';
			$variable_id = isset( $query['variable']['variableId'] ) ? sanitize_text_field( (string) $query['variable']['variableId'] ) : '';
			if ( '' !== $variable_id ) {
				$variable = [
					'scope' => $scope,
					'variableId' => $variable_id,
				];
			}
		}

		// Slideshow settings
		$ss = is_array( $source['slideshow'] ?? null ) ? $source['slideshow'] : [];
		$slideshow = [
			'autoplay'           => isset( $ss['autoplay'] ) ? (bool) $ss['autoplay'] : true,
			'interval'           => isset( $ss['interval'] ) && is_numeric( $ss['interval'] ) ? max( 500, (int) $ss['interval'] ) : 4000,
			'transition'         => isset( $ss['transition'] ) && in_array( $ss['transition'], [ 'slide', 'fade', 'none' ], true ) ? $ss['transition'] : 'slide',
			'transitionDuration' => isset( $ss['transitionDuration'] ) && is_numeric( $ss['transitionDuration'] ) ? max( 0, (int) $ss['transitionDuration'] ) : 500,
			'showArrows'         => isset( $ss['showArrows'] ) ? (bool) $ss['showArrows'] : true,
			'showDots'           => isset( $ss['showDots'] ) ? (bool) $ss['showDots'] : true,
			'pauseOnHover'       => isset( $ss['pauseOnHover'] ) ? (bool) $ss['pauseOnHover'] : true,
			'loop'               => isset( $ss['loop'] ) ? (bool) $ss['loop'] : true,
		];

		// Ticker settings
		$tk = is_array( $source['ticker'] ?? null ) ? $source['ticker'] : [];
		$ticker = [
			'speed'        => isset( $tk['speed'] ) && is_numeric( $tk['speed'] ) ? max( 1, (int) $tk['speed'] ) : 40,
			'direction'    => isset( $tk['direction'] ) && in_array( $tk['direction'], [ 'left', 'right', 'up', 'down' ], true ) ? $tk['direction'] : 'left',
			'pauseOnHover' => isset( $tk['pauseOnHover'] ) ? (bool) $tk['pauseOnHover'] : true,
			'gap'          => isset( $tk['gap'] ) && is_numeric( $tk['gap'] ) ? max( 0, (int) $tk['gap'] ) : 24,
		];

		// Carousel settings
		$cr = is_array( $source['carousel'] ?? null ) ? $source['carousel'] : [];
		$carousel = [
			'visibleItems'       => isset( $cr['visibleItems'] ) && is_numeric( $cr['visibleItems'] ) ? max( 1, (int) $cr['visibleItems'] ) : 3,
			'scrollItems'        => isset( $cr['scrollItems'] ) && is_numeric( $cr['scrollItems'] ) ? max( 1, (int) $cr['scrollItems'] ) : 1,
			'autoplay'           => isset( $cr['autoplay'] ) ? (bool) $cr['autoplay'] : false,
			'interval'           => isset( $cr['interval'] ) && is_numeric( $cr['interval'] ) ? max( 500, (int) $cr['interval'] ) : 4000,
			'showArrows'         => isset( $cr['showArrows'] ) ? (bool) $cr['showArrows'] : true,
			'showDots'           => isset( $cr['showDots'] ) ? (bool) $cr['showDots'] : true,
			'pauseOnHover'       => isset( $cr['pauseOnHover'] ) ? (bool) $cr['pauseOnHover'] : true,
			'loop'               => isset( $cr['loop'] ) ? (bool) $cr['loop'] : true,
			'transition'         => isset( $cr['transition'] ) && in_array( $cr['transition'], [ 'slide', 'fade', 'none' ], true ) ? $cr['transition'] : 'slide',
			'transitionDuration' => isset( $cr['transitionDuration'] ) && is_numeric( $cr['transitionDuration'] ) ? max( 0, (int) $cr['transitionDuration'] ) : 500,
		];

		return [
			'mode' => $mode,
			'source' => $child_source,
			'componentId' => $component_id,
			'layout' => $layout,
			'gap' => isset( $source['gap'] ) && is_numeric( $source['gap'] ) ? max( 0, (float) $source['gap'] ) : 16,
			'columns' => isset( $source['columns'] ) && is_numeric( $source['columns'] ) ? max( 1, (int) $source['columns'] ) : 3,
			'minItemWidth' => isset( $source['minItemWidth'] ) && is_numeric( $source['minItemWidth'] ) ? max( 40, (float) $source['minItemWidth'] ) : 220,
			'templateRootId' => isset( $source['templateRootId'] ) ? sanitize_text_field( (string) $source['templateRootId'] ) : '',
			'query' => [
				'source' => $source_type,
				'collection' => $collection,
				'limit' => $limit,
				'order' => $order,
				'categoryIds' => $category_ids,
				'selectedIds' => $selected_ids,
				'variable' => $variable,
			],
			'slideshow' => $slideshow,
			'ticker' => $ticker,
			'carousel' => $carousel,
		];
	}

	private function build_loop_collection_item_from_post( WP_Post $post, string $post_type ): array {
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
		$item = [
			'id' => (int) $post->ID,
			'title' => get_the_title( $post ),
			'url' => get_permalink( $post ),
			'postType' => $post_type,
			'image' => $image_url ? esc_url_raw( $image_url ) : '',
			'excerpt' => $this->build_loop_item_excerpt( $post ),
			'date' => get_the_date( '', $post ),
			'termIds' => $term_ids,
		];
		if ( 'product' === $post_type && function_exists( 'wc_get_product' ) ) {
			$product = wc_get_product( $post->ID );
			if ( $product ) {
				$item['price'] = wp_strip_all_tags( html_entity_decode( $product->get_price_html(), ENT_QUOTES, 'UTF-8' ) );
			}
		}
		return $item;
	}

	private function resolve_loop_source_variable( array $loop_config ): ?array {
		$variable_config = is_array( $loop_config['query']['variable'] ?? null ) ? $loop_config['query']['variable'] : null;
		if ( ! $variable_config ) return null;
		$scope = 'global' === ( $variable_config['scope'] ?? 'page' ) ? 'global' : 'page';
		$variable_id = isset( $variable_config['variableId'] ) ? (string) $variable_config['variableId'] : '';
		if ( '' === $variable_id ) return null;
		$variables = 'global' === $scope ? $this->global_variables : $this->page_variables;
		foreach ( $variables as $variable ) {
			if ( ! is_array( $variable ) || ( $variable['id'] ?? '' ) !== $variable_id ) continue;
			return $variable;
		}
		return null;
	}

	private function get_loop_collection_items( array $loop_config ): array {
		$query = $loop_config['query'] ?? [];
		$source_type = $query['source'] ?? 'collection';
		$collection = $query['collection'] ?? 'posts';
		$limit = isset( $query['limit'] ) && is_numeric( $query['limit'] ) ? max( 1, (int) $query['limit'] ) : 6;
		$order = isset( $query['order'] ) && 'ASC' === strtoupper( (string) $query['order'] ) ? 'ASC' : 'DESC';
		$category_ids = is_array( $query['categoryIds'] ?? null ) ? array_values( array_unique( array_filter( array_map( 'intval', $query['categoryIds'] ) ) ) ) : [];

		$post_type = 'post';
		$orderby = 'date';
		if ( 'pages' === $collection ) {
			$post_type = 'page';
			$orderby = 'menu_order title';
		} elseif ( 'products' === $collection ) {
			if ( ! post_type_exists( 'product' ) ) {
				return [];
			}
			$post_type = 'product';
		}

		if ( 'variable' === $source_type ) {
			$variable = $this->resolve_loop_source_variable( $loop_config );
			if ( ! $variable || ! in_array( $variable['type'] ?? '', [ 'post', 'product' ], true ) ) {
				return [];
			}
			$value = is_array( $variable['value'] ?? null ) ? $variable['value'] : null;
			$post_id = isset( $value['id'] ) ? (int) $value['id'] : 0;
			if ( $post_id <= 0 ) {
				return [];
			}
			$post = get_post( $post_id );
			if ( ! ( $post instanceof WP_Post ) || 'publish' !== $post->post_status ) {
				return [];
			}
			if ( 'product' === ( $variable['type'] ?? '' ) && 'product' !== $post->post_type ) {
				return [];
			}
			if ( 'post' === ( $variable['type'] ?? '' ) && ! in_array( $post->post_type, [ 'post', 'page' ], true ) ) {
				return [];
			}
			return [ $this->build_loop_collection_item_from_post( $post, (string) $post->post_type ) ];
		}

		if ( 'selected' === $source_type ) {
			$selected_ids = is_array( $query['selectedIds'] ?? null ) ? array_values( array_unique( array_filter( array_map( 'intval', $query['selectedIds'] ) ) ) ) : [];
			if ( empty( $selected_ids ) ) {
				return [];
			}
			$posts = get_posts( [
				'post_type' => $post_type,
				'post_status' => 'publish',
				'posts_per_page' => count( $selected_ids ),
				'post__in' => $selected_ids,
				'orderby' => 'post__in',
				'order' => 'ASC',
			] );
			return array_map( function( $post ) {
				return $this->build_loop_collection_item_from_post( $post, (string) $post->post_type );
			}, $posts );
		}

		$posts = get_posts( [
			'post_type' => $post_type,
			'post_status' => 'publish',
			'posts_per_page' => $limit,
			'orderby' => $orderby,
			'order' => $order,
			...( ! empty( $category_ids ) && 'post' === $post_type ? [
				'tax_query' => [ [
					'taxonomy' => 'category',
					'field' => 'term_id',
					'terms' => $category_ids,
				] ],
			] : [] ),
			...( ! empty( $category_ids ) && 'product' === $post_type ? [
				'tax_query' => [ [
					'taxonomy' => 'product_cat',
					'field' => 'term_id',
					'terms' => $category_ids,
				] ],
			] : [] ),
		] );
		if ( 'post' === $post_type ) {
			$posts = array_values( array_filter( $posts, function( $post ) {
				return ! ( $post instanceof WP_Post ) || ! $this->is_submission_generated_post( $post );
			} ) );
		}

		return array_map( function( $post ) use ( $post_type ) {
			return $this->build_loop_collection_item_from_post( $post, $post_type );
		}, $posts );
	}

	private function build_loop_item_variables( array $item ): array {
		$variables = [
			[
				'id' => 'loop-item-title',
				'scope' => 'loop-item',
				'type' => 'string',
				'name' => 'Item Title',
				'category' => 'Loop Item',
				'value' => isset( $item['title'] ) && is_string( $item['title'] ) ? $item['title'] : '',
			],
			[
				'id' => 'loop-item-url',
				'scope' => 'loop-item',
				'type' => 'string',
				'name' => 'Item URL',
				'category' => 'Loop Item',
				'value' => isset( $item['url'] ) && is_string( $item['url'] ) ? $item['url'] : '',
			],
			[
				'id' => 'loop-item-excerpt',
				'scope' => 'loop-item',
				'type' => 'string',
				'name' => 'Item Excerpt',
				'category' => 'Loop Item',
				'value' => isset( $item['excerpt'] ) && is_string( $item['excerpt'] ) ? $item['excerpt'] : '',
			],
			[
				'id' => 'loop-item-date',
				'scope' => 'loop-item',
				'type' => 'string',
				'name' => 'Item Date',
				'category' => 'Loop Item',
				'value' => isset( $item['date'] ) && is_string( $item['date'] ) ? $item['date'] : '',
			],
			[
				'id' => 'loop-item-image',
				'scope' => 'loop-item',
				'type' => 'image',
				'name' => 'Item Image',
				'category' => 'Loop Item',
				'value' => isset( $item['image'] ) && is_string( $item['image'] ) ? $item['image'] : '',
			],
		];

		if ( isset( $item['price'] ) && is_string( $item['price'] ) && '' !== trim( $item['price'] ) ) {
			$variables[] = [
				'id' => 'loop-item-price',
				'scope' => 'loop-item',
				'type' => 'string',
				'name' => 'Item Price',
				'category' => 'Loop Item',
				'value' => $item['price'],
			];
		}

		return $variables;
	}

	private function build_loop_runtime_item_attrs( array $item, int $index ): string {
		$attrs = ' data-fb-loop-item-index="' . esc_attr( (string) $index ) . '"';
		$attr_map = [
			'title' => 'data-fb-loop-item-title',
			'url' => 'data-fb-loop-item-url',
			'excerpt' => 'data-fb-loop-item-excerpt',
			'date' => 'data-fb-loop-item-date',
			'image' => 'data-fb-loop-item-image',
			'price' => 'data-fb-loop-item-price',
		];

		foreach ( $attr_map as $key => $attr_name ) {
			$value = $item[ $key ] ?? '';
			if ( ! is_string( $value ) || '' === $value ) {
				continue;
			}
			$attrs .= ' ' . $attr_name . '="' . esc_attr( $value ) . '"';
		}

		return $attrs;
	}

	private function set_dom_element_style_property( DOMElement $element, string $property, string $value ): void {
		$style_text = (string) $element->getAttribute( 'style' );
		$style_map = [];
		foreach ( explode( ';', $style_text ) as $declaration ) {
			$parts = explode( ':', $declaration, 2 );
			if ( 2 !== count( $parts ) ) {
				continue;
			}
			$name = strtolower( trim( $parts[0] ) );
			if ( '' === $name ) {
				continue;
			}
			$style_map[ $name ] = trim( $parts[1] );
		}
		$style_map[ strtolower( $property ) ] = $value;
		$serialized = [];
		foreach ( $style_map as $name => $entry ) {
			$serialized[] = $name . ':' . $entry;
		}
		$element->setAttribute( 'style', implode( ';', $serialized ) . ( ! empty( $serialized ) ? ';' : '' ) );
	}

	private function get_first_descendant_with_class( DOMNode $root, DOMXPath $xpath, string $class_name ): ?DOMElement {
		$nodes = $xpath->query( './/*[contains(concat(" ", normalize-space(@class), " "), " ' . $class_name . ' ")]', $root );
		if ( ! $nodes instanceof DOMNodeList || 0 === $nodes->length ) {
			return null;
		}
		$node = $nodes->item( 0 );
		return $node instanceof DOMElement ? $node : null;
	}

	private function replace_dom_element_inner_html( DOMElement $element, string $html ): void {
		$document = $element->ownerDocument;
		if ( ! $document instanceof DOMDocument ) {
			$element->textContent = wp_strip_all_tags( $html );
			return;
		}
		while ( $element->firstChild ) {
			$element->removeChild( $element->firstChild );
		}
		if ( '' === $html ) {
			return;
		}
		$fragment = $document->createDocumentFragment();
		if ( ! @$fragment->appendXML( $html ) ) {
			$element->appendChild( $document->createTextNode( wp_strip_all_tags( $html ) ) );
			return;
		}
		$element->appendChild( $fragment );
	}

	private function apply_loop_item_binding_to_dom_node( DOMElement $node, string $property_key, array $variable, DOMXPath $xpath ): void {
		$value = $variable['value'] ?? null;
		$text_node = $this->get_first_descendant_with_class( $node, $xpath, 'fb-text-content' );
		if ( 'text' === $property_key ) {
			if ( $text_node instanceof DOMElement ) {
				$this->replace_dom_element_inner_html( $text_node, $this->plain_text_to_rich_text_html( $value === null ? '' : (string) $value ) );
			}
			return;
		}
		if ( 'hidden' === $property_key ) {
			if ( ! empty( $value ) ) {
				return;
			}
			$this->set_dom_element_style_property( $node, 'display', 'none' );
			return;
		}
		if ( 'linkUrl' === $property_key ) {
			$link_url = $this->sanitize_navigation_url( $this->normalize_link_url_value( $value ) );
			if ( '' !== $link_url ) {
				$node->setAttribute( 'data-fb-link-url', $link_url );
			} else {
				$node->removeAttribute( 'data-fb-link-url' );
			}
			return;
		}
		if ( 'styles.color' === $property_key ) {
			$target = $text_node instanceof DOMElement ? $text_node : $node;
			$this->set_dom_element_style_property( $target, 'color', is_string( $value ) ? $value : '#000000' );
			return;
		}
		if ( 'styles.fontFamily' === $property_key ) {
			$target = $text_node instanceof DOMElement ? $text_node : $node;
			$this->set_dom_element_style_property( $target, 'font-family', is_string( $value ) ? $value : (string) ( $value ?? '' ) );
			return;
		}
		if ( 'styles.backgroundColor' === $property_key ) {
			$this->set_dom_element_style_property( $node, 'background-color', is_string( $value ) ? $value : '#000000' );
			return;
		}
		if ( 'styles.backgroundImage' === $property_key ) {
			$url = $this->normalize_media_url( $value );
			$this->set_dom_element_style_property( $node, 'background-image', '' !== $url ? 'url(' . $url . ')' : 'none' );
			return;
		}
		if ( 'styles.zIndex' === $property_key ) {
			$this->set_dom_element_style_property( $node, 'z-index', is_numeric( $value ) ? (string) (float) $value : '0' );
			return;
		}
		if ( 'src' === $property_key ) {
			$image_url = $this->normalize_media_url( $value );
			$target = null;
			if ( in_array( strtolower( $node->tagName ), [ 'img', 'video' ], true ) ) {
				$target = $node;
			} else {
				$asset_nodes = $xpath->query( './/img|.//video', $node );
				if ( $asset_nodes instanceof DOMNodeList && $asset_nodes->length > 0 ) {
					$candidate = $asset_nodes->item( 0 );
					$target = $candidate instanceof DOMElement ? $candidate : null;
				}
			}
			if ( $target instanceof DOMElement ) {
				if ( '' !== $image_url ) {
					$target->setAttribute( 'src', $image_url );
				} else {
					$target->removeAttribute( 'src' );
				}
			}
		}
	}

	private function apply_loop_item_bindings_to_rendered_html( string $html, array $loop_item_variables, string $bp_id ): string {
		if ( '' === trim( $html ) ) {
			return $html;
		}
		$variable_map = $this->get_variable_map_for_loop_item( $loop_item_variables );
		$loop_item_map = $variable_map['loop-item'] ?? [];
		if ( empty( $loop_item_map ) ) {
			return $html;
		}

		$document = new DOMDocument( '1.0', 'UTF-8' );
		libxml_use_internal_errors( true );
		$loaded = $document->loadHTML( '<?xml encoding="utf-8" ?><div id="fb-loop-bind-root">' . $html . '</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD );
		if ( ! $loaded ) {
			libxml_clear_errors();
			libxml_use_internal_errors( false );
			return $html;
		}
		$xpath = new DOMXPath( $document );
		$nodes = $xpath->query( '//*[@data-fb-bindings]' );
		if ( $nodes instanceof DOMNodeList ) {
			foreach ( $nodes as $node ) {
				if ( ! $node instanceof DOMElement ) {
					continue;
				}
				$bindings_json = html_entity_decode( (string) $node->getAttribute( 'data-fb-bindings' ), ENT_QUOTES, 'UTF-8' );
				$bindings = json_decode( $bindings_json, true );
				if ( ! is_array( $bindings ) ) {
					continue;
				}
				$bindings = $this->normalize_bindings( $bindings );
				$property_keys = array_values( array_unique( array_merge(
					array_keys( $bindings['desktop'] ?? [] ),
					array_keys( $bindings['tablet'] ?? [] ),
					array_keys( $bindings['mobile'] ?? [] )
				) ) );
				foreach ( $property_keys as $property_key ) {
					$binding = $this->resolve_binding( $bindings, $bp_id, $property_key );
					if ( ! is_array( $binding ) || 'loop-item' !== ( $binding['scope'] ?? '' ) ) {
						continue;
					}
					$variable_id = $binding['variableId'] ?? '';
					$variable = $loop_item_map[ $variable_id ] ?? null;
					if ( ! is_array( $variable ) ) {
						continue;
					}
					$this->apply_loop_item_binding_to_dom_node( $node, $property_key, $variable, $xpath );
				}
			}
		}

		$root = $document->getElementById( 'fb-loop-bind-root' );
		if ( ! $root instanceof DOMElement ) {
			libxml_clear_errors();
			libxml_use_internal_errors( false );
			return $html;
		}
		$output = '';
		foreach ( $root->childNodes as $child ) {
			$output .= $document->saveHTML( $child );
		}
		libxml_clear_errors();
		libxml_use_internal_errors( false );
		return $output;
	}

	private function render_loop_children( array $el, string $bpId, float $child_cw, float $child_ch, bool $child_layout_on, string $child_flex_dir, string $child_align_items ): string {
		$resolved = $this->resolve( $el, $bpId );
		$loop_config = $this->normalize_loop_config( $resolved['loop'] ?? ( $el['base']['loop'] ?? [] ) );
		$mode = $loop_config['mode'];
		$child_source = $loop_config['source'];
		$is_interactive = in_array( $mode, [ 'slideshow', 'ticker', 'carousel' ], true );

		// Interactive modes need real box items; plain loop uses display:contents
		$item_style = $is_interactive ? '' : ' style="display:contents;"';

		// ── Render items based on source ──────────────────────────────
		$items_html = '';
		$item_count = 0;

		if ( 'manual' === $child_source ) {
			// Manual children: render each direct child as an item
			foreach ( $el['children'] ?? [] as $child_id ) {
				$child = $this->el_index[ $child_id ] ?? null;
				if ( ! $child ) continue;
				$items_html .= '<div class="fb-loop-runtime-item"' . $item_style . ' data-fb-loop-item-index="' . $item_count . '">';
				$items_html .= $this->render_element( $child, $bpId, $child_cw, $child_ch, $child_layout_on, $child_flex_dir, $child_align_items );
				$items_html .= '</div>';
				$item_count++;
			}
		} elseif ( 'component' === $child_source ) {
			// Component children: render each direct child (component instances) as an item
			foreach ( $el['children'] ?? [] as $child_id ) {
				$child = $this->el_index[ $child_id ] ?? null;
				if ( ! $child ) continue;
				$items_html .= '<div class="fb-loop-runtime-item"' . $item_style . ' data-fb-loop-item-index="' . $item_count . '">';
				$items_html .= $this->render_element( $child, $bpId, $child_cw, $child_ch, $child_layout_on, $child_flex_dir, $child_align_items );
				$items_html .= '</div>';
				$item_count++;
			}
		} else {
			// Query source: existing behavior
			$template_root_id = $loop_config['templateRootId'] ?: ( $el['children'][0] ?? '' );
			if ( '' === $template_root_id ) {
				return '';
			}
			$template = $this->el_index[ $template_root_id ] ?? null;
			if ( ! is_array( $template ) ) {
				return '';
			}
			$items = $this->get_loop_collection_items( $loop_config );
			if ( empty( $items ) ) {
				return '';
			}
			foreach ( $items as $index => $item ) {
				$loop_item_variables = $this->build_loop_item_variables( is_array( $item ) ? $item : [] );
				$items_html .= '<div class="fb-loop-runtime-item"' . $item_style . $this->build_loop_runtime_item_attrs( is_array( $item ) ? $item : [], (int) $index ) . '>';
				$items_html .= $this->apply_loop_item_bindings_to_rendered_html(
					$this->render_element( $template, $bpId, $child_cw, $child_ch, $child_layout_on, $child_flex_dir, $child_align_items, $loop_item_variables ),
					$loop_item_variables,
					$bpId
				);
				$items_html .= '</div>';
				$item_count++;
			}
		}

		if ( '' === $items_html ) {
			return '';
		}

		// ── Simple loop: no runtime wrapper needed ────────────────────
		if ( 'loop' === $mode ) {
			return $items_html;
		}

		// ── Interactive modes: wrap with runtime data ─────────────────
		// Merge top-level gap into mode config so the runtime has it
		$mode_config = $loop_config[ $mode ] ?? [];
		$mode_config['gap'] = $loop_config['gap'];
		$config_json = wp_json_encode( $mode_config );
		$html  = '<div class="fb-loop-interactive">';
		$html .= '<div class="fb-loop-track" data-fb-loop-mode="' . esc_attr( $mode ) . '" data-fb-loop-config="' . esc_attr( $config_json ) . '" data-fb-loop-count="' . $item_count . '">';
		$html .= $items_html;
		$html .= '</div>';

		// Arrows
		$show_arrows = false;
		if ( 'slideshow' === $mode ) {
			$show_arrows = ! empty( $loop_config['slideshow']['showArrows'] );
		} elseif ( 'carousel' === $mode ) {
			$show_arrows = ! empty( $loop_config['carousel']['showArrows'] );
		}
		if ( $show_arrows ) {
			$html .= '<button type="button" class="fb-loop-arrow fb-loop-arrow--prev" aria-label="Previous"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>';
			$html .= '<button type="button" class="fb-loop-arrow fb-loop-arrow--next" aria-label="Next"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>';
		}

		// Dots
		$show_dots = false;
		if ( 'slideshow' === $mode ) {
			$show_dots = ! empty( $loop_config['slideshow']['showDots'] );
		} elseif ( 'carousel' === $mode ) {
			$show_dots = ! empty( $loop_config['carousel']['showDots'] );
		}
		if ( $show_dots && $item_count > 1 ) {
			$html .= '<div class="fb-loop-dots">';
			for ( $i = 0; $i < $item_count; $i++ ) {
				$active_class = 0 === $i ? ' fb-loop-dot--active' : '';
				$html .= '<button type="button" class="fb-loop-dot' . $active_class . '" data-fb-dot-index="' . $i . '" aria-label="Go to slide ' . ( $i + 1 ) . '"></button>';
			}
			$html .= '</div>';
		}

		$html .= '</div>'; // close .fb-loop-interactive

		return $html;
	}

	private function apply_variable_binding_value( array $resolved, string $property_key, array $variable ): array {
		$next = $resolved;
		$next['styles'] = is_array( $resolved['styles'] ?? null ) ? $resolved['styles'] : [];
		$value = $variable['value'] ?? null;

		switch ( $property_key ) {
			case 'text':
				$next['text'] = $value === null ? '' : (string) $value;
				$next['richTextHtml'] = $this->plain_text_to_rich_text_html( $next['text'] );
				break;
			case 'hidden':
				$next['hidden'] = empty( $value );
				break;
			case 'linkUrl':
				$next['linkUrl'] = $this->normalize_link_url_value( $value );
				break;
			case 'styles.backgroundImage':
				$next['styles']['backgroundImage'] = $this->normalize_media_url( $value );
				break;
			case 'styles.backgroundColor':
				$next['styles']['backgroundColor'] = is_string( $value ) ? $value : '#000000';
				break;
			case 'styles.color':
				$next['styles']['color'] = is_string( $value ) ? $value : '#000000';
				break;
			case 'styles.zIndex':
				$next['styles']['zIndex'] = is_numeric( $value ) ? (float) $value : 0;
				break;
			case 'styles.fontFamily':
				$next['styles']['fontFamily'] = is_string( $value ) ? $value : (string) ( $value ?? '' );
				break;
			case 'src':
				$next['src'] = $this->normalize_media_url( $value );
				break;
		}

		return $next;
	}

	private function resolve_element_with_variables( array $el, string $bp_id, array $loop_item_variables = [] ): array {
		$resolved = $this->resolve( $el, $bp_id );
		$bindings = $this->normalize_bindings( $el['bindings'] ?? [] );
		$variable_map = $this->get_variable_map_for_loop_item( $loop_item_variables );
		$property_keys = array_values( array_unique( array_merge(
			array_keys( $bindings['desktop'] ?? [] ),
			array_keys( $bindings['tablet'] ?? [] ),
			array_keys( $bindings['mobile'] ?? [] )
		) ) );

		foreach ( $property_keys as $property_key ) {
			$binding = $this->resolve_binding( $bindings, $bp_id, $property_key );
			if ( ! $binding ) continue;
			$scope = $binding['scope'] ?? 'page';
			$variable_id = $binding['variableId'] ?? '';
			$variable = $variable_map[ $scope ][ $variable_id ] ?? null;
			if ( ! is_array( $variable ) ) continue;
			$resolved = $this->apply_variable_binding_value( $resolved, $property_key, $variable );
		}

		return $resolved;
	}

	/**
	 * Merge base + per-breakpoint overrides into a flat resolved array.
	 * Desktop uses base only; tablet/mobile merge base + overrides[bpId].
	 */
	/**
	 * Resolve element props with cascade: desktop (base) → tablet → mobile.
	 * Mobile inherits tablet overrides before applying its own.
	 */
	private function resolve( array $el, string $bpId ): array {
		$base   = $el['base'] ?? [];
		if ( $bpId === 'desktop' ) {
			return $base;
		}
		$tab_ov = $el['overrides']['tablet'] ?? [];
		if ( $bpId === 'tablet' ) {
			return array_merge(
				$base,
				$tab_ov,
				[ 'styles' => array_merge( $base['styles'] ?? [], $tab_ov['styles'] ?? [] ) ]
			);
		}
		// mobile: base → tablet override → mobile override
		$mob_ov = $el['overrides']['mobile'] ?? [];
		return array_merge(
			$base,
			$tab_ov,
			$mob_ov,
			[
				'styles' => array_merge(
					$base['styles'] ?? [],
					$tab_ov['styles'] ?? [],
					$mob_ov['styles'] ?? []
				),
			]
		);
	}

	private function camel_to_kebab( string $str ): string {
		return strtolower( preg_replace( '/([A-Z])/', '-$1', $str ) );
	}

	/**
	 * Return the visible viewport fold height for a breakpoint.
	 * Matches the JS autoFoldH formula: desktop uses 9/16 aspect, others use 16/9.
	 */
	private function get_viewport_fold_h( string $bpId ): float {
		if ( isset( $this->viewport_fold_h[ $bpId ] ) && $this->viewport_fold_h[ $bpId ] !== null ) {
			return $this->viewport_fold_h[ $bpId ];
		}
		$w = (float) ( $this->bp_cfg[ $bpId ]['max_w'] ?? 1440 );
		return $bpId === 'desktop' ? round( $w * 9 / 16 ) : round( $w * 16 / 9 );
	}

	/**
	 * Compute content height by finding the lowest element bottom-edge.
	 * Used to set aspect-ratio on the container so % heights resolve correctly.
	 */
	private function compute_content_height( string $bpId, int $default_h ): int {
		$max_h = $default_h;
		foreach ( $this->layout['elements'] ?? [] as $el ) {
			if ( ! empty( $el['parentId'] ) ) continue;
			$resolved = $this->resolve( $el, $bpId );
			if ( ! empty( $resolved['hidden'] ) ) continue;
			$bottom = intval( $resolved['y'] ?? 0 ) + intval( $resolved['height'] ?? 0 );
			if ( $bottom > $max_h ) {
				$max_h = $bottom;
			}
		}
		return max( $max_h, 100 );
	}

	private function load_component_library(): array {
		$components = is_array( $this->layout['_componentLibrary'] ?? null )
			? $this->layout['_componentLibrary']
			: json_decode( get_option( '_fb_component_library', '[]' ), true );
		if ( ! is_array( $components ) ) return [];

		$indexed = [];
		foreach ( $components as $component ) {
			if ( ! is_array( $component ) || empty( $component['id'] ) ) continue;
			$indexed[ sanitize_text_field( $component['id'] ) ] = $component;
		}

		return $indexed;
	}

	private function get_component_definition( string $component_id ): ?array {
		return $this->component_library[ $component_id ] ?? null;
	}

	private function is_assoc_array( array $value ): bool {
		if ( [] === $value ) return false;
		return array_keys( $value ) !== range( 0, count( $value ) - 1 );
	}

	private function deep_merge_value( $base, $override ) {
		if ( ! is_array( $base ) || ! is_array( $override ) ) return $override;
		if ( ! $this->is_assoc_array( $base ) || ! $this->is_assoc_array( $override ) ) return $override;

		$merged = $base;
		foreach ( $override as $key => $value ) {
			$merged[ $key ] = array_key_exists( $key, $base )
				? $this->deep_merge_value( $base[ $key ], $value )
				: $value;
		}
		return $merged;
	}

	private function get_snapshot_root( array $snapshot ): ?array {
		$id_set = [];
		foreach ( $snapshot as $el ) {
			if ( ! empty( $el['id'] ) ) $id_set[ $el['id'] ] = true;
		}
		foreach ( $snapshot as $el ) {
			$parent_id = $el['parentId'] ?? null;
			if ( ! $parent_id || empty( $id_set[ $parent_id ] ) ) return $el;
		}
		return $snapshot[0] ?? null;
	}

	private function apply_component_variant_overrides( array $primary_snapshot, array $override_snapshot ): array {
		$base_map = [];
		foreach ( $primary_snapshot as $el ) {
			if ( empty( $el['id'] ) ) continue;
			$base_map[ $el['id'] ] = $el;
		}

		$delete_ids = [];
		$collect_delete_ids = function( string $element_id ) use ( &$collect_delete_ids, &$delete_ids, $base_map ): void {
			if ( isset( $delete_ids[ $element_id ] ) ) return;
			$delete_ids[ $element_id ] = true;
			$element = $base_map[ $element_id ] ?? null;
			foreach ( $element['children'] ?? [] as $child_id ) {
				if ( is_string( $child_id ) && $child_id !== '' ) {
					$collect_delete_ids( $child_id );
				}
			}
		};

		foreach ( $override_snapshot as $entry ) {
			if ( ! empty( $entry['__deleted'] ) && ! empty( $entry['id'] ) ) {
				$collect_delete_ids( $entry['id'] );
			}
		}

		$next = [];
		foreach ( $primary_snapshot as $el ) {
			if ( empty( $el['id'] ) || isset( $delete_ids[ $el['id'] ] ) ) continue;
			$clone = $el;
			$clone['children'] = array_values( array_filter(
				$clone['children'] ?? [],
				fn( $child_id ) => ! isset( $delete_ids[ $child_id ] )
			) );
			$next[] = $clone;
		}

		$next_map = [];
		foreach ( $next as $el ) {
			$next_map[ $el['id'] ] = $el;
		}

		foreach ( $override_snapshot as $entry ) {
			if ( ! is_array( $entry ) || ! empty( $entry['__deleted'] ) || empty( $entry['id'] ) ) continue;
			if ( isset( $next_map[ $entry['id'] ] ) ) {
				$merged = $this->deep_merge_value( $next_map[ $entry['id'] ], $entry );
				unset( $merged['__added'], $merged['__deleted'] );
				$next_map[ $entry['id'] ] = $merged;
			} else {
				$added = $entry;
				unset( $added['__added'], $added['__deleted'] );
				$next_map[ $added['id'] ] = $added;
			}
		}

		return array_values( $next_map );
	}

	private function compose_component_variant_snapshot( array $component, ?string $variant_id = null ): array {
		$variants = is_array( $component['variants'] ?? null ) ? $component['variants'] : [];
		if ( empty( $variants ) ) return [];

		$primary_variant = null;
		foreach ( $variants as $candidate ) {
			if ( ! is_array( $candidate ) || empty( $candidate['id'] ) ) continue;
			$mode = sanitize_text_field( $candidate['mode'] ?? 'default' );
			if ( 'default' !== $mode ) continue;
			$primary_variant = $candidate;
			break;
		}
		if ( ! is_array( $primary_variant ) ) return [];

		$target_variant = null;
		foreach ( $variants as $candidate ) {
			if ( ! is_array( $candidate ) || empty( $candidate['id'] ) ) continue;
			if ( $variant_id && $candidate['id'] === $variant_id ) {
				$target_variant = $candidate;
				break;
			}
		}
		if ( ! $target_variant ) {
			$default_variant_id = $component['defaultVariantId'] ?? null;
			foreach ( $variants as $candidate ) {
				if ( ! is_array( $candidate ) || empty( $candidate['id'] ) ) continue;
				if ( $default_variant_id && $candidate['id'] === $default_variant_id ) {
					$target_variant = $candidate;
					break;
				}
			}
		}
		if ( ! $target_variant ) $target_variant = $primary_variant;

		$primary_snapshot = is_array( $primary_variant['snapshot'] ?? null ) ? $primary_variant['snapshot'] : [];
		if ( empty( $target_variant['id'] ) || $target_variant['id'] === ( $primary_variant['id'] ?? null ) ) {
			return $primary_snapshot;
		}

		$target_mode = sanitize_text_field( $target_variant['mode'] ?? 'default' );
		if ( 'default' === $target_mode ) {
			return $this->apply_component_variant_overrides(
				$primary_snapshot,
				is_array( $target_variant['snapshot'] ?? null ) ? $target_variant['snapshot'] : []
			);
		}

		$parent_variant_id = sanitize_text_field( $target_variant['parentVariantId'] ?? '' );
		$parent_snapshot = $parent_variant_id
			? $this->compose_component_variant_snapshot( $component, $parent_variant_id )
			: $primary_snapshot;

		return $this->apply_component_variant_overrides(
			$parent_snapshot,
			is_array( $target_variant['snapshot'] ?? null ) ? $target_variant['snapshot'] : []
		);
	}

	private function prepare_component_variant_snapshot_for_render( array $snapshot ): array {
		return array_map( function( $entry ) {
			if ( ! is_array( $entry ) ) return $entry;
			$next = $entry;
			$base_hidden = ! empty( $next['base']['hidden'] );
			if ( $base_hidden ) {
				$next['base']['hidden'] = false;
				$next['base']['styles'] = is_array( $next['base']['styles'] ?? null ) ? $next['base']['styles'] : [];
				$next['base']['styles']['opacity'] = 0;
			}
			if ( is_array( $next['overrides'] ?? null ) ) {
				foreach ( $next['overrides'] as $bp_key => $override ) {
					if ( ! is_array( $override ) || empty( $override['hidden'] ) ) continue;
					$next['overrides'][ $bp_key ]['hidden'] = false;
					$next['overrides'][ $bp_key ]['styles'] = is_array( $next['overrides'][ $bp_key ]['styles'] ?? null ) ? $next['overrides'][ $bp_key ]['styles'] : [];
					$next['overrides'][ $bp_key ]['styles']['opacity'] = 0;
				}
			}
			return $next;
		}, $snapshot );
	}

	private function render_snapshot_element( array $el, array $snapshot_index, string $bpId, float $cw, float $ch, bool $artboard_layout_on = false, string $parent_flex_dir = 'none', string $parent_align_items = 'stretch' ): string {
		$previous_index = $this->el_index;
		$this->el_index = $snapshot_index;
		$html = $this->render_element( $el, $bpId, $cw, $ch, $artboard_layout_on, $parent_flex_dir, $parent_align_items );
		$this->el_index = $previous_index;
		return $html;
	}

	private function render_component_instance_variants( array $el, array $resolved, string $bpId ): string {
		$instance = is_array( $el['componentInstance'] ?? null ) ? $el['componentInstance'] : [];
		$component_id = sanitize_text_field( $instance['componentId'] ?? '' );
		$component = $component_id ? $this->get_component_definition( $component_id ) : null;
		$variants = is_array( $component['variants'] ?? null ) ? $component['variants'] : [];
		if ( ! $component || empty( $variants ) ) return '';

		$active_variant_id = sanitize_text_field( $instance['variantId'] ?? ( $component['defaultVariantId'] ?? ( $variants[0]['id'] ?? '' ) ) );
		$root_width = max( 1, (float) ( $resolved['width'] ?? 1 ) );
		$root_height = max( 1, (float) ( $resolved['height'] ?? 1 ) );
		$html = '';

		foreach ( $variants as $variant ) {
			if ( ! is_array( $variant ) || empty( $variant['id'] ) ) continue;
			$variant_id = sanitize_text_field( $variant['id'] );
			$variant_mode = sanitize_text_field( $variant['mode'] ?? 'default' );
			if ( ! in_array( $variant_mode, [ 'default', 'hover', 'pressed' ], true ) ) $variant_mode = 'default';
			$parent_variant_id = sanitize_text_field( $variant['parentVariantId'] ?? '' );
			$snapshot = $this->prepare_component_variant_snapshot_for_render( $this->compose_component_variant_snapshot( $component, $variant_id ) );
			$root = $this->get_snapshot_root( $snapshot );
			if ( ! $root ) continue;

			$snapshot_index = [];
			foreach ( $snapshot as $snapshot_el ) {
				if ( ! empty( $snapshot_el['id'] ) ) $snapshot_index[ $snapshot_el['id'] ] = $snapshot_el;
			}

			$root_variant = $root;
			$root_variant['parentId'] = null;
			$root_variant['base']['x'] = 0;
			$root_variant['base']['y'] = 0;
			$root_variant['base']['width'] = $root_width;
			$root_variant['base']['height'] = $root_height;
			$root_variant['base']['widthMode'] = 'fill';
			$root_variant['base']['heightMode'] = 'fill';
			$root_variant['base']['constraints'] = [
				'top' => true,
				'left' => true,
				'right' => true,
				'bottom' => true,
			];

			$interaction = is_array( $variant['interaction'] ?? null ) ? $variant['interaction'] : null;
			$target_variant_id = sanitize_text_field( $interaction['targetVariantId'] ?? '' );
			$trigger = sanitize_text_field( $interaction['trigger'] ?? '' );
			$delay = isset( $interaction['delay'] ) ? max( 0, (float) $interaction['delay'] ) : 0;
			$transition = $this->normalize_component_transition( is_array( $interaction['transition'] ?? null ) ? $interaction['transition'] : null );
			$attrs = ' data-fb-variant-id="' . esc_attr( $variant_id ) . '"';
			$attrs .= ' data-fb-variant-mode="' . esc_attr( $variant_mode ) . '"';
			$attrs .= ' data-fb-parent-variant-id="' . esc_attr( $parent_variant_id ) . '"';
			if ( 'default' === $variant_mode && $target_variant_id !== '' && $target_variant_id !== $variant_id ) {
				$attrs .= ' data-fb-transition-type="' . esc_attr( $transition['type'] ) . '"';
				$attrs .= ' data-fb-transition-duration="' . esc_attr( (string) $transition['duration'] ) . '"';
				$attrs .= ' data-fb-transition-physics-duration="' . esc_attr( (string) $transition['physicsDuration'] ) . '"';
				$attrs .= ' data-fb-transition-ease="' . esc_attr( $transition['easePreset'] ) . '"';
				$attrs .= ' data-fb-transition-spring-mode="' . esc_attr( $transition['springMode'] ) . '"';
				$attrs .= ' data-fb-transition-bounce="' . esc_attr( (string) $transition['bounce'] ) . '"';
				$attrs .= ' data-fb-transition-stiffness="' . esc_attr( (string) $transition['stiffness'] ) . '"';
				$attrs .= ' data-fb-transition-damping="' . esc_attr( (string) $transition['damping'] ) . '"';
				$attrs .= ' data-fb-transition-mass="' . esc_attr( (string) $transition['mass'] ) . '"';
				$attrs .= ' data-fb-transition-bezier-x1="' . esc_attr( (string) $transition['bezier']['x1'] ) . '"';
				$attrs .= ' data-fb-transition-bezier-y1="' . esc_attr( (string) $transition['bezier']['y1'] ) . '"';
				$attrs .= ' data-fb-transition-bezier-x2="' . esc_attr( (string) $transition['bezier']['x2'] ) . '"';
				$attrs .= ' data-fb-transition-bezier-y2="' . esc_attr( (string) $transition['bezier']['y2'] ) . '"';
				$attrs .= ' data-fb-trigger="' . esc_attr( $trigger ?: 'click' ) . '"';
				$attrs .= ' data-fb-target-variant-id="' . esc_attr( $target_variant_id ) . '"';
				$attrs .= ' data-fb-delay="' . esc_attr( (string) $delay ) . '"';
			}

			$html .= '<div class="fb-component-variant' . ( $variant_id === $active_variant_id ? ' is-active' : '' ) . '"' . $attrs . '>';
			$html .= $this->render_snapshot_element( $root_variant, $snapshot_index, $bpId, $root_width, $root_height, false, 'none' );
			$html .= '</div>';
		}

		return $html;
	}

	private function normalize_component_transition( ?array $transition ): array {
		$type = sanitize_text_field( $transition['type'] ?? 'instant' );
		if ( ! in_array( $type, [ 'instant', 'ease', 'realistic' ], true ) ) $type = 'instant';
		$ease_preset = sanitize_text_field( $transition['easePreset'] ?? 'easeInOut' );
		if ( ! in_array( $ease_preset, [ 'easeInOut', 'easeOut', 'easeIn', 'linear', 'custom' ], true ) ) $ease_preset = 'easeInOut';
		$spring_mode = sanitize_text_field( $transition['springMode'] ?? 'time' );
		if ( ! in_array( $spring_mode, [ 'time', 'physics' ], true ) ) $spring_mode = 'time';
		$bezier = is_array( $transition['bezier'] ?? null ) ? $transition['bezier'] : [];

		return [
			'type'       => $type,
			'duration'   => isset( $transition['duration'] ) ? max( 0, (float) $transition['duration'] ) : 0.3,
			'physicsDuration' => isset( $transition['physicsDuration'] ) ? max( 0, (float) $transition['physicsDuration'] ) : ( isset( $transition['duration'] ) ? max( 0, (float) $transition['duration'] ) : 0.3 ),
			'easePreset' => $ease_preset,
			'springMode' => $spring_mode,
			'bounce'     => isset( $transition['bounce'] ) ? max( 0, min( 1, (float) $transition['bounce'] ) ) : 0.2,
			'stiffness'  => isset( $transition['stiffness'] ) ? max( 1, (float) $transition['stiffness'] ) : 500,
			'damping'    => isset( $transition['damping'] ) ? max( 1, (float) $transition['damping'] ) : 24,
			'mass'       => isset( $transition['mass'] ) ? max( 0.1, (float) $transition['mass'] ) : 1,
			'bezier'     => [
				'x1' => isset( $bezier['x1'] ) ? max( 0, min( 1, (float) $bezier['x1'] ) ) : 0.44,
				'y1' => isset( $bezier['y1'] ) ? max( 0, min( 1, (float) $bezier['y1'] ) ) : 0,
				'x2' => isset( $bezier['x2'] ) ? max( 0, min( 1, (float) $bezier['x2'] ) ) : 0.56,
				'y2' => isset( $bezier['y2'] ) ? max( 0, min( 1, (float) $bezier['y2'] ) ) : 1,
			],
		];
	}

	private function get_component_runtime_assets(): string {
		$bid = esc_attr( $this->build_id );
		$page_variables_json = wp_json_encode( $this->page_variables );
		$global_variables_json = wp_json_encode( $this->global_variables );
		$css = ".{$bid} .fb-component-instance{position:relative;overflow:hidden;}"
			. ".{$bid} .fb-component-variant{position:absolute;inset:0;visibility:hidden;opacity:0;pointer-events:none;}"
			. ".{$bid} .fb-component-variant.is-active,.{$bid} .fb-component-variant.is-present{visibility:visible;}"
			. ".{$bid} .fb-component-variant.is-active{opacity:1;pointer-events:auto;}"
			. ".{$bid} .fb-component-variant > .fb-el{pointer-events:auto;}";

		$script = <<<'SCRIPT'
<script>
(function(){
	var gsap = window.gsap || null;
	var Flip = window.Flip || (gsap && gsap.plugins ? gsap.plugins.Flip : null) || null;
	var ScrollTrigger = window.ScrollTrigger || (gsap && gsap.plugins ? gsap.plugins.ScrollTrigger : null) || null;
	if (gsap && gsap.registerPlugin) {
		var runtimePlugins = [];
		if (Flip) runtimePlugins.push(Flip);
		if (ScrollTrigger) runtimePlugins.push(ScrollTrigger);
		if (runtimePlugins.length) gsap.registerPlugin.apply(gsap, runtimePlugins);
	}
	var scope = document.querySelector('.fb-page.__FB_BUILD_ID__');
	if (!scope) return;
	var embeddedPageVariables = __FB_PAGE_VARIABLES__ || [];
	var embeddedGlobalVariables = __FB_GLOBAL_VARIABLES__ || [];
	var runtimeData = window.fbRuntimeData || {};
	var pageContextId = String(runtimeData.postId || '__FB_BUILD_ID__');
	var cloneValue = function(value) {
		return value == null ? value : JSON.parse(JSON.stringify(value));
	};
	var parseJsonAttr = function(value, fallback) {
		if (!value) return fallback;
		try {
			return JSON.parse(value);
		} catch (error) {
			return fallback;
		}
	};
	var getCurrentBreakpoint = function() {
		var width = window.innerWidth || document.documentElement.clientWidth || 1024;
		if (width <= 375) return 'mobile';
		if (width <= 768) return 'tablet';
		return 'desktop';
	};
	var normalizeRuntimeFontFamily = function(value) {
		var raw = value == null ? '' : String(value);
		if (!raw) return '';
		var primary = raw.split(',')[0] || '';
		primary = primary.trim().replace(/^['"]+|['"]+$/g, '');
		if (!primary) return '';
		var normalized = primary.toLowerCase();
		if (['inherit', 'initial', 'unset', 'serif', 'sans-serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'arial'].indexOf(normalized) !== -1) {
			return '';
		}
		return primary;
	};
	var normalizeRuntimeFontWeight = function(value) {
		if (typeof value === 'number' && isFinite(value)) return Math.max(100, Math.min(900, Math.round(value)));
		var text = value == null ? '' : String(value).trim().toLowerCase();
		if (text === 'bold') return 700;
		if (text === 'normal') return 400;
		var parsed = parseInt(text, 10);
		return isFinite(parsed) ? Math.max(100, Math.min(900, parsed)) : 400;
	};
	var runtimeLoadedBaseFamilies = new Set();
	var runtimeLoadedFonts = new Set();
	var ensureRuntimeGoogleFontLoaded = function(family, options) {
		var normalizedFamily = normalizeRuntimeFontFamily(family);
		if (!normalizedFamily) return;
		if (!runtimeLoadedBaseFamilies.has(normalizedFamily)) {
			runtimeLoadedBaseFamilies.add(normalizedFamily);
			var baseLink = document.createElement('link');
			baseLink.rel = 'stylesheet';
			baseLink.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(normalizedFamily).replace(/%20/g, '+') + '&display=swap';
			baseLink.dataset.fbRuntimeFontFamily = normalizedFamily;
			document.head.appendChild(baseLink);
		}
		var weight = normalizeRuntimeFontWeight(options && options.weight);
		var style = options && options.style === 'italic' ? 'italic' : 'normal';
		if (weight === 400 && style === 'normal') return;
		var requestKey = normalizedFamily + '::' + style + '::' + weight;
		if (runtimeLoadedFonts.has(requestKey)) return;
		runtimeLoadedFonts.add(requestKey);
		var encodedFamily = encodeURIComponent(normalizedFamily).replace(/%20/g, '+');
		var familyRequest = style === 'italic'
			? encodedFamily + ':ital,wght@1,' + weight
			: encodedFamily + ':wght@' + weight;
		var link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = 'https://fonts.googleapis.com/css2?family=' + familyRequest + '&display=swap';
		link.dataset.fbRuntimeFont = requestKey;
		document.head.appendChild(link);
	};
	var loadRuntimeFontsInScope = function() {
		var nodes = scope.querySelectorAll('[style*="font-family"], .fb-text-content, .fb-form-field__label, .fb-form-choice__label, .fb-form-field--radio, .fb-form-field--checkbox, [data-fb-form-submit-button="true"]');
		nodes.forEach(function(node) {
			var style = window.getComputedStyle(node);
			ensureRuntimeGoogleFontLoaded(style.fontFamily, {
				weight: style.fontWeight,
				style: style.fontStyle,
			});
		});
	};
	var normalizeVariableValue = function(type, value) {
			if (type === 'boolean') {
				if (typeof value === 'boolean') return value;
				if (typeof value === 'string') {
					var normalized = value.trim().toLowerCase();
					if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
					if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off' || normalized === '') return false;
				}
				if (typeof value === 'number') return value !== 0;
				return !!value;
			}
		if (type === 'color') return typeof value === 'string' && value ? value : '#000000';
		if (type === 'image') return typeof value === 'string' ? value : String(value == null ? '' : value);
		if (type === 'number') {
			var parsed = typeof value === 'number' ? value : parseFloat(value);
			return Number.isFinite(parsed) ? parsed : 0;
		}
		if (type === 'post' || type === 'product') {
			if (!value || typeof value !== 'object') return null;
			return {
				id: typeof value.id === 'number' ? value.id : parseInt(value.id, 10) || 0,
				title: typeof value.title === 'string' ? value.title : '',
				url: typeof value.url === 'string' ? value.url : '',
				postType: typeof value.postType === 'string' ? value.postType : (type === 'product' ? 'product' : 'post')
			};
		}
		return typeof value === 'string' ? value : String(value == null ? '' : value);
	};
	var normalizeVariables = function(list, fallbackScope) {
		if (!Array.isArray(list)) return [];
		return list.map(function(variable) {
			if (!variable || typeof variable !== 'object' || !variable.id) return null;
			var type = typeof variable.type === 'string' ? variable.type : 'string';
			var defaultValue = normalizeVariableValue(type, variable.value);
			return {
				id: String(variable.id),
				scope: variable.scope === 'global' ? 'global' : fallbackScope,
				type: type,
				name: typeof variable.name === 'string' ? variable.name : 'Variable',
				category: typeof variable.category === 'string' ? variable.category : 'General',
				persistent: !!variable.persistent,
				defaultValue: defaultValue,
				value: defaultValue
			};
		}).filter(Boolean);
	};
	var pageVariables = normalizeVariables(embeddedPageVariables, 'page');
	var globalVariables = normalizeVariables(
		Array.isArray(runtimeData.globalVariables) && runtimeData.globalVariables.length ? runtimeData.globalVariables : embeddedGlobalVariables,
		'global'
	);
	var variableState = {
		page: new Map(pageVariables.map(function(variable) { return [variable.id, variable]; })),
		global: new Map(globalVariables.map(function(variable) { return [variable.id, variable]; }))
	};
	var getStorageKey = function(scopeName) {
		return scopeName === 'global' ? 'fb:variables:global' : 'fb:variables:page:' + pageContextId;
	};
	var restorePersistentVariables = function(scopeName) {
		var map = variableState[scopeName];
		if (!map || !window.localStorage) return;
		try {
			var raw = window.localStorage.getItem(getStorageKey(scopeName));
			if (!raw) return;
			var saved = JSON.parse(raw);
			if (!saved || typeof saved !== 'object') return;
			map.forEach(function(variable, variableId) {
				if (!variable.persistent || !Object.prototype.hasOwnProperty.call(saved, variableId)) return;
				variable.value = normalizeVariableValue(variable.type, saved[variableId]);
			});
		} catch (error) {
			return;
		}
	};
	var persistVariables = function(scopeName) {
		var map = variableState[scopeName];
		if (!map || !window.localStorage) return;
		var payload = {};
		map.forEach(function(variable, variableId) {
			if (!variable.persistent) return;
			payload[variableId] = variable.value;
		});
		try {
			window.localStorage.setItem(getStorageKey(scopeName), JSON.stringify(payload));
		} catch (error) {
			return;
		}
	};
	var getVariable = function(scopeName, variableId) {
		var map = variableState[scopeName === 'global' ? 'global' : 'page'];
		return map ? (map.get(variableId) || null) : null;
	};
	var getLoopItemRuntimeValue = function(runtimeOptions, variableId) {
		var sourceNode = runtimeOptions && runtimeOptions.event && runtimeOptions.event.target ? runtimeOptions.event.target : null;
		if (!sourceNode && runtimeOptions && runtimeOptions.triggerNode) sourceNode = runtimeOptions.triggerNode;
		if (!sourceNode || !sourceNode.closest) return null;
		var loopItemNode = sourceNode.closest('.fb-loop-runtime-item');
		if (!loopItemNode || !loopItemNode.dataset) return null;
		var keyMap = {
			'loop-item-title': 'fbLoopItemTitle',
			'loop-item-url': 'fbLoopItemUrl',
			'loop-item-excerpt': 'fbLoopItemExcerpt',
			'loop-item-date': 'fbLoopItemDate',
			'loop-item-image': 'fbLoopItemImage',
			'loop-item-price': 'fbLoopItemPrice'
		};
		var datasetKey = keyMap[variableId] || '';
		if (!datasetKey) return null;
		var value = loopItemNode.dataset[datasetKey];
		return typeof value === 'string' ? value : null;
	};
	var resolveRuntimeVariable = function(scopeName, variableId, runtimeOptions) {
		if (scopeName === 'loop-item') {
			var loopValue = getLoopItemRuntimeValue(runtimeOptions, variableId);
			if (loopValue == null) return null;
			return {
				id: variableId,
				scope: 'loop-item',
				type: variableId === 'loop-item-image' ? 'image' : 'string',
				value: loopValue
			};
		}
		return getVariable(scopeName, variableId);
	};
	var setVariableValue = function(scopeName, variableId, nextValue) {
		var variable = getVariable(scopeName, variableId);
		if (!variable) return;
		variable.value = normalizeVariableValue(variable.type, nextValue);
		persistVariables(variable.scope || scopeName);
	};
	var bindingToText = function(value) {
		if (value && typeof value === 'object') {
			if (typeof value.title === 'string' && value.title) return value.title;
			if (typeof value.url === 'string' && value.url) return value.url;
		}
		return value == null ? '' : String(value);
	};
	var bindingTextToHtml = function(value) {
		return bindingToText(value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;')
			.replace(/\n/g, '<br>');
	};
	var sanitizeNavigationUrl = function(value) {
		var raw = bindingToText(value).trim();
		if (!raw) return '';
		if (/^\/{2}/.test(raw)) return '';
		if (/^(#|\?|\/(?!\/))/.test(raw)) return raw;
		if (/^(mailto:|tel:)/i.test(raw)) return raw;
		try {
			var parsed = new URL(raw, window.location.href);
			var protocol = (parsed.protocol || '').toLowerCase();
			if (protocol === 'http:' || protocol === 'https:') return parsed.href;
		} catch (error) {
			return '';
		}
		return '';
	};
	var getNodeLinkUrl = function(node) {
		if (!node || !node.dataset) return '';
		return sanitizeNavigationUrl(node.dataset.fbLinkUrl || '');
	};
	var syncLinkNodeState = function(node) {
		if (!node) return '';
		var url = getNodeLinkUrl(node);
		var handledByFlow = !!node.dataset.fbFlow;
		var handledByInteractions = !!node.dataset.fbInteractions;
		var enabled = !!url && !handledByFlow && !handledByInteractions;
		if (enabled) {
			node.style.cursor = 'pointer';
			if (!node.hasAttribute('tabindex')) {
				node.dataset.fbLinkAddedTabindex = '1';
				node.setAttribute('tabindex', '0');
			}
			if (!node.hasAttribute('role')) node.setAttribute('role', 'link');
		} else {
			if (node.dataset.fbLinkAddedTabindex === '1') {
				node.removeAttribute('tabindex');
				delete node.dataset.fbLinkAddedTabindex;
			}
			if (node.getAttribute('role') === 'link') node.removeAttribute('role');
			if (!handledByFlow && !handledByInteractions && node.dataset.fbLinkBound === '1') node.style.cursor = '';
		}
		return enabled ? url : '';
	};
	var shouldIgnoreLinkActivation = function(node, event) {
		if (!event) return false;
		if (event.defaultPrevented) return true;
		var target = event.target;
		if (!target || !target.closest) return false;
		var interactiveAncestor = target.closest('a,button,input,select,textarea,label,summary,[contenteditable=""],[contenteditable="true"]');
		return !!interactiveAncestor && interactiveAncestor !== node;
	};
	var navigateToUrl = function(url, event) {
		if (!url) return;
		if (event && (event.metaKey || event.ctrlKey)) {
			window.open(url, '_blank', 'noopener');
			return;
		}
		window.location.href = url;
	};
	var inferRuntimeValueType = function(value) {
		if (typeof value === 'boolean') return 'boolean';
		if (typeof value === 'number') return 'number';
		if (value && typeof value === 'object') return 'image';
		return 'string';
	};
	var getFlowRuntimeValue = function(runtimeOptions, path) {
		var sourcePath = path == null ? '' : String(path).trim();
		var response = runtimeOptions && typeof runtimeOptions.response === 'object' ? runtimeOptions.response : null;
		if (!response || !sourcePath) return null;
		if (sourcePath.indexOf('.') === -1) {
			if (response.submission && response.submission.values && Object.prototype.hasOwnProperty.call(response.submission.values, sourcePath)) {
				return response.submission.values[sourcePath];
			}
			if (response.values && Object.prototype.hasOwnProperty.call(response.values, sourcePath)) {
				return response.values[sourcePath];
			}
		}
		var root = {
			response: response,
			submission: response && response.submission ? response.submission : null,
			formNode: runtimeOptions && runtimeOptions.formNode ? runtimeOptions.formNode : null,
			error: runtimeOptions && runtimeOptions.error ? runtimeOptions.error : null
		};
		return sourcePath.split('.').reduce(function(current, key) {
			if (current == null) return null;
			return Object.prototype.hasOwnProperty.call(Object(current), key) ? current[key] : null;
		}, root);
	};
	var resolveConfiguredFlowValue = function(config, runtimeOptions) {
		var valueSource = config && typeof config.valueSource === 'string' ? config.valueSource : 'manual';
		if (valueSource === 'submitted-field') {
			return cloneValue(getFlowRuntimeValue(runtimeOptions, config.submissionField || config.responsePath || ''));
		}
		if (valueSource === 'response-path') {
			return cloneValue(getFlowRuntimeValue(runtimeOptions, config.responsePath || ''));
		}
		return cloneValue(config ? config.value : null);
	};
	var resolveConfiguredNavigationUrl = function(config, runtimeOptions) {
		if (config && config.destinationSource === 'variable') {
			var runtimeVariable = resolveRuntimeVariable(config.variableScope || 'page', config.variableId || '', runtimeOptions);
			return sanitizeNavigationUrl(runtimeVariable ? runtimeVariable.value : '');
		}
		return sanitizeNavigationUrl(config && config.pageUrl ? config.pageUrl : '');
	};
	var resolveConditionSubject = function(config, runtimeOptions) {
		var subjectSource = config && typeof config.subjectSource === 'string' ? config.subjectSource : 'variable';
		if (subjectSource === 'submitted-field') {
			var submittedValue = getFlowRuntimeValue(runtimeOptions, config.submissionField || config.responsePath || '');
			return {
				value: submittedValue,
				type: inferRuntimeValueType(submittedValue)
			};
		}
		if (subjectSource === 'response-path') {
			var responseValue = getFlowRuntimeValue(runtimeOptions, config.responsePath || '');
			return {
				value: responseValue,
				type: inferRuntimeValueType(responseValue)
			};
		}
		var variable = resolveRuntimeVariable(config.variableScope || 'page', config.variableId || '', runtimeOptions);
		return {
			value: variable ? variable.value : null,
			type: variable ? variable.type : 'string'
		};
	};
	var resolveBindingForBreakpoint = function(bindings, bpId, propertyKey) {
		if (!bindings || typeof bindings !== 'object') return null;
		var desktop = bindings.desktop || {};
		var tablet = bindings.tablet || {};
		var mobile = bindings.mobile || {};
		if (bpId === 'mobile') return mobile[propertyKey] || tablet[propertyKey] || desktop[propertyKey] || null;
		if (bpId === 'tablet') return tablet[propertyKey] || desktop[propertyKey] || null;
		return desktop[propertyKey] || null;
	};
	var getVisualTarget = function(node) {
		if (!node || !node.querySelector) return node;
		return node.querySelector('[data-fb-form-surface="true"]') || node;
	};
	var applyBindingToNode = function(node, propertyKey, variable) {
		if (!node || !variable) return;
		var value = variable.value;
		var textNode = node.querySelector('.fb-text-content');
		var visualTarget = getVisualTarget(node);
		if (propertyKey === 'text') {
			if (textNode) textNode.innerHTML = bindingTextToHtml(value);
			return;
		}
		if (propertyKey === 'hidden') {
			node.style.display = value ? '' : 'none';
			return;
		}
		if (propertyKey === 'linkUrl') {
			var linkUrl = sanitizeNavigationUrl(value);
			if (linkUrl) node.dataset.fbLinkUrl = linkUrl;
			else delete node.dataset.fbLinkUrl;
			syncLinkNodeState(node);
			return;
		}
		if (propertyKey === 'styles.backgroundImage') {
			var backgroundUrl = '';
			if (value && typeof value === 'object' && typeof value.url === 'string') backgroundUrl = value.url;
			else if (typeof value === 'string') backgroundUrl = value;
			backgroundUrl = backgroundUrl.trim();
			visualTarget.style.backgroundImage = backgroundUrl ? 'url(' + backgroundUrl.replace(/\)/g, '\\)') + ')' : '';
			return;
		}
		if (propertyKey === 'src') {
			var imageNode = node.tagName === 'IMG' || node.tagName === 'VIDEO' ? node : node.querySelector('img,video');
			var imageUrl = '';
			if (value && typeof value === 'object' && typeof value.url === 'string') imageUrl = value.url;
			else if (typeof value === 'string') imageUrl = value;
			imageUrl = imageUrl.trim();
			if (imageNode) {
				if (imageUrl) imageNode.setAttribute('src', imageUrl);
				else imageNode.removeAttribute('src');
			}
			return;
		}
		if (propertyKey === 'styles.backgroundColor') {
			visualTarget.style.backgroundColor = typeof value === 'string' ? value : '#000000';
			return;
		}
		if (propertyKey === 'styles.color') {
			(textNode || node).style.color = typeof value === 'string' ? value : '#000000';
			return;
		}
		if (propertyKey === 'styles.zIndex') {
			node.style.zIndex = String(typeof value === 'number' ? value : (parseFloat(value) || 0));
			return;
		}
		if (propertyKey === 'styles.fontFamily') {
			(textNode || node).style.fontFamily = bindingToText(value);
			ensureRuntimeGoogleFontLoaded(bindingToText(value), {
				weight: window.getComputedStyle(textNode || node).fontWeight,
				style: window.getComputedStyle(textNode || node).fontStyle,
			});
		}
	};
	var applyNodeBindings = function(node) {
		var bindings = parseJsonAttr(node.dataset.fbBindings, null);
		if (!bindings) return;
		var bpId = getCurrentBreakpoint();
		var keys = Object.keys(bindings.desktop || {}).concat(Object.keys(bindings.tablet || {}), Object.keys(bindings.mobile || {}))
			.filter(function(propertyKey, index, allKeys) { return allKeys.indexOf(propertyKey) === index; });
		keys.forEach(function(propertyKey) {
			var binding = resolveBindingForBreakpoint(bindings, bpId, propertyKey);
			if (!binding || !binding.variableId) return;
			var variable = getVariable(binding.scope || 'page', binding.variableId);
			if (!variable) return;
			applyBindingToNode(node, propertyKey, variable);
		});
	};
	var applyAllBindings = function() {
		scope.querySelectorAll('[data-fb-bindings]').forEach(applyNodeBindings);
	};
	var executeInteraction = function(interaction, runtimeOptions) {
		if (!interaction || typeof interaction !== 'object') return;
		if (interaction.type === 'navigate') {
			var interactionUrl = resolveConfiguredNavigationUrl(interaction, runtimeOptions);
			if (interactionUrl) navigateToUrl(interactionUrl, runtimeOptions && runtimeOptions.event ? runtimeOptions.event : null);
			return;
		}
		if (interaction.type !== 'set-variable' || !interaction.variableId) return;
		var variable = resolveRuntimeVariable(interaction.variableScope || 'page', interaction.variableId, runtimeOptions);
		if (!variable) return;
		var operation = interaction.operation || 'set';
		var nextValue = cloneValue(variable.value);
		if (operation === 'default') {
			nextValue = cloneValue(variable.defaultValue);
		} else if (variable.type === 'boolean') {
			var resolvedBooleanValue = resolveConfiguredFlowValue(interaction, runtimeOptions);
			nextValue = operation === 'toggle' ? !variable.value : !!resolvedBooleanValue;
		} else if (variable.type === 'number') {
			var resolvedStepValue = operation === 'set' ? resolveConfiguredFlowValue(interaction, runtimeOptions) : interaction.value;
			var step = typeof resolvedStepValue === 'number' ? resolvedStepValue : parseFloat(resolvedStepValue);
			step = Number.isFinite(step) ? step : 0;
			if (operation === 'increment') nextValue = (Number(variable.value) || 0) + step;
			else if (operation === 'decrement') nextValue = (Number(variable.value) || 0) - step;
			else nextValue = step;
		} else {
			nextValue = resolveConfiguredFlowValue(interaction, runtimeOptions);
		}
		setVariableValue(variable.scope || interaction.variableScope || 'page', variable.id, nextValue);
		applyAllBindings();
	};
	var getFlowNodeMap = function(flow) {
		return new Map((Array.isArray(flow && flow.nodes) ? flow.nodes : []).map(function(node) {
			return [String(node.id), node];
		}));
	};
	var getFlowEdgesBySource = function(flow) {
		var map = new Map();
		(Array.isArray(flow && flow.edges) ? flow.edges : []).forEach(function(edge) {
			if (!edge || !edge.source || !edge.target) return;
			var sourceId = String(edge.source);
			var sourcePort = edge.sourcePort || 'next';
			var outgoing = map.get(sourceId) || new Map();
			outgoing.set(sourcePort, edge);
			map.set(sourceId, outgoing);
		});
		return map;
	};
	var normalizeConditionCompareValue = function(type, value) {
		if (type === 'number') {
			var numeric = typeof value === 'number' ? value : parseFloat(value);
			return Number.isFinite(numeric) ? numeric : 0;
		}
		if (type === 'boolean') return normalizeVariableValue('boolean', value);
		if (value && typeof value === 'object') return bindingToText(value);
		return value == null ? '' : String(value);
	};
	var evaluateConditionNode = function(node, runtimeOptions) {
		var config = node && typeof node.config === 'object' ? node.config : {};
		var operator = config.operator || 'equals';
		var subject = resolveConditionSubject(config, runtimeOptions);
		var left = subject.value;
		var type = subject.type || 'string';
		var right = normalizeConditionCompareValue(type, config.compareValue);
		if (type === 'number') {
			var leftNumber = typeof left === 'number' ? left : parseFloat(left);
			left = Number.isFinite(leftNumber) ? leftNumber : 0;
		} else if (type === 'boolean') {
			left = normalizeVariableValue('boolean', left);
		} else {
			left = normalizeConditionCompareValue(type, left);
		}
		if (operator === 'not-equals') return left !== right;
		if (operator === 'contains') return String(left || '').toLowerCase().indexOf(String(right || '').toLowerCase()) !== -1;
		if (operator === 'greater-than') return Number(left) > Number(right);
		if (operator === 'less-than') return Number(left) < Number(right);
		return left === right;
	};
	var getFormConfig = function(formNode) {
		return parseJsonAttr(formNode && formNode.dataset ? formNode.dataset.fbFormConfig : null, {}) || {};
	};
	var getFormStatusNode = function(formNode) {
		return formNode ? formNode.querySelector('[data-fb-form-status]') : null;
	};
	var getFormButtonNode = function(formNode) {
		return formNode ? formNode.querySelector('.fb-form-submit') : null;
	};
	var setFormRuntimeState = function(formNode, nextState, message) {
		if (!formNode) return;
		var config = getFormConfig(formNode);
		var buttonNode = getFormButtonNode(formNode);
		var statusNode = getFormStatusNode(formNode);
		var submitLabel = buttonNode && buttonNode.dataset && typeof buttonNode.dataset.fbSubmitLabel === 'string' && buttonNode.dataset.fbSubmitLabel
			? buttonNode.dataset.fbSubmitLabel
			: (typeof config.submitLabel === 'string' && config.submitLabel ? config.submitLabel : 'Submit');
		var nextLabel = nextState === 'submitting' ? 'Submitting...' : submitLabel;
		formNode.dataset.fbFormState = nextState || 'idle';
		if (buttonNode) {
			buttonNode.textContent = nextLabel;
			buttonNode.disabled = nextState === 'submitting';
			buttonNode.setAttribute('aria-disabled', nextState === 'submitting' ? 'true' : 'false');
		}
		if (statusNode) {
			statusNode.textContent = message || '';
			statusNode.style.display = message ? 'block' : 'none';
			statusNode.style.color = nextState === 'error'
				? '#b91c1c'
				: (nextState === 'success' ? '#047857' : 'rgba(15,23,42,0.68)');
		}
	};
	var buildFormSubmissionPayload = function(formNode) {
		syncRichTextFields(formNode);
		var payload = new window.FormData(formNode);
		payload.append('post_id', formNode.dataset.fbPostId || ((window.fbRuntimeData && window.fbRuntimeData.postId) ? String(window.fbRuntimeData.postId) : ''));
		payload.append('form_id', formNode.dataset.fbFormId || '');
		return payload;
	};
	var normalizeRichTextHtml = function(html) {
		var wrapper = document.createElement('div');
		wrapper.innerHTML = html || '';
		var text = (wrapper.textContent || '').replace(/\u00a0/g, ' ').trim();
		var hasContentNode = !!wrapper.querySelector('img,video,iframe,embed,object,table,blockquote,pre,code');
		return (!text && !hasContentNode) ? '' : wrapper.innerHTML;
	};
	var syncRichTextField = function(fieldNode) {
		if (!fieldNode) return;
		var editorNode = fieldNode.querySelector('[data-fb-richtext-editor="true"]');
		var inputNode = fieldNode.querySelector('[data-fb-richtext-input="true"]');
		if (!editorNode || !inputNode) return;
		var normalizedHtml = normalizeRichTextHtml(editorNode.innerHTML);
		inputNode.value = normalizedHtml;
		if (normalizedHtml) editorNode.classList.remove('is-empty');
		else editorNode.classList.add('is-empty');
	};
	var syncRichTextFields = function(scopeNode) {
		(scopeNode || scope).querySelectorAll('[data-fb-richtext-field="true"]').forEach(syncRichTextField);
	};
	var bindRichTextField = function(fieldNode) {
		if (!fieldNode || fieldNode.dataset.fbRichtextBound === '1') return;
		var editorNode = fieldNode.querySelector('[data-fb-richtext-editor="true"]');
		var inputNode = fieldNode.querySelector('[data-fb-richtext-input="true"]');
		if (!editorNode || !inputNode) return;
		fieldNode.dataset.fbRichtextBound = '1';
		syncRichTextField(fieldNode);
		['input', 'blur', 'keyup', 'paste'].forEach(function(eventName) {
			editorNode.addEventListener(eventName, function() {
				syncRichTextField(fieldNode);
			});
		});
		fieldNode.querySelectorAll('[data-fb-richtext-command]').forEach(function(buttonNode) {
			buttonNode.addEventListener('click', function() {
				var command = buttonNode.getAttribute('data-fb-richtext-command') || '';
				var commandValue = buttonNode.getAttribute('data-fb-richtext-value') || null;
				if (!command) return;
				editorNode.focus();
				if (command === 'createLink') {
					var url = window.prompt('Link URL', 'https://');
					if (!url) return;
					document.execCommand('createLink', false, url);
				} else if (command === 'formatBlock') {
					document.execCommand('formatBlock', false, '<' + (commandValue || 'p') + '>');
				} else {
					document.execCommand(command, false, commandValue);
				}
				syncRichTextField(fieldNode);
			});
		});
	};
	var getFileUploadNames = function(inputNode) {
		if (!inputNode || !inputNode.files || !inputNode.files.length) return [];
		return Array.prototype.map.call(inputNode.files, function(file) {
			return file && file.name ? file.name : 'File';
		});
	};
	var updateFileUploadField = function(fieldNode) {
		if (!fieldNode) return;
		var inputNode = fieldNode.querySelector('input[type="file"]');
		var labelNode = fieldNode.querySelector('[data-fb-file-upload-label="true"]');
		var metaNode = fieldNode.querySelector('[data-fb-file-upload-meta="true"]');
		if (!inputNode || !labelNode || !metaNode) return;
		var names = getFileUploadNames(inputNode);
		var allowsMultiple = fieldNode.getAttribute('data-fb-file-upload-multiple') === 'true';
		var placeholder = fieldNode.getAttribute('data-fb-file-upload-placeholder') || 'Drop files here or browse';
		if (!names.length) {
			labelNode.textContent = placeholder;
			metaNode.textContent = allowsMultiple ? 'Accepts multiple files' : 'Accepts one file';
			return;
		}
		labelNode.textContent = names.length === 1 ? names[0] : names.length + ' files selected';
		metaNode.textContent = names.slice(0, 3).join(', ');
	};
	var bindFileUploadField = function(fieldNode) {
		if (!fieldNode || fieldNode.dataset.fbFileUploadBound === '1') return;
		var inputNode = fieldNode.querySelector('input[type="file"]');
		if (!inputNode) return;
		fieldNode.dataset.fbFileUploadBound = '1';
		updateFileUploadField(fieldNode);
		inputNode.addEventListener('change', function() {
			updateFileUploadField(fieldNode);
		});
		['dragenter', 'dragover'].forEach(function(eventName) {
			fieldNode.addEventListener(eventName, function(event) {
				event.preventDefault();
				fieldNode.classList.add('is-dragover');
			});
		});
		['dragleave', 'dragend', 'drop'].forEach(function(eventName) {
			fieldNode.addEventListener(eventName, function(event) {
				event.preventDefault();
				fieldNode.classList.remove('is-dragover');
			});
		});
		fieldNode.addEventListener('drop', function(event) {
			var droppedFiles = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : null;
			if (!droppedFiles || !droppedFiles.length) return;
			try {
				if (inputNode.multiple) {
					inputNode.files = droppedFiles;
				} else {
					var transfer = new window.DataTransfer();
					transfer.items.add(droppedFiles[0]);
					inputNode.files = transfer.files;
				}
				updateFileUploadField(fieldNode);
			} catch (error) {
				// Fall back to the native file picker when assignment is not permitted.
			}
		});
	};
	var getFormSubmitEndpoint = function() {
		var restRoot = window.fbRuntimeData && typeof window.fbRuntimeData.restUrl === 'string' ? window.fbRuntimeData.restUrl : '';
		if (restRoot) return restRoot.replace(/\/?$/, '/') + 'forms/submit';
		try {
			return new URL('/wp-json/framebuilder/v1/forms/submit', window.location.origin).toString();
		} catch (error) {
			return '/wp-json/framebuilder/v1/forms/submit';
		}
	};
	var requestFormSubmission = function(formNode) {
		return window.fetch(getFormSubmitEndpoint(), {
			method: 'POST',
			credentials: 'same-origin',
			body: buildFormSubmissionPayload(formNode)
		}).then(function(response) {
			return response.text().then(function(text) {
				var data = {};
				if (text) {
					try {
						data = JSON.parse(text);
					} catch (error) {
						data = { success: false, message: 'Unexpected response from form submit endpoint.' };
					}
				}
				if (!response.ok || data.success === false) {
					var requestError = new Error((data && data.message) || 'Form submission failed.');
					requestError.data = data;
					throw requestError;
				}
				return data;
			});
		});
	};
	var executeFlow = function(flow, options) {
		options = options || {};
		if (!flow || typeof flow !== 'object') return;
		var nodeMap = getFlowNodeMap(flow);
		if (!nodeMap.size) return;
		var edgesBySource = getFlowEdgesBySource(flow);
		var triggerNode = null;
		nodeMap.forEach(function(node) {
			if (!triggerNode && node && node.type === 'trigger') triggerNode = node;
		});
		var getNextEdge = function(nodeId, port) {
			var outgoing = edgesBySource.get(String(nodeId));
			if (!outgoing) return null;
			return outgoing.get(port || 'next') || null;
		};
		var steps = 0;
		var runNode = function(nodeId, continuationTargetId) {
			if (!nodeId || steps > 128) return;
			steps += 1;
			var node = nodeMap.get(String(nodeId));
			if (!node) return;
			if (node.type === 'trigger') {
				var triggerPort = options.startPort || 'next';
				var triggerEdge = getNextEdge(node.id, triggerPort) || getNextEdge(node.id, 'next');
				if (triggerEdge) runNode(triggerEdge.target, null);
				return;
			}
			if (node.type === 'navigate') {
				var destinationUrl = resolveConfiguredNavigationUrl(node.config || {}, options);
				if (destinationUrl) navigateToUrl(destinationUrl, options && options.event ? options.event : null);
				return;
			}
			if (node.type === 'set-variable') {
				executeInteraction(Object.assign({ type: 'set-variable' }, node.config || {}), options);
				var setVariableEdge = getNextEdge(node.id, 'next');
				if (setVariableEdge) runNode(setVariableEdge.target, continuationTargetId);
				else if (continuationTargetId) runNode(continuationTargetId, null);
				return;
			}
			if (node.type === 'delay') {
				var duration = Math.max(0, parseInt(node.config && node.config.durationMs, 10) || 0);
				var delayEdge = getNextEdge(node.id, 'next');
				if (delayEdge) window.setTimeout(function() { runNode(delayEdge.target, continuationTargetId); }, duration);
				else if (continuationTargetId) window.setTimeout(function() { runNode(continuationTargetId, null); }, duration);
				return;
			}
			if (node.type === 'condition') {
				var branchPort = evaluateConditionNode(node, options) ? 'true' : 'false';
				var conditionContinuationEdge = getNextEdge(node.id, 'next');
				var conditionEdge = getNextEdge(node.id, branchPort) || conditionContinuationEdge;
				if (conditionEdge) runNode(conditionEdge.target, conditionContinuationEdge ? conditionContinuationEdge.target : continuationTargetId);
				else if (continuationTargetId) runNode(continuationTargetId, null);
				return;
			}
			if (node.type === 'end') return;
			var fallbackEdge = getNextEdge(node.id, 'next');
			if (fallbackEdge) runNode(fallbackEdge.target, continuationTargetId);
			else if (continuationTargetId) runNode(continuationTargetId, null);
		};
		if (triggerNode) runNode(triggerNode.id, null);
	};
	var submitRuntimeForm = function(formNode, flow) {
		if (!formNode || formNode.dataset.fbFormSubmitting === '1') return;
		var config = getFormConfig(formNode);
		formNode.dataset.fbFormSubmitting = '1';
		setFormRuntimeState(formNode, 'submitting', '');
		requestFormSubmission(formNode).then(function(data) {
			formNode.dataset.fbFormSubmitting = '0';
			setFormRuntimeState(formNode, 'success', (data && data.message) || config.successMessage || 'Thanks. Your submission was received.');
			if (flow) executeFlow(flow, { startPort: 'submitted', response: data, formNode: formNode });
		}).catch(function(error) {
			formNode.dataset.fbFormSubmitting = '0';
			var fallbackMessage = (error && error.data && error.data.message) || config.errorMessage || 'Something went wrong. Please try again.';
			setFormRuntimeState(formNode, 'error', fallbackMessage);
			if (flow) executeFlow(flow, { startPort: 'error', error: error, formNode: formNode });
		});
	};
	var bindFlow = function(node) {
		if (!node || node.dataset.fbFlowBound === '1') return;
		var flow = parseJsonAttr(node.dataset.fbFlow, null);
		if (!flow || !Array.isArray(flow.nodes) || !flow.nodes.length) return;
		var trigger = flow && typeof flow.trigger === 'object' ? flow.trigger : {};
		var triggerType = trigger.type || 'custom';
		var hasSubmissionFormNode = Array.isArray(flow.nodes) && flow.nodes.some(function(flowNode) {
			return flowNode && flowNode.type === 'submission-form';
		});
		node.dataset.fbFlowBound = '1';
		if (triggerType === 'form-submit') {
			var formNode = node.tagName === 'FORM' ? node : node.closest('form');
			if (!formNode) return;
			formNode.addEventListener('submit', function(event) {
				event.preventDefault();
				event.stopPropagation();
				submitRuntimeForm(formNode, flow);
			});
			return;
		}
		if (triggerType === 'element-click' && hasSubmissionFormNode) {
			var submissionFormNode = node.tagName === 'FORM' ? node : node.closest('form');
			if (submissionFormNode) {
				if (node.tagName === 'FORM') {
					submissionFormNode.addEventListener('submit', function(event) {
						event.preventDefault();
						event.stopPropagation();
						submitRuntimeForm(submissionFormNode, flow);
					});
					return;
				}
				node.style.cursor = 'pointer';
				node.addEventListener('click', function(event) {
					event.preventDefault();
					event.stopPropagation();
					submitRuntimeForm(submissionFormNode, flow);
				});
				return;
			}
		}
		if (triggerType === 'page-load') {
			window.requestAnimationFrame(function() {
				executeFlow(flow);
			});
			return;
		}
		node.style.cursor = 'pointer';
		node.addEventListener('click', function(event) {
			event.stopPropagation();
			executeFlow(flow, { event: event, triggerNode: node });
		});
	};
	var bindInteractions = function(node) {
		if (!node || node.dataset.fbInteractionsBound === '1') return;
		if (node.dataset.fbFlow) return;
		var interactions = parseJsonAttr(node.dataset.fbInteractions, []);
		if (!Array.isArray(interactions) || !interactions.length) return;
		node.dataset.fbInteractionsBound = '1';
		node.style.cursor = 'pointer';
		node.addEventListener('click', function(event) {
			event.stopPropagation();
			interactions.forEach(function(interaction) {
					executeInteraction(interaction, { event: event });
			});
		});
	};
	var bindLinkNode = function(node) {
		if (!node) return;
		syncLinkNodeState(node);
		if (node.dataset.fbLinkBound === '1') return;
		node.dataset.fbLinkBound = '1';
		node.addEventListener('click', function(event) {
			var url = syncLinkNodeState(node);
			if (!url || shouldIgnoreLinkActivation(node, event)) return;
			event.preventDefault();
			event.stopPropagation();
			navigateToUrl(url, event);
		});
		node.addEventListener('keydown', function(event) {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			var url = syncLinkNodeState(node);
			if (!url || shouldIgnoreLinkActivation(node, event)) return;
			event.preventDefault();
			event.stopPropagation();
			navigateToUrl(url, event);
		});
	};
	restorePersistentVariables('page');
	restorePersistentVariables('global');
	loadRuntimeFontsInScope();
	applyAllBindings();
	loadRuntimeFontsInScope();
	scope.querySelectorAll('[data-fb-richtext-field]').forEach(bindRichTextField);
	scope.querySelectorAll('[data-fb-file-upload="true"]').forEach(bindFileUploadField);
	scope.querySelectorAll('[data-fb-flow]').forEach(bindFlow);
	scope.querySelectorAll('[data-fb-interactions]').forEach(bindInteractions);
	scope.querySelectorAll('[data-fb-link-url]').forEach(bindLinkNode);
	scope.querySelectorAll('form[data-fb-form-id]').forEach(function(formNode) {
		if (!formNode || formNode.dataset.fbFormShellBound === '1') return;
		formNode.dataset.fbFormShellBound = '1';
		setFormRuntimeState(formNode, formNode.dataset.fbFormState || 'idle', '');
		formNode.addEventListener('submit', function(event) {
			if (formNode.dataset.fbFlowBound === '1') return;
			event.preventDefault();
			event.stopPropagation();
			submitRuntimeForm(formNode, null);
		});
	});
	var bindingResizeFrame = null;
	window.addEventListener('resize', function() {
		if (bindingResizeFrame) window.cancelAnimationFrame(bindingResizeFrame);
		bindingResizeFrame = window.requestAnimationFrame(function() {
			applyAllBindings();
		});
	});
	var instances = scope.querySelectorAll('.fb-component-instance[data-fb-component-id]');
	var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	var EASE_CURVES = {
		easeInOut: 'cubic-bezier(0.44, 0, 0.56, 1)',
		easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
		easeIn: 'cubic-bezier(0.64, 0, 0.78, 0)',
		linear: 'linear'
	};
	var findVariant = function(instance, variantId) {
		return Array.prototype.find.call(instance.querySelectorAll('.fb-component-variant'), function(node) {
			return node.dataset.fbVariantId === variantId;
		}) || null;
	};
	var parseNumber = function(value, fallback) {
		var parsed = parseFloat(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	};
	var parseTransition = function(node) {
		return {
			type: node.dataset.fbTransitionType || 'instant',
			duration: Math.max(0, parseNumber(node.dataset.fbTransitionDuration, 0.3)),
			physicsDuration: Math.max(0, parseNumber(node.dataset.fbTransitionPhysicsDuration, parseNumber(node.dataset.fbTransitionDuration, 0.3))),
			easePreset: node.dataset.fbTransitionEase || 'easeInOut',
			springMode: node.dataset.fbTransitionSpringMode || 'time',
			bounce: Math.max(0, Math.min(1, parseNumber(node.dataset.fbTransitionBounce, 0.2))),
			stiffness: Math.max(1, parseNumber(node.dataset.fbTransitionStiffness, 500)),
			damping: Math.max(1, parseNumber(node.dataset.fbTransitionDamping, 24)),
			mass: Math.max(0.1, parseNumber(node.dataset.fbTransitionMass, 1)),
			bezier: {
				x1: Math.max(0, Math.min(1, parseNumber(node.dataset.fbTransitionBezierX1, 0.44))),
				y1: Math.max(0, Math.min(1, parseNumber(node.dataset.fbTransitionBezierY1, 0))),
				x2: Math.max(0, Math.min(1, parseNumber(node.dataset.fbTransitionBezierX2, 0.56))),
				y2: Math.max(0, Math.min(1, parseNumber(node.dataset.fbTransitionBezierY2, 1)))
			}
		};
	};
	var getEaseValue = function(transition) {
		if (!transition || transition.type === 'instant') return 'linear';
		if (transition.type === 'ease') {
			return createBezierEase(transition.bezier);
		}
		return transition.springMode === 'physics'
			? 'none'
			: 'back.out(' + (1 + transition.bounce * 1.2) + ')';
	};
	var createBezierEase = function(bezier) {
		var x1 = Math.max(0, Math.min(1, bezier && bezier.x1 !== undefined ? bezier.x1 : 0.44));
		var y1 = Math.max(0, Math.min(1, bezier && bezier.y1 !== undefined ? bezier.y1 : 0));
		var x2 = Math.max(0, Math.min(1, bezier && bezier.x2 !== undefined ? bezier.x2 : 0.56));
		var y2 = Math.max(0, Math.min(1, bezier && bezier.y2 !== undefined ? bezier.y2 : 1));
		if (x1 === y1 && x2 === y2) return function(value) { return value; };
		var calcBezier = function(time, point1, point2) {
			var a = 1 - (3 * point2) + (3 * point1);
			var b = (3 * point2) - (6 * point1);
			var c = 3 * point1;
			return (((a * time) + b) * time + c) * time;
		};
		var getSlope = function(time, point1, point2) {
			var a = 1 - (3 * point2) + (3 * point1);
			var b = (3 * point2) - (6 * point1);
			var c = 3 * point1;
			return (3 * a * time * time) + (2 * b * time) + c;
		};
		var binarySubdivide = function(targetX, left, right) {
			var currentX;
			var currentT;
			for (var index = 0; index < 8; index++) {
				currentT = left + ((right - left) * 0.5);
				currentX = calcBezier(currentT, x1, x2) - targetX;
				if (Math.abs(currentX) < 1e-5) return currentT;
				if (currentX > 0) right = currentT;
				else left = currentT;
			}
			return currentT;
		};
		var getTForX = function(targetX) {
			var guessT = targetX;
			for (var index = 0; index < 4; index++) {
				var slope = getSlope(guessT, x1, x2);
				if (Math.abs(slope) < 1e-6) break;
				var currentX = calcBezier(guessT, x1, x2) - targetX;
				guessT -= currentX / slope;
			}
			if (guessT >= 0 && guessT <= 1) return guessT;
			return binarySubdivide(targetX, 0, 1);
		};
		return function(value) {
			return calcBezier(getTForX(Math.max(0, Math.min(1, value))), y1, y2);
		};
	};
	var getPhysicsSpringConfig = function(transition) {
		var mass = Math.max(0.1, transition.mass || 1);
		var stiffness = Math.max(1, transition.stiffness || 500);
		var damping = Math.max(1, transition.damping || 24);
		var angularFrequency = Math.sqrt(stiffness / mass);
		var dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
		var naturalDuration = dampingRatio < 1
			? Math.log(1 / 0.0025) / (Math.max(0.05, dampingRatio) * angularFrequency)
			: Math.log(1 / 0.0025) / angularFrequency;
		return {
			mass: mass,
			stiffness: stiffness,
			damping: damping,
			angularFrequency: angularFrequency,
			dampingRatio: dampingRatio,
			naturalDuration: Math.max(0.45, Math.min(2.4, naturalDuration)),
			duration: Math.max(0.18, parseNumber(transition.physicsDuration, Math.max(0.45, Math.min(2.4, naturalDuration))))
		};
	};
	var getScrollProgressEase = function(transition) {
		if (!transition || transition.type === 'instant') return null;
		if (transition.type === 'ease') return createBezierEase(transition.bezier);
		if (transition.springMode === 'physics') {
			return createBezierEase({ x1: 0.16, y1: 1, x2: 0.3, y2: 1 });
		}
		var bounce = clamp(parseNumber(transition.bounce, 0.2), 0, 1);
		return createBezierEase({
			x1: 0.2,
			y1: Math.min(1, 0.55 + (bounce * 0.2)),
			x2: 0.36,
			y2: 1
		});
	};
	var mapScrollAnimationProgress = function(animation, progress) {
		var clampedProgress = clamp(progress, 0, 1);
		var transition = normalizeAnimationTransition(animation && animation.transition, { duration: 0.7, easePreset: 'easeInOut' });
		var easing = getScrollProgressEase(transition);
		return easing ? clamp(easing(clampedProgress), 0, 1) : clampedProgress;
	};
	var sampleSpringValue = function(initialValue, elapsed, spring) {
		if (!initialValue) return 0;
		var velocity = 0;
		var angularFrequency = spring.angularFrequency;
		var dampingRatio = spring.dampingRatio;
		if (dampingRatio < 1) {
			var dampedFrequency = angularFrequency * Math.sqrt(1 - (dampingRatio * dampingRatio));
			var envelope = Math.exp(-dampingRatio * angularFrequency * elapsed);
			var coefficient = (velocity + (dampingRatio * angularFrequency * initialValue)) / dampedFrequency;
			return envelope * ((initialValue * Math.cos(dampedFrequency * elapsed)) + (coefficient * Math.sin(dampedFrequency * elapsed)));
		}
		if (Math.abs(dampingRatio - 1) < 0.0001) {
			return (initialValue + ((velocity + (angularFrequency * initialValue)) * elapsed)) * Math.exp(-angularFrequency * elapsed);
		}
		var decay = Math.sqrt((dampingRatio * dampingRatio) - 1);
		var rateA = -angularFrequency * (dampingRatio - decay);
		var rateB = -angularFrequency * (dampingRatio + decay);
		var coeffA = (velocity - (rateB * initialValue)) / (rateA - rateB);
		var coeffB = initialValue - coeffA;
		return (coeffA * Math.exp(rateA * elapsed)) + (coeffB * Math.exp(rateB * elapsed));
	};
	var addPhysicsSpringSequence = function(timeline, node, startState, spring, at) {
		var stepCount = 24;
		var previousScheduledTime = 0;
		for (var index = 1; index <= stepCount; index++) {
			var elapsed = (spring.naturalDuration * index) / stepCount;
			var scheduledTime = (spring.duration * index) / stepCount;
			var stepDuration = scheduledTime - previousScheduledTime;
			timeline.to(node, {
				x: sampleSpringValue(startState.x, elapsed, spring),
				y: sampleSpringValue(startState.y, elapsed, spring),
				scaleX: 1 + sampleSpringValue(startState.scaleX - 1, elapsed, spring),
				scaleY: 1 + sampleSpringValue(startState.scaleY - 1, elapsed, spring),
				rotation: sampleSpringValue(startState.rotation || 0, elapsed, spring),
				duration: stepDuration,
				ease: 'none',
				clearProps: index === stepCount ? 'transform' : undefined
			}, at + previousScheduledTime);
			previousScheduledTime = scheduledTime;
		}
	};
	var addWrapperPhysicsSequence = function(timeline, node, spring, at) {
		gsap.set(node, { scaleX: 0.935, scaleY: 0.935, transformOrigin: 'center center' });
		addPhysicsSpringSequence(timeline, node, {
			x: 0,
			y: 0,
			scaleX: 0.935,
			scaleY: 0.935
		}, spring, at);
	};
	var getTransitionDurationMs = function(transition) {
		if (!transition || transition.type === 'instant') return 0;
		if (transition.type === 'ease') return Math.max(120, transition.duration * 1000);
		if (transition.springMode === 'time') return Math.max(180, transition.duration * 1000);
		return getPhysicsSpringConfig(transition).duration * 1000;
	};
	var clamp = function(value, min, max) {
		return Math.min(max, Math.max(min, value));
	};
	var lerp = function(start, end, progress) {
		return start + ((end - start) * progress);
	};
	var interpolateValue = function(fromValue, toValue, progress) {
		if (fromValue == null) return toValue;
		if (toValue == null) return fromValue;
		if (typeof fromValue === 'number' && typeof toValue === 'number') return lerp(fromValue, toValue, progress);
		if (gsap && gsap.utils && typeof gsap.utils.interpolate === 'function') {
			return gsap.utils.interpolate(fromValue, toValue, progress);
		}
		return progress >= 1 ? toValue : fromValue;
	};
	var parseBlurRadius = function(value) {
		if (typeof value === 'number' && isFinite(value)) return Math.max(0, value);
		if (typeof value !== 'string') return 0;
		var match = value.match(/blur\(([-\d.]+)px\)/i);
		if (!match) return 0;
		var parsed = parseFloat(match[1]);
		return isFinite(parsed) ? Math.max(0, parsed) : 0;
	};
	var parseFilterPercent = function(value, fnName, fallback) {
		if (typeof value !== 'string') return fallback;
		var escapedName = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		var match = value.match(new RegExp(escapedName + '\\(([-\\d.]+)%\\)', 'i'));
		if (!match) return fallback;
		var parsed = parseFloat(match[1]);
		return isFinite(parsed) ? Math.max(0, Math.min(200, parsed)) : fallback;
	};
	var parseFilterSettings = function(value) {
		var source = typeof value === 'string' ? value : '';
		return {
			blur: parseBlurRadius(source),
			brightness: parseFilterPercent(source, 'brightness', 100),
			contrast: parseFilterPercent(source, 'contrast', 100),
			saturation: parseFilterPercent(source, 'saturate', 100)
		};
	};
	var buildBlurValue = function(value) {
		var amount = typeof value === 'number' ? value : parseFloat(value);
		amount = isFinite(amount) ? Math.max(0, amount) : 0;
		return amount > 0.01 ? 'blur(' + amount + 'px)' : 'none';
	};
	var buildFilterValue = function(settings) {
		var source = settings && typeof settings === 'object' ? settings : {};
		var brightness = Math.max(0, Math.min(200, parseNumber(source.brightness, 100)));
		var contrast = Math.max(0, Math.min(200, parseNumber(source.contrast, 100)));
		var saturation = Math.max(0, Math.min(200, parseNumber(source.saturation, 100)));
		var blur = Math.max(0, parseNumber(source.blur, 0));
		var filters = [];
		if (Math.abs(brightness - 100) > 0.01) filters.push('brightness(' + brightness + '%)');
		if (Math.abs(contrast - 100) > 0.01) filters.push('contrast(' + contrast + '%)');
		if (Math.abs(saturation - 100) > 0.01) filters.push('saturate(' + saturation + '%)');
		if (blur > 0.01) filters.push('blur(' + blur + 'px)');
		return filters.length ? filters.join(' ') : 'none';
	};
	var setNodeBackdropFilter = function(node, value) {
		if (!node) return;
		node.style.backdropFilter = value;
		node.style.webkitBackdropFilter = value;
	};
	var getViewportHeight = function() {
		return window.innerHeight || document.documentElement.clientHeight || 1;
	};
	var normalizeAnimationTransition = function(transition, fallback) {
		var safe = transition && typeof transition === 'object' ? transition : {};
		var source = Object.assign({
			type: 'ease',
			duration: 0.6,
			physicsDuration: 0.6,
			easePreset: 'easeInOut',
			springMode: 'time',
			bounce: 0.2,
			stiffness: 500,
			damping: 24,
			mass: 1,
			bezier: { x1: 0.44, y1: 0, x2: 0.56, y2: 1 }
		}, fallback || {}, safe);
		if (!source.bezier || typeof source.bezier !== 'object') source.bezier = { x1: 0.44, y1: 0, x2: 0.56, y2: 1 };
		source.physicsDuration = parseNumber(safe.physicsDuration, parseNumber(source.duration, 0.6));
		return source;
	};
	var normalizeAnimationMarkerOffset = function(value) {
		var numericValue = typeof value === 'number' ? value : parseFloat(value);
		if (!isFinite(numericValue)) return null;
		return clamp(numericValue, -2, 2);
	};
	var normalizeAnimationMarkerOffsetPx = function(value) {
		var numericValue = typeof value === 'number' ? value : parseFloat(value);
		if (!isFinite(numericValue)) return null;
		return clamp(numericValue, -20000, 20000);
	};
	var normalizeScrollVariantTargets = function(animation) {
		if (!animation || typeof animation !== 'object') return [];
		var targets = Array.isArray(animation.targets) && animation.targets.length
			? animation.targets
			: [{ targetVariantId: animation.targetVariantId || null, marker: animation.marker }];
		return targets.map(function(target, index) {
			return {
				id: target && target.id ? String(target.id) : ('target-' + index),
				targetVariantId: target && target.targetVariantId ? String(target.targetVariantId) : null,
				marker: clamp(parseNumber(target && target.marker, index === 0 ? 0.5 : (0.35 + (index * 0.18))), 0, 1),
				markerOffset: normalizeAnimationMarkerOffset(target && target.markerOffset),
				markerOffsetPx: normalizeAnimationMarkerOffsetPx(target && target.markerOffsetPx)
			};
		}).sort(function(left, right) {
			return left.marker - right.marker;
		});
	};
	var resolveAnimationsForBreakpoint = function(animations, bpId) {
		var safe = animations && typeof animations === 'object' ? animations : {};
		if (bpId === 'mobile') return Array.isArray(safe.mobile) ? safe.mobile : (Array.isArray(safe.tablet) ? safe.tablet : (Array.isArray(safe.desktop) ? safe.desktop : []));
		if (bpId === 'tablet') return Array.isArray(safe.tablet) ? safe.tablet : (Array.isArray(safe.desktop) ? safe.desktop : []);
		return Array.isArray(safe.desktop) ? safe.desktop : [];
	};
	var getNodeViewportRatio = function(node) {
		if (!node) return 1;
		var rect = node.getBoundingClientRect();
		return rect.top / getViewportHeight();
	};
	var getDocumentTop = function(node) {
		if (!node || !node.getBoundingClientRect) return 0;
		var rect = node.getBoundingClientRect();
		return (window.scrollY || window.pageYOffset || 0) + rect.top;
	};
	var getNodeMarkerBoard = function(node) {
		if (!node || !node.closest) return null;
		return node.closest('.fb-bp-inner') || node.closest('.fb-bp') || node.parentElement || null;
	};
	var isStickyNodeElement = function(node) {
		if (!node) return false;
		if (node.classList && node.classList.contains('fb-el--sticky')) return true;
		var computedStyle = window.getComputedStyle(node);
		var position = computedStyle ? computedStyle.position : '';
		return position === 'sticky' || position === '-webkit-sticky';
	};
	var getCumulativeOffsetTop = function(target) {
		if (!target) return 0;
		var offset = 0;
		var current = target;
		while (current) {
			offset += current.offsetTop || 0;
			current = current.offsetParent;
		}
		return offset;
	};
	var isOffsetParentAncestor = function(target, ancestor) {
		var current = target;
		while (current) {
			if (current === ancestor) return true;
			current = current.offsetParent;
		}
		return false;
	};
	var getNodeMarkerAnchorTarget = function(node, board) {
		if (!node || !board) return null;
		return node;
	};
	var getNaturalLocalOffsetTop = function(target, ancestor) {
		if (!target || !ancestor) return 0;
		if (isOffsetParentAncestor(target, ancestor)) {
			return getCumulativeOffsetTop(target) - getCumulativeOffsetTop(ancestor);
		}
		var ancestorRect = ancestor.getBoundingClientRect ? ancestor.getBoundingClientRect() : null;
		var targetRect = target.getBoundingClientRect ? target.getBoundingClientRect() : null;
		if (ancestorRect && targetRect) {
			return (targetRect.top - ancestorRect.top) + (ancestor.scrollTop || 0);
		}
		return 0;
	};
	var refreshNaturalMarkerAnchor = function(target, ancestor) {
		if (!target || !ancestor) return;
		target.__fbNaturalLocalOffsetTop = getNaturalLocalOffsetTop(target, ancestor);
	};
	var cacheNaturalMarkerAnchor = function(target, ancestor) {
		if (!target || !ancestor) return;
		if (typeof target.__fbNaturalLocalOffsetTop === 'number') return;
		refreshNaturalMarkerAnchor(target, ancestor);
	};
	var getNaturalMarkerAnchor = function(target, ancestor) {
		if (!target || !ancestor) return 0;
		cacheNaturalMarkerAnchor(target, ancestor);
		return typeof target.__fbNaturalLocalOffsetTop === 'number' ? target.__fbNaturalLocalOffsetTop : 0;
	};
	var buildNodeMarkerContext = function(node) {
		if (!node) return null;
		var board = getNodeMarkerBoard(node);
		if (!board) return null;
		var anchorTarget = getNodeMarkerAnchorTarget(node, board);
		return {
			board: board,
			boardHeight: Math.max(1, board.clientHeight || board.offsetHeight || 1),
			boardDocumentTop: getDocumentTop(board),
			naturalTop: getNaturalMarkerAnchor(anchorTarget, board)
		};
	};
	var refreshNodeMarkerAnchor = function(node) {
		if (!node) return;
		var board = getNodeMarkerBoard(node);
		if (!board) return;
		refreshNaturalMarkerAnchor(getNodeMarkerAnchorTarget(node, board), board);
	};
	var getMarkerLocalYFromContext = function(context, ratioValue, offsetPxValue, fallback) {
		if (!context) return 0;
		var markerOffsetPx = normalizeAnimationMarkerOffsetPx(offsetPxValue);
		if (markerOffsetPx != null) {
			return context.naturalTop + markerOffsetPx;
		}
		var markerRatio = clamp(parseNumber(ratioValue, fallback), 0, 1);
		return clamp(markerRatio * context.boardHeight, 0, context.boardHeight);
	};
	var getMarkerOffsetPxFromContext = function(context, ratioValue, offsetPxValue, fallback) {
		if (!context) return 0;
		var markerOffsetPx = normalizeAnimationMarkerOffsetPx(offsetPxValue);
		if (markerOffsetPx != null) return markerOffsetPx;
		return getMarkerLocalYFromContext(context, ratioValue, offsetPxValue, fallback) - context.naturalTop;
	};
	var resolveMarkerOffsetPxFromContext = function(context, ratioValue, offsetPxValue, fallback) {
		return getMarkerOffsetPxFromContext(context, ratioValue, offsetPxValue, fallback);
	};
	var resolveScrollSequenceMarkerOffsetPxFromContext = function(context, ratioValue, offsetPxValue, fallback) {
		return getMarkerOffsetPxFromContext(context, ratioValue, offsetPxValue, fallback);
	};
	var resolveMarkerLocalYFromContext = function(context, ratioValue, offsetPxValue, fallback) {
		return getMarkerLocalYFromContext(context, ratioValue, offsetPxValue, fallback);
	};
	var getNodeAnchorDocumentTopFromContext = function(context) {
		if (!context) return Infinity;
		return context.boardDocumentTop + context.naturalTop;
	};
	var getNodeAnchorViewportTopFromContext = function(context) {
		if (!context) return Infinity;
		var scrollTop = window.scrollY || window.pageYOffset || 0;
		return getNodeAnchorDocumentTopFromContext(context) - scrollTop;
	};
	var getNodeAnchorTravelFromContext = function(context) {
		if (!context) return -Infinity;
		return -getNodeAnchorViewportTopFromContext(context);
	};
	var resolveMarkerDocumentTopFromContext = function(context, ratioValue, offsetPxValue, fallback) {
		if (!context) return Infinity;
		return context.boardDocumentTop + getMarkerLocalYFromContext(context, ratioValue, offsetPxValue, fallback);
	};
	var buildScrollAnimationMetrics = function(node, start, end, startOffsetPx, endOffsetPx) {
		var context = buildNodeMarkerContext(node);
		if (!context) return null;
		return {
			context: context,
			startMarkerDocumentTop: resolveMarkerDocumentTopFromContext(context, start, startOffsetPx, 0.2),
			endMarkerDocumentTop: resolveMarkerDocumentTopFromContext(context, end, endOffsetPx, 0.68)
		};
	};
	var getScrollAnimationProgressFromMetrics = function(metrics) {
		if (!metrics) return 0;
		var scrollTop = window.scrollY || window.pageYOffset || 0;
		var range = metrics.endMarkerDocumentTop - metrics.startMarkerDocumentTop;
		if (Math.abs(range) < 0.0001) return scrollTop >= metrics.endMarkerDocumentTop ? 1 : 0;
		return clamp((scrollTop - metrics.startMarkerDocumentTop) / range, 0, 1);
	};
	var getLocalOffsetWithinAncestor = function(target, ancestor) {
		if (!target || !ancestor) return 0;
		if (typeof target.__fbNaturalLocalOffsetTop === 'number') {
			return target.__fbNaturalLocalOffsetTop;
		}
		cacheNaturalMarkerAnchor(target, ancestor);
		if (typeof target.__fbNaturalLocalOffsetTop === 'number') {
			return target.__fbNaturalLocalOffsetTop;
		}
		return getNaturalLocalOffsetTop(target, ancestor);
	};
	var getMarkerLocalY = function(node, ratioValue, offsetPxValue, fallback) {
		if (!node) return 0;
		var context = buildNodeMarkerContext(node);
		if (!context) return 0;
		return getMarkerLocalYFromContext(context, ratioValue, offsetPxValue, fallback);
	};
	var getMarkerDocumentTop = function(node, ratioValue, offsetPxValue, fallback) {
		if (!node) return Infinity;
		var context = buildNodeMarkerContext(node);
		if (!context) return Infinity;
		return getNodeAnchorDocumentTopFromContext(context) + resolveMarkerOffsetPxFromContext(context, ratioValue, offsetPxValue, fallback);
	};
	var getNodeNaturalViewportTop = function(node) {
		if (!node) return Infinity;
		return getNodeAnchorViewportTopFromContext(buildNodeMarkerContext(node));
	};
	var getMarkerViewportDistance = function(node, ratioValue, offsetPxValue, fallback) {
		if (!node) return Infinity;
		return getMarkerDocumentTop(node, ratioValue, offsetPxValue, fallback) - (window.scrollY || window.pageYOffset || 0);
	};
	var resolveRelativeMarkerRatio = function(node, ratioValue, offsetValue, offsetPxValue, fallback) {
		if (!node) return clamp(parseNumber(ratioValue, fallback), 0, 1);
		var board = getNodeMarkerBoard(node);
		var boardHeight = Math.max(1, board ? (board.clientHeight || board.offsetHeight || 1) : 1);
		return clamp(getMarkerLocalY(node, ratioValue, offsetPxValue, fallback) / boardHeight, 0, 1);
	};
	var getScrollAnimationProgress = function(node, start, end, startOffset, endOffset, startOffsetPx, endOffsetPx) {
		return getScrollAnimationProgressFromMetrics(buildScrollAnimationMetrics(node, start, end, startOffsetPx, endOffsetPx));
	};
	var initScrollSequence = function(node) {
		if (!node || node.dataset.fbScrollSequenceBound === '1') return;
		var config = parseJsonAttr(node.dataset.fbScrollSequence, null);
		if (!config || typeof config !== 'object') return;
		var media = node.querySelector('[data-fb-scroll-sequence-media]');
		if (!media) return;
		node.dataset.fbScrollSequenceBound = '1';
		var type = config.type === 'image-sequence' ? 'image-sequence' : (config.type === 'gif' ? 'gif' : 'video');
		var frames = Array.isArray(config.frames) ? config.frames.filter(function(entry) {
			return typeof entry === 'string' && entry;
		}) : [];
		var preloadedFrames = type === 'image-sequence'
			? frames.map(function(entry) {
				var image = new window.Image();
				image.decoding = 'async';
				image.src = entry;
				return image;
			})
			: [];
		var lastFrameIndex = -1;
		var scrollFrame = null;
		var metrics = null;
		var refreshMetrics = function(forceAnchorRefresh) {
			refreshNodeMarkerAnchor(node);
			metrics = buildScrollAnimationMetrics(node, config.start, config.end, config.startOffsetPx, config.endOffsetPx);
		};
		var updateSequence = function() {
			scrollFrame = null;
			refreshMetrics(false);
			var progress = getScrollAnimationProgressFromMetrics(metrics);
			node.style.setProperty('--fb-scroll-sequence-progress', String(progress));
			if (type === 'video') {
				var applyVideoProgress = function() {
					if (!isFinite(media.duration) || media.duration <= 0) return;
					var nextTime = clamp(progress, 0, 1) * media.duration;
					if (Math.abs((media.currentTime || 0) - nextTime) > 0.033) media.currentTime = nextTime;
				};
				if (media.readyState >= 1) applyVideoProgress();
				else media.addEventListener('loadedmetadata', applyVideoProgress, { once: true });
				return;
			}
			if (type === 'image-sequence') {
				if (!frames.length) return;
				var nextIndex = Math.round(clamp(progress, 0, 1) * Math.max(0, frames.length - 1));
				if (nextIndex === lastFrameIndex) return;
				lastFrameIndex = nextIndex;
				var nextFrameSrc = preloadedFrames[nextIndex] && preloadedFrames[nextIndex].src ? preloadedFrames[nextIndex].src : frames[nextIndex];
				if (media.src !== nextFrameSrc) media.src = nextFrameSrc;
				return;
			}
			if (type === 'gif' && progress <= 0.001 && typeof config.src === 'string' && config.src) {
				if (media.getAttribute('src') !== config.src) media.setAttribute('src', config.src);
			}
		};
		var requestUpdate = function() {
			if (scrollFrame) return;
			scrollFrame = window.requestAnimationFrame(updateSequence);
		};
		var handleResize = function() {
			refreshMetrics(true);
			requestUpdate();
		};
		refreshMetrics(true);
		window.addEventListener('scroll', requestUpdate, { passive: true });
		window.addEventListener('resize', handleResize);
		window.addEventListener('load', handleResize);
		requestUpdate();
	};
	var parseBaseTranslatePercent = function(transformCss, axis) {
		if (typeof transformCss !== 'string' || !transformCss) return 0;
		var normalized = transformCss.replace(/\s+/g, ' ').trim();
		if (!normalized) return 0;
		if (axis === 'x') {
			var translate3dMatchX = normalized.match(/translate3d\(\s*(-?[\d.]+)%\s*,/i);
			if (translate3dMatchX) return parseNumber(translate3dMatchX[1], 0);
			var translateMatchX = normalized.match(/translate\(\s*(-?[\d.]+)%\s*,/i);
			if (translateMatchX) return parseNumber(translateMatchX[1], 0);
			var translateXMatch = normalized.match(/translateX\(\s*(-?[\d.]+)%\s*\)/i);
			if (translateXMatch) return parseNumber(translateXMatch[1], 0);
			return 0;
		}
		var translate3dMatchY = normalized.match(/translate3d\(\s*-?[\d.]+%\s*,\s*(-?[\d.]+)%/i);
		if (translate3dMatchY) return parseNumber(translate3dMatchY[1], 0);
		var translateMatchY = normalized.match(/translate\(\s*-?[\d.]+%\s*,\s*(-?[\d.]+)%/i);
		if (translateMatchY) return parseNumber(translateMatchY[1], 0);
		var translateYMatch = normalized.match(/translateY\(\s*(-?[\d.]+)%\s*\)/i);
		if (translateYMatch) return parseNumber(translateYMatch[1], 0);
		return 0;
	};
	var getAnimationBaseState = function(node) {
		if (node.__fbAnimationBaseState) return node.__fbAnimationBaseState;
		var computed = window.getComputedStyle(node);
		var visualTarget = getVisualTarget(node);
		var visualComputed = visualTarget && visualTarget !== node ? window.getComputedStyle(visualTarget) : computed;
		var rect = node.getBoundingClientRect();
		var inlineTransform = node.style.transform || '';
		var textNode = node.querySelector('.fb-text-content');
		var iconNode = node.querySelector('.fb-icon-content');
		var textComputed = textNode ? window.getComputedStyle(textNode) : null;
		var contentComputed = textComputed || (iconNode ? window.getComputedStyle(iconNode) : null) || computed;
		var filterSettings = parseFilterSettings(computed.filter || 'none');
		node.__fbAnimationBaseState = {
			left: parseNumber(node.style.left, parseNumber(computed.left, 0)),
			top: parseNumber(node.style.top, parseNumber(computed.top, 0)),
			baseLayoutX: parseNumber(node.getAttribute('data-fb-base-x'), 0),
			baseLayoutY: parseNumber(node.getAttribute('data-fb-base-y'), 0),
			leftCss: node.style.left || '',
			topCss: node.style.top || '',
			transformCss: inlineTransform,
			position: computed.position,
			xPercent: parseBaseTranslatePercent(inlineTransform, 'x'),
			yPercent: parseBaseTranslatePercent(inlineTransform, 'y'),
			width: parseNumber(node.style.width, parseNumber(computed.width, rect.width || node.offsetWidth || 0)),
			height: parseNumber(node.style.height, parseNumber(computed.height, rect.height || node.offsetHeight || 0)),
			widthCss: node.style.width || '',
			heightCss: node.style.height || '',
			rotation: parseNumber(node.getAttribute('data-fb-base-rotation'), getRotationFromComputedStyle(computed)),
			rotationX: parseNumber(node.getAttribute('data-fb-base-rotation-x'), 0),
			rotationY: parseNumber(node.getAttribute('data-fb-base-rotation-y'), 0),
			opacity: parseNumber(computed.opacity, 1),
			backgroundColor: visualComputed.backgroundColor,
			color: contentComputed.color,
			borderColor: visualComputed.borderColor,
			borderRadius: visualComputed.borderRadius,
			boxShadow: visualComputed.boxShadow,
			blur: filterSettings.blur,
			brightness: filterSettings.brightness,
			contrast: filterSettings.contrast,
			saturation: filterSettings.saturation,
			filter: computed.filter || 'none',
			backdropBlur: parseBlurRadius(computed.backdropFilter || computed.webkitBackdropFilter),
			backdropFilter: computed.backdropFilter || computed.webkitBackdropFilter || 'none',
			visualTarget: visualTarget,
			textNode: textNode,
			iconNode: iconNode
		};
		return node.__fbAnimationBaseState;
	};
	var buildBaseRotationTransform = function(baseState) {
		if (!baseState) return 'none';
		var transforms = [];
		if ((baseState.xPercent || 0) !== 0 || (baseState.yPercent || 0) !== 0) {
			if ((baseState.xPercent || 0) !== 0 && (baseState.yPercent || 0) !== 0) transforms.push('translate(' + (baseState.xPercent || 0) + '%, ' + (baseState.yPercent || 0) + '%)');
			else if ((baseState.xPercent || 0) !== 0) transforms.push('translateX(' + (baseState.xPercent || 0) + '%)');
			else transforms.push('translateY(' + (baseState.yPercent || 0) + '%)');
		}
		if ((baseState.rotationX || 0) !== 0 || (baseState.rotationY || 0) !== 0) transforms.push('perspective(1000px)');
		if ((baseState.rotationX || 0) !== 0) transforms.push('rotateX(' + (baseState.rotationX || 0) + 'deg)');
		if ((baseState.rotationY || 0) !== 0) transforms.push('rotateY(' + (baseState.rotationY || 0) + 'deg)');
		if ((baseState.rotation || 0) !== 0) transforms.push('rotate(' + (baseState.rotation || 0) + 'deg)');
		return transforms.length ? transforms.join(' ') : 'none';
	};
	var restoreAnimationBaseState = function(node) {
		if (!node) return;
		var baseState = getAnimationBaseState(node);
		var visualTarget = baseState.visualTarget || node;
		if (gsap) {
			gsap.killTweensOf(node);
			gsap.set(node, {
				opacity: baseState.opacity,
				xPercent: baseState.xPercent || 0,
				yPercent: baseState.yPercent || 0,
				x: 0,
				y: 0,
				scaleX: 1,
				scaleY: 1,
				rotation: baseState.rotation || 0,
				rotationX: baseState.rotationX || 0,
				rotationY: baseState.rotationY || 0,
				skewX: 0,
				skewY: 0,
				transformPerspective: (baseState.rotationX || baseState.rotationY) ? 1000 : 0,
				transformOrigin: 'center center',
				overwrite: true,
			});
		}
		node.style.left = baseState.leftCss;
		node.style.top = baseState.topCss;
		node.style.width = baseState.widthCss;
		node.style.height = baseState.heightCss;
		visualTarget.style.backgroundColor = baseState.backgroundColor;
		visualTarget.style.borderColor = baseState.borderColor;
		visualTarget.style.borderRadius = baseState.borderRadius;
		visualTarget.style.boxShadow = baseState.boxShadow;
		node.style.filter = baseState.filter;
		setNodeBackdropFilter(node, baseState.backdropFilter);
		node.style.transform = buildBaseRotationTransform(baseState);
		node.style.transformStyle = (baseState.rotationX || baseState.rotationY) ? 'preserve-3d' : '';
		(baseState.textNode || baseState.iconNode || node).style.color = baseState.color;
	};
	var hasAnimationPatchState = function(state) {
		if (!state || typeof state !== 'object') return false;
		var layout = state.layout && typeof state.layout === 'object' ? state.layout : null;
		var styles = state.styles && typeof state.styles === 'object' ? state.styles : null;
		return !!((layout && Object.keys(layout).length) || (styles && Object.keys(styles).length));
	};
	var clampLoopNumber = function(value, fallback, min, max) {
		var numericValue = typeof value === 'number' ? value : parseFloat(value);
		if (!isFinite(numericValue)) numericValue = fallback;
		if (typeof min === 'number') numericValue = Math.max(min, numericValue);
		if (typeof max === 'number') numericValue = Math.min(max, numericValue);
		return numericValue;
	};
	var ensureLoopAnimationStyles = function() {
		if (document.getElementById('fb-loop-animation-style')) return;
		var styleNode = document.createElement('style');
		styleNode.id = 'fb-loop-animation-style';
		styleNode.textContent = '@keyframes fb-loop-animation{0%{opacity:var(--fb-loop-opacity-from,1);transform:var(--fb-loop-transform-from,none);}100%{opacity:1;transform:var(--fb-loop-transform-to,none);}}';
		document.head.appendChild(styleNode);
	};
	var getLoopAnimationTiming = function(transition) {
		if (!transition || transition.type === 'instant') return 'linear';
		if (transition.type === 'realistic') {
			if (transition.springMode === 'physics') return 'cubic-bezier(0.16, 1, 0.3, 1)';
			var bounce = clampLoopNumber(transition.bounce, 0.2, 0, 1);
			return 'cubic-bezier(0.2, ' + Math.max(0.55, 1 - (bounce * 0.35)) + ', 0.2, ' + Math.min(1.45, 1 + (bounce * 0.45)) + ')';
		}
		var bezier = transition.bezier || { x1: 0.44, y1: 0, x2: 0.56, y2: 1 };
		return 'cubic-bezier(' + clampLoopNumber(bezier.x1, 0.44, 0, 1) + ', ' + clampLoopNumber(bezier.y1, 0, -2, 2) + ', ' + clampLoopNumber(bezier.x2, 0.56, 0, 1) + ', ' + clampLoopNumber(bezier.y2, 1, -2, 2) + ')';
	};
	var buildLoopTransform = function(effect, baseState) {
		var transforms = [];
		var baseRotation = baseState && baseState.rotation ? baseState.rotation : 0;
		var baseRotationX = baseState && baseState.rotationX ? baseState.rotationX : 0;
		var baseRotationY = baseState && baseState.rotationY ? baseState.rotationY : 0;
		var baseXPercent = baseState && baseState.xPercent ? baseState.xPercent : 0;
		var baseYPercent = baseState && baseState.yPercent ? baseState.yPercent : 0;
		if (baseXPercent !== 0 || baseYPercent !== 0) {
			if (baseXPercent !== 0 && baseYPercent !== 0) transforms.push('translate(' + baseXPercent + '%, ' + baseYPercent + '%)');
			else if (baseXPercent !== 0) transforms.push('translateX(' + baseXPercent + '%)');
			else transforms.push('translateY(' + baseYPercent + '%)');
		}
		if (baseRotationX !== 0 || baseRotationY !== 0 || (effect && effect.rotateMode === '3d')) transforms.push('perspective(1000px)');
		if (baseRotationX !== 0) transforms.push('rotateX(' + baseRotationX + 'deg)');
		if (baseRotationY !== 0) transforms.push('rotateY(' + baseRotationY + 'deg)');
		if (baseRotation) transforms.push('rotate(' + baseRotation + 'deg)');
		var offsetX = clampLoopNumber(effect && effect.offsetX, 0, -4000, 4000);
		var offsetY = clampLoopNumber(effect && effect.offsetY, 0, -4000, 4000);
		if (offsetX !== 0 || offsetY !== 0) transforms.push('translate(' + offsetX + 'px, ' + offsetY + 'px)');
		var scale = clampLoopNumber(effect && effect.scale, 1, 0.1, 4);
		if (scale !== 1) transforms.push('scale(' + scale + ')');
		var skewX = clampLoopNumber(effect && effect.skewX, 0, -180, 180);
		var skewY = clampLoopNumber(effect && effect.skewY, 0, -180, 180);
		if (skewX !== 0 || skewY !== 0) transforms.push('skew(' + skewX + 'deg, ' + skewY + 'deg)');
		if (effect && effect.rotateMode === '3d') {
			transforms.push('perspective(1000px)');
			var rotateX = clampLoopNumber(effect.rotateX, 0, -1080, 1080);
			var rotateY = clampLoopNumber(effect.rotateY, 0, -1080, 1080);
			var rotateZ = clampLoopNumber(effect.rotate, 0, -1080, 1080);
			if (rotateX !== 0) transforms.push('rotateX(' + rotateX + 'deg)');
			if (rotateY !== 0) transforms.push('rotateY(' + rotateY + 'deg)');
			if (rotateZ !== 0) transforms.push('rotateZ(' + rotateZ + 'deg)');
		} else {
			var rotate = clampLoopNumber(effect && effect.rotate, 0, -1080, 1080);
			if (rotate !== 0) transforms.push('rotate(' + rotate + 'deg)');
		}
		return transforms.length ? transforms.join(' ') : 'none';
	};
	var clearLoopAnimation = function(node) {
		if (!node) return;
		node.style.removeProperty('--fb-loop-opacity-from');
		node.style.removeProperty('--fb-loop-transform-from');
		node.style.removeProperty('--fb-loop-transform-to');
		node.style.animationName = '';
		node.style.animationDuration = '';
		node.style.animationTimingFunction = '';
		node.style.animationDelay = '';
		node.style.animationIterationCount = '';
		node.style.animationDirection = '';
		node.style.animationFillMode = '';
		node.style.animationPlayState = '';
		node.style.transformStyle = '';
		node.style.willChange = '';
	};
	var applyHoverAnimation = function(node, animation, active) {
		if (!node || !animation) return;
		var baseState = getAnimationBaseState(node);
		var effect = animation && animation.effect ? animation.effect : {};
		var transition = normalizeAnimationTransition(animation && animation.transition, { duration: 0.22, easePreset: 'easeInOut' });
		var duration = getTransitionDurationMs(transition) / 1000;
		var ease = transition.type === 'realistic'
			? (transition.springMode === 'physics'
				? 'elastic.out(1,' + Math.max(0.2, transition.mass * 0.45) + ')'
				: 'back.out(' + (1 + transition.bounce * 1.2) + ')')
			: getEaseValue(transition);
		var targetOpacity = active ? clampLoopNumber(effect.opacity, baseState.opacity, 0, 1) : baseState.opacity;
		var targetX = active ? clampLoopNumber(effect.offsetX, 0, -4000, 4000) : 0;
		var targetY = active ? clampLoopNumber(effect.offsetY, 0, -4000, 4000) : 0;
		var targetScale = active ? clampLoopNumber(effect.scale, 1, 0.1, 4) : 1;
		var targetSkewX = active ? clampLoopNumber(effect.skewX, 0, -180, 180) : 0;
		var targetSkewY = active ? clampLoopNumber(effect.skewY, 0, -180, 180) : 0;
		var targetRotation = (baseState.rotation || 0) + (active ? clampLoopNumber(effect.rotate, 0, -1080, 1080) : 0);
		var targetRotationX = (baseState.rotationX || 0) + (active && effect.rotateMode === '3d' ? clampLoopNumber(effect.rotateX, 0, -1080, 1080) : 0);
		var targetRotationY = (baseState.rotationY || 0) + (active && effect.rotateMode === '3d' ? clampLoopNumber(effect.rotateY, 0, -1080, 1080) : 0);
		node.style.transformStyle = (baseState.rotationX || baseState.rotationY || (active && effect.rotateMode === '3d')) ? 'preserve-3d' : '';
		node.style.willChange = 'transform, opacity';
		if (gsap) {
			gsap.killTweensOf(node);
			gsap.to(node, {
				opacity: targetOpacity,
				xPercent: baseState.xPercent || 0,
				yPercent: baseState.yPercent || 0,
				x: targetX,
				y: targetY,
				scaleX: targetScale,
				scaleY: targetScale,
				rotation: targetRotation,
				rotationX: targetRotationX,
				rotationY: targetRotationY,
				skewX: targetSkewX,
				skewY: targetSkewY,
				transformPerspective: (targetRotationX !== 0 || targetRotationY !== 0 || (active && effect.rotateMode === '3d')) ? 1000 : 0,
				transformOrigin: 'center center',
				duration: duration,
				ease: ease,
				overwrite: true,
			});
			return;
		}
		node.style.opacity = String(targetOpacity);
		node.style.transform = active ? buildLoopTransform(effect, baseState) : buildBaseRotationTransform(baseState);
	};
	var clearHoverAnimation = function(node) {
		if (!node) return;
		if (gsap) gsap.killTweensOf(node);
		node.style.transformStyle = '';
		node.style.willChange = '';
	};
	var applyLoopAnimation = function(node, animation, playState) {
		if (!node || !animation) return;
		ensureLoopAnimationStyles();
		var baseState = getAnimationBaseState(node);
		var effect = animation && animation.effect ? animation.effect : {};
		var transition = normalizeAnimationTransition(animation && animation.transition, { duration: 0.8, easePreset: 'easeInOut' });
		node.style.setProperty('--fb-loop-opacity-from', String(clampLoopNumber(effect.opacity, 1, 0, 1)));
		node.style.setProperty('--fb-loop-transform-from', buildLoopTransform(effect, baseState));
		node.style.setProperty('--fb-loop-transform-to', buildBaseRotationTransform(baseState));
		node.style.animationName = 'fb-loop-animation';
		node.style.animationDuration = (getTransitionDurationMs(transition) / 1000) + 's';
		node.style.animationTimingFunction = getLoopAnimationTiming(transition);
		node.style.animationDelay = clampLoopNumber(animation.delay, 0, 0, 60) + 's';
		node.style.animationIterationCount = 'infinite';
		node.style.animationDirection = animation.loopType === 'mirror' ? 'alternate' : 'normal';
		node.style.animationFillMode = 'both';
		node.style.animationPlayState = playState === 'paused' ? 'paused' : 'running';
		node.style.transformStyle = effect.rotateMode === '3d' ? 'preserve-3d' : '';
		node.style.willChange = 'transform, opacity';
	};
	var shouldAnimateDimensionOverride = function(baseCssValue, endLayout, dimensionKey, modeKey, pctKey) {
		if (!Object.prototype.hasOwnProperty.call(endLayout, dimensionKey)) return false;
		if (Object.prototype.hasOwnProperty.call(endLayout, modeKey) || Object.prototype.hasOwnProperty.call(endLayout, pctKey)) return true;
		if (typeof baseCssValue !== 'string') return true;
		var normalized = baseCssValue.trim();
		if (!normalized) return true;
		if (normalized === 'fit-content') return false;
		if (/%$/.test(normalized)) return false;
		return true;
	};
	var shouldAnimatePositionOverride = function(baseCssValue, computedPosition, endLayout, key) {
		if (!Object.prototype.hasOwnProperty.call(endLayout, key)) return false;
		if (Object.prototype.hasOwnProperty.call(endLayout, 'positionType') || Object.prototype.hasOwnProperty.call(endLayout, 'absoluteInLayout')) return true;
		if (computedPosition === 'relative' || computedPosition === 'sticky' || computedPosition === 'static') return false;
		if (typeof baseCssValue !== 'string') return true;
		var normalized = baseCssValue.trim().toLowerCase();
		if (!normalized || normalized === 'auto') return false;
		if (/%$/.test(normalized)) return false;
		return true;
	};
	var normalizeCenteredAnimationPatchLayout = function(patchLayout, baseState) {
		if (!patchLayout || typeof patchLayout !== 'object') return {};
		var isFlowPositioned = baseState.position === 'relative' || baseState.position === 'sticky' || baseState.position === 'static';
		if (!isFlowPositioned) return patchLayout;
		var hasWidthOverride = Object.prototype.hasOwnProperty.call(patchLayout, 'width');
		var hasHeightOverride = Object.prototype.hasOwnProperty.call(patchLayout, 'height');
		if (!hasWidthOverride && !hasHeightOverride) return patchLayout;
		var normalizedLayout = Object.assign({}, patchLayout);
		var targetWidth = hasWidthOverride ? parseNumber(patchLayout.width, baseState.width) : baseState.width;
		var targetHeight = hasHeightOverride ? parseNumber(patchLayout.height, baseState.height) : baseState.height;
		normalizedLayout.x = baseState.baseLayoutX + ((baseState.width - targetWidth) / 2);
		normalizedLayout.y = baseState.baseLayoutY + ((baseState.height - targetHeight) / 2);
		return normalizedLayout;
	};
	var applyEnterAnimation = function(node, animation) {
		if (!node) return;
		var effect = animation && animation.effect ? animation.effect : {};
		var startState = animation && animation.startState && typeof animation.startState === 'object' ? animation.startState : {};
		var startLayout = startState.layout && typeof startState.layout === 'object' ? startState.layout : {};
		var startStyles = startState.styles && typeof startState.styles === 'object' ? startState.styles : {};
		var baseState = getAnimationBaseState(node);
		startLayout = normalizeCenteredAnimationPatchLayout(startLayout, baseState);
		var visualTarget = baseState.visualTarget || node;
		var contentTarget = baseState.textNode || baseState.iconNode || null;
		var visualFromVars = {};
		var visualToVars = {};
		var transition = normalizeAnimationTransition(animation && animation.transition, { duration: 0.7, easePreset: 'easeInOut' });
		var enterDuration = getTransitionDurationMs(transition) / 1000;
		var enterEase = transition.type === 'realistic'
			? (transition.springMode === 'physics'
				? 'elastic.out(1,' + Math.max(0.2, transition.mass * 0.45) + ')'
				: 'back.out(' + (1 + transition.bounce * 1.2) + ')')
			: getEaseValue(transition);
		if (!gsap) return;
		gsap.killTweensOf(node);
		var fromVars = {
			opacity: Object.prototype.hasOwnProperty.call(startStyles, 'opacity') ? parseNumber(startStyles.opacity, baseState.opacity) : (parseNumber(effect.opacity, 0) * baseState.opacity),
			x: parseNumber(effect.offsetX, 0),
			y: parseNumber(effect.offsetY, 40),
			scaleX: parseNumber(effect.scale, 1),
			scaleY: parseNumber(effect.scale, 1),
			rotation: (baseState.rotation || 0) + parseNumber(effect.rotate, 0),
			rotationX: parseNumber(effect.rotateX, 0),
			rotationY: parseNumber(effect.rotateY, 0),
			skewX: parseNumber(effect.skewX, 0),
			skewY: parseNumber(effect.skewY, 0),
			transformOrigin: 'center center'
		};
		var animateLeft = shouldAnimatePositionOverride(baseState.leftCss, baseState.position, startLayout, 'x');
		var animateTop = shouldAnimatePositionOverride(baseState.topCss, baseState.position, startLayout, 'y');
		var animateWidth = shouldAnimateDimensionOverride(baseState.widthCss, startLayout, 'width', 'widthMode', 'widthPct');
		var animateHeight = shouldAnimateDimensionOverride(baseState.heightCss, startLayout, 'height', 'heightMode', 'heightPct');
		var canUseTransformLayout = baseState.width > 0.01 && baseState.height > 0.01;
		var canUseTransformPosition = baseState.position !== 'relative' && baseState.position !== 'sticky';
		if (canUseTransformLayout && ((canUseTransformPosition && (animateLeft || animateTop)) || animateWidth || animateHeight)) {
			var flowOffsetX = !canUseTransformPosition && Object.prototype.hasOwnProperty.call(startLayout, 'x') ? (parseNumber(startLayout.x, baseState.baseLayoutX) - baseState.baseLayoutX) : 0;
			var flowOffsetY = !canUseTransformPosition && Object.prototype.hasOwnProperty.call(startLayout, 'y') ? (parseNumber(startLayout.y, baseState.baseLayoutY) - baseState.baseLayoutY) : 0;
			var startLeft = canUseTransformPosition && animateLeft ? parseNumber(startLayout.x, baseState.left) : (baseState.left + flowOffsetX);
			var startTop = canUseTransformPosition && animateTop ? parseNumber(startLayout.y, baseState.top) : (baseState.top + flowOffsetY);
			var startWidth = animateWidth ? parseNumber(startLayout.width, baseState.width) : baseState.width;
			var startHeight = animateHeight ? parseNumber(startLayout.height, baseState.height) : baseState.height;
			var baseCenterX = baseState.left + (baseState.width / 2);
			var baseCenterY = baseState.top + (baseState.height / 2);
			fromVars.x += (startLeft + (startWidth / 2)) - baseCenterX;
			fromVars.y += (startTop + (startHeight / 2)) - baseCenterY;
			fromVars.scaleX *= baseState.width > 0.01 ? (startWidth / baseState.width) : 1;
			fromVars.scaleY *= baseState.height > 0.01 ? (startHeight / baseState.height) : 1;
		} else {
			if (Object.prototype.hasOwnProperty.call(startLayout, 'x')) fromVars.left = parseNumber(startLayout.x, baseState.left);
			if (Object.prototype.hasOwnProperty.call(startLayout, 'y')) fromVars.top = parseNumber(startLayout.y, baseState.top);
			if (Object.prototype.hasOwnProperty.call(startLayout, 'width')) fromVars.width = parseNumber(startLayout.width, baseState.width);
			if (Object.prototype.hasOwnProperty.call(startLayout, 'height')) fromVars.height = parseNumber(startLayout.height, baseState.height);
		}
		if (Object.prototype.hasOwnProperty.call(startLayout, 'rotation')) fromVars.rotation = parseNumber(startLayout.rotation, parseNumber(effect.rotate, 0));
		if (Object.prototype.hasOwnProperty.call(startLayout, 'rotationX')) fromVars.rotationX = parseNumber(startLayout.rotationX, baseState.rotationX || 0);
		if (Object.prototype.hasOwnProperty.call(startLayout, 'rotationY')) fromVars.rotationY = parseNumber(startLayout.rotationY, baseState.rotationY || 0);
		if (Object.prototype.hasOwnProperty.call(startStyles, 'backgroundColor')) {
			if (visualTarget === node) fromVars.backgroundColor = startStyles.backgroundColor;
			else {
				visualFromVars.backgroundColor = startStyles.backgroundColor;
				visualToVars.backgroundColor = baseState.backgroundColor;
			}
		}
		if (Object.prototype.hasOwnProperty.call(startStyles, 'borderColor')) {
			if (visualTarget === node) fromVars.borderColor = startStyles.borderColor;
			else {
				visualFromVars.borderColor = startStyles.borderColor;
				visualToVars.borderColor = baseState.borderColor;
			}
		}
		if (Object.prototype.hasOwnProperty.call(startStyles, 'borderRadius')) {
			if (visualTarget === node) fromVars.borderRadius = startStyles.borderRadius;
			else {
				visualFromVars.borderRadius = startStyles.borderRadius;
				visualToVars.borderRadius = baseState.borderRadius;
			}
		}
		if (Object.prototype.hasOwnProperty.call(startStyles, 'blur') || Object.prototype.hasOwnProperty.call(startStyles, 'brightness') || Object.prototype.hasOwnProperty.call(startStyles, 'contrast') || Object.prototype.hasOwnProperty.call(startStyles, 'saturation')) {
			fromVars.filter = buildFilterValue({
				blur: Object.prototype.hasOwnProperty.call(startStyles, 'blur') ? parseNumber(startStyles.blur, baseState.blur) : baseState.blur,
				brightness: Object.prototype.hasOwnProperty.call(startStyles, 'brightness') ? parseNumber(startStyles.brightness, baseState.brightness) : baseState.brightness,
				contrast: Object.prototype.hasOwnProperty.call(startStyles, 'contrast') ? parseNumber(startStyles.contrast, baseState.contrast) : baseState.contrast,
				saturation: Object.prototype.hasOwnProperty.call(startStyles, 'saturation') ? parseNumber(startStyles.saturation, baseState.saturation) : baseState.saturation,
			});
		}
		if (Object.prototype.hasOwnProperty.call(startStyles, 'backdropBlur')) fromVars.backdropFilter = buildBlurValue(parseNumber(startStyles.backdropBlur, baseState.backdropBlur));
		var toVars = {
			opacity: baseState.opacity,
			x: 0,
			y: 0,
			scaleX: 1,
			scaleY: 1,
			rotation: baseState.rotation || 0,
			rotationX: baseState.rotationX || 0,
			rotationY: baseState.rotationY || 0,
			skewX: 0,
			skewY: 0,
			duration: enterDuration,
			ease: enterEase,
			overwrite: true,
			clearProps: 'opacity'
		};
		if (!(canUseTransformLayout && ((canUseTransformPosition && (animateLeft || animateTop)) || animateWidth || animateHeight))) {
			if (Object.prototype.hasOwnProperty.call(startLayout, 'x')) toVars.left = baseState.left;
			if (Object.prototype.hasOwnProperty.call(startLayout, 'y')) toVars.top = baseState.top;
			if (Object.prototype.hasOwnProperty.call(startLayout, 'width')) toVars.width = baseState.width;
			if (Object.prototype.hasOwnProperty.call(startLayout, 'height')) toVars.height = baseState.height;
		}
		if (Object.prototype.hasOwnProperty.call(startStyles, 'backgroundColor') && visualTarget === node) toVars.backgroundColor = baseState.backgroundColor;
		if (Object.prototype.hasOwnProperty.call(startStyles, 'borderColor') && visualTarget === node) toVars.borderColor = baseState.borderColor;
		if (Object.prototype.hasOwnProperty.call(startStyles, 'borderRadius') && visualTarget === node) toVars.borderRadius = baseState.borderRadius;
		if (Object.prototype.hasOwnProperty.call(startStyles, 'blur') || Object.prototype.hasOwnProperty.call(startStyles, 'brightness') || Object.prototype.hasOwnProperty.call(startStyles, 'contrast') || Object.prototype.hasOwnProperty.call(startStyles, 'saturation')) toVars.filter = baseState.filter;
		if (Object.prototype.hasOwnProperty.call(startStyles, 'backdropBlur')) toVars.backdropFilter = baseState.backdropFilter;
		gsap.fromTo(node, fromVars, toVars);
		if (visualTarget !== node && Object.keys(visualFromVars).length) {
			visualFromVars.duration = enterDuration;
			visualFromVars.ease = enterEase;
			visualFromVars.overwrite = true;
			visualToVars.duration = enterDuration;
			visualToVars.ease = enterEase;
			visualToVars.overwrite = true;
			gsap.fromTo(visualTarget, visualFromVars, visualToVars);
		}
		if (contentTarget && Object.prototype.hasOwnProperty.call(startStyles, 'color')) {
			gsap.fromTo(contentTarget, { color: startStyles.color }, {
				color: baseState.color,
				duration: enterDuration,
				ease: enterEase,
				overwrite: true,
			});
		}
	};
	var applyScrollAnimation = function(node, animation, forcedProgress) {
		if (!node || !animation) return;
		var startState = animation.startState && typeof animation.startState === 'object' ? animation.startState : {};
		var endState = animation.endState && typeof animation.endState === 'object' ? animation.endState : {};
		var useStartState = hasAnimationPatchState(startState);
		var patchState = useStartState ? startState : endState;
		var patchLayout = patchState.layout && typeof patchState.layout === 'object' ? patchState.layout : {};
		var patchStyles = patchState.styles && typeof patchState.styles === 'object' ? patchState.styles : {};
		var baseState = getAnimationBaseState(node);
		patchLayout = normalizeCenteredAnimationPatchLayout(patchLayout, baseState);
		var visualTarget = baseState.visualTarget || node;
		var contentTarget = baseState.textNode || baseState.iconNode || node;
		var visualFromVars = {};
		var visualToVars = {};
		var rawProgress = typeof forcedProgress === 'number' ? forcedProgress : getScrollAnimationProgress(node, animation.start, animation.end, animation.startOffset, animation.endOffset, animation.startOffsetPx, animation.endOffsetPx);
		var progress = mapScrollAnimationProgress(animation, rawProgress);
		var startOpacity = useStartState && Object.prototype.hasOwnProperty.call(patchStyles, 'opacity') ? parseNumber(patchStyles.opacity, baseState.opacity) : baseState.opacity;
		var endOpacity = !useStartState && Object.prototype.hasOwnProperty.call(patchStyles, 'opacity') ? parseNumber(patchStyles.opacity, baseState.opacity) : baseState.opacity;
		var currentOpacity = lerp(useStartState ? startOpacity : baseState.opacity, useStartState ? baseState.opacity : endOpacity, progress);
		var startRotate = useStartState && Object.prototype.hasOwnProperty.call(patchLayout, 'rotation') ? parseNumber(patchLayout.rotation, baseState.rotation || 0) : (baseState.rotation || 0);
		var endRotate = !useStartState && Object.prototype.hasOwnProperty.call(patchLayout, 'rotation') ? parseNumber(patchLayout.rotation, baseState.rotation || 0) : (baseState.rotation || 0);
		var startRotateX = useStartState && Object.prototype.hasOwnProperty.call(patchLayout, 'rotationX') ? parseNumber(patchLayout.rotationX, baseState.rotationX || 0) : (baseState.rotationX || 0);
		var endRotateX = !useStartState && Object.prototype.hasOwnProperty.call(patchLayout, 'rotationX') ? parseNumber(patchLayout.rotationX, baseState.rotationX || 0) : (baseState.rotationX || 0);
		var startRotateY = useStartState && Object.prototype.hasOwnProperty.call(patchLayout, 'rotationY') ? parseNumber(patchLayout.rotationY, baseState.rotationY || 0) : (baseState.rotationY || 0);
		var endRotateY = !useStartState && Object.prototype.hasOwnProperty.call(patchLayout, 'rotationY') ? parseNumber(patchLayout.rotationY, baseState.rotationY || 0) : (baseState.rotationY || 0);
		var currentRotate = lerp(useStartState ? startRotate : (baseState.rotation || 0), useStartState ? (baseState.rotation || 0) : endRotate, progress);
		var currentRotateX = lerp(useStartState ? startRotateX : (baseState.rotationX || 0), useStartState ? (baseState.rotationX || 0) : endRotateX, progress);
		var currentRotateY = lerp(useStartState ? startRotateY : (baseState.rotationY || 0), useStartState ? (baseState.rotationY || 0) : endRotateY, progress);
		var nextVars = {
			opacity: currentOpacity,
			x: 0,
			y: 0,
			scaleX: 1,
			scaleY: 1,
			rotation: currentRotate,
			rotationX: currentRotateX,
			rotationY: currentRotateY,
			skewX: 0,
			skewY: 0,
			overwrite: true,
		};
		node.style.transformStyle = (currentRotateX || currentRotateY) ? 'preserve-3d' : '';
		var animateLeft = shouldAnimatePositionOverride(baseState.leftCss, baseState.position, patchLayout, 'x');
		var animateTop = shouldAnimatePositionOverride(baseState.topCss, baseState.position, patchLayout, 'y');
		var animateWidth = shouldAnimateDimensionOverride(baseState.widthCss, patchLayout, 'width', 'widthMode', 'widthPct');
		var animateHeight = shouldAnimateDimensionOverride(baseState.heightCss, patchLayout, 'height', 'heightMode', 'heightPct');
		var canUseTransformLayout = baseState.width > 0.01 && baseState.height > 0.01;
		var canUseTransformPosition = baseState.position !== 'relative' && baseState.position !== 'sticky';
		if (canUseTransformLayout && ((canUseTransformPosition && (animateLeft || animateTop)) || animateWidth || animateHeight)) {
			var flowOffsetX = !canUseTransformPosition && Object.prototype.hasOwnProperty.call(patchLayout, 'x') ? (parseNumber(patchLayout.x, baseState.baseLayoutX) - baseState.baseLayoutX) : 0;
			var flowOffsetY = !canUseTransformPosition && Object.prototype.hasOwnProperty.call(patchLayout, 'y') ? (parseNumber(patchLayout.y, baseState.baseLayoutY) - baseState.baseLayoutY) : 0;
			var startLeft = useStartState ? (canUseTransformPosition && animateLeft ? parseNumber(patchLayout.x, baseState.left) : (baseState.left + flowOffsetX)) : baseState.left;
			var endLeft = useStartState ? baseState.left : (canUseTransformPosition && animateLeft ? parseNumber(patchLayout.x, baseState.left) : (baseState.left + flowOffsetX));
			var startTop = useStartState ? (canUseTransformPosition && animateTop ? parseNumber(patchLayout.y, baseState.top) : (baseState.top + flowOffsetY)) : baseState.top;
			var endTop = useStartState ? baseState.top : (canUseTransformPosition && animateTop ? parseNumber(patchLayout.y, baseState.top) : (baseState.top + flowOffsetY));
			var startWidth = useStartState ? (animateWidth ? parseNumber(patchLayout.width, baseState.width) : baseState.width) : baseState.width;
			var endWidth = useStartState ? baseState.width : (animateWidth ? parseNumber(patchLayout.width, baseState.width) : baseState.width);
			var startHeight = useStartState ? (animateHeight ? parseNumber(patchLayout.height, baseState.height) : baseState.height) : baseState.height;
			var endHeight = useStartState ? baseState.height : (animateHeight ? parseNumber(patchLayout.height, baseState.height) : baseState.height);
			var baseCenterX = baseState.left + (baseState.width / 2);
			var baseCenterY = baseState.top + (baseState.height / 2);
			var currentCenterX = lerp(startLeft + (startWidth / 2), endLeft + (endWidth / 2), progress);
			var currentCenterY = lerp(startTop + (startHeight / 2), endTop + (endHeight / 2), progress);
			nextVars.x = currentCenterX - baseCenterX;
			nextVars.y = currentCenterY - baseCenterY;
			nextVars.scaleX = baseState.width > 0.01 ? lerp(startWidth / baseState.width, endWidth / baseState.width, progress) : 1;
			nextVars.scaleY = baseState.height > 0.01 ? lerp(startHeight / baseState.height, endHeight / baseState.height, progress) : 1;
		} else {
			if (animateLeft) {
				nextVars.left = lerp(useStartState ? parseNumber(patchLayout.x, baseState.left) : baseState.left, useStartState ? baseState.left : parseNumber(patchLayout.x, baseState.left), progress);
			}
			if (animateTop) {
				nextVars.top = lerp(useStartState ? parseNumber(patchLayout.y, baseState.top) : baseState.top, useStartState ? baseState.top : parseNumber(patchLayout.y, baseState.top), progress);
			}
			if (animateWidth) {
				nextVars.width = lerp(useStartState ? parseNumber(patchLayout.width, baseState.width) : baseState.width, useStartState ? baseState.width : parseNumber(patchLayout.width, baseState.width), progress);
			}
			if (animateHeight) {
				nextVars.height = lerp(useStartState ? parseNumber(patchLayout.height, baseState.height) : baseState.height, useStartState ? baseState.height : parseNumber(patchLayout.height, baseState.height), progress);
			}
		}
		if (gsap) gsap.set(node, nextVars);
		else {
			node.style.opacity = String(currentOpacity);
			node.style.transform = 'rotate(' + currentRotate + 'deg)';
		}
		if (Object.prototype.hasOwnProperty.call(patchStyles, 'backgroundColor')) {
			visualTarget.style.backgroundColor = interpolateValue(useStartState ? patchStyles.backgroundColor : baseState.backgroundColor, useStartState ? baseState.backgroundColor : patchStyles.backgroundColor, progress);
		}
		if (Object.prototype.hasOwnProperty.call(patchStyles, 'color')) {
			contentTarget.style.color = interpolateValue(useStartState ? patchStyles.color : baseState.color, useStartState ? baseState.color : patchStyles.color, progress);
		}
		if (Object.prototype.hasOwnProperty.call(patchStyles, 'borderColor')) {
			visualTarget.style.borderColor = interpolateValue(useStartState ? patchStyles.borderColor : baseState.borderColor, useStartState ? baseState.borderColor : patchStyles.borderColor, progress);
		}
		if (Object.prototype.hasOwnProperty.call(patchStyles, 'borderRadius')) {
			visualTarget.style.borderRadius = interpolateValue(useStartState ? patchStyles.borderRadius : baseState.borderRadius, useStartState ? baseState.borderRadius : patchStyles.borderRadius, progress);
		}
		if (Object.prototype.hasOwnProperty.call(patchStyles, 'blur') || Object.prototype.hasOwnProperty.call(patchStyles, 'brightness') || Object.prototype.hasOwnProperty.call(patchStyles, 'contrast') || Object.prototype.hasOwnProperty.call(patchStyles, 'saturation')) {
			node.style.filter = buildFilterValue({
				blur: Object.prototype.hasOwnProperty.call(patchStyles, 'blur') ? interpolateValue(useStartState ? parseNumber(patchStyles.blur, baseState.blur) : baseState.blur, useStartState ? baseState.blur : parseNumber(patchStyles.blur, baseState.blur), progress) : baseState.blur,
				brightness: Object.prototype.hasOwnProperty.call(patchStyles, 'brightness') ? interpolateValue(useStartState ? parseNumber(patchStyles.brightness, baseState.brightness) : baseState.brightness, useStartState ? baseState.brightness : parseNumber(patchStyles.brightness, baseState.brightness), progress) : baseState.brightness,
				contrast: Object.prototype.hasOwnProperty.call(patchStyles, 'contrast') ? interpolateValue(useStartState ? parseNumber(patchStyles.contrast, baseState.contrast) : baseState.contrast, useStartState ? baseState.contrast : parseNumber(patchStyles.contrast, baseState.contrast), progress) : baseState.contrast,
				saturation: Object.prototype.hasOwnProperty.call(patchStyles, 'saturation') ? interpolateValue(useStartState ? parseNumber(patchStyles.saturation, baseState.saturation) : baseState.saturation, useStartState ? baseState.saturation : parseNumber(patchStyles.saturation, baseState.saturation), progress) : baseState.saturation,
			});
		}
		if (Object.prototype.hasOwnProperty.call(patchStyles, 'backdropBlur')) {
			setNodeBackdropFilter(node, buildBlurValue(interpolateValue(useStartState ? parseNumber(patchStyles.backdropBlur, baseState.backdropBlur) : baseState.backdropBlur, useStartState ? baseState.backdropBlur : parseNumber(patchStyles.backdropBlur, baseState.backdropBlur), progress)));
		}
	};
	var buildScrollAnimationTimeline = function(node, animation) {
		if (!node || !animation || !gsap) return null;
		var startState = animation.startState && typeof animation.startState === 'object' ? animation.startState : {};
		var endState = animation.endState && typeof animation.endState === 'object' ? animation.endState : {};
		var useStartState = hasAnimationPatchState(startState);
		var patchState = useStartState ? startState : endState;
		var patchLayout = patchState.layout && typeof patchState.layout === 'object' ? patchState.layout : {};
		var patchStyles = patchState.styles && typeof patchState.styles === 'object' ? patchState.styles : {};
		var baseState = getAnimationBaseState(node);
		patchLayout = normalizeCenteredAnimationPatchLayout(patchLayout, baseState);
		var visualTarget = baseState.visualTarget || node;
		var contentTarget = baseState.textNode || baseState.iconNode || node;
		var fromVars = {
			opacity: useStartState && Object.prototype.hasOwnProperty.call(patchStyles, 'opacity') ? parseNumber(patchStyles.opacity, baseState.opacity) : baseState.opacity,
			x: 0,
			y: 0,
			scaleX: 1,
			scaleY: 1,
			rotation: useStartState && Object.prototype.hasOwnProperty.call(patchLayout, 'rotation') ? parseNumber(patchLayout.rotation, baseState.rotation || 0) : (baseState.rotation || 0),
			rotationX: useStartState && Object.prototype.hasOwnProperty.call(patchLayout, 'rotationX') ? parseNumber(patchLayout.rotationX, baseState.rotationX || 0) : (baseState.rotationX || 0),
			rotationY: useStartState && Object.prototype.hasOwnProperty.call(patchLayout, 'rotationY') ? parseNumber(patchLayout.rotationY, baseState.rotationY || 0) : (baseState.rotationY || 0),
			skewX: 0,
			skewY: 0,
			transformOrigin: 'center center',
			force3D: true,
			immediateRender: false,
		};
		var toVars = {
			opacity: !useStartState && Object.prototype.hasOwnProperty.call(patchStyles, 'opacity') ? parseNumber(patchStyles.opacity, baseState.opacity) : baseState.opacity,
			x: 0,
			y: 0,
			scaleX: 1,
			scaleY: 1,
			rotation: !useStartState && Object.prototype.hasOwnProperty.call(patchLayout, 'rotation') ? parseNumber(patchLayout.rotation, baseState.rotation || 0) : (baseState.rotation || 0),
			rotationX: !useStartState && Object.prototype.hasOwnProperty.call(patchLayout, 'rotationX') ? parseNumber(patchLayout.rotationX, baseState.rotationX || 0) : (baseState.rotationX || 0),
			rotationY: !useStartState && Object.prototype.hasOwnProperty.call(patchLayout, 'rotationY') ? parseNumber(patchLayout.rotationY, baseState.rotationY || 0) : (baseState.rotationY || 0),
			skewX: 0,
			skewY: 0,
			transformOrigin: 'center center',
			force3D: true,
			duration: 1,
			ease: 'none',
			overwrite: true,
			immediateRender: false,
		};
		var animateLeft = shouldAnimatePositionOverride(baseState.leftCss, baseState.position, patchLayout, 'x');
		var animateTop = shouldAnimatePositionOverride(baseState.topCss, baseState.position, patchLayout, 'y');
		var animateWidth = shouldAnimateDimensionOverride(baseState.widthCss, patchLayout, 'width', 'widthMode', 'widthPct');
		var animateHeight = shouldAnimateDimensionOverride(baseState.heightCss, patchLayout, 'height', 'heightMode', 'heightPct');
		var canUseTransformLayout = baseState.width > 0.01 && baseState.height > 0.01;
		var canUseTransformPosition = baseState.position !== 'relative' && baseState.position !== 'sticky';
		if (canUseTransformLayout && ((canUseTransformPosition && (animateLeft || animateTop)) || animateWidth || animateHeight)) {
			var flowOffsetX = !canUseTransformPosition && Object.prototype.hasOwnProperty.call(patchLayout, 'x') ? (parseNumber(patchLayout.x, baseState.baseLayoutX) - baseState.baseLayoutX) : 0;
			var flowOffsetY = !canUseTransformPosition && Object.prototype.hasOwnProperty.call(patchLayout, 'y') ? (parseNumber(patchLayout.y, baseState.baseLayoutY) - baseState.baseLayoutY) : 0;
			var startLeftResolved = useStartState ? (canUseTransformPosition && animateLeft ? parseNumber(patchLayout.x, baseState.left) : (baseState.left + flowOffsetX)) : baseState.left;
			var endLeftResolved = useStartState ? baseState.left : (canUseTransformPosition && animateLeft ? parseNumber(patchLayout.x, baseState.left) : (baseState.left + flowOffsetX));
			var startTopResolved = useStartState ? (canUseTransformPosition && animateTop ? parseNumber(patchLayout.y, baseState.top) : (baseState.top + flowOffsetY)) : baseState.top;
			var endTopResolved = useStartState ? baseState.top : (canUseTransformPosition && animateTop ? parseNumber(patchLayout.y, baseState.top) : (baseState.top + flowOffsetY));
			var startWidthResolved = useStartState ? (animateWidth ? parseNumber(patchLayout.width, baseState.width) : baseState.width) : baseState.width;
			var endWidthResolved = useStartState ? baseState.width : (animateWidth ? parseNumber(patchLayout.width, baseState.width) : baseState.width);
			var startHeightResolved = useStartState ? (animateHeight ? parseNumber(patchLayout.height, baseState.height) : baseState.height) : baseState.height;
			var endHeightResolved = useStartState ? baseState.height : (animateHeight ? parseNumber(patchLayout.height, baseState.height) : baseState.height);
			var baseCenterX = baseState.left + (baseState.width / 2);
			var baseCenterY = baseState.top + (baseState.height / 2);
			fromVars.x = (startLeftResolved + (startWidthResolved / 2)) - baseCenterX;
			toVars.x = (endLeftResolved + (endWidthResolved / 2)) - baseCenterX;
			fromVars.y = (startTopResolved + (startHeightResolved / 2)) - baseCenterY;
			toVars.y = (endTopResolved + (endHeightResolved / 2)) - baseCenterY;
			fromVars.scaleX = baseState.width > 0.01 ? (startWidthResolved / baseState.width) : 1;
			toVars.scaleX = baseState.width > 0.01 ? (endWidthResolved / baseState.width) : 1;
			fromVars.scaleY = baseState.height > 0.01 ? (startHeightResolved / baseState.height) : 1;
			toVars.scaleY = baseState.height > 0.01 ? (endHeightResolved / baseState.height) : 1;
		} else {
		if (animateLeft) {
			fromVars.left = useStartState ? parseNumber(patchLayout.x, baseState.left) : baseState.left;
			toVars.left = useStartState ? baseState.left : parseNumber(patchLayout.x, baseState.left);
		}
		if (animateTop) {
			fromVars.top = useStartState ? parseNumber(patchLayout.y, baseState.top) : baseState.top;
			toVars.top = useStartState ? baseState.top : parseNumber(patchLayout.y, baseState.top);
		}
		if (animateWidth) {
			fromVars.width = useStartState ? parseNumber(patchLayout.width, baseState.width) : baseState.width;
			toVars.width = useStartState ? baseState.width : parseNumber(patchLayout.width, baseState.width);
		}
		if (animateHeight) {
			fromVars.height = useStartState ? parseNumber(patchLayout.height, baseState.height) : baseState.height;
			toVars.height = useStartState ? baseState.height : parseNumber(patchLayout.height, baseState.height);
		}
		}
		if (Object.prototype.hasOwnProperty.call(patchStyles, 'backgroundColor')) {
			if (visualTarget === node) {
				fromVars.backgroundColor = useStartState ? patchStyles.backgroundColor : baseState.backgroundColor;
				toVars.backgroundColor = useStartState ? baseState.backgroundColor : patchStyles.backgroundColor;
			} else {
				visualFromVars.backgroundColor = useStartState ? patchStyles.backgroundColor : baseState.backgroundColor;
				visualToVars.backgroundColor = useStartState ? baseState.backgroundColor : patchStyles.backgroundColor;
			}
		}
		if (Object.prototype.hasOwnProperty.call(patchStyles, 'borderColor')) {
			if (visualTarget === node) {
				fromVars.borderColor = useStartState ? patchStyles.borderColor : baseState.borderColor;
				toVars.borderColor = useStartState ? baseState.borderColor : patchStyles.borderColor;
			} else {
				visualFromVars.borderColor = useStartState ? patchStyles.borderColor : baseState.borderColor;
				visualToVars.borderColor = useStartState ? baseState.borderColor : patchStyles.borderColor;
			}
		}
		if (Object.prototype.hasOwnProperty.call(patchStyles, 'borderRadius')) {
			if (visualTarget === node) {
				fromVars.borderRadius = useStartState ? patchStyles.borderRadius : baseState.borderRadius;
				toVars.borderRadius = useStartState ? baseState.borderRadius : patchStyles.borderRadius;
			} else {
				visualFromVars.borderRadius = useStartState ? patchStyles.borderRadius : baseState.borderRadius;
				visualToVars.borderRadius = useStartState ? baseState.borderRadius : patchStyles.borderRadius;
			}
		}
		if (Object.prototype.hasOwnProperty.call(patchStyles, 'blur') || Object.prototype.hasOwnProperty.call(patchStyles, 'brightness') || Object.prototype.hasOwnProperty.call(patchStyles, 'contrast') || Object.prototype.hasOwnProperty.call(patchStyles, 'saturation')) {
			fromVars.filter = buildFilterValue({
				blur: useStartState && Object.prototype.hasOwnProperty.call(patchStyles, 'blur') ? parseNumber(patchStyles.blur, baseState.blur) : baseState.blur,
				brightness: useStartState && Object.prototype.hasOwnProperty.call(patchStyles, 'brightness') ? parseNumber(patchStyles.brightness, baseState.brightness) : baseState.brightness,
				contrast: useStartState && Object.prototype.hasOwnProperty.call(patchStyles, 'contrast') ? parseNumber(patchStyles.contrast, baseState.contrast) : baseState.contrast,
				saturation: useStartState && Object.prototype.hasOwnProperty.call(patchStyles, 'saturation') ? parseNumber(patchStyles.saturation, baseState.saturation) : baseState.saturation,
			});
			toVars.filter = buildFilterValue({
				blur: !useStartState && Object.prototype.hasOwnProperty.call(patchStyles, 'blur') ? parseNumber(patchStyles.blur, baseState.blur) : baseState.blur,
				brightness: !useStartState && Object.prototype.hasOwnProperty.call(patchStyles, 'brightness') ? parseNumber(patchStyles.brightness, baseState.brightness) : baseState.brightness,
				contrast: !useStartState && Object.prototype.hasOwnProperty.call(patchStyles, 'contrast') ? parseNumber(patchStyles.contrast, baseState.contrast) : baseState.contrast,
				saturation: !useStartState && Object.prototype.hasOwnProperty.call(patchStyles, 'saturation') ? parseNumber(patchStyles.saturation, baseState.saturation) : baseState.saturation,
			});
		}
		if (Object.prototype.hasOwnProperty.call(patchStyles, 'backdropBlur')) {
			fromVars.backdropFilter = buildBlurValue(useStartState ? parseNumber(patchStyles.backdropBlur, baseState.backdropBlur) : baseState.backdropBlur);
			toVars.backdropFilter = buildBlurValue(!useStartState ? parseNumber(patchStyles.backdropBlur, baseState.backdropBlur) : baseState.backdropBlur);
		}
		var timeline = gsap.timeline({ paused: true, defaults: { overwrite: true } });
		timeline.fromTo(node, fromVars, toVars, 0);
		if (visualTarget !== node && Object.keys(visualFromVars).length) {
			visualFromVars.duration = 1;
			visualFromVars.ease = 'none';
			visualFromVars.overwrite = true;
			visualFromVars.immediateRender = false;
			visualToVars.duration = 1;
			visualToVars.ease = 'none';
			visualToVars.overwrite = true;
			visualToVars.immediateRender = false;
			timeline.fromTo(visualTarget, visualFromVars, visualToVars, 0);
		}
		if (Object.prototype.hasOwnProperty.call(patchStyles, 'color') && contentTarget) {
			timeline.fromTo(contentTarget, {
				color: useStartState ? patchStyles.color : baseState.color,
				immediateRender: false,
			}, {
				color: useStartState ? baseState.color : patchStyles.color,
				duration: 1,
				ease: 'none',
				overwrite: true,
				immediateRender: false,
			}, 0);
		}
		return timeline;
	};
	var initElementAnimations = function(node) {
		if (!node || node.dataset.fbAnimationsBound === '1') return;
		var readAnimations = function() {
			return parseJsonAttr(node.dataset.fbAnimations, null);
		};
		if (!readAnimations()) return;
		refreshNodeMarkerAnchor(node);
		node.dataset.fbAnimationsBound = '1';
		var enterPlayed = new Set();
		var scrollPlaybackState = { maxProgress: 0 };
		var loopVisibilityState = { isVisible: true };
		var hoverState = { isActive: false, restoreTimer: null };
		var scrollApplyState = { hasApplied: false };
		var scrollMetrics = null;
		var scrollMetricsKey = '';
		var scrollTriggerInstance = null;
		var scrollAnimationTimeline = null;
		var scrollAnimationTimelineKey = '';
		var getHoverAnimation = function() {
			return resolveAnimationsForBreakpoint(readAnimations(), getCurrentBreakpoint()).find(function(entry) {
				return entry && entry.type === 'hover';
			}) || null;
		};
		var refreshScrollMetrics = function(animation) {
			if (!animation) {
				scrollMetrics = null;
				scrollMetricsKey = '';
				return;
			}
			refreshNodeMarkerAnchor(node);
			scrollMetrics = buildScrollAnimationMetrics(node, animation.start, animation.end, animation.startOffsetPx, animation.endOffsetPx);
			scrollMetricsKey = [getCurrentBreakpoint(), animation.id, animation.startOffsetPx, animation.endOffsetPx, animation.start, animation.end].join(':');
		};
		var getResolvedScrollAnimationProgress = function(animation, scrollTriggerProgress) {
			if (!animation) return 0;
			if (scrollMetrics) return getScrollAnimationProgressFromMetrics(scrollMetrics);
			if (typeof scrollTriggerProgress === 'number') return scrollTriggerProgress;
			return getScrollAnimationProgress(node, animation.start, animation.end, animation.startOffset, animation.endOffset, animation.startOffsetPx, animation.endOffsetPx);
		};
		var applyResolvedScrollProgress = function(animation, progress) {
			if (!animation) return;
			var nextProgress = clamp(progress, 0, 1);
			if (animation.playback === 'once') {
				scrollPlaybackState.maxProgress = Math.max(scrollPlaybackState.maxProgress, nextProgress);
				nextProgress = scrollPlaybackState.maxProgress;
			} else if (nextProgress <= 0.001) {
				scrollPlaybackState.maxProgress = 0;
			}
			applyScrollAnimation(node, animation, nextProgress);
			scrollApplyState.hasApplied = true;
			updateLoopAnimation();
		};
		var destroyScrollAnimationTimeline = function() {
			if (scrollAnimationTimeline && scrollAnimationTimeline.kill) scrollAnimationTimeline.kill();
			scrollAnimationTimeline = null;
			scrollAnimationTimelineKey = '';
		};
		var destroyScrollTrigger = function() {
			if (scrollTriggerInstance && scrollTriggerInstance.kill) scrollTriggerInstance.kill();
			scrollTriggerInstance = null;
		};
		var syncScrollTrigger = function(animation) {
			if (!ScrollTrigger) return false;
			if (!animation) {
				destroyScrollTrigger();
				destroyScrollAnimationTimeline();
				return true;
			}
			var nextMetricsKey = [getCurrentBreakpoint(), animation.id, animation.startOffsetPx, animation.endOffsetPx, animation.start, animation.end].join(':');
			if (scrollTriggerInstance && scrollTriggerInstance.__fbMetricsKey === nextMetricsKey) return true;
			destroyScrollTrigger();
			if (!scrollAnimationTimeline || scrollAnimationTimelineKey !== nextMetricsKey) {
				destroyScrollAnimationTimeline();
				restoreAnimationBaseState(node);
				scrollAnimationTimeline = buildScrollAnimationTimeline(node, animation);
				scrollAnimationTimelineKey = nextMetricsKey;
			}
			refreshScrollMetrics(animation);
			scrollTriggerInstance = ScrollTrigger.create({
				trigger: node,
				start: function() {
					refreshScrollMetrics(animation);
					return scrollMetrics ? scrollMetrics.startMarkerDocumentTop : 0;
				},
				end: function() {
					refreshScrollMetrics(animation);
					return scrollMetrics ? scrollMetrics.endMarkerDocumentTop : 1;
				},
				scrub: true,
				invalidateOnRefresh: true,
				onRefreshInit: function() {
					refreshScrollMetrics(animation);
				},
				onRefresh: function(self) {
					if (hoverState.isActive) return;
					applyResolvedScrollProgress(animation, getResolvedScrollAnimationProgress(animation, self.progress));
				},
				onUpdate: function(self) {
					if (hoverState.isActive) return;
					applyResolvedScrollProgress(animation, getResolvedScrollAnimationProgress(animation, self.progress));
				}
			});
			scrollTriggerInstance.__fbMetricsKey = nextMetricsKey;
			applyResolvedScrollProgress(animation, getResolvedScrollAnimationProgress(animation, scrollTriggerInstance.progress || 0));
			return true;
		};
		var runEnterAnimations = function() {
			var animations = resolveAnimationsForBreakpoint(readAnimations(), getCurrentBreakpoint()).filter(function(animation) {
				return animation && animation.type === 'enter';
			});
			animations.forEach(function(animation) {
				if (animation.playback !== 'replay' && enterPlayed.has(animation.id)) return;
				enterPlayed.add(animation.id);
				applyEnterAnimation(node, animation);
			});
		};
		var enterObserver = new IntersectionObserver(function(entries) {
			entries.forEach(function(entry) {
				if (entry.isIntersecting) {
					runEnterAnimations();
					return;
				}
				resolveAnimationsForBreakpoint(readAnimations(), getCurrentBreakpoint()).forEach(function(animation) {
					if (animation && animation.type === 'enter' && animation.playback === 'replay') {
						enterPlayed.delete(animation.id);
					}
				});
			});
		}, { threshold: 0.18 });
		enterObserver.observe(node);
		var updateLoopAnimation = function() {
			if (hoverState.isActive) {
				clearLoopAnimation(node);
				return;
			}
			var animation = resolveAnimationsForBreakpoint(readAnimations(), getCurrentBreakpoint()).find(function(entry) {
				return entry && entry.type === 'loop';
			}) || null;
			if (!animation) {
				clearLoopAnimation(node);
				return;
			}
			var playState = animation.offscreenBehavior === 'pause' && !loopVisibilityState.isVisible ? 'paused' : 'running';
			applyLoopAnimation(node, animation, playState);
		};
		if (typeof IntersectionObserver !== 'undefined') {
			var loopObserver = new IntersectionObserver(function(entries) {
				entries.forEach(function(entry) {
					loopVisibilityState.isVisible = entry.isIntersecting !== false;
					updateLoopAnimation();
				});
			}, { threshold: 0.01 });
			loopObserver.observe(node);
		}
		var scrollFrame = null;
		var updateScrollAnimations = function() {
			scrollFrame = null;
			var animation = resolveAnimationsForBreakpoint(readAnimations(), getCurrentBreakpoint()).find(function(entry) {
				return entry && entry.type === 'scroll';
			}) || null;
			if (hoverState.isActive) {
				if (!animation) {
					refreshScrollMetrics(null);
					scrollPlaybackState.maxProgress = 0;
				}
				return;
			}
			if (!animation) {
				syncScrollTrigger(null);
				refreshScrollMetrics(null);
				scrollPlaybackState.maxProgress = 0;
				if (scrollApplyState.hasApplied) {
					restoreAnimationBaseState(node);
					scrollApplyState.hasApplied = false;
				}
				updateLoopAnimation();
				return;
			}
			syncScrollTrigger(null);
			var nextMetricsKey = [getCurrentBreakpoint(), animation.id, animation.startOffsetPx, animation.endOffsetPx, animation.start, animation.end].join(':');
			refreshScrollMetrics(animation);
			if (scrollMetricsKey !== nextMetricsKey) {
				scrollMetricsKey = nextMetricsKey;
			}
			applyResolvedScrollProgress(animation, getScrollAnimationProgressFromMetrics(scrollMetrics));
		};
		var requestScrollUpdate = function() {
			if (scrollFrame) return;
			scrollFrame = window.requestAnimationFrame(updateScrollAnimations);
		};
		var syncHoverAnimation = function(active) {
			if (hoverState.restoreTimer) {
				window.clearTimeout(hoverState.restoreTimer);
				hoverState.restoreTimer = null;
			}
			hoverState.isActive = active === true;
			var hoverAnimation = getHoverAnimation();
			if (!hoverAnimation) {
				clearHoverAnimation(node);
				updateScrollAnimations();
				if (!resolveAnimationsForBreakpoint(readAnimations(), getCurrentBreakpoint()).find(function(entry) {
					return entry && entry.type === 'scroll';
				})) {
					restoreAnimationBaseState(node);
				}
				updateLoopAnimation();
				return;
			}
			if (hoverState.isActive) {
				clearLoopAnimation(node);
				applyHoverAnimation(node, hoverAnimation, true);
				return;
			}
			var hasScrollAnimation = !!resolveAnimationsForBreakpoint(readAnimations(), getCurrentBreakpoint()).find(function(entry) {
				return entry && entry.type === 'scroll';
			});
			var hasLoopAnimation = !!resolveAnimationsForBreakpoint(readAnimations(), getCurrentBreakpoint()).find(function(entry) {
				return entry && entry.type === 'loop';
			});
			applyHoverAnimation(node, hoverAnimation, false);
			if (hasScrollAnimation || hasLoopAnimation) {
				var hoverTransition = normalizeAnimationTransition(hoverAnimation && hoverAnimation.transition, { duration: 0.22, easePreset: 'easeInOut' });
				hoverState.restoreTimer = window.setTimeout(function() {
					hoverState.restoreTimer = null;
					clearHoverAnimation(node);
					if (hasScrollAnimation) updateScrollAnimations();
					else restoreAnimationBaseState(node);
					updateLoopAnimation();
				}, getTransitionDurationMs(hoverTransition));
				return;
			}
		};
		var handleScrollResize = function() {
			var animation = resolveAnimationsForBreakpoint(readAnimations(), getCurrentBreakpoint()).find(function(entry) {
				return entry && entry.type === 'scroll';
			}) || null;
			refreshScrollMetrics(animation);
			if (scrollTriggerInstance && scrollTriggerInstance.refresh) {
				scrollTriggerInstance.refresh();
				return;
			}
			requestScrollUpdate();
		};
		window.addEventListener('scroll', requestScrollUpdate, { passive: true });
		window.addEventListener('resize', handleScrollResize);
		window.addEventListener('load', function() {
			handleScrollResize();
			updateScrollAnimations();
		});
		node.addEventListener('mouseenter', function() {
			syncHoverAnimation(true);
		});
		node.addEventListener('mouseleave', function() {
			syncHoverAnimation(false);
		});
		updateScrollAnimations();
		requestScrollUpdate();
	};
	var getRealisticOvershoot = function(transition) {
		if (!transition || transition.type !== 'realistic') return 1.03;
		if (transition.springMode === 'physics') {
			var spring = getPhysicsSpringConfig(transition);
			if (spring.dampingRatio >= 1) return 1;
			return 1 + Math.min(0.28, Math.max(0.04, 0.16 * (1 - spring.dampingRatio)));
		}
		return 1 + Math.max(0.06, transition.bounce * 0.18);
	};
	var getRealisticProfile = function(transition) {
		var overshoot = Math.max(0.05, getRealisticOvershoot(transition) - 1);
		return {
			travelOvershoot: Math.max(0.12, overshoot * 1.55),
			scaleOvershoot: Math.max(0.05, overshoot * 1.1),
			pushDuration: Math.max(0.18, transition.duration * 0.42),
			settleDuration: Math.max(0.22, transition.duration * 0.58),
			pushEase: 'power2.out',
			settleEase: 'back.out(' + (1.6 + (transition.bounce * 2.6)) + ')'
		};
	};
	var applyInstantSwitch = function(instance, next) {
		if (gsap) gsap.killTweensOf(instance.querySelectorAll('.fb-component-variant'));
		instance.querySelectorAll('.fb-component-variant').forEach(function(node) {
			node.classList.remove('is-present');
			node.classList.toggle('is-active', node === next);
			node.style.opacity = '';
			node.style.transform = '';
			node.style.visibility = '';
			node.style.pointerEvents = '';
		});
	};
	var getEnterVars = function(transition) {
		if (transition.type === 'realistic') {
			var overshoot = getRealisticOvershoot(transition);
			return {
				opacity: 1,
				y: 0,
				scale: 1,
				duration: getTransitionDurationMs(transition) / 1000,
				ease: transition.springMode === 'physics' ? 'elastic.out(1,' + Math.max(0.2, transition.mass * 0.45) + ')' : 'back.out(' + (1 + transition.bounce * 1.2) + ')',
				clearProps: 'opacity,transform,visibility,pointerEvents',
				transformOrigin: 'center center',
				startAt: { opacity: 0, y: 0, scale: Math.max(0.94, overshoot - 0.06) },
			};
		}
		return {
			opacity: 1,
			y: 0,
			scale: 1,
			duration: getTransitionDurationMs(transition) / 1000,
			ease: getEaseValue(transition),
			clearProps: 'opacity,transform,visibility,pointerEvents',
			transformOrigin: 'center center',
			startAt: { opacity: 0, y: 0, scale: 0.992 },
		};
	};
	var getExitVars = function(transition) {
		return {
			opacity: 0,
			y: 0,
			scale: transition.type === 'realistic' ? 0.985 : 0.992,
			duration: getTransitionDurationMs(transition) / 1000,
			ease: transition.type === 'realistic' ? 'power2.in' : getEaseValue(transition),
			clearProps: 'opacity,transform,visibility,pointerEvents',
			transformOrigin: 'center center',
		};
	};
	var getVariantWrapperDirection = function(current, next) {
		var parent = current && current.parentElement;
		if (!parent || parent !== (next && next.parentElement)) return 1;
		var variants = Array.prototype.slice.call(parent.children || []);
		var currentIndex = variants.indexOf(current);
		var nextIndex = variants.indexOf(next);
		if (currentIndex === -1 || nextIndex === -1) return 1;
		return nextIndex >= currentIndex ? 1 : -1;
	};
	var getVariantWrapperTravel = function(current, next) {
		var width = Math.max((current && current.offsetWidth) || 0, (next && next.offsetWidth) || 0, 24);
		return Math.min(42, Math.max(14, width * 0.14));
	};
	var animateVariantWrappers = function(current, next, transition, options) {
		if (!gsap || !current || !next) return null;
		options = options || {};
		var crossfadeVariants = options.crossfadeVariants !== false;
		var direction = getVariantWrapperDirection(current, next);
		var travel = getVariantWrapperTravel(current, next);
		if (transition.type === 'realistic' && transition.springMode === 'physics') {
			var spring = getPhysicsSpringConfig(transition);
			var physicsTimeline = gsap.timeline({ defaults: { overwrite: true } });
			gsap.set(current, { opacity: 1, x: 0, scaleX: 1, scaleY: 1, transformOrigin: 'center center' });
			gsap.set(next, { opacity: crossfadeVariants ? 0 : 1, transformOrigin: 'center center' });
			physicsTimeline.to(current, {
				...(crossfadeVariants ? { opacity: 0 } : null),
				x: travel * 0.22 * direction,
				scaleX: 0.985,
				scaleY: 0.985,
				duration: spring.duration,
				ease: 'none',
				clearProps: crossfadeVariants ? 'opacity,transform' : 'transform'
			}, 0);
			if (crossfadeVariants) {
				physicsTimeline.to(next, {
					opacity: 1,
					duration: spring.duration,
					ease: 'none',
					clearProps: 'opacity'
				}, 0);
			}
			addPhysicsSpringSequence(physicsTimeline, next, {
				x: -travel * 0.82 * direction,
				y: 0,
				scaleX: 0.94,
				scaleY: 0.94,
				rotation: 0
			}, spring, 0);
			return physicsTimeline;
		}
		if (transition.type === 'realistic') {
			var profile = getRealisticProfile(transition);
			var realisticTimeline = gsap.timeline({ defaults: { overwrite: true } });
			gsap.set(current, { opacity: 1, x: 0, scale: 1, transformOrigin: 'center center' });
			gsap.set(next, { opacity: crossfadeVariants ? 0 : 1, x: -travel * 0.82 * direction, scale: 0.94, transformOrigin: 'center center' });
			realisticTimeline.to(current, {
				...(crossfadeVariants ? { opacity: 0 } : null),
				x: travel * 0.2 * direction,
				scale: 0.985,
				duration: profile.pushDuration,
				ease: profile.pushEase
			}, 0);
			realisticTimeline.to(next, {
				...(crossfadeVariants ? { opacity: 1 } : null),
				x: travel * profile.travelOvershoot * direction,
				scale: 1 + profile.scaleOvershoot,
				duration: profile.pushDuration,
				ease: profile.pushEase
			}, 0);
			realisticTimeline.to(next, {
				x: 0,
				scale: 1,
				duration: profile.settleDuration,
				ease: profile.settleEase,
				clearProps: crossfadeVariants ? 'opacity,transform' : 'transform'
			}, profile.pushDuration);
			return realisticTimeline;
		}
		var duration = getTransitionDurationMs(transition) / 1000;
		var ease = getEaseValue(transition);
		var timeline = gsap.timeline({ defaults: { overwrite: true } });
		gsap.set(current, { opacity: 1, x: 0, scale: 1, transformOrigin: 'center center' });
		gsap.set(next, { opacity: 0, x: -travel * 0.72 * direction, scale: 0.992, transformOrigin: 'center center' });
		timeline.to(current, {
			opacity: 0,
			x: travel * 0.18 * direction,
			scale: 0.992,
			duration: duration,
			ease: ease,
			clearProps: 'opacity,transform'
		}, 0);
		timeline.to(next, {
			opacity: 1,
			x: 0,
			scale: 1,
			duration: duration,
			ease: ease,
			clearProps: 'opacity,transform'
		}, 0);
		return timeline;
	};
	var collectSharedElementPairs = function(container, currentVariant, nextVariant) {
		if (!container || !currentVariant || !nextVariant) return [];
		var containerRect = container.getBoundingClientRect();
		var currentNodes = new Map(Array.prototype.map.call(currentVariant.querySelectorAll('[data-fb-node-id]'), function(node) {
			return [node.dataset.fbNodeId, node];
		}));
		return Array.prototype.reduce.call(nextVariant.querySelectorAll('[data-fb-node-id]'), function(pairs, nextNode) {
			var nodeId = nextNode.dataset.fbNodeId;
			var currentNode = currentNodes.get(nodeId);
			if (!nodeId || !currentNode) return pairs;
			var currentRect = currentNode.getBoundingClientRect();
			var nextRect = nextNode.getBoundingClientRect();
			if (!currentRect.width || !currentRect.height || !nextRect.width || !nextRect.height) return pairs;
			var insideViewport = currentRect.right >= containerRect.left
				&& currentRect.left <= containerRect.right
				&& currentRect.bottom >= containerRect.top
				&& currentRect.top <= containerRect.bottom;
			pairs.push({
				currentNode: currentNode,
				nextNode: nextNode,
				deltaX: currentRect.left - nextRect.left,
				deltaY: currentRect.top - nextRect.top,
				scaleX: currentRect.width / nextRect.width,
				scaleY: currentRect.height / nextRect.height,
				insideViewport: insideViewport
			});
			return pairs;
		}, []);
	};
	var ANIMATABLE_STYLE_PROPS = ['backgroundColor', 'color', 'borderRadius', 'borderColor', 'boxShadow', 'opacity', 'filter', 'backdropFilter'];
	var CROSSFADE_STYLE_PROPS = ['backgroundImage'];
	var FLIP_PROPS = 'opacity,backgroundColor,color,borderRadius,borderColor,boxShadow,filter,backdropFilter';
	var hasStyleDifference = function(currentValue, nextValue) {
		if (currentValue === nextValue) return false;
		var currentNumber = parseFloat(currentValue);
		var nextNumber = parseFloat(nextValue);
		if (isFinite(currentNumber) && isFinite(nextNumber)) {
			return Math.abs(currentNumber - nextNumber) > 0.01;
		}
		return true;
	};
	var getRotationFromComputedStyle = function(style) {
		var rotate = style && style.rotate;
		if (rotate && rotate !== 'none') {
			var parsedRotate = parseFloat(rotate);
			if (isFinite(parsedRotate)) return parsedRotate;
		}
		var transform = style && style.transform;
		if (!transform || transform === 'none') return 0;
		var matrixMatch = transform.match(/^matrix\(([^)]+)\)$/);
		if (matrixMatch) {
			var matrixValues = matrixMatch[1].split(',').map(function(value) { return parseFloat(value.trim()); });
			if (matrixValues.length >= 2 && matrixValues.every(function(value) { return isFinite(value); })) {
				return Math.atan2(matrixValues[1], matrixValues[0]) * (180 / Math.PI);
			}
		}
		var matrix3dMatch = transform.match(/^matrix3d\(([^)]+)\)$/);
		if (matrix3dMatch) {
			var matrix3dValues = matrix3dMatch[1].split(',').map(function(value) { return parseFloat(value.trim()); });
			if (matrix3dValues.length >= 2 && matrix3dValues.every(function(value) { return isFinite(value); })) {
				return Math.atan2(matrix3dValues[1], matrix3dValues[0]) * (180 / Math.PI);
			}
		}
		return 0;
	};
	var getNodeAnimationChanges = function(currentNode, nextNode) {
		var currentRect = currentNode.getBoundingClientRect();
		var nextRect = nextNode.getBoundingClientRect();
		var currentStyle = window.getComputedStyle(currentNode);
		var nextStyle = window.getComputedStyle(nextNode);
		var styleFrom = {};
		var styleTo = {};
		ANIMATABLE_STYLE_PROPS.forEach(function(prop) {
			var currentValue = currentStyle[prop];
			var nextValue = nextStyle[prop];
			if (!hasStyleDifference(currentValue, nextValue)) return;
			styleFrom[prop] = currentValue;
			styleTo[prop] = nextValue;
		});
		var unsupportedChange = CROSSFADE_STYLE_PROPS.some(function(prop) {
			return hasStyleDifference(currentStyle[prop], nextStyle[prop]);
		}) || currentNode.textContent !== nextNode.textContent;
		var deltaX = currentRect.left - nextRect.left;
		var deltaY = currentRect.top - nextRect.top;
		var scaleX = currentRect.width / Math.max(nextRect.width, 0.01);
		var scaleY = currentRect.height / Math.max(nextRect.height, 0.01);
		var rotation = getRotationFromComputedStyle(currentStyle) - getRotationFromComputedStyle(nextStyle);
		var geometryChanged = Math.abs(deltaX) > 0.5
			|| Math.abs(deltaY) > 0.5
			|| Math.abs(scaleX - 1) > 0.01
			|| Math.abs(scaleY - 1) > 0.01
			|| Math.abs(rotation) > 0.5;
		return {
			geometryChanged: geometryChanged,
			styleChanged: Object.keys(styleTo).length > 0,
			needsCrossfade: unsupportedChange,
			startState: {
				x: deltaX,
				y: deltaY,
				scaleX: Math.max(0.01, scaleX),
				scaleY: Math.max(0.01, scaleY),
				rotation: rotation
			},
			styleFrom: styleFrom,
			styleTo: styleTo,
			styleProps: Object.keys(styleTo)
		};
	};
	var prepareAnimatedPairs = function(pairs) {
		var pairEntries = pairs.map(function(pair) {
			return { pair: pair, changes: getNodeAnimationChanges(pair.currentNode, pair.nextNode) };
		});
		var byId = new Map(pairEntries.map(function(entry) {
			return [entry.pair.nextNode.dataset.fbNodeId, entry];
		}));
		return pairEntries.filter(function(entry) {
			if (!entry.changes.geometryChanged && !entry.changes.styleChanged && !entry.changes.needsCrossfade) return false;
			var ancestor = entry.pair.nextNode.parentElement ? entry.pair.nextNode.parentElement.closest('[data-fb-node-id]') : null;
			while (ancestor) {
				var ancestorEntry = byId.get(ancestor.dataset.fbNodeId);
				if (ancestorEntry && (ancestorEntry.changes.geometryChanged || ancestorEntry.changes.needsCrossfade)) return false;
				ancestor = ancestor.parentElement ? ancestor.parentElement.closest('[data-fb-node-id]') : null;
			}
			return true;
		});
	};
	var collectTopLevelUnmatchedNodes = function(variantNode, matchedIds) {
		if (!variantNode) return [];
		var allNodes = Array.prototype.slice.call(variantNode.querySelectorAll('[data-fb-node-id]'));
		return allNodes.filter(function(node) {
			var nodeId = node.dataset.fbNodeId;
			if (!nodeId || matchedIds.has(nodeId)) return false;
			var ancestor = node.parentElement ? node.parentElement.closest('[data-fb-node-id]') : null;
			while (ancestor) {
				var ancestorId = ancestor.dataset.fbNodeId;
				if (ancestorId && !matchedIds.has(ancestorId)) return false;
				ancestor = ancestor.parentElement ? ancestor.parentElement.closest('[data-fb-node-id]') : null;
			}
			return true;
		});
	};
	var animateVariantSwitchFallback = function(instance, current, next, transition, onComplete) {
		if (!gsap) {
			applyInstantSwitch(instance, next);
			if (onComplete) onComplete();
			return;
		}
		var complete = function() {
			instance.querySelectorAll('.fb-component-variant').forEach(function(node) {
				var isActive = node === next;
				node.classList.remove('is-present');
				node.classList.toggle('is-active', isActive);
				node.style.opacity = '';
				node.style.transform = '';
				node.style.visibility = '';
				node.style.pointerEvents = '';
			});
			if (onComplete) onComplete();
		};
		gsap.killTweensOf([current, next]);
		current.style.opacity = '1';
		current.classList.remove('is-active');
		current.classList.add('is-present');
		next.classList.add('is-present');
		next.classList.add('is-active');
		next.style.visibility = 'visible';
		next.style.pointerEvents = 'none';
		current.style.pointerEvents = 'none';
		var timeline = animateVariantWrappers(current, next, transition) || gsap.timeline({ defaults: { overwrite: true } });
		timeline.eventCallback('onComplete', complete);
	};
	var animateVariantSwitch = function(instance, current, next, transition, onComplete) {
		if (!next) return;
		if (!current || current === next || prefersReducedMotion || !transition || transition.type === 'instant') {
			applyInstantSwitch(instance, next);
			if (onComplete) onComplete();
			return;
		}
		var duration = getTransitionDurationMs(transition);
		if (!duration) {
			applyInstantSwitch(instance, next);
			if (onComplete) onComplete();
			return;
		}
		if (!gsap || !Flip) {
			animateVariantSwitchFallback(instance, current, next, transition, onComplete);
			return;
		}
		next.classList.add('is-present');
		next.style.visibility = 'visible';
		next.style.pointerEvents = 'none';
		next.style.opacity = '1';
		current.style.pointerEvents = 'none';
		var complete = function() {
			instance.querySelectorAll('.fb-component-variant').forEach(function(node) {
				var isActive = node === next;
				node.classList.remove('is-present');
				node.classList.toggle('is-active', isActive);
				node.style.opacity = '';
				node.style.transform = '';
				node.style.visibility = '';
				node.style.pointerEvents = '';
			});
			if (onComplete) onComplete();
		};
		var currentFlipTargets = current.querySelectorAll('[data-flip-id]');
		var state = null;
		try {
			state = Flip.getState(currentFlipTargets, { props: FLIP_PROPS, simple: false });
		} catch (error) {
			state = null;
		}
		if (!state) {
			animateVariantSwitchFallback(instance, current, next, transition, onComplete);
			return;
		}
		var totalDuration = getTransitionDurationMs(transition) / 1000;
		var ease = transition.type === 'realistic'
			? (transition.springMode === 'physics'
				? 'elastic.out(1,' + Math.max(0.2, transition.mass * 0.45) + ')'
				: 'back.out(' + (1 + transition.bounce * 1.2) + ')')
			: getEaseValue(transition);
		var sharedPairs = collectSharedElementPairs(instance, current, next);
		var animatedPairs = prepareAnimatedPairs(sharedPairs);
		var matchedIds = new Set(sharedPairs.map(function(entry) {
			return entry.nextNode.dataset.fbNodeId;
		}).filter(Boolean));
		var shouldCrossfadeVariants = animatedPairs.some(function(entry) {
			return entry.changes.needsCrossfade;
		}) || collectTopLevelUnmatchedNodes(current, matchedIds).length > 0 || collectTopLevelUnmatchedNodes(next, matchedIds).length > 0;
		current.style.opacity = '1';
		current.classList.remove('is-active');
		current.classList.add('is-present');
		next.classList.add('is-present');
		next.classList.add('is-active');
		next.style.visibility = 'visible';
		next.style.pointerEvents = 'none';
		current.style.pointerEvents = 'none';
		next.style.opacity = shouldCrossfadeVariants ? '0' : '1';
		animateVariantWrappers(current, next, transition, { crossfadeVariants: shouldCrossfadeVariants });
		try {
			Flip.from(state, {
				targets: Array.prototype.slice.call(current.querySelectorAll('[data-flip-id]')).concat(Array.prototype.slice.call(next.querySelectorAll('[data-flip-id]'))),
				absolute: true,
				nested: true,
				scale: true,
				simple: false,
				props: FLIP_PROPS,
				duration: totalDuration,
				ease: ease,
				onEnter: function(elements) {
					return gsap.fromTo(elements, { opacity: 0 }, {
						opacity: 1,
						duration: totalDuration,
						ease: ease,
						clearProps: 'opacity'
					});
				},
				onLeave: function(elements) {
					return gsap.to(elements, {
						opacity: 0,
						duration: totalDuration,
						ease: ease,
						clearProps: 'opacity'
					});
				},
				onComplete: complete
			});
		} catch (error) {
			animateVariantSwitchFallback(instance, current, next, transition, onComplete);
		}
	};
	var syncInitialElementAnimationState = function(node) {
		if (!node) return;
		var animations = parseJsonAttr(node.dataset.fbAnimations, null);
		if (!animations) return;
		var scrollAnimation = resolveAnimationsForBreakpoint(animations, getCurrentBreakpoint()).find(function(entry) {
			return entry && entry.type === 'scroll';
		}) || null;
		if (!scrollAnimation) return;
		refreshNodeMarkerAnchor(node);
		var progress = getScrollAnimationProgress(node, scrollAnimation.start, scrollAnimation.end, scrollAnimation.startOffset, scrollAnimation.endOffset, scrollAnimation.startOffsetPx, scrollAnimation.endOffsetPx);
		applyScrollAnimation(node, scrollAnimation, progress);
	};
	var syncInitialAnimationStatesInScope = function() {
		scope.querySelectorAll('[data-fb-animations]').forEach(syncInitialElementAnimationState);
	};
	var scopeScrollAnimationSyncFrame = null;
	var requestScopeScrollAnimationSync = function() {
		if (scopeScrollAnimationSyncFrame) return;
		scopeScrollAnimationSyncFrame = window.requestAnimationFrame(function() {
			scopeScrollAnimationSyncFrame = null;
			syncInitialAnimationStatesInScope();
		});
	};
	scope.querySelectorAll('[data-fb-animations]').forEach(initElementAnimations);
	syncInitialAnimationStatesInScope();
	window.requestAnimationFrame(syncInitialAnimationStatesInScope);
	window.setTimeout(syncInitialAnimationStatesInScope, 120);
	window.setTimeout(syncInitialAnimationStatesInScope, 400);
	window.addEventListener('scroll', requestScopeScrollAnimationSync, { passive: true });
	window.addEventListener('resize', requestScopeScrollAnimationSync);
	window.addEventListener('load', function() {
		requestScopeScrollAnimationSync();
		window.setTimeout(syncInitialAnimationStatesInScope, 80);
	});
	scope.querySelectorAll('[data-fb-scroll-sequence]').forEach(initScrollSequence);

	instances.forEach(function(instance) {
		var timer = null;
		var scrollVariantFrame = null;
		var lockedScrollVariantTarget = null;
		var scrollVariantBaseId = '';
		var activeVariantId = instance.dataset.fbActiveVariant || '';
		var baseVariantId = '';
		var clearTimer = function() {
			if (!timer) return;
			window.clearTimeout(timer);
			timer = null;
		};
		var isDefaultVariantNode = function(node) {
			return (node && node.dataset ? (node.dataset.fbVariantMode || 'default') : 'default') === 'default';
		};
		var getBaseVariantId = function(variantId) {
			var node = findVariant(instance, variantId);
			if (!node) return baseVariantId || instance.dataset.fbBaseVariant || variantId || '';
			if (isDefaultVariantNode(node)) return node.dataset.fbVariantId || variantId || '';
			return node.dataset.fbParentVariantId || baseVariantId || instance.dataset.fbBaseVariant || variantId || '';
		};
		var getBaseVariantNode = function() {
			var baseId = baseVariantId || instance.dataset.fbBaseVariant || getBaseVariantId(activeVariantId || instance.dataset.fbActiveVariant || '');
			return findVariant(instance, baseId) || getActive();
		};
		var findStateVariant = function(baseVariantId, mode) {
			return Array.prototype.find.call(instance.querySelectorAll('.fb-component-variant'), function(node) {
				return (node.dataset.fbVariantMode || 'default') === mode && (node.dataset.fbParentVariantId || '') === baseVariantId;
			}) || null;
		};
		var getActive = function() {
			return instance.querySelector('.fb-component-variant.is-active') || instance.querySelector('.fb-component-variant');
		};
		var showVariant = function(variantId, transition, options) {
			var current = getActive();
			var next = findVariant(instance, variantId);
			if (!next) return;
			var setBase = options && Object.prototype.hasOwnProperty.call(options, 'setBase')
				? !!options.setBase
				: isDefaultVariantNode(next);
			var queueAfter = options && Object.prototype.hasOwnProperty.call(options, 'queueAppear')
				? !!options.queueAppear
				: setBase;
			var nextBaseVariantId = setBase ? getBaseVariantId(variantId) : (baseVariantId || getBaseVariantId(activeVariantId || instance.dataset.fbActiveVariant || ''));
			animateVariantSwitch(instance, current, next, transition || parseTransition(current || next), function() {
				activeVariantId = variantId;
				baseVariantId = nextBaseVariantId || baseVariantId;
				instance.dataset.fbActiveVariant = activeVariantId;
				instance.dataset.fbBaseVariant = baseVariantId;
				if (queueAfter) queueAppear();
			});
		};
		var applyVisualState = function(mode) {
			var baseId = baseVariantId || instance.dataset.fbBaseVariant || getBaseVariantId(activeVariantId || instance.dataset.fbActiveVariant || '');
			if (!baseId) return;
			var targetNode = mode ? findStateVariant(baseId, mode) : findVariant(instance, baseId);
			var targetId = targetNode ? targetNode.dataset.fbVariantId : baseId;
			if (!targetId || targetId === activeVariantId) return;
			showVariant(targetId, {
				type: 'ease',
				duration: 0.18,
				easePreset: 'easeInOut',
				springMode: 'time',
				bounce: 0,
				stiffness: 500,
				damping: 24,
				mass: 1,
				bezier: { x1: 0.4, y1: 0, x2: 0.2, y2: 1 }
			}, { setBase: false, queueAppear: false });
		};
		var queueAppear = function() {
			clearTimer();
			var active = getBaseVariantNode();
			if (!active || active.dataset.fbTrigger !== 'appear') return;
			var target = active.dataset.fbTargetVariantId;
			if (!target) return;
			var delay = Math.max(0, parseNumber(active.dataset.fbDelay, 0) * 1000);
			var transition = parseTransition(active);
			timer = window.setTimeout(function() {
				showVariant(target, transition);
			}, delay);
		};
		var runTrigger = function(expected) {
			var active = getBaseVariantNode();
			if (!active || active.dataset.fbTrigger !== expected) return;
			var target = active.dataset.fbTargetVariantId;
			if (!target) return;
			var delay = Math.max(0, parseNumber(active.dataset.fbDelay, 0) * 1000);
			var transition = parseTransition(active);
			clearTimer();
			if (delay > 0) {
				timer = window.setTimeout(function() {
					showVariant(target, transition);
				}, delay);
				return;
			}
			showVariant(target, transition);
		};
		var getScrollVariantBaseId = function() {
			return scrollVariantBaseId || baseVariantId || instance.dataset.fbBaseVariant || getBaseVariantId(activeVariantId || instance.dataset.fbActiveVariant || '');
		};
		var applyScrollVariantTarget = function(target, fallbackTransition) {
			var transition = normalizeAnimationTransition((target && target.animation && target.animation.transition) || fallbackTransition || null, { duration: 0.45, easePreset: 'easeInOut' });
			if (!target) {
				var restoreBaseId = getScrollVariantBaseId();
				if (!restoreBaseId || activeVariantId === restoreBaseId) return;
				showVariant(restoreBaseId, transition, { setBase: true, queueAppear: false });
				return;
			}
			if (activeVariantId === target.targetVariantId) return;
			var nextNode = findVariant(instance, target.targetVariantId);
			showVariant(target.targetVariantId, transition, {
				setBase: isDefaultVariantNode(nextNode),
				queueAppear: false,
			});
		};
		var updateScrollVariantTargets = function() {
			scrollVariantFrame = null;
			var animations = resolveAnimationsForBreakpoint(parseJsonAttr(instance.dataset.fbAnimations, null), getCurrentBreakpoint()).filter(function(animation) {
				return animation && animation.type === 'scroll-variant';
			});
			if (!animations.length) return;
			var context = buildNodeMarkerContext(instance);
			var timelineTargets = animations.reduce(function(list, animation) {
				normalizeScrollVariantTargets(animation).forEach(function(target) {
					if (!target.targetVariantId) return;
					var markerOffsetPx = resolveMarkerOffsetPxFromContext(context, target.marker, target.markerOffsetPx, 0.5);
					list.push({
						key: animation.id + ':' + target.id,
						animation: animation,
						targetVariantId: target.targetVariantId,
						markerOffsetPx: markerOffsetPx,
						markerDistance: markerOffsetPx - getNodeAnchorTravelFromContext(context)
					});
				});
				return list;
			}, []).sort(function(left, right) {
				return left.markerOffsetPx - right.markerOffsetPx;
			});
			if (!timelineTargets.length) return;
			var desiredTarget = timelineTargets.reduce(function(selected, candidate) {
				if (candidate.markerDistance > 0) return selected;
				if (!selected) return candidate;
				return candidate.markerDistance > selected.markerDistance ? candidate : selected;
			}, null);
			var replayEnabled = timelineTargets.some(function(entry) {
				return entry.animation.playback === 'replay';
			});
			if (replayEnabled) {
				lockedScrollVariantTarget = desiredTarget;
				applyScrollVariantTarget(desiredTarget, timelineTargets[0] && timelineTargets[0].animation && timelineTargets[0].animation.transition);
				return;
			}
			if (desiredTarget && (!lockedScrollVariantTarget || desiredTarget.markerDistance > lockedScrollVariantTarget.markerDistance)) {
				lockedScrollVariantTarget = desiredTarget;
			}
			if (!lockedScrollVariantTarget) return;
			applyScrollVariantTarget(lockedScrollVariantTarget, timelineTargets[0] && timelineTargets[0].animation && timelineTargets[0].animation.transition);
		};
		var requestScrollVariantUpdate = function() {
			if (scrollVariantFrame) return;
			scrollVariantFrame = window.requestAnimationFrame(updateScrollVariantTargets);
		};
		instance.addEventListener('click', function(event) {
			event.stopPropagation();
			runTrigger('click');
		});
		instance.addEventListener('pointerdown', function(event) {
			event.stopPropagation();
			applyVisualState('pressed');
			runTrigger('click-start');
		});
		instance.addEventListener('pointerup', function(event) {
			event.stopPropagation();
			if (instance.matches(':hover')) applyVisualState('hover');
			else applyVisualState(null);
		});
		instance.addEventListener('pointercancel', function() { applyVisualState(null); });
		instance.addEventListener('mouseenter', function() {
			applyVisualState('hover');
			runTrigger('mouse-enter');
		});
		instance.addEventListener('mouseleave', function() {
			applyVisualState(null);
			runTrigger('mouse-leave');
		});
		activeVariantId = activeVariantId || (getActive() ? (getActive().dataset.fbVariantId || '') : '');
		baseVariantId = getBaseVariantId(activeVariantId || instance.dataset.fbActiveVariant || '');
		scrollVariantBaseId = baseVariantId;
		instance.dataset.fbActiveVariant = activeVariantId;
		instance.dataset.fbBaseVariant = baseVariantId;
		refreshNodeMarkerAnchor(instance);
		queueAppear();
		window.addEventListener('scroll', requestScrollVariantUpdate, { passive: true });
		window.addEventListener('resize', function() {
			refreshNodeMarkerAnchor(instance);
			requestScrollVariantUpdate();
		});
		requestScrollVariantUpdate();
	});
})();
</script>
SCRIPT;

		$script = strtr(
			$script,
			[
				'__FB_BUILD_ID__' => $bid,
				'__FB_PAGE_VARIABLES__' => $page_variables_json,
				'__FB_GLOBAL_VARIABLES__' => $global_variables_json,
			]
		);

		return '<style>' . $css . '</style>' . $script;
	}

	private function sanitize_css_value( $value ): string {
		return preg_replace( '/[;\{\}]/', '', (string) $value );
	}

	private function is_gradient_css_value( $value ): bool {
		return is_string( $value ) && preg_match( '/gradient\(/i', $value );
	}

	private function get_gradient_fallback_color( $value, string $fallback = '#000000' ): string {
		if ( ! is_string( $value ) || trim( $value ) === '' ) return $fallback;
		if ( ! $this->is_gradient_css_value( $value ) ) return trim( $value );
		if ( preg_match( '/(#[0-9a-fA-F]{3,8}|rgba?\([^\)]+\)|hsla?\([^\)]+\)|currentColor)/i', $value, $matches ) ) {
			return $matches[1];
		}
		return $fallback;
	}

	private function build_text_stroke_shadow_css( float $width, string $color ): string {
		$radius = max( 1, (int) ceil( $width ) );
		$shadow_parts = [];
		for ( $offset_y = -$radius; $offset_y <= $radius; $offset_y++ ) {
			for ( $offset_x = -$radius; $offset_x <= $radius; $offset_x++ ) {
				if ( 0 === $offset_x && 0 === $offset_y ) continue;
				$shadow_parts[] = sprintf( '%dpx %dpx 0 %s', $offset_x, $offset_y, $color );
			}
		}
		return implode( ', ', $shadow_parts );
	}

}
