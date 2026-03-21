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

	/** @var array<string,float|null> Per-breakpoint viewport fold height (null = auto-compute) */
	private array $viewport_fold_h = [ 'desktop' => null, 'tablet' => null, 'mobile' => null ];

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

	private function normalize_video_provider( $value ): string {
		return in_array( $value, [ 'youtube', 'vimeo', 'upload' ], true ) ? $value : 'upload';
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

	private function plain_text_to_rich_text_html( string $text ): string {
		return nl2br( esc_html( $text ) );
	}

	private function build_gradient_frame_stroke_overlay_style( array $styles ): string {
		$border_width = isset( $styles['borderWidth'] ) ? max( 0, (float) $styles['borderWidth'] ) : 0;
		$border_color = $styles['borderColor'] ?? '';
		if ( $border_width <= 0 || ! $this->is_gradient_css_value( $border_color ) ) {
			return '';
		}

		return 'position:absolute;inset:0;border-radius:inherit;padding:' . $border_width . 'px;box-sizing:border-box;background:' . $this->sanitize_css_value( $border_color ) . ';-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;user-select:none;';
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

	public function __construct( array $layout ) {
		$this->layout   = $layout;
		$this->build_id = 'fb' . substr( md5( wp_json_encode( $layout ) ), 0, 6 );
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
		$css  = $this->generate_css();
		$html = '<style>' . $css . '</style>';

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
	private function render_element( array $el, string $bpId, float $cw, float $ch, bool $artboard_layout_on = false, string $parent_flex_dir = 'none', string $parent_align_items = 'stretch' ): string {
		$resolved = $this->resolve_element_with_variables( $el, $bpId );
		if ( ! empty( $resolved['hidden'] ) ) return '';

		$id     = preg_replace( '/[^a-zA-Z0-9_-]/', '', $el['id'] ?? '' );
		$class  = 'fb-el fb-el-' . $id;
		$class  = 'fb-el fb-el-' . $id;
		$styles = $resolved['styles'] ?? [];

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
		$pin_right  = !empty( $cx['right'] );
		$pin_bottom = !empty( $cx['bottom'] );
		$right_val  = $cw - $x - $w;
		$bottom_val = $ch - $y - $h;
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
				$sticky_offsets .= "--fb-sticky-top:{$sticky_top}px;top:{$sticky_top}px;align-self:{$parent_align_items};{$sticky_cross_axis_extra}";
			}
			$inline = 'position:' . ( $pos_type === 'sticky' ? 'sticky' : 'relative' ) . ";box-sizing:border-box;{$sticky_offsets}{$extra}";
		} elseif ( $pos_type === 'fixed' || $pos_type === 'absolute' ) {
			$position_css = $pos_type === 'fixed' ? 'fixed' : 'absolute';
			$inline = "position:{$position_css};box-sizing:border-box;";

			if ( $width_mode === 'fill' ) {
				$inline .= 'left:0;right:0;width:auto;';
			} elseif ( $width_mode === 'hug' ) {
				$inline .= "left:{$x}px;width:fit-content;";
			} elseif ( $width_mode === 'relative' ) {
				$inline .= "left:{$x}px;width:{$w_pct}%;";
			} elseif ( ! empty( $cx['left'] ) && $pin_right ) {
				$inline .= "left:{$x}px;right:{$right_val}px;";
			} elseif ( $pin_right && empty( $cx['left'] ) ) {
				$inline .= "right:{$right_val}px;width:{$w}px;";
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
			} elseif ( ! empty( $cx['top'] ) && $pin_bottom ) {
				$inline .= "top:{$y}px;bottom:{$eff_bottom_val}px;";
			} elseif ( $pin_bottom && empty( $cx['top'] ) ) {
				$inline .= "bottom:{$eff_bottom_val}px;height:{$h}px;";
			} else {
				$inline .= "top:{$y}px;height:{$h}px;";
			}
		}
		if ( $min_w !== null && $min_w > 0 ) $inline .= "min-width:{$min_w}px;";
		if ( $max_w !== null && $max_w > 0 ) $inline .= "max-width:{$max_w}px;";
		if ( $min_h !== null && $min_h > 0 ) $inline .= "min-height:{$min_h}px;";
		if ( $max_h !== null && $max_h > 0 ) $inline .= "max-height:{$max_h}px;";

		if ( ! empty( $resolved['rotation'] ) ) {
			$inline .= 'transform:rotate(' . floatval( $resolved['rotation'] ) . 'deg);';
		}

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
		if ( isset( $styles['blur'] ) && $styles['blur'] !== '' ) {
			$blur = max( 0, (float) $styles['blur'] );
			$inline .= 'filter:' . ( $blur > 0 ? 'blur(' . $blur . 'px)' : 'none' ) . ';';
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
		$runtime_attrs = '';
		if ( $bindings_json !== '' ) {
			$runtime_attrs .= ' data-fb-bindings="' . $bindings_json . '"';
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
		if ( $scroll_sequence_json !== '' ) {
			$runtime_attrs .= ' data-fb-scroll-sequence="' . $scroll_sequence_json . '"';
		}
		if ( $component_id && $this->get_component_definition( $component_id ) ) {
			$html = '<div class="' . esc_attr( $class . ' fb-component-instance' ) . '" style="' . esc_attr( $layout_inline ) . '" data-fb-node-id="' . esc_attr( $id ) . '" data-flip-id="' . esc_attr( $id ) . '" data-fb-component-id="' . esc_attr( $component_id ) . '" data-fb-active-variant="' . esc_attr( sanitize_text_field( $component_instance['variantId'] ?? '' ) ) . '"' . $runtime_attrs . '>';
			$html .= $this->render_component_instance_variants( $el, $resolved, $bpId );
			$html .= '</div>';
			return $html;
		}
		// Emit the div with all accumulated inline styles
		$html = '<div class="' . esc_attr( $class ) . '" style="' . esc_attr( $inline ) . '" data-fb-node-id="' . esc_attr( $id ) . '" data-flip-id="' . esc_attr( $id ) . '"' . $runtime_attrs . '>';
		$frame_stroke_overlay_style = $this->build_gradient_frame_stroke_overlay_style( $styles );
		if ( '' !== $frame_stroke_overlay_style ) {
			$html .= '<div class="fb-frame-stroke-overlay" aria-hidden="true" style="' . esc_attr( $frame_stroke_overlay_style ) . '"></div>';
		}

		// Image element: render <img> tag filling the div (added after div opening)
		if ( ( $el['type'] ?? '' ) === 'image' ) {
			$src     = esc_url( $this->normalize_media_url( $resolved['src'] ?? '' ) );
			$obj_fit = $this->sanitize_css_value( $styles['objectFit'] ?? 'cover' );
			if ( $src ) {
				$img_style = "position:absolute;inset:0;width:100%;height:100%;object-fit:{$obj_fit};border-radius:inherit;";
				$html .= '<img src="' . $src . '" alt="" style="' . esc_attr( $img_style ) . '" loading="lazy">';
			}
		}

		if ( ( $el['type'] ?? '' ) === 'video' ) {
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

		if ( ( $el['type'] ?? '' ) === 'scroll-sequence' && $scroll_sequence ) {
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

		if ( ( $el['type'] ?? '' ) === 'text' ) {
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
			$text_style .= 'color:' . $text_color . ';';
			$text_style .= 'white-space:' . $white_space . ';';
			$text_style .= 'word-break:break-word;';
			$text_stroke_width = isset( $styles['strokeWidth'] ) ? max( 0, (float) $styles['strokeWidth'] ) : 0;
			if ( $text_stroke_width > 0 ) {
				$text_stroke_color = $this->sanitize_css_value( $this->get_gradient_fallback_color( $styles['strokeColor'] ?? '', $styles['color'] ?? '#000000' ) );
				$text_style .= '--fb-text-stroke-width:' . $text_stroke_width . 'px;';
				$text_style .= '--fb-text-stroke-color:' . $text_stroke_color . ';';
			}
			$text_value = $this->get_resolved_rich_text_html( $resolved );
			$html .= '<div class="fb-text-content" data-flip-id="' . esc_attr( $id . '__content' ) . '" style="' . esc_attr( $text_style ) . '">' . $text_value . '</div>';
		}

		if ( ( $el['type'] ?? '' ) === 'icon' ) {
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

		// Compute flex direction this element provides to its own children
		$child_flex_dir = 'none';
		if ( ( $styles['display'] ?? '' ) === 'flex' ) {
			$child_flex_dir = $styles['flexDirection'] ?? 'column';
		}
		$child_layout_on = $child_flex_dir !== 'none';
		$child_align_items = $child_layout_on ? ( $styles['alignItems'] ?? 'stretch' ) : 'stretch';
		list( $child_cw, $child_ch ) = $this->compute_child_context_size( $resolved, $cw, $ch, $artboard_layout_on, $parent_flex_dir );
		foreach ( $el['children'] ?? [] as $child_id ) {
			$child = $this->el_index[ $child_id ] ?? null;
			if ( $child ) {
				$html .= $this->render_element( $child, $bpId, $child_cw, $child_ch, $child_layout_on, $child_flex_dir, $child_align_items );
			}
		}

		$html .= '</div>';
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
		$pin_top    = !empty( $cx['top'] );
		$pin_bottom = !empty( $cx['bottom'] );
		$pin_left   = !empty( $cx['left'] );
		$pin_right  = !empty( $cx['right'] );
		// Compute right/bottom from design positions
		$right_val  = $cw - $x - $w;
		$bottom_val = $ch - $y - $h;

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
			} elseif ( $pin_left && $pin_right ) {
				$rules[] = "left: {$x}px";
				$rules[] = "right: {$right_val}px";
			} elseif ( $pin_right && !$pin_left ) {
				$rules[] = "right: {$right_val}px";
				$rules[] = "width: {$w}px";
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
			} elseif ( $pin_top && $pin_bottom ) {
				$rules[] = "top: {$y}px";
				$rules[] = "bottom: {$eff_bottom_val}px";
			} elseif ( $pin_bottom && !$pin_top ) {
				$rules[] = "bottom: {$eff_bottom_val}px";
				$rules[] = "height: {$h}px";
			} else {
				$rules[] = "top: {$y}px";
				$rules[] = "height: {$h}px";
			}
		}

		if ( $min_w !== null && $min_w > 0 ) $rules[] = "min-width: {$min_w}px";
		if ( $max_w !== null && $max_w > 0 ) $rules[] = "max-width: {$max_w}px";
		if ( $min_h !== null && $min_h > 0 ) $rules[] = "min-height: {$min_h}px";
		if ( $max_h !== null && $max_h > 0 ) $rules[] = "max-height: {$max_h}px";

		if ( ! empty( $resolved['rotation'] ) ) {
			$rules[] = 'transform: rotate(' . floatval( $resolved['rotation'] ) . 'deg)';
		}

		$allowed_props = [
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
		if ( ! empty( $styles['borderWidth'] ) && $this->is_gradient_css_value( $styles['borderColor'] ?? '' ) ) {
			$rules = array_filter( $rules, fn( $rule ) => strpos( $rule, 'border-color:' ) === false );
			$rules[] = 'border-color: transparent';
		}
		// Background image fill
		$bg_img = $this->normalize_media_url( $styles['backgroundImage'] ?? '' );
		if ( $bg_img !== '' ) {
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
		if ( ( $styles['borderRadiusMode'] ?? '' ) === 'independent' ) {
			$br = (float) ( $styles['borderRadius'] ?? 0 );
			$tl = (float) ( $styles['borderRadiusTL'] ?? $br );
			$tr = (float) ( $styles['borderRadiusTR'] ?? $br );
			$brc = (float) ( $styles['borderRadiusBR'] ?? $br );
			$bl = (float) ( $styles['borderRadiusBL'] ?? $br );
			$rules = array_filter( $rules, fn( $r ) => strpos( $r, 'border-radius' ) === false );
			$rules[] = "border-radius: {$tl}px {$tr}px {$brc}px {$bl}px";
		}
		if ( isset( $styles['blur'] ) && $styles['blur'] !== '' ) {
			$blur = max( 0, (float) $styles['blur'] );
			$rules[] = 'filter: ' . ( $blur > 0 ? 'blur(' . $blur . 'px)' : 'none' );
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
		$page_map = [];
		foreach ( $this->page_variables as $variable ) {
			$page_map[ $variable['id'] ] = $variable;
		}
		$global_map = [];
		foreach ( $this->global_variables as $variable ) {
			$global_map[ $variable['id'] ] = $variable;
		}

		return [
			'page'   => $page_map,
			'global' => $global_map,
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
		if ( '' === $id || ! in_array( $type, [ 'trigger', 'condition', 'navigate', 'set-variable', 'delay', 'end' ], true ) ) {
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
			'sourcePort' => in_array( $source_port, [ 'next', 'true', 'false' ], true ) ? $source_port : 'next',
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
					'scope'      => $scope === 'global' ? 'global' : 'page',
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

	private function apply_variable_binding_value( array $resolved, string $property_key, array $variable ): array {
		$next = $resolved;
		$next['styles'] = is_array( $resolved['styles'] ?? null ) ? $resolved['styles'] : [];
		$value = $variable['value'] ?? null;

		switch ( $property_key ) {
			case 'text':
				$next['text'] = $value === null ? '' : (string) $value;
				break;
			case 'hidden':
				$next['hidden'] = empty( $value );
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

	private function resolve_element_with_variables( array $el, string $bp_id ): array {
		$resolved = $this->resolve( $el, $bp_id );
		$bindings = $this->normalize_bindings( $el['bindings'] ?? [] );
		$variable_map = $this->get_variable_map();
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
	var resolveBindingForBreakpoint = function(bindings, bpId, propertyKey) {
		if (!bindings || typeof bindings !== 'object') return null;
		var desktop = bindings.desktop || {};
		var tablet = bindings.tablet || {};
		var mobile = bindings.mobile || {};
		if (bpId === 'mobile') return mobile[propertyKey] || tablet[propertyKey] || desktop[propertyKey] || null;
		if (bpId === 'tablet') return tablet[propertyKey] || desktop[propertyKey] || null;
		return desktop[propertyKey] || null;
	};
	var applyBindingToNode = function(node, propertyKey, variable) {
		if (!node || !variable) return;
		var value = variable.value;
		var textNode = node.querySelector('.fb-text-content');
		if (propertyKey === 'text') {
			if (textNode) textNode.innerHTML = bindingTextToHtml(value);
			return;
		}
		if (propertyKey === 'hidden') {
			node.style.display = value ? '' : 'none';
			return;
		}
		if (propertyKey === 'styles.backgroundImage') {
			var backgroundUrl = '';
			if (value && typeof value === 'object' && typeof value.url === 'string') backgroundUrl = value.url;
			else if (typeof value === 'string') backgroundUrl = value;
			backgroundUrl = backgroundUrl.trim();
			node.style.backgroundImage = backgroundUrl ? 'url(' + backgroundUrl.replace(/\)/g, '\\)') + ')' : '';
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
			node.style.backgroundColor = typeof value === 'string' ? value : '#000000';
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
	var executeInteraction = function(interaction) {
		if (!interaction || typeof interaction !== 'object') return;
		if (interaction.type === 'navigate') {
			if (interaction.pageUrl) window.location.href = interaction.pageUrl;
			return;
		}
		if (interaction.type !== 'set-variable' || !interaction.variableId) return;
		var variable = getVariable(interaction.variableScope || 'page', interaction.variableId);
		if (!variable) return;
		var operation = interaction.operation || 'set';
		var nextValue = cloneValue(variable.value);
		if (operation === 'default') {
			nextValue = cloneValue(variable.defaultValue);
		} else if (variable.type === 'boolean') {
			nextValue = operation === 'toggle' ? !variable.value : !!interaction.value;
		} else if (variable.type === 'number') {
			var step = typeof interaction.value === 'number' ? interaction.value : parseFloat(interaction.value);
			step = Number.isFinite(step) ? step : 0;
			if (operation === 'increment') nextValue = (Number(variable.value) || 0) + step;
			else if (operation === 'decrement') nextValue = (Number(variable.value) || 0) - step;
			else nextValue = step;
		} else {
			nextValue = cloneValue(interaction.value);
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
	var evaluateConditionNode = function(node) {
		var config = node && typeof node.config === 'object' ? node.config : {};
		var variable = getVariable(config.variableScope || 'page', config.variableId || '');
		var operator = config.operator || 'equals';
		var left = variable ? variable.value : null;
		var type = variable ? variable.type : 'string';
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
	var executeFlow = function(flow) {
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
		var runNode = function(nodeId) {
			if (!nodeId || steps > 128) return;
			steps += 1;
			var node = nodeMap.get(String(nodeId));
			if (!node) return;
			if (node.type === 'trigger') {
				var triggerEdge = getNextEdge(node.id, 'next');
				if (triggerEdge) runNode(triggerEdge.target);
				return;
			}
			if (node.type === 'navigate') {
				if (node.config && node.config.pageUrl) window.location.href = node.config.pageUrl;
				return;
			}
			if (node.type === 'set-variable') {
				executeInteraction(Object.assign({ type: 'set-variable' }, node.config || {}));
				var setVariableEdge = getNextEdge(node.id, 'next');
				if (setVariableEdge) runNode(setVariableEdge.target);
				return;
			}
			if (node.type === 'delay') {
				var duration = Math.max(0, parseInt(node.config && node.config.durationMs, 10) || 0);
				var delayEdge = getNextEdge(node.id, 'next');
				if (delayEdge) window.setTimeout(function() { runNode(delayEdge.target); }, duration);
				return;
			}
			if (node.type === 'condition') {
				var branchPort = evaluateConditionNode(node) ? 'true' : 'false';
				var conditionEdge = getNextEdge(node.id, branchPort) || getNextEdge(node.id, 'next');
				if (conditionEdge) runNode(conditionEdge.target);
				return;
			}
			if (node.type === 'end') return;
			var fallbackEdge = getNextEdge(node.id, 'next');
			if (fallbackEdge) runNode(fallbackEdge.target);
		};
		if (triggerNode) runNode(triggerNode.id);
	};
	var bindFlow = function(node) {
		if (!node || node.dataset.fbFlowBound === '1') return;
		var flow = parseJsonAttr(node.dataset.fbFlow, null);
		if (!flow || !Array.isArray(flow.nodes) || !flow.nodes.length) return;
		node.dataset.fbFlowBound = '1';
		node.style.cursor = 'pointer';
		node.addEventListener('click', function(event) {
			event.stopPropagation();
			executeFlow(flow);
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
				executeInteraction(interaction);
			});
		});
	};
	restorePersistentVariables('page');
	restorePersistentVariables('global');
	applyAllBindings();
	scope.querySelectorAll('[data-fb-flow]').forEach(bindFlow);
	scope.querySelectorAll('[data-fb-interactions]').forEach(bindInteractions);
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
		gsap.set(node, { scaleX: 0.935, scaleY: 0.935, transformOrigin: 'top left' });
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
	var buildBlurValue = function(value) {
		var amount = typeof value === 'number' ? value : parseFloat(value);
		amount = isFinite(amount) ? Math.max(0, amount) : 0;
		return amount > 0.01 ? 'blur(' + amount + 'px)' : 'none';
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
	var refreshNaturalMarkerAnchor = function(target, ancestor) {
		if (!target || !ancestor) return;
		if (isStickyNodeElement(target)) {
			var stickyLocalOffsetTop = getCumulativeOffsetTop(target) - getCumulativeOffsetTop(ancestor);
			if (isFinite(stickyLocalOffsetTop)) {
				target.__fbNaturalLocalOffsetTop = stickyLocalOffsetTop;
				return;
			}
		}
		if (isOffsetParentAncestor(target, ancestor)) {
			target.__fbNaturalLocalOffsetTop = getCumulativeOffsetTop(target) - getCumulativeOffsetTop(ancestor);
			return;
		}
		var ancestorRect = ancestor.getBoundingClientRect();
		var targetRect = target.getBoundingClientRect();
		target.__fbNaturalLocalOffsetTop = targetRect.top - ancestorRect.top;
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
		return {
			board: board,
			boardHeight: Math.max(1, board.clientHeight || board.offsetHeight || 1),
			boardDocumentTop: getDocumentTop(board),
			naturalTop: getNaturalMarkerAnchor(node, board)
		};
	};
	var resolveMarkerOffsetPxFromContext = function(context, ratioValue, offsetPxValue, fallback) {
		if (!context) return 0;
		var markerOffsetPx = normalizeAnimationMarkerOffsetPx(offsetPxValue);
		if (markerOffsetPx != null) {
			return markerOffsetPx;
		}
		var markerRatio = clamp(parseNumber(ratioValue, fallback), 0, 1);
		return (markerRatio * context.boardHeight) - context.naturalTop;
	};
	var resolveScrollSequenceMarkerOffsetPxFromContext = function(context, ratioValue, offsetPxValue, fallback) {
		return Math.max(0, resolveMarkerOffsetPxFromContext(context, ratioValue, offsetPxValue, fallback));
	};
	var resolveMarkerLocalYFromContext = function(context, ratioValue, offsetPxValue, fallback) {
		if (!context) return 0;
		return context.naturalTop + resolveMarkerOffsetPxFromContext(context, ratioValue, offsetPxValue, fallback);
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
		return getNodeAnchorDocumentTopFromContext(context) + resolveMarkerOffsetPxFromContext(context, ratioValue, offsetPxValue, fallback);
	};
	var buildScrollAnimationMetrics = function(node, start, end, startOffsetPx, endOffsetPx) {
		var context = buildNodeMarkerContext(node);
		if (!context) return null;
		return {
			context: context,
			startOffsetPx: resolveScrollSequenceMarkerOffsetPxFromContext(context, start, startOffsetPx, 0.2),
			endOffsetPx: resolveScrollSequenceMarkerOffsetPxFromContext(context, end, endOffsetPx, 0.68)
		};
	};
	var getScrollAnimationProgressFromMetrics = function(metrics) {
		if (!metrics) return 0;
		var travel = getNodeAnchorTravelFromContext(metrics.context);
		var range = metrics.endOffsetPx - metrics.startOffsetPx;
		if (Math.abs(range) < 0.0001) return travel >= metrics.endOffsetPx ? 1 : 0;
		return clamp((travel - metrics.startOffsetPx) / range, 0, 1);
	};
	var getLocalOffsetWithinAncestor = function(target, ancestor) {
		if (!target || !ancestor) return 0;
		if (typeof target.__fbNaturalLocalOffsetTop === 'number') {
			return target.__fbNaturalLocalOffsetTop;
		}
		if (isOffsetParentAncestor(target, ancestor)) {
			return getCumulativeOffsetTop(target) - getCumulativeOffsetTop(ancestor);
		}
		cacheNaturalMarkerAnchor(target, ancestor);
		if (typeof target.__fbNaturalLocalOffsetTop === 'number') {
			return target.__fbNaturalLocalOffsetTop;
		}
		var ancestorRect = ancestor.getBoundingClientRect();
		var targetRect = target.getBoundingClientRect();
		return targetRect.top - ancestorRect.top;
	};
	var getMarkerLocalY = function(node, ratioValue, offsetPxValue, fallback) {
		if (!node) return 0;
		var board = getNodeMarkerBoard(node);
		var boardHeight = Math.max(1, board ? (board.clientHeight || board.offsetHeight || 1) : 1);
		var markerOffsetPx = normalizeAnimationMarkerOffsetPx(offsetPxValue);
		if (markerOffsetPx != null) {
			return getLocalOffsetWithinAncestor(node, board) + markerOffsetPx;
		}
		var markerRatio = clamp(parseNumber(ratioValue, fallback), 0, 1);
		return markerRatio * boardHeight;
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
		var context = buildNodeMarkerContext(node);
		if (!context) return Infinity;
		return resolveMarkerOffsetPxFromContext(context, ratioValue, offsetPxValue, fallback) - getNodeAnchorTravelFromContext(context);
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
			if (forceAnchorRefresh || !isStickyNodeElement(node)) {
				refreshNaturalMarkerAnchor(node, getNodeMarkerBoard(node));
			}
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
	var getAnimationBaseState = function(node) {
		if (node.__fbAnimationBaseState) return node.__fbAnimationBaseState;
		var computed = window.getComputedStyle(node);
		var rect = node.getBoundingClientRect();
		var textNode = node.querySelector('.fb-text-content');
		var iconNode = node.querySelector('.fb-icon-content');
		var textComputed = textNode ? window.getComputedStyle(textNode) : null;
		var contentComputed = textComputed || (iconNode ? window.getComputedStyle(iconNode) : null) || computed;
		node.__fbAnimationBaseState = {
			left: parseNumber(node.style.left, parseNumber(computed.left, 0)),
			top: parseNumber(node.style.top, parseNumber(computed.top, 0)),
			leftCss: node.style.left || '',
			topCss: node.style.top || '',
			position: computed.position,
			width: parseNumber(node.style.width, rect.width || node.offsetWidth || parseNumber(computed.width, 0)),
			height: parseNumber(node.style.height, rect.height || node.offsetHeight || parseNumber(computed.height, 0)),
			widthCss: node.style.width || '',
			heightCss: node.style.height || '',
			rotation: getRotationFromComputedStyle(computed),
			opacity: parseNumber(computed.opacity, 1),
			backgroundColor: computed.backgroundColor,
			color: contentComputed.color,
			borderColor: computed.borderColor,
			borderRadius: computed.borderRadius,
			blur: parseBlurRadius(computed.filter),
			filter: computed.filter || 'none',
			backdropBlur: parseBlurRadius(computed.backdropFilter || computed.webkitBackdropFilter),
			backdropFilter: computed.backdropFilter || computed.webkitBackdropFilter || 'none',
			textNode: textNode,
			iconNode: iconNode
		};
		return node.__fbAnimationBaseState;
	};
	var restoreAnimationBaseState = function(node) {
		if (!node) return;
		var baseState = getAnimationBaseState(node);
		if (gsap) {
			gsap.killTweensOf(node);
			gsap.set(node, {
				opacity: baseState.opacity,
				x: 0,
				y: 0,
				scaleX: 1,
				scaleY: 1,
				rotation: baseState.rotation || 0,
				rotationX: 0,
				rotationY: 0,
				skewX: 0,
				skewY: 0,
				overwrite: true,
			});
		}
		node.style.left = baseState.leftCss;
		node.style.top = baseState.topCss;
		node.style.width = baseState.widthCss;
		node.style.height = baseState.heightCss;
		node.style.backgroundColor = baseState.backgroundColor;
		node.style.borderColor = baseState.borderColor;
		node.style.borderRadius = baseState.borderRadius;
		node.style.filter = baseState.filter;
		setNodeBackdropFilter(node, baseState.backdropFilter);
		(baseState.textNode || baseState.iconNode || node).style.color = baseState.color;
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
	var applyEnterAnimation = function(node, animation) {
		if (!node) return;
		var effect = animation && animation.effect ? animation.effect : {};
		var startState = animation && animation.startState && typeof animation.startState === 'object' ? animation.startState : {};
		var startLayout = startState.layout && typeof startState.layout === 'object' ? startState.layout : {};
		var startStyles = startState.styles && typeof startState.styles === 'object' ? startState.styles : {};
		var baseState = getAnimationBaseState(node);
		var contentTarget = baseState.textNode || baseState.iconNode || null;
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
		if (Object.prototype.hasOwnProperty.call(startLayout, 'x')) fromVars.left = parseNumber(startLayout.x, baseState.left);
		if (Object.prototype.hasOwnProperty.call(startLayout, 'y')) fromVars.top = parseNumber(startLayout.y, baseState.top);
		if (Object.prototype.hasOwnProperty.call(startLayout, 'width')) fromVars.width = parseNumber(startLayout.width, baseState.width);
		if (Object.prototype.hasOwnProperty.call(startLayout, 'height')) fromVars.height = parseNumber(startLayout.height, baseState.height);
		if (Object.prototype.hasOwnProperty.call(startLayout, 'rotation')) fromVars.rotation = parseNumber(startLayout.rotation, parseNumber(effect.rotate, 0));
		if (Object.prototype.hasOwnProperty.call(startStyles, 'backgroundColor')) fromVars.backgroundColor = startStyles.backgroundColor;
		if (Object.prototype.hasOwnProperty.call(startStyles, 'borderColor')) fromVars.borderColor = startStyles.borderColor;
		if (Object.prototype.hasOwnProperty.call(startStyles, 'borderRadius')) fromVars.borderRadius = startStyles.borderRadius;
		if (Object.prototype.hasOwnProperty.call(startStyles, 'blur')) fromVars.filter = buildBlurValue(parseNumber(startStyles.blur, baseState.blur));
		if (Object.prototype.hasOwnProperty.call(startStyles, 'backdropBlur')) fromVars.backdropFilter = buildBlurValue(parseNumber(startStyles.backdropBlur, baseState.backdropBlur));
		var toVars = {
			opacity: baseState.opacity,
			x: 0,
			y: 0,
			scaleX: 1,
			scaleY: 1,
			rotation: baseState.rotation || 0,
			rotationX: 0,
			rotationY: 0,
			skewX: 0,
			skewY: 0,
			duration: enterDuration,
			ease: enterEase,
			overwrite: true,
			clearProps: 'opacity'
		};
		if (Object.prototype.hasOwnProperty.call(startLayout, 'x')) toVars.left = baseState.left;
		if (Object.prototype.hasOwnProperty.call(startLayout, 'y')) toVars.top = baseState.top;
		if (Object.prototype.hasOwnProperty.call(startLayout, 'width')) toVars.width = baseState.width;
		if (Object.prototype.hasOwnProperty.call(startLayout, 'height')) toVars.height = baseState.height;
		if (Object.prototype.hasOwnProperty.call(startStyles, 'backgroundColor')) toVars.backgroundColor = baseState.backgroundColor;
		if (Object.prototype.hasOwnProperty.call(startStyles, 'borderColor')) toVars.borderColor = baseState.borderColor;
		if (Object.prototype.hasOwnProperty.call(startStyles, 'borderRadius')) toVars.borderRadius = baseState.borderRadius;
		if (Object.prototype.hasOwnProperty.call(startStyles, 'blur')) toVars.filter = baseState.filter;
		if (Object.prototype.hasOwnProperty.call(startStyles, 'backdropBlur')) toVars.backdropFilter = baseState.backdropFilter;
		gsap.fromTo(node, fromVars, toVars);
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
		var endState = animation.endState && typeof animation.endState === 'object' ? animation.endState : {};
		var endLayout = endState.layout && typeof endState.layout === 'object' ? endState.layout : {};
		var endStyles = endState.styles && typeof endState.styles === 'object' ? endState.styles : {};
		var baseState = getAnimationBaseState(node);
		var progress = typeof forcedProgress === 'number' ? forcedProgress : getScrollAnimationProgress(node, animation.start, animation.end, animation.startOffset, animation.endOffset, animation.startOffsetPx, animation.endOffsetPx);
		var finalOpacity = Object.prototype.hasOwnProperty.call(endStyles, 'opacity') ? parseNumber(endStyles.opacity, baseState.opacity) : baseState.opacity;
		var currentOpacity = lerp(baseState.opacity, finalOpacity, progress);
		var currentRotate = lerp(baseState.rotation || 0, parseNumber(endLayout.rotation, baseState.rotation || 0), progress);
		var nextVars = {
			opacity: currentOpacity,
			x: 0,
			y: 0,
			scaleX: 1,
			scaleY: 1,
			rotation: currentRotate,
			rotationX: 0,
			rotationY: 0,
			skewX: 0,
			skewY: 0,
			overwrite: true,
		};
		if (shouldAnimatePositionOverride(baseState.leftCss, baseState.position, endLayout, 'x')) {
			nextVars.left = lerp(baseState.left, parseNumber(endLayout.x, baseState.left), progress);
		}
		if (shouldAnimatePositionOverride(baseState.topCss, baseState.position, endLayout, 'y')) {
			nextVars.top = lerp(baseState.top, parseNumber(endLayout.y, baseState.top), progress);
		}
		if (shouldAnimateDimensionOverride(baseState.widthCss, endLayout, 'width', 'widthMode', 'widthPct')) {
			nextVars.width = lerp(baseState.width, parseNumber(endLayout.width, baseState.width), progress);
		}
		if (shouldAnimateDimensionOverride(baseState.heightCss, endLayout, 'height', 'heightMode', 'heightPct')) {
			nextVars.height = lerp(baseState.height, parseNumber(endLayout.height, baseState.height), progress);
		}
		if (gsap) gsap.set(node, nextVars);
		else {
			node.style.opacity = String(currentOpacity);
			node.style.transform = 'rotate(' + currentRotate + 'deg)';
		}
		if (Object.prototype.hasOwnProperty.call(endStyles, 'backgroundColor')) {
			node.style.backgroundColor = interpolateValue(baseState.backgroundColor, endStyles.backgroundColor, progress);
		}
		if (Object.prototype.hasOwnProperty.call(endStyles, 'color')) {
			(baseState.textNode || baseState.iconNode || node).style.color = interpolateValue(baseState.color, endStyles.color, progress);
		}
		if (Object.prototype.hasOwnProperty.call(endStyles, 'borderColor')) {
			node.style.borderColor = interpolateValue(baseState.borderColor, endStyles.borderColor, progress);
		}
		if (Object.prototype.hasOwnProperty.call(endStyles, 'borderRadius')) {
			node.style.borderRadius = interpolateValue(baseState.borderRadius, endStyles.borderRadius, progress);
		}
		if (Object.prototype.hasOwnProperty.call(endStyles, 'blur')) {
			node.style.filter = buildBlurValue(interpolateValue(baseState.blur, parseNumber(endStyles.blur, baseState.blur), progress));
		}
		if (Object.prototype.hasOwnProperty.call(endStyles, 'backdropBlur')) {
			setNodeBackdropFilter(node, buildBlurValue(interpolateValue(baseState.backdropBlur, parseNumber(endStyles.backdropBlur, baseState.backdropBlur), progress)));
		}
	};
	var initElementAnimations = function(node) {
		if (!node || node.dataset.fbAnimationsBound === '1') return;
		var readAnimations = function() {
			return parseJsonAttr(node.dataset.fbAnimations, null);
		};
		if (!readAnimations()) return;
		refreshNaturalMarkerAnchor(node, getNodeMarkerBoard(node));
		node.dataset.fbAnimationsBound = '1';
		var enterPlayed = new Set();
		var scrollPlaybackState = { maxProgress: 0 };
		var scrollMetrics = null;
		var scrollMetricsKey = '';
		var refreshScrollMetrics = function(animation) {
			if (!animation) {
				scrollMetrics = null;
				scrollMetricsKey = '';
				return;
			}
			refreshNaturalMarkerAnchor(node, getNodeMarkerBoard(node));
			scrollMetrics = buildScrollAnimationMetrics(node, animation.start, animation.end, animation.startOffsetPx, animation.endOffsetPx);
			scrollMetricsKey = [getCurrentBreakpoint(), animation.id, animation.startOffsetPx, animation.endOffsetPx, animation.start, animation.end].join(':');
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
		var scrollFrame = null;
		var updateScrollAnimations = function() {
			scrollFrame = null;
			var animation = resolveAnimationsForBreakpoint(readAnimations(), getCurrentBreakpoint()).find(function(entry) {
				return entry && entry.type === 'scroll';
			}) || null;
			if (!animation) {
				refreshScrollMetrics(null);
				scrollPlaybackState.maxProgress = 0;
				restoreAnimationBaseState(node);
				return;
			}
			var nextMetricsKey = [getCurrentBreakpoint(), animation.id, animation.startOffsetPx, animation.endOffsetPx, animation.start, animation.end].join(':');
			if (!scrollMetrics || scrollMetricsKey !== nextMetricsKey) {
				refreshScrollMetrics(animation);
			}
			var progress = getScrollAnimationProgressFromMetrics(scrollMetrics);
			if (animation.playback === 'once') {
				scrollPlaybackState.maxProgress = Math.max(scrollPlaybackState.maxProgress, progress);
				progress = scrollPlaybackState.maxProgress;
			} else if (progress <= 0.001) {
				scrollPlaybackState.maxProgress = 0;
			}
			applyScrollAnimation(node, animation, progress);
		};
		var requestScrollUpdate = function() {
			if (scrollFrame) return;
			scrollFrame = window.requestAnimationFrame(updateScrollAnimations);
		};
		var handleScrollResize = function() {
			var animation = resolveAnimationsForBreakpoint(readAnimations(), getCurrentBreakpoint()).find(function(entry) {
				return entry && entry.type === 'scroll';
			}) || null;
			refreshScrollMetrics(animation);
			requestScrollUpdate();
		};
		window.addEventListener('scroll', requestScrollUpdate, { passive: true });
		window.addEventListener('resize', handleScrollResize);
		window.addEventListener('load', handleScrollResize);
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
				transformOrigin: 'top left',
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
			transformOrigin: 'top left',
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
			transformOrigin: 'top left',
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
			gsap.set(current, { opacity: 1, x: 0, scaleX: 1, scaleY: 1, transformOrigin: 'top left' });
			gsap.set(next, { opacity: crossfadeVariants ? 0 : 1, transformOrigin: 'top left' });
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
			gsap.set(current, { opacity: 1, x: 0, scale: 1, transformOrigin: 'top left' });
			gsap.set(next, { opacity: crossfadeVariants ? 0 : 1, x: -travel * 0.82 * direction, scale: 0.94, transformOrigin: 'top left' });
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
		gsap.set(current, { opacity: 1, x: 0, scale: 1, transformOrigin: 'top left' });
		gsap.set(next, { opacity: 0, x: -travel * 0.72 * direction, scale: 0.992, transformOrigin: 'top left' });
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
	scope.querySelectorAll('[data-fb-animations]').forEach(initElementAnimations);
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
		refreshNaturalMarkerAnchor(instance, getNodeMarkerBoard(instance));
		queueAppear();
		window.addEventListener('scroll', requestScrollVariantUpdate, { passive: true });
		window.addEventListener('resize', function() {
			refreshNaturalMarkerAnchor(instance, getNodeMarkerBoard(instance));
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
